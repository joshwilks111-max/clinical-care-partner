// app/api/turn1.5/route.test.ts
//
// Pipeline-branch tests for the turn-1.5 collapse-decider route, with the SDK
// MOCKED at the boundary (`ai`'s generateText). Model-free + deterministic while
// exercising EVERY terminal of the SINGLE server-side decider:
//
//   phase "decide":
//     - "plan"    (no ambiguity)               → status "ok",  NO model call
//     - "abstain" (positive must-not-miss)     → abstention,   NO model call
//     - "abstain" (no guideline / unmapped)    → abstention,   NO model call
//     - "ask"     (1 mnm + 1 treatable top)    → status "ask", EXACTLY 1 call
//   phase "answer":
//     - "present"     → abstain (must-not-miss confirmed), NO model call
//     - "not_assessed"→ abstain (fail closed, SAME as present), NO model call
//     - "absent"      → ok (dx narrowed → plan croup),    NO model call
//     - 2nd unresolved at MAX_ROUNDS           → abstain,      NO model call
//   bad body → 400 ; oversized body → 413 ; bad phase → 400 ; bad answer → 400.
//
// THE NON-VACUOUS CORE: each terminal branch asserts generateTextCalls.length
// === 0 (or === 1 for the ask phase) INDEPENDENTLY — a per-branch pin, not one
// grouped assertion. This proves the dose-enabling decision is deterministic
// code, never a hidden model call, on EVERY path.
//
// HOW THE MOCK WORKS: vi.mock("ai") replaces generateText with a queue-driven
// stub returning a pre-set `experimental_output` per call. Output + stepCountIs
// pass through to the real module so the route's option shape stays honest.
// createAnthropic is stubbed so no provider is built.

import { describe, it, expect, vi, beforeEach } from "vitest";

// --- SDK boundary mock: queue of structured outputs, consumed per call. ---
const outputQueue: unknown[] = [];
const generateTextCalls: unknown[] = [];

vi.mock("ai", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    generateText: vi.fn(async (opts: unknown) => {
      generateTextCalls.push(opts);
      if (outputQueue.length === 0) {
        throw new Error("test: generateText called more times than queued");
      }
      return { experimental_output: outputQueue.shift() };
    }),
  };
});

vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: () => () => ({ __model: "stub" }),
}));

import { POST } from "./route";
import type { CaseState } from "@/lib/case-state";
import type { Differential } from "@/lib/schemas";

// ---------------------------------------------------------------------------
// Fixtures — the canonical croup/epiglottitis collapse shapes (mirror
// lib/collapse.test.ts so the route is tested against REAL decideCollapse input).
// ---------------------------------------------------------------------------

/** Croup likely (+ mapped) AND Epiglottitis must-not-miss with ZERO positives —
 *  the canonical "ask one discriminating question" setup (round 0). */
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

/** Croup likely (+ mapped), NO must-not-miss → "plan" (unambiguous). */
const planDifferential: Differential = {
  conditions: [
    {
      name: "Croup",
      likelihood: "likely",
      positive_evidence: ["barky cough", "stridor at rest"],
      negative_evidence: [],
    },
  ],
  candidate_guidelines: [
    { guideline_id: "starship-croup-2020", label: "Starship croup (NZ)" },
  ],
};

/** A must-not-miss WITH positive evidence → terminal abstain (false-negative
 *  guard; rule 2). Never asks, never plans. */
const positiveMustNotMissDifferential: Differential = {
  conditions: [
    {
      name: "Croup",
      likelihood: "likely",
      positive_evidence: ["barky cough"],
      negative_evidence: [],
    },
    {
      name: "Epiglottitis",
      likelihood: "must-not-miss",
      positive_evidence: ["drooling"],
      negative_evidence: ["tripod posture", "muffled voice"],
    },
  ],
  candidate_guidelines: [],
};

/** A single treatable top that is NOT in the registry map → no guideline →
 *  abstain (rule 6, the no-matching-guideline path). */
const unmappedDifferential: Differential = {
  conditions: [
    {
      name: "Bronchiolitis",
      likelihood: "likely",
      positive_evidence: ["wheeze", "age 1"],
      negative_evidence: [],
    },
  ],
  candidate_guidelines: [],
};

function makeCaseState(
  differential: Differential,
  overrides: Partial<CaseState> = {},
): CaseState {
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
    differential,
    selected_condition: "croup",
    selected_guideline_id: null,
    selected_severity: "moderate",
    discriminating_qa: [],
    round: 0,
    ...overrides,
  };
}

function postBody(body: unknown): Request {
  return new Request("http://localhost/api/turn1.5", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** A well-formed model question output for the ask phase. */
const phrasedQuestion = {
  question:
    "Is the child drooling, sitting in a tripod posture, or showing a muffled voice?",
};

beforeEach(() => {
  outputQueue.length = 0;
  generateTextCalls.length = 0;
});

// ---------------------------------------------------------------------------
// Bad input — red technical errors (NO model call on any of these).
// ---------------------------------------------------------------------------

describe("POST /api/turn1.5 — bad input", () => {
  it("missing phase → 400 with the phase-specific message, NO model call", async () => {
    const res = await POST(
      postBody({ caseState: makeCaseState(planDifferential) }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { status?: string; message?: string };
    expect(body.status).toBe("error");
    expect(body.message).toBe(
      "Request must include phase: 'decide' or 'answer'.",
    );
    expect(generateTextCalls.length).toBe(0);
  });

  it("invalid phase literal → 400, NO model call", async () => {
    const res = await POST(
      postBody({ phase: "go", caseState: makeCaseState(planDifferential) }),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { status?: string }).status).toBe("error");
    expect(generateTextCalls.length).toBe(0);
  });

  it("missing caseState → 400, NO model call", async () => {
    const res = await POST(postBody({ phase: "decide" }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { status?: string };
    expect(body.status).toBe("error");
    expect(generateTextCalls.length).toBe(0);
  });

  it("non-JSON body → 400, NO model call", async () => {
    const res = await POST(
      new Request("http://localhost/api/turn1.5", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not json",
      }),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { status?: string }).status).toBe("error");
    expect(generateTextCalls.length).toBe(0);
  });

  it("oversized body → 413, NO model call", async () => {
    const huge = "x".repeat(70 * 1024);
    const res = await POST(
      postBody({
        phase: "decide",
        caseState: makeCaseState(planDifferential),
        pad: huge,
      }),
    );
    expect(res.status).toBe(413);
    const body = (await res.json()) as { status?: string; message?: string };
    expect(body.status).toBe("error");
    expect(body.message).toBe("Request too large.");
    expect(generateTextCalls.length).toBe(0);
  });

  it("answer phase with an out-of-enum answer → 400, NO model call", async () => {
    const res = await POST(
      postBody({
        phase: "answer",
        caseState: makeCaseState(ambiguousDifferential),
        answer: "maybe",
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { status?: string; message?: string };
    expect(body.status).toBe("error");
    expect(body.message).toContain("present");
    expect(generateTextCalls.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// phase "decide" — the three collapse terminals.
// ---------------------------------------------------------------------------

describe("POST /api/turn1.5 — phase 'decide'", () => {
  it("PLAN (no ambiguity) → status 'ok', caseState unchanged, NO model call", async () => {
    const caseState = makeCaseState(planDifferential);
    const res = await POST(postBody({ phase: "decide", caseState }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status?: string;
      guidelineId?: string;
      caseState?: CaseState;
      provenance?: { action?: string };
    };
    expect(body.status).toBe("ok");
    expect(body.guidelineId).toBe("starship-croup-2020");
    expect(body.provenance?.action).toBe("plan");
    // caseState is UNCHANGED at the decide-plan phase (no Q&A, no round bump).
    expect(body.caseState?.round).toBe(0);
    expect(body.caseState?.discriminating_qa).toEqual([]);
    // NON-VACUITY: the dose-enabling "plan" was a deterministic short-circuit.
    expect(generateTextCalls.length).toBe(0);
  });

  it("ABSTAIN (positive must-not-miss) → abstention, NO model call", async () => {
    const res = await POST(
      postBody({
        phase: "decide",
        caseState: makeCaseState(positiveMustNotMissDifferential),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status?: string; reason?: string };
    expect(body.status).toBe("abstention");
    expect(body.reason).toBe("no_matching_guideline");
    // NON-VACUITY: a confirmed must-not-miss abstains BEFORE any model call.
    expect(generateTextCalls.length).toBe(0);
  });

  it("ABSTAIN (no matching guideline) → abstention, NO model call", async () => {
    const res = await POST(
      postBody({
        phase: "decide",
        caseState: makeCaseState(unmappedDifferential),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status?: string;
      reason?: string;
      source?: string;
    };
    expect(body.status).toBe("abstention");
    expect(body.reason).toBe("no_matching_guideline");
    expect(body.source).toBe("no-guideline");
    // NON-VACUITY: the no-guideline abstain is a deterministic short-circuit.
    expect(generateTextCalls.length).toBe(0);
  });

  it("ASK (1 unresolved mnm + 1 treatable top) → status 'ask', EXACTLY 1 model call", async () => {
    outputQueue.push(phrasedQuestion);
    const res = await POST(
      postBody({
        phase: "decide",
        caseState: makeCaseState(ambiguousDifferential),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status?: string;
      question?: string;
      target?: string;
      discriminators?: string[];
      provenance?: { action?: string };
    };
    expect(body.status).toBe("ask");
    expect(body.question).toBe(phrasedQuestion.question);
    expect(body.target).toBe("Epiglottitis");
    expect(body.discriminators).toEqual([
      "drooling",
      "tripod posture",
      "muffled voice",
    ]);
    expect(body.provenance?.action).toBe("ask");
    // The ASK phase is the ONLY phase that calls the model — exactly once.
    expect(generateTextCalls.length).toBe(1);
  });

  it("ASK then model/parse failure → red 502 (generic message)", async () => {
    // The model returns a malformed output → DiscriminatingQuestion.parse throws
    // (non-transient) → the route goes red with a GENERIC message (never echoed).
    outputQueue.push({ not_a_question: true });
    const res = await POST(
      postBody({
        phase: "decide",
        caseState: makeCaseState(ambiguousDifferential),
      }),
    );
    expect(res.status).toBe(502);
    const body = (await res.json()) as { status?: string; message?: string };
    expect(body.status).toBe("error");
    expect(body.message).toBe(
      "A technical error occurred while phrasing the question.",
    );
    expect(generateTextCalls.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// phase "answer" — the deterministic flip + re-decide. NO model call on ANY arm.
// ---------------------------------------------------------------------------

describe("POST /api/turn1.5 — phase 'answer' (NO model call on any branch)", () => {
  it("'absent' → dx narrowed → status 'ok' (plan croup), round bumped, Q&A appended, NO model call", async () => {
    const caseState = makeCaseState(ambiguousDifferential);
    const res = await POST(
      postBody({ phase: "answer", caseState, answer: "absent" }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status?: string;
      guidelineId?: string;
      caseState?: CaseState;
      provenance?: { action?: string; round?: number };
    };
    expect(body.status).toBe("ok");
    expect(body.guidelineId).toBe("starship-croup-2020");
    expect(body.provenance?.action).toBe("plan");
    // The round was incremented SERVER-side (0 → 1).
    expect(body.caseState?.round).toBe(1);
    expect(body.provenance?.round).toBe(1);
    // The Q&A was appended with the answer + the round it was asked at.
    expect(body.caseState?.discriminating_qa).toEqual([
      { question: "", answer: "absent", round: 0 },
    ]);
    // note_hash + other fields are carried VERBATIM (not rebuilt via buildCaseState).
    expect(body.caseState?.note_hash).toBe("deadbeef");
    // NON-VACUITY: the dose-enabling re-decide was deterministic — NO model call.
    expect(generateTextCalls.length).toBe(0);
  });

  it("'present' → must-not-miss confirmed → abstention, NO model call", async () => {
    const caseState = makeCaseState(ambiguousDifferential);
    const res = await POST(
      postBody({ phase: "answer", caseState, answer: "present" }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status?: string; reason?: string };
    expect(body.status).toBe("abstention");
    expect(body.reason).toBe("no_matching_guideline");
    expect(generateTextCalls.length).toBe(0);
  });

  it("'not_assessed' → FAIL CLOSED → abstention (identical to 'present'), NO model call", async () => {
    // SAFETY-CRITICAL: not_assessed maps to present:true, NOT false. "We don't
    // know if the dangerous finding is there" abstains exactly like "it might be
    // there" — it must NOT demote the must-not-miss and enable a dose. This is
    // the false-negative the whole beat prevents.
    const caseState = makeCaseState(ambiguousDifferential);
    const res = await POST(
      postBody({ phase: "answer", caseState, answer: "not_assessed" }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status?: string;
      reason?: string;
      caseState?: CaseState;
    };
    // Identical outcome to 'present' — abstain, never an "ok" that enables dosing.
    expect(body.status).toBe("abstention");
    expect(body.reason).toBe("no_matching_guideline");
    expect(generateTextCalls.length).toBe(0);
  });

  it("answer posted at MAX_ROUNDS (no pending ask) → abstain, NO model call", async () => {
    // The case is still ambiguous BUT we are already at round MAX_ROUNDS (1). The
    // answer phase first re-derives the prior decision at the CURRENT round to
    // recover the target/discriminators; at round 1 (1 < MAX_ROUNDS is false)
    // decideCollapse no longer returns "ask" (rule 6) → there is NO pending ask
    // to answer → the route abstains (fail toward stopping) rather than flip
    // evidence on a target that was never asked at this round.
    const caseState = makeCaseState(ambiguousDifferential, { round: 1 });
    const res = await POST(
      postBody({ phase: "answer", caseState, answer: "absent" }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status?: string; reason?: string };
    // At round 1 the prior decision is no longer an "ask" (MAX_ROUNDS reached),
    // so the answer phase has no pending ask → abstain.
    expect(body.status).toBe("abstention");
    expect(generateTextCalls.length).toBe(0);
  });
});
