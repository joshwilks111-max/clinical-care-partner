// app/api/turn1.5/route.retry.test.ts
//
// Bounded transient-only retry tests for Turn 1.5 decide (the only model phase).

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
import type { CaseState } from "@/lib/case-state";
import type { Differential } from "@/lib/schemas";

const ambiguousDifferential: Differential = {
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
      negative_evidence: ["drooling", "tripod posture", "muffled voice"],
    },
  ],
  candidate_guidelines: [
    { guideline_id: "starship-croup-2020", label: "Starship croup (NZ)" },
  ],
};

const askOutput = {
  needs_question: true,
  target_condition: "Epiglottitis",
  question:
    "Is the child drooling, sitting in a tripod posture, or showing a muffled voice?",
  recommended_condition: "Croup",
  recommended_guideline: "starship-croup-2020",
  rationale_summary: "One high-impact question before dosing croup.",
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
    selected_condition: null,
    selected_guideline_id: null,
    selected_severity: "moderate",
    discriminating_qa: [],
  };
}

function postDecide(): Request {
  return new Request("http://localhost/api/turn1.5", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phase: "decide", caseState: makeCaseState() }),
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

describe("POST /api/turn1.5 — bounded transient-only retry (decide)", () => {
  it("transient once then success → status ask", async () => {
    actionQueue.push({ throw: transientError() });
    actionQueue.push({ output: askOutput });

    const res = await POST(postDecide());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status?: string };
    expect(body.status).toBe("ask");
    expect(generateTextCalls.length).toBe(2);
  });

  it("persistent transient → error after exactly 3 attempts", async () => {
    actionQueue.push({ throw: transientError() });
    actionQueue.push({ throw: transientError() });
    actionQueue.push({ throw: transientError() });
    actionQueue.push({ output: askOutput });

    const res = await POST(postDecide());
    expect(res.status).toBe(502);
    expect(generateTextCalls.length).toBe(3);
    expect(actionQueue.length).toBe(1);
  });

  it("schema parse failure → error after repair attempt also fails", async () => {
    const invalid = { needs_question: "yes" };
    actionQueue.push({ output: invalid });
    actionQueue.push({ output: invalid });

    const res = await POST(postDecide());
    expect(res.status).toBe(502);
    // Initial judgment + one repair attempt (each may use transient retry).
    expect(generateTextCalls.length).toBe(2);
    expect(actionQueue.length).toBe(0);
  });

  it("auth error → error immediately, no retry", async () => {
    actionQueue.push({ throw: new Error("401 Unauthorized: invalid x-api-key") });
    actionQueue.push({ output: askOutput });

    const res = await POST(postDecide());
    expect(res.status).toBe(502);
    expect(generateTextCalls.length).toBe(1);
    expect(actionQueue.length).toBe(1);
  });
});
