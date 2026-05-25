// app/api/turn2/route.retry.test.ts
//
// RETRY-BEHAVIOUR tests for the turn-2 apply route, SDK MOCKED at the boundary
// (`ai`'s generateText). NO live calls. These prove the bounded transient-only
// retry contract end-to-end through the real route handler:
//
//   (a) STEP A transient ONCE, then success → final status:"ok" (recovered).
//   (b) STEP A persistent transient (every attempt fails) → status:"error"
//       (red 502) after EXACTLY the bounded attempt count — no infinite loop.
//   (c) STEP B Zod/validation parse failure (non-transient) → status:"error"
//       IMMEDIATELY with ZERO retries (generateText for STEP B called once).
//   (+) a transient on STEP B specifically also recovers (both steps wrapped).
//
// The mock queue holds, per generateText call, EITHER a structured output (to
// resolve) OR an {__throw: Error} marker (to throw). This lets each test script
// the exact transient/non-transient sequence the route will see.

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

function makeCaseState(overrides: Partial<CaseState> = {}): CaseState {
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
    differential: { conditions: [], candidate_guidelines: [] },
    selected_condition: "croup",
    selected_guideline_id: "starship-croup-2020",
    selected_severity: "moderate",
    ...overrides,
  };
}

function postCaseState(caseState: unknown): Request {
  return new Request("http://localhost/api/turn2", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ caseState }),
  });
}

const moderateClassification = {
  severity_row: "moderate",
  dose_rule_id: "croup-dex-moderate",
  reasoning: "Stridor at rest, no cyanosis → moderate row.",
};

const completeCroupPlan = {
  recommendations: [
    {
      text: "Give oral dexamethasone 2.13 mg as a single dose.",
      source_section: "Croup — Corticosteroid treatment (dexamethasone dosing)",
      source_version: "Starship NZ Clinical Guideline, 2020",
      source_url:
        "https://starship.org.nz/guidelines/croup/ [CONFIRM URL AT BUILD]",
      quote: "dexamethasone 0.15 mg/kg ORALLY, single dose",
    },
  ],
  required_fields: {
    diagnosis: { present: true, value: "croup" },
    severity: { present: true, value: "moderate" },
    drug: { present: true, value: "dexamethasone" },
    dose: { present: true, value: "2.13 mg oral" },
    route: { present: true, value: "oral" },
    escalation_criteria: {
      present: true,
      value: "Nebulised adrenaline + senior help for severe croup.",
    },
    disposition: { present: true, value: "Observe; discharge once stable." },
  },
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

describe("POST /api/turn2 — bounded transient-only retry", () => {
  it("(a) STEP A transient once, then success → status 'ok' (retry recovered)", async () => {
    // STEP A: throw transient, then succeed. STEP B: succeed.
    actionQueue.push({ throw: transientError() });
    actionQueue.push({ output: moderateClassification });
    actionQueue.push({ output: completeCroupPlan });

    const res = await POST(postCaseState(makeCaseState()));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status?: string };
    expect(body.status).toBe("ok");
    // 1 transient miss + 1 successful STEP-A retry + 1 STEP-B = 3 calls.
    expect(generateTextCalls.length).toBe(3);
  });

  it("(b) STEP A persistent transient → status 'error' after EXACTLY 3 attempts (bounded)", async () => {
    // Every STEP-A attempt throws transient. Bound is 3 (1 try + 2 retries).
    actionQueue.push({ throw: transientError() });
    actionQueue.push({ throw: transientError() });
    actionQueue.push({ throw: transientError() });
    // A 4th queued action would be consumed only if it looped past the bound —
    // its presence lets us prove the route did NOT call a 4th time.
    actionQueue.push({ output: moderateClassification });

    const res = await POST(postCaseState(makeCaseState()));
    expect(res.status).toBe(502);
    const body = (await res.json()) as { status?: string; message?: string };
    expect(body.status).toBe("error");
    // EXACTLY 3 STEP-A attempts — bounded, never infinite. STEP B never ran.
    expect(generateTextCalls.length).toBe(3);
    // The 4th action is still queued (proving no 4th call was made).
    expect(actionQueue.length).toBe(1);
  });

  it("(c) STEP B Zod parse failure (non-transient) → status 'error' IMMEDIATELY, ZERO retries", async () => {
    // STEP A succeeds. STEP B returns an UNCITED recommendation → PlanOutput.parse
    // throws a ZodError (non-transient) → red on the first STEP-B attempt.
    actionQueue.push({ output: moderateClassification });
    actionQueue.push({
      output: {
        recommendations: [{ text: "Give dexamethasone." }],
        required_fields: {},
      },
    });
    // A spare success that must NOT be consumed (no STEP-B retry).
    actionQueue.push({ output: completeCroupPlan });

    const res = await POST(postCaseState(makeCaseState()));
    expect(res.status).toBe(502);
    const body = (await res.json()) as { status?: string };
    expect(body.status).toBe("error");
    // STEP A (1) + STEP B once (1) = 2. No STEP-B retry on a Zod failure.
    expect(generateTextCalls.length).toBe(2);
    // The spare STEP-B success is still queued → STEP B was NOT retried.
    expect(actionQueue.length).toBe(1);
  });

  it("STEP B transient once, then success → status 'ok' (STEP B is also wrapped)", async () => {
    // STEP A succeeds; STEP B throws transient once then succeeds.
    actionQueue.push({ output: moderateClassification });
    actionQueue.push({ throw: transientError() });
    actionQueue.push({ output: completeCroupPlan });

    const res = await POST(postCaseState(makeCaseState()));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status?: string };
    expect(body.status).toBe("ok");
    // STEP A (1) + STEP B miss (1) + STEP B retry (1) = 3.
    expect(generateTextCalls.length).toBe(3);
  });

  it("STEP A auth error (non-transient) → status 'error' IMMEDIATELY, ZERO retries", async () => {
    // A 401 is NOT in the transient list → must go red on the first attempt.
    const auth = new Error("401 Unauthorized: invalid x-api-key");
    actionQueue.push({ throw: auth });
    actionQueue.push({ output: moderateClassification }); // must not be consumed

    const res = await POST(postCaseState(makeCaseState()));
    expect(res.status).toBe(502);
    const body = (await res.json()) as { status?: string };
    expect(body.status).toBe("error");
    expect(generateTextCalls.length).toBe(1);
    expect(actionQueue.length).toBe(1);
  });
});
