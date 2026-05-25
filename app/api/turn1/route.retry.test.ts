// app/api/turn1/route.retry.test.ts
//
// RETRY-BEHAVIOUR tests for the turn-1 differential route, SDK MOCKED at the
// boundary (`ai`'s generateText). NO live calls. Proves the bounded
// transient-only retry contract on the differential model call AND that the
// PRE-LLM refusal gate is untouched by the retry:
//
//   (a) transient ONCE, then success → status:"ok" (retry recovered).
//   (b) persistent transient → status:"error" (red 502) after EXACTLY the
//       bounded attempt count (3) — no infinite loop.
//   (c) Zod parse failure (non-transient) → status:"error" IMMEDIATELY with
//       ZERO retries (generateText called exactly once).
//   (d) the pre-LLM weight-missing refusal still makes ZERO model calls — the
//       gate runs BEFORE the retry-wrapped call (the headline guarantee).
//
// NOTE: the existing route.test.ts fetch-spy/refusal suite is unchanged and
// stays green; this file adds the retry-specific coverage with the SDK mocked.

import { describe, it, expect, vi, beforeEach } from "vitest";

type Action = { output: unknown } | { throw: Error };
const actionQueue: Action[] = [];
const generateTextCalls: unknown[] = [];

vi.mock("ai", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    generateText: vi.fn(async (opts: unknown) => {
      generateTextCalls.push(opts);
      if (actionQueue.length === 0) {
        throw new Error("test: generateText called more times than queued");
      }
      const action = actionQueue.shift()!;
      if ("throw" in action) throw action.throw;
      return { experimental_output: action.output };
    }),
  };
});

vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: () => () => ({ __model: "stub" }),
}));

import { POST } from "./route";

// A well-formed turn-1 structured output (weight present → passes the gate).
// Matches lib/schemas.ts Turn1Output exactly: condition.name + the likelihood
// enum + positive/negative_evidence arrays, and candidate_guidelines as
// {guideline_id,label} objects (NOT bare strings).
const validTurn1Output = {
  extracted_facts: {
    condition_hints: ["croup"],
    severity: "moderate",
    weight_kg: 14.2,
    age: "3yo",
    profession: null,
    setting: null,
  },
  differential: {
    conditions: [
      {
        name: "croup",
        likelihood: "likely",
        positive_evidence: ["Barky cough", "Stridor at rest"],
        negative_evidence: ["[NOT MENTIONED] cyanosis"],
      },
    ],
    candidate_guidelines: [
      { guideline_id: "starship-croup-2020", label: "Croup (Starship 2020)" },
    ],
  },
};

// A note WITH a kg weight so the pre-LLM gate passes and STEP 2 (model) runs.
const NOTE_WITH_WEIGHT = "3yo, 14.2 kg, barky cough and stridor at rest.";
// A note with NO kg weight → the pre-LLM gate refuses with zero model calls.
const NOTE_NO_WEIGHT = "3yo with barky cough and stridor";

function postNote(note: string): Request {
  return new Request("http://localhost/api/turn1", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ note }),
  });
}

function transientError(): Error {
  const e = new Error("No output generated.");
  e.name = "AI_NoOutputGeneratedError";
  return e;
}

beforeEach(() => {
  actionQueue.length = 0;
  generateTextCalls.length = 0;
});

describe("POST /api/turn1 — bounded transient-only retry", () => {
  it("(a) transient once, then success → status 'ok' (retry recovered)", async () => {
    actionQueue.push({ throw: transientError() });
    actionQueue.push({ output: validTurn1Output });

    const res = await POST(postNote(NOTE_WITH_WEIGHT));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status?: string };
    expect(body.status).toBe("ok");
    // 1 transient miss + 1 successful retry = 2 calls.
    expect(generateTextCalls.length).toBe(2);
  });

  it("(b) persistent transient → status 'error' after EXACTLY 3 attempts (bounded)", async () => {
    actionQueue.push({ throw: transientError() });
    actionQueue.push({ throw: transientError() });
    actionQueue.push({ throw: transientError() });
    actionQueue.push({ output: validTurn1Output }); // must NOT be consumed

    const res = await POST(postNote(NOTE_WITH_WEIGHT));
    expect(res.status).toBe(502);
    const body = (await res.json()) as { status?: string };
    expect(body.status).toBe("error");
    // EXACTLY 3 attempts (1 try + 2 retries) — bounded, never infinite.
    expect(generateTextCalls.length).toBe(3);
    expect(actionQueue.length).toBe(1);
  });

  it("(c) Zod parse failure (non-transient) → status 'error' IMMEDIATELY, ZERO retries", async () => {
    // A structurally invalid output (missing extracted_facts) → Turn1Output.parse
    // throws a ZodError (non-transient) → red on the first attempt.
    actionQueue.push({ output: { differential: { conditions: [] } } });
    actionQueue.push({ output: validTurn1Output }); // must NOT be consumed

    const res = await POST(postNote(NOTE_WITH_WEIGHT));
    expect(res.status).toBe(502);
    const body = (await res.json()) as { status?: string };
    expect(body.status).toBe("error");
    // Called exactly once — a Zod failure is never retried.
    expect(generateTextCalls.length).toBe(1);
    expect(actionQueue.length).toBe(1);
  });

  it("(d) pre-LLM weight-missing refusal still makes ZERO model calls", async () => {
    // The gate runs BEFORE the retry-wrapped model call, so a weightless note
    // refuses without ever invoking generateText — even with actions queued.
    actionQueue.push({ output: validTurn1Output }); // must NOT be consumed

    const res = await POST(postNote(NOTE_NO_WEIGHT));
    expect(res.status).toBe(200); // a refusal is a deliberate decision (200).
    const body = (await res.json()) as { status?: string; reason?: string };
    expect(body.status).toBe("refusal");
    expect(body.reason).toBe("weight_missing");
    // THE headline guarantee: retry never touches the gate → zero model calls.
    expect(generateTextCalls.length).toBe(0);
    expect(actionQueue.length).toBe(1);
  });
});

describe("POST /api/turn1 — POST-model weight gate (distinct from the pre-LLM gate)", () => {
  it("note HAS a kg weight but the model extracts weight_kg:null → refusal AFTER the model ran", async () => {
    // The pre-LLM gate is regex-presence only ("14.2 kg" is present → it passes
    // and STEP 2 runs). But the MODEL is the authoritative extractor and may still
    // judge the figure not a usable patient weight, returning weight_kg:null. The
    // POST-model defensive gate must catch THAT and refuse — never proceed to build
    // a CaseState with a null weight. This proves the post-model gate (not the
    // pre-LLM one): generateText WAS called exactly once before the refusal.
    const outputWithNullWeight = {
      ...validTurn1Output,
      extracted_facts: { ...validTurn1Output.extracted_facts, weight_kg: null },
    };
    actionQueue.push({ output: outputWithNullWeight });

    const res = await POST(postNote(NOTE_WITH_WEIGHT));
    expect(res.status).toBe(200); // a refusal is a deliberate decision (200).
    const body = (await res.json()) as { status?: string; reason?: string };
    expect(body.status).toBe("refusal");
    expect(body.reason).toBe("weight_missing");
    // THE proof it's the POST-model gate: the model DID run (pre-LLM gate passed
    // because the note carries a kg figure) — exactly one call, then refused.
    expect(generateTextCalls.length).toBe(1);
    expect(actionQueue.length).toBe(0);
  });
});
