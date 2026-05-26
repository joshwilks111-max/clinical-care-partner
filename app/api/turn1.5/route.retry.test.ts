// app/api/turn1.5/route.retry.test.ts
//
// RETRY-BEHAVIOUR tests for the turn-1.5 collapse-decider route, SDK MOCKED at
// the boundary (`ai`'s generateText). NO live calls. These prove the bounded
// transient-only retry contract end-to-end — scoped to the ASK PHASE, the ONLY
// phase that calls the model (decide-plan / decide-abstain / every answer arm
// make ZERO calls, so there is nothing to retry there):
//
//   (a) ASK transient ONCE, then success → final status:"ask" (recovered).
//   (b) ASK persistent transient (every attempt fails) → status:"error"
//       (red 502) after EXACTLY the bounded attempt count — no infinite loop.
//   (c) ASK Zod/parse failure (non-transient) → status:"error" IMMEDIATELY with
//       ZERO retries (generateText called once).
//   (d) ASK auth error (non-transient) → status:"error" IMMEDIATELY, ZERO retries.
//
// The mock queue holds, per generateText call, EITHER a structured output (to
// resolve) OR an {throw: Error} marker (to throw) — scripting the exact
// transient/non-transient sequence the route will see.

import { describe, it, expect, vi, beforeEach } from "vitest";

// --- SDK boundary mock: queue of {output} | {throw} actions, per call. ---
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
import type { CaseState } from "@/lib/case-state";
import type { Differential } from "@/lib/schemas";

// The canonical "ask" setup: croup likely (+ mapped) + epiglottitis must-not-miss
// with ZERO positives at round 0 → decideCollapse returns "ask" → ONE model call.
const ambiguousDifferential: Differential = {
  conditions: [
    {
      name: "Croup",
      likelihood: "likely",
      positive_evidence: ["barky cough", "stridor at rest", "age 3"],
      negative_evidence: ["drooling", "tripod posture", "muffled voice"],
    },
    {
      name: "Epiglottitis",
      likelihood: "must-not-miss",
      positive_evidence: [],
      negative_evidence: ["drooling", "tripod posture", "muffled voice"],
    },
  ],
  candidate_guidelines: [
    { guideline_id: "starship-croup-2020", label: "Starship croup (NZ)" },
  ],
};

function makeCaseState(): CaseState {
  return {
    note_hash: "deadbeef",
    extracted_facts: {
      condition_hints: ["croup"],
      severity: "moderate",
      weight_kg: 14.2,
      age: "3yo",
      profession: null,
      setting: null,
    },
    differential: ambiguousDifferential,
    selected_condition: "croup",
    selected_guideline_id: null,
    selected_severity: "moderate",
    discriminating_qa: [],
    round: 0,
  };
}

function postDecide(): Request {
  return new Request("http://localhost/api/turn1.5", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phase: "decide", caseState: makeCaseState() }),
  });
}

const phrasedQuestion = {
  question:
    "Is the child drooling, sitting in a tripod posture, or showing a muffled voice?",
};

/** The SDK no-output transient miss (name + message both match TRANSIENT). */
function transientError(): Error {
  const e = new Error("No output generated.");
  e.name = "AI_NoOutputGeneratedError";
  return e;
}

beforeEach(() => {
  actionQueue.length = 0;
  generateTextCalls.length = 0;
});

describe("POST /api/turn1.5 — bounded transient-only retry (ask phase)", () => {
  it("(a) ASK transient once, then success → status 'ask' (retry recovered)", async () => {
    actionQueue.push({ throw: transientError() });
    actionQueue.push({ output: phrasedQuestion });

    const res = await POST(postDecide());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status?: string; question?: string };
    expect(body.status).toBe("ask");
    expect(body.question).toBe(phrasedQuestion.question);
    // 1 transient miss + 1 successful retry = 2 calls.
    expect(generateTextCalls.length).toBe(2);
  });

  it("(b) ASK persistent transient → status 'error' after EXACTLY 3 attempts (bounded)", async () => {
    actionQueue.push({ throw: transientError() });
    actionQueue.push({ throw: transientError() });
    actionQueue.push({ throw: transientError() });
    // A 4th queued action is consumed only if the route looped past the bound —
    // its presence lets us prove no 4th call was made.
    actionQueue.push({ output: phrasedQuestion });

    const res = await POST(postDecide());
    expect(res.status).toBe(502);
    const body = (await res.json()) as { status?: string };
    expect(body.status).toBe("error");
    // EXACTLY 3 attempts — bounded, never infinite.
    expect(generateTextCalls.length).toBe(3);
    // The 4th action is still queued (proving no 4th call was made).
    expect(actionQueue.length).toBe(1);
  });

  it("(c) ASK Zod parse failure (non-transient) → status 'error' IMMEDIATELY, ZERO retries", async () => {
    // The model returns a malformed output → DiscriminatingQuestion.parse throws
    // a ZodError (non-transient) → red on the first attempt, no retry.
    actionQueue.push({ output: { not_a_question: true } });
    // A spare success that must NOT be consumed (no retry on a parse failure).
    actionQueue.push({ output: phrasedQuestion });

    const res = await POST(postDecide());
    expect(res.status).toBe(502);
    const body = (await res.json()) as { status?: string };
    expect(body.status).toBe("error");
    // Exactly one attempt; no retry on a Zod failure.
    expect(generateTextCalls.length).toBe(1);
    expect(actionQueue.length).toBe(1);
  });

  it("(d) ASK auth error (non-transient) → status 'error' IMMEDIATELY, ZERO retries", async () => {
    const auth = new Error("401 Unauthorized: invalid x-api-key");
    actionQueue.push({ throw: auth });
    actionQueue.push({ output: phrasedQuestion }); // must not be consumed

    const res = await POST(postDecide());
    expect(res.status).toBe(502);
    const body = (await res.json()) as { status?: string };
    expect(body.status).toBe("error");
    expect(generateTextCalls.length).toBe(1);
    expect(actionQueue.length).toBe(1);
  });
});
