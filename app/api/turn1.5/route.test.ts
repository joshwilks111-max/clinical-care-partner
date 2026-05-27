// app/api/turn1.5/route.test.ts
//
// Advisory Turn 1.5 route tests — SDK mocked at the boundary.

import { describe, it, expect, vi, beforeEach } from "vitest";

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

// NOTE: epiglottitis.negative_evidence has 2-of-3 registry discriminators
// (NOT all 3). This is the fixture for the "ask" path — when only some
// discriminators are documented absent, the override does NOT fire and the
// question still gets asked to flip the remaining one. The override path
// (all-3-absent) is pinned in route.override.test.ts.
const croupEpiglottitisDiff: Differential = {
  conditions: [
    {
      name: "Croup",
      likelihood: "likely",
      positive_evidence: ["barky cough", "stridor at rest"],
      negative_evidence: ["drooling", "tripod posture"],
    },
    {
      name: "Epiglottitis",
      likelihood: "must-not-miss",
      positive_evidence: [],
      negative_evidence: ["drooling", "tripod posture"],
    },
  ],
  candidate_guidelines: [
    { guideline_id: "starship-croup-2020", label: "Starship croup (NZ)" },
  ],
};

const croupOnlyDiff: Differential = {
  conditions: [
    {
      name: "Croup",
      likelihood: "likely",
      positive_evidence: ["barky cough"],
      negative_evidence: [],
    },
  ],
  candidate_guidelines: [
    { guideline_id: "starship-croup-2020", label: "Starship croup (NZ)" },
  ],
};

const emptyDiff: Differential = { conditions: [], candidate_guidelines: [] };

const unmappedDiff: Differential = {
  conditions: [
    {
      name: "Bronchiolitis",
      likelihood: "likely",
      positive_evidence: ["wheeze"],
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
    selected_condition: null,
    selected_guideline_id: null,
    selected_severity: "moderate",
    discriminating_qa: [],
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

const askOutput = {
  needs_question: true,
  target_condition: "Epiglottitis",
  question: "Is the child drooling or in a tripod posture?",
  recommended_condition: "Croup",
  recommended_guideline: "starship-croup-2020",
  rationale_summary: "Rule out epiglottitis before dosing croup.",
};

const okOutput = {
  needs_question: false,
  recommended_condition: "Croup",
  recommended_guideline: "starship-croup-2020",
  rationale_summary: "No clarifying question needed.",
};

const badPairOutput = {
  needs_question: false,
  recommended_condition: "Croup",
  recommended_guideline: "ascia-anaphylaxis-2024",
  rationale_summary: "Wrong pair.",
};

beforeEach(() => {
  outputQueue.length = 0;
  generateTextCalls.length = 0;
});

describe("POST /api/turn1.5 — bad input", () => {
  it("missing phase → 400, NO model call", async () => {
    const res = await POST(
      postBody({ caseState: makeCaseState(croupOnlyDiff) }),
    );
    expect(res.status).toBe(400);
    expect(generateTextCalls.length).toBe(0);
  });

  it("oversized body → 413, NO model call", async () => {
    const huge = "x".repeat(65 * 1024);
    const res = await POST(
      new Request("http://localhost/api/turn1.5", {
        method: "POST",
        body: huge,
      }),
    );
    expect(res.status).toBe(413);
    expect(generateTextCalls.length).toBe(0);
  });
});

describe("POST /api/turn1.5 — decide (advisory)", () => {
  it("empty differential → error pre-model", async () => {
    const res = await POST(
      postBody({ phase: "decide", caseState: makeCaseState(emptyDiff) }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { status: string; code?: string };
    expect(body.status).toBe("error");
    expect(body.code).toBe("empty_differential");
    expect(generateTextCalls.length).toBe(0);
  });

  it("empty registry (no treatable) → error pre-model", async () => {
    const res = await POST(
      postBody({ phase: "decide", caseState: makeCaseState(unmappedDiff) }),
    );
    const body = (await res.json()) as { status: string; code?: string };
    expect(body.status).toBe("error");
    expect(body.code).toBe("empty_registry");
    expect(generateTextCalls.length).toBe(0);
  });

  it("needs_question true → ask with exactly one model call", async () => {
    outputQueue.push(askOutput);
    const res = await POST(
      postBody({
        phase: "decide",
        caseState: makeCaseState(croupEpiglottitisDiff),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      target?: string;
      recommended_guideline?: string;
    };
    expect(body.status).toBe("ask");
    expect(body.target).toBe("Epiglottitis");
    expect(body.recommended_guideline).toBe("starship-croup-2020");
    expect(generateTextCalls.length).toBe(1);
  });

  it("needs_question false → ok with one model call", async () => {
    outputQueue.push(okOutput);
    const res = await POST(
      postBody({ phase: "decide", caseState: makeCaseState(croupOnlyDiff) }),
    );
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("ok");
    expect(generateTextCalls.length).toBe(1);
  });

  it("pair mismatch → repair then error after failed validation", async () => {
    outputQueue.push(badPairOutput, badPairOutput);
    const res = await POST(
      postBody({ phase: "decide", caseState: makeCaseState(croupOnlyDiff) }),
    );
    const body = (await res.json()) as { status: string; code?: string };
    expect(body.status).toBe("error");
    expect(body.code).toBe("parse_failure");
    expect(generateTextCalls.length).toBe(2);
  });
});

describe("POST /api/turn1.5 — answer (recorded)", () => {
  const baseAnswerBody = {
    phase: "answer" as const,
    target: "Epiglottitis",
    question: "Is the child drooling?",
    recommended_condition: "Croup",
    recommended_guideline: "starship-croup-2020",
  };

  it("skip (null answer) → recorded with engaged false", async () => {
    const res = await POST(
      postBody({
        ...baseAnswerBody,
        caseState: makeCaseState(croupEpiglottitisDiff),
        answer: null,
      }),
    );
    const body = (await res.json()) as {
      status: string;
      caseState?: CaseState;
    };
    expect(body.status).toBe("recorded");
    const qa = body.caseState?.discriminating_qa.at(-1);
    expect(qa?.engaged).toBe(false);
    expect(qa?.answer).toBe("skipped");
    expect(generateTextCalls.length).toBe(0);
  });

  it("absent answer → recorded with engaged true and updated differential", async () => {
    const res = await POST(
      postBody({
        ...baseAnswerBody,
        caseState: makeCaseState(croupEpiglottitisDiff),
        answer: "absent",
      }),
    );
    const body = (await res.json()) as {
      status: string;
      caseState?: CaseState;
    };
    expect(body.status).toBe("recorded");
    expect(body.caseState?.discriminating_qa.at(-1)?.engaged).toBe(true);
    expect(generateTextCalls.length).toBe(0);
  });

  it("answer with target lacking registry discriminators → 400 bad_discriminators", async () => {
    const res = await POST(
      postBody({
        phase: "answer",
        caseState: makeCaseState(croupEpiglottitisDiff),
        answer: "present",
        target: "Croup",
        question: "Any barky cough?",
        recommended_condition: "Croup",
        recommended_guideline: "starship-croup-2020",
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { status: string; code?: string };
    expect(body.status).toBe("error");
    expect(body.code).toBe("bad_discriminators");
    expect(generateTextCalls.length).toBe(0);
  });
});
