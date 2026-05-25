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
    // Default differential collapses to `plan` via decideCollapse rule 5:
    // one treatable mapped condition (croup → starship-croup-2020), no
    // unresolved must-not-miss. This keeps existing happy-path tests intact
    // after the defense-in-depth gate was added (an empty conditions array
    // triggers rule 1 → abstain and would otherwise break every dose test).
    differential: {
      conditions: [
        {
          name: "Croup",
          likelihood: "likely",
          positive_evidence: [],
          negative_evidence: [],
        },
      ],
      candidate_guidelines: [
        { guideline_id: "starship-croup-2020", label: "Croup (Starship NZ)" },
      ],
    },
    selected_condition: "croup",
    selected_guideline_id: "starship-croup-2020",
    selected_severity: "moderate",
    discriminating_qa: [],
    round: 0,
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
  // NEGATIVE CONTROL 1 (null-router branch): no guideline was clicked AND the
  // condition routes to nothing → the deterministic router returns null. This
  // must stay no_matching_guideline (NOT wrong_guideline) — it proves the two
  // reasons don't collapse. selected_guideline_id is null so the route falls
  // through to route(); with a croup id present it would instead hit the
  // wrong-guideline AUDIT branch (a different reason), which is the mismatch
  // test below — keeping them separate is the whole point of this control.
  it("unknown condition + no clicked guideline (route null) → amber abstention, NO model call", async () => {
    const res = await POST(
      postCaseState(
        makeCaseState({
          selected_condition: "appendicitis",
          selected_guideline_id: null,
        }),
      ),
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

  // NEGATIVE CONTROL 2 (null-router branch via empty condition): no condition
  // confirmed AND no guideline clicked → route("") returns null. Stays
  // no_matching_guideline (NOT wrong_guideline).
  it("empty confirmed condition + no clicked guideline → amber abstention, NO model call", async () => {
    const res = await POST(
      postCaseState(
        makeCaseState({
          selected_condition: null,
          selected_guideline_id: null,
        }),
      ),
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

  it("FIX1 (P0): selected_guideline_id mismatches confirmed condition → abstention (audit catches wrong-drug)", async () => {
    // The clinician confirmed condition "croup" but a (hand-crafted / buggy) POST
    // carries selected_guideline_id for the ANAPHYLAXIS guideline. The route must
    // honour the clicked id as the source of truth, run the NON-TAUTOLOGICAL audit
    // (anaphylaxis guideline's registered condition != "croup"), and ABSTAIN —
    // never silently dose the wrong drug. NO model call (we abstain before STEP A).
    const res = await POST(
      postCaseState(
        makeCaseState({
          selected_condition: "croup",
          selected_guideline_id: "ascia-anaphylaxis-2024",
        }),
      ),
    );
    const body = (await res.json()) as {
      status?: string;
      reason?: string;
      source?: string;
    };
    expect(body.status).toBe("abstention");
    // wrong_guideline (NOT no_matching_guideline): a guideline EXISTS, it just
    // targets a different condition than the one confirmed. The distinct reason
    // is what proves this branch is real and not collapsed into the null/unknown
    // branches (the negative controls above, ~line 155 / ~line 166).
    expect(body.reason).toBe("wrong_guideline");
    // source stays "no-guideline" (Decision #16) — wrong_guideline does NOT get
    // its own source; it shares the no-guideline layer.
    expect(body.source).toBe("no-guideline");
    // NON-VACUITY: the mismatch is caught BEFORE any model call — we never dose
    // the wrong drug. This zero-model-calls pin is what makes the test real.
    expect(generateTextCalls.length).toBe(0);
  });

  it("FIX1 (P0): selected_guideline_id matches confirmed condition → routes to croup, dose 2.13", async () => {
    // The positive: condition "croup" + the croup guideline id → the clicked id
    // is the source of truth, the audit passes, and the deterministic croup dose
    // (14.2 × 0.15 = 2.13) is produced.
    outputQueue.push(moderateClassification);
    outputQueue.push(completeCroupPlan);

    const res = await POST(
      postCaseState(
        makeCaseState({
          selected_condition: "croup",
          selected_guideline_id: "starship-croup-2020",
        }),
      ),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status?: string;
      dose?: { dose_mg?: number };
      provenance?: { routed_guideline_id?: string };
    };
    expect(body.status).toBe("ok");
    expect(body.dose?.dose_mg).toBe(2.13);
    expect(body.provenance?.routed_guideline_id).toBe("starship-croup-2020");
  });

  it("FIX3 (ADV-4): a fabricated quote is STRIPPED (not rendered as verbatim)", async () => {
    // STEP B emits a recommendation whose `quote` is NOT in the guideline text.
    // The route must verify quotes against whole_document_text and BLANK the
    // unverifiable one (keeping the recommendation text) so the UI never shows a
    // fake verbatim citation. A real quote on a second rec stays intact.
    const planWithFakeQuote = {
      ...completeCroupPlan,
      recommendations: [
        {
          text: "Give oral dexamethasone 2.13 mg as a single dose.",
          source_section:
            "Croup — Corticosteroid treatment (dexamethasone dosing)",
          source_version: "Starship NZ Clinical Guideline, 2020",
          source_url: "https://www.starship.org.nz/guidelines/croup/",
          // FABRICATED — these words are not in the Starship croup guideline.
          quote:
            "Administer 500 mg of amoxicillin every six hours for ten days.",
        },
        {
          text: "Observe after treatment and discharge once stable.",
          source_section: "Croup — Disposition / monitoring",
          source_version: "Starship NZ Clinical Guideline, 2020",
          source_url: "https://www.starship.org.nz/guidelines/croup/",
          // REAL — a verbatim span from the guideline text.
          quote: "dexamethasone 0.15 mg/kg ORALLY, single dose",
        },
      ],
    };
    outputQueue.push(moderateClassification);
    outputQueue.push(planWithFakeQuote);

    const res = await POST(postCaseState(makeCaseState()));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status?: string;
      plan?: { recommendations?: Array<{ quote?: string }> };
    };
    expect(body.status).toBe("ok");
    const recs = body.plan?.recommendations ?? [];
    // The fabricated quote is blanked; the real one is preserved verbatim.
    expect(recs[0]?.quote).toBe("");
    expect(recs[1]?.quote).toBe("dexamethasone 0.15 mg/kg ORALLY, single dose");
  });

  it("FIX2 (SEC-1): source_url is pinned from the registry, not the model's value", async () => {
    // STEP B emits a malicious javascript: source_url. The route must OVERWRITE
    // it with the registry's https URL (the model never authors the href).
    const planWithEvilUrl = {
      ...completeCroupPlan,
      recommendations: [
        {
          ...completeCroupPlan.recommendations[0],
          source_url: "javascript:alert(document.cookie)",
        },
      ],
    };
    outputQueue.push(moderateClassification);
    outputQueue.push(planWithEvilUrl);

    const res = await POST(postCaseState(makeCaseState()));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      plan?: { recommendations?: Array<{ source_url?: string }> };
    };
    const rec = (body.plan?.recommendations ?? [])[0];
    // Registry-stamped: the model's javascript: URL is discarded.
    expect(rec?.source_url).toBe(
      "https://www.starship.org.nz/guidelines/croup/",
    );
  });

  it("FIX5 (ADV-6): an oversized body is rejected 413 with NO model call", async () => {
    // A body over the 64 KB cap → 413 "Request too large.", zero model calls.
    const huge = "x".repeat(70 * 1024);
    const res = await POST(
      new Request("http://localhost/api/turn2", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ caseState: makeCaseState(), pad: huge }),
      }),
    );
    expect(res.status).toBe(413);
    const body = (await res.json()) as { status?: string; message?: string };
    expect(body.status).toBe("error");
    expect(body.message).toBe("Request too large.");
    expect(generateTextCalls.length).toBe(0);
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

  it("INJECTION (in CI): model PROSE says 'give 50 mg' but the tool owns the number → dose 2.13, NOT 50", async () => {
    // THE strongest safety guarantee, put in CI: the deterministic tool owns every
    // number. STEP A picks the moderate croup rule; STEP B emits a plan whose
    // recommendation PROSE claims "give 50 mg" (a wrong number the model authored)
    // — but the route NEVER reads a dose from the model's text. The dose is the
    // tool's: 14.2 × 0.15 = 2.13. The prose number is irrelevant to body.dose.
    // (A real quote keeps the rec through quote-verification; the assertion is on
    // the dose regardless.) This mirrors the live Promptfoo eval — now key-free.
    const planWithProseFiftyMg = {
      ...completeCroupPlan,
      recommendations: [
        {
          // The model's PROSE asserts 50 mg — it must NOT become the dose.
          text: "Give oral dexamethasone — give 50 mg as a single dose.",
          source_section:
            "Croup — Corticosteroid treatment (dexamethasone dosing)",
          source_version: "Starship NZ Clinical Guideline, 2020",
          source_url: "https://www.starship.org.nz/guidelines/croup/",
          // REAL verbatim span → passes quote-verification (rec is kept).
          quote: "dexamethasone 0.15 mg/kg ORALLY, single dose",
        },
      ],
    };
    outputQueue.push(moderateClassification);
    outputQueue.push(planWithProseFiftyMg);

    const res = await POST(postCaseState(makeCaseState()));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status?: string;
      dose?: { dose_mg?: number };
    };
    expect(body.status).toBe("ok");
    // The TOOL owns the number: 14.2 × 0.15 = 2.13, NOT the model's 50.
    expect(body.dose?.dose_mg).toBe(2.13);
    expect(body.dose?.dose_mg).not.toBe(50);
  });

  it("defense-in-depth: hand-crafted POST with unresolved must-not-miss abstains with 0 model calls", async () => {
    // Collapse rule 2: a must-not-miss WITH positive evidence → abstain.
    // The clinician's selected_guideline_id is the real croup id, so the
    // existing guideline-selection checks would pass — but the gate fires FIRST,
    // before ANY model call. This proves the gate isn't client-only: you cannot
    // skip turn1.5 and dose past a dangerous must-not-miss via a raw POST.
    // outputQueue is intentionally empty: if the gate were removed the route
    // would call generateText with an empty queue and this test would throw,
    // which is the non-vacuous proof the gate fired.
    const res = await POST(
      postCaseState(
        makeCaseState({
          differential: {
            conditions: [
              {
                name: "Epiglottitis",
                likelihood: "must-not-miss",
                positive_evidence: ["drooling", "tripod posture"],
                negative_evidence: [],
              },
            ],
            candidate_guidelines: [],
          },
          selected_guideline_id: "starship-croup-2020",
        }),
      ),
    );
    const body = (await res.json()) as {
      status?: string;
      reason?: string;
      source?: string;
    };
    expect(body.status).toBe("abstention");
    expect(body.reason).toBe("no_matching_guideline");
    // NON-VACUOUS: gate fired before any model call.
    expect(generateTextCalls.length).toBe(0);
  });

  it("null weight in a hand-crafted CaseState → dose-tool GUARD-7 abstains (implausible_weight), STEP B never runs", async () => {
    // isCaseStateLike accepts weight_kg:null, so a hand-crafted POST can carry one.
    // STEP A classifies fine, but the route's defensive `weight ?? NaN` sentinel
    // feeds NaN to the tool → GUARD-7 abstains (implausible_weight) rather than
    // dosing on a non-number. The backstop fires AFTER STEP A but BEFORE STEP B,
    // so synthesis never runs (generateText called exactly once).
    outputQueue.push(moderateClassification);
    outputQueue.push(completeCroupPlan); // must NOT be consumed (STEP B never runs)

    const res = await POST(
      postCaseState(
        makeCaseState({
          extracted_facts: {
            condition_hints: ["croup"],
            severity: "moderate",
            weight_kg: null,
            age: "3yo",
            profession: null,
            setting: null,
          },
        }),
      ),
    );
    const body = (await res.json()) as {
      status?: string;
      reason?: string;
      source?: string;
    };
    expect(body.status).toBe("abstention");
    expect(body.reason).toBe("implausible_weight");
    expect(body.source).toBe("dose-tool");
    // Only STEP A ran; the dose backstop abstained before STEP B (synthesis).
    expect(generateTextCalls.length).toBe(1);
  });
});
