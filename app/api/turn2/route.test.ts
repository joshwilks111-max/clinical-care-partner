// app/api/turn2/route.test.ts
//
// Pipeline-branch tests for the turn-2 apply route, with the SDK MOCKED at the
// boundary (`ai`'s generateText). This keeps the suite model-free + deterministic
// while exercising EVERY branch of the apply pipeline:
//   - bad body                          → RED technical error (400)
//   - no-matching-guideline (route null)→ amber abstention "no local guideline"
//   - wrong-guideline audit mismatch    → amber abstention
//   - dose-tool refusal (bad rule id)   → amber abstention (source dose-tool)
//   - Zod parse failure on the plan     → RED technical error (502)
//   - completeness gate fires           → amber "incomplete", missing slot named
//   - full happy path                   → "ok": dose + cited plan + provenance
//
// HOW THE MOCK WORKS: we vi.mock("ai") and replace generateText with a queue-
// driven stub that returns a pre-set `experimental_output` per call (STEP A then
// STEP B). Output + stepCountIs are passed through to the real module so the
// route's option shape stays honest. createAnthropic is harmless (no network is
// reached because generateText never runs the real provider). This asserts the
// route's CONTROL FLOW + the deterministic seams (router, calculate_dose,
// completeness) — the BULK of coverage — leaving live model behaviour to the
// small smoke run.

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

// createAnthropic is imported by the route; stub it so no real provider is built.
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

// A well-formed STEP-A severity classification for croup-moderate.
const moderateClassification = {
  severity_row: "moderate",
  dose_rule_id: "croup-dex-moderate",
  reasoning: "Stridor at rest, no cyanosis → moderate row.",
};

// A well-formed, complete STEP-B plan for croup (all required slots filled).
const completeCroupPlan = {
  recommendations: [
    {
      text: "Give oral dexamethasone 2.13 mg as a single dose.",
      source_section: "Croup — Corticosteroid treatment (dexamethasone dosing)",
      source_version: "Starship NZ Clinical Guideline, 2020",
      source_url: "https://www.starship.org.nz/guidelines/croup/",
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

beforeEach(() => {
  outputQueue.length = 0;
  generateTextCalls.length = 0;
});

describe("POST /api/turn2 — bad input", () => {
  it("missing caseState → RED technical error 400", async () => {
    const res = await POST(
      new Request("http://localhost/api/turn2", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { status?: string };
    expect(body.status).toBe("error");
    // No model call on a bad body.
    expect(generateTextCalls.length).toBe(0);
  });

  it("non-JSON body → RED technical error 400", async () => {
    const res = await POST(
      new Request("http://localhost/api/turn2", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not json",
      }),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { status?: string }).status).toBe("error");
  });
});

describe("POST /api/turn2 — abstentions (amber), before/around the model", () => {
  it("unknown condition (route null) → amber abstention, NO model call", async () => {
    const res = await POST(
      postCaseState(makeCaseState({ selected_condition: "appendicitis" })),
    );
    const body = (await res.json()) as {
      status?: string;
      reason?: string;
      source?: string;
    };
    expect(body.status).toBe("abstention");
    expect(body.reason).toBe("no_matching_guideline");
    expect(body.source).toBe("no-guideline");
    expect(generateTextCalls.length).toBe(0);
  });

  it("empty confirmed condition → amber abstention, NO model call", async () => {
    const res = await POST(
      postCaseState(makeCaseState({ selected_condition: null })),
    );
    const body = (await res.json()) as { status?: string; reason?: string };
    expect(body.status).toBe("abstention");
    expect(body.reason).toBe("no_matching_guideline");
    expect(generateTextCalls.length).toBe(0);
  });

  it("dose-tool refuses an invalid rule id → amber abstention (source dose-tool)", async () => {
    // STEP A returns a rule id that is NOT in the croup guideline → the
    // deterministic tool refuses with invalid_dose_rule_id.
    outputQueue.push({
      severity_row: "moderate",
      dose_rule_id: "not-a-real-rule",
      reasoning: "n/a",
    });
    const res = await POST(postCaseState(makeCaseState()));
    const body = (await res.json()) as {
      status?: string;
      reason?: string;
      source?: string;
    };
    expect(body.status).toBe("abstention");
    expect(body.reason).toBe("invalid_dose_rule_id");
    expect(body.source).toBe("dose-tool");
    // Only STEP A ran; STEP B (synthesis) was never reached.
    expect(generateTextCalls.length).toBe(1);
  });
});

describe("POST /api/turn2 — technical error (red) vs success vs incomplete (amber)", () => {
  it("plan fails Zod parse → RED technical error 502", async () => {
    // STEP A ok; STEP B returns a plan with an UNCITED recommendation (no
    // source_section / quote) → PlanOutput.parse throws → red technical state.
    outputQueue.push(moderateClassification);
    outputQueue.push({
      recommendations: [{ text: "Give dexamethasone." }], // missing citation
      required_fields: {},
    });
    const res = await POST(postCaseState(makeCaseState()));
    expect(res.status).toBe(502);
    const body = (await res.json()) as { status?: string };
    expect(body.status).toBe("error");
    expect(generateTextCalls.length).toBe(2);
  });

  it("completeness gate fires on a dropped slot → amber 'incomplete', slot named", async () => {
    // STEP A ok; STEP B is faithful + cited but DROPS escalation_criteria
    // (value null) → the completeness gate must fire (the money-shot).
    const planMissingEscalation = {
      ...completeCroupPlan,
      required_fields: {
        ...completeCroupPlan.required_fields,
        escalation_criteria: { present: false, value: null },
      },
    };
    outputQueue.push(moderateClassification);
    outputQueue.push(planMissingEscalation);

    const res = await POST(postCaseState(makeCaseState()));
    const body = (await res.json()) as {
      status?: string;
      missing?: string[];
      headline?: string;
    };
    expect(body.status).toBe("incomplete");
    expect(body.missing).toContain("escalation_criteria");
    expect(body.headline).toContain("escalation_criteria");
  });

  it("happy path → 'ok': dose 2.13mg, cited plan, provenance seam", async () => {
    outputQueue.push(moderateClassification);
    outputQueue.push(completeCroupPlan);

    const res = await POST(postCaseState(makeCaseState()));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status?: string;
      dose?: { dose_mg?: number; drug?: string; capped?: boolean };
      plan?: { recommendations?: unknown[] };
      provenance?: {
        routed_guideline_id?: string;
        dose_rule_id?: string;
        severity_row?: string;
      };
    };
    expect(body.status).toBe("ok");
    // The DETERMINISTIC tool owns the number — 14.2 × 0.15 = 2.13.
    expect(body.dose?.dose_mg).toBe(2.13);
    expect(body.dose?.drug).toBe("dexamethasone");
    expect(body.dose?.capped).toBe(false);
    // The provenance seam is visible.
    expect(body.provenance?.routed_guideline_id).toBe("starship-croup-2020");
    expect(body.provenance?.dose_rule_id).toBe("croup-dex-moderate");
    expect(body.provenance?.severity_row).toBe("moderate");
    expect((body.plan?.recommendations ?? []).length).toBeGreaterThan(0);
  });

  it("severe 25kg case → cap fires: dose 12mg, capped true, binding_limit 12", async () => {
    outputQueue.push({
      severity_row: "severe",
      dose_rule_id: "croup-dex-severe",
      reasoning: "Marked distress + cyanosis → severe row.",
    });
    // STEP B plan can reuse the complete slot set (values not asserted here).
    outputQueue.push(completeCroupPlan);

    const res = await POST(
      postCaseState(
        makeCaseState({
          selected_severity: "severe",
          extracted_facts: {
            condition_hints: ["croup"],
            severity: "severe",
            weight_kg: 25,
            age: "8yo",
            profession: null,
            setting: null,
          },
        }),
      ),
    );
    const body = (await res.json()) as {
      status?: string;
      dose?: {
        dose_mg?: number;
        capped?: boolean;
        binding_limit?: number | null;
      };
    };
    expect(body.status).toBe("ok");
    // 25 × 0.6 = 15 → CAPPED to 12 (the tool, not the model, applies the cap).
    expect(body.dose?.dose_mg).toBe(12);
    expect(body.dose?.capped).toBe(true);
    expect(body.dose?.binding_limit).toBe(12);
  });
});
