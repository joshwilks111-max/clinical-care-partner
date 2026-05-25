// lib/plan-schema.test.ts
//
// Pure tests for the turn-2 output contract + the unified abstention adapter.
// No model, no network — these assert the STRUCTURAL guarantees:
//   - citation is schema-enforced (a recommendation without source/quote fails),
//   - the two source refusal shapes both map onto the ONE Abstention shape.

import { describe, it, expect } from "vitest";
import {
  PlanOutput,
  PlanRecommendation,
  buildPlanOutputSchema,
  fromDoseRefusal,
  fromRefusalDecision,
  type Abstention,
} from "./plan-schema";
import type { DoseRefusal } from "@/tools/calculate_dose";
import type { RefusalDecision } from "@/lib/refusal-gate";
import { getGuideline } from "@/registry/guidelines";

const validRec = {
  text: "Give oral dexamethasone 2.13 mg as a single dose.",
  source_section: "Croup — Corticosteroid treatment",
  source_version: "Starship NZ Clinical Guideline, 2020",
  source_url: "https://starship.org.nz/guidelines/croup/",
  quote: "dexamethasone 0.15 mg/kg ORALLY, single dose",
};

describe("PlanRecommendation — citation is schema-enforced", () => {
  it("accepts a recommendation that carries section + quote", () => {
    expect(PlanRecommendation.safeParse(validRec).success).toBe(true);
  });

  it("REJECTS a recommendation missing source_section", () => {
    const { source_section: _omit, ...noSection } = validRec;
    expect(PlanRecommendation.safeParse(noSection).success).toBe(false);
  });

  it("REJECTS a recommendation missing the verbatim quote", () => {
    const { quote: _omit, ...noQuote } = validRec;
    expect(PlanRecommendation.safeParse(noQuote).success).toBe(false);
  });

  it("REJECTS an empty-string quote (min(1) — no blank citation)", () => {
    expect(
      PlanRecommendation.safeParse({ ...validRec, quote: "" }).success,
    ).toBe(false);
  });
});

describe("PlanOutput", () => {
  it("accepts a plan with >=1 cited recommendation + required_fields record", () => {
    const ok = PlanOutput.safeParse({
      recommendations: [validRec],
      required_fields: {
        diagnosis: { present: true, value: "croup" },
        escalation_criteria: { present: false, value: null },
      },
    });
    expect(ok.success).toBe(true);
  });

  it("REJECTS a plan with zero recommendations (min(1))", () => {
    const bad = PlanOutput.safeParse({
      recommendations: [],
      required_fields: {},
    });
    expect(bad.success).toBe(false);
  });

  it("accepts a required_fields value of null (the completeness gate's input)", () => {
    const ok = PlanOutput.safeParse({
      recommendations: [validRec],
      required_fields: { disposition: { present: false, value: null } },
    });
    expect(ok.success).toBe(true);
  });
});

describe("buildPlanOutputSchema — forces every guideline slot (the empty-{} fix)", () => {
  const croup = getGuideline("starship-croup-2020")!;
  const schema = buildPlanOutputSchema(croup);

  it("REJECTS an empty required_fields (the bug: the model returned {})", () => {
    const bad = schema.safeParse({
      recommendations: [validRec],
      required_fields: {},
    });
    expect(bad.success).toBe(false);
  });

  it("REJECTS a partial required_fields (a dropped slot fails the schema)", () => {
    // Only diagnosis present — every other croup slot is required and missing.
    const bad = schema.safeParse({
      recommendations: [validRec],
      required_fields: { diagnosis: { present: true, value: "croup" } },
    });
    expect(bad.success).toBe(false);
  });

  it("ACCEPTS a full slot set (every croup field present, value may be null)", () => {
    const required_fields: Record<
      string,
      { present: boolean; value: string | null }
    > = {};
    for (const f of croup.required_fields.fields) {
      required_fields[f] = { present: true, value: `${f}-value` };
    }
    const ok = schema.safeParse({
      recommendations: [validRec],
      required_fields,
    });
    expect(ok.success).toBe(true);
  });

  it("a schema-valid full set still validates against the wire PlanOutput", () => {
    const required_fields: Record<
      string,
      { present: boolean; value: string | null }
    > = {};
    for (const f of croup.required_fields.fields) {
      // present:true but value:null is schema-valid — the completeness GATE
      // (not the schema) is what catches this honest null at runtime.
      required_fields[f] = { present: true, value: null };
    }
    const parsed = schema.parse({
      recommendations: [validRec],
      required_fields,
    });
    expect(PlanOutput.safeParse(parsed).success).toBe(true);
  });
});

describe("fromDoseRefusal — dose-tool refusal → unified Abstention", () => {
  it("maps an invalid_dose_rule_id refusal through with source dose-tool", () => {
    const r: DoseRefusal = {
      kind: "refusal",
      reason: "invalid_dose_rule_id",
      message: 'No dose rule "x" in guideline "y". I will not guess a rule.',
    };
    const a: Abstention = fromDoseRefusal(r);
    expect(a.kind).toBe("abstention");
    expect(a.reason).toBe("invalid_dose_rule_id");
    expect(a.source).toBe("dose-tool");
    expect(a.headline).toBe(r.message);
  });

  it("maps an implausible_weight refusal (the tool's GUARD-7)", () => {
    const r: DoseRefusal = {
      kind: "refusal",
      reason: "implausible_weight",
      message: "Weight 300 kg is outside the plausible range.",
    };
    const a = fromDoseRefusal(r);
    expect(a.reason).toBe("implausible_weight");
    expect(a.source).toBe("dose-tool");
  });

  it("maps a rule_not_verified refusal (human_verified gate)", () => {
    const r: DoseRefusal = {
      kind: "refusal",
      reason: "rule_not_verified",
      message: "Dose rule is not human-verified.",
    };
    expect(fromDoseRefusal(r).reason).toBe("rule_not_verified");
  });
});

describe("fromRefusalDecision — pre-LLM / no-guideline refusal → unified Abstention", () => {
  it("maps a no_matching_guideline refusal with source no-guideline", () => {
    const d: RefusalDecision = {
      refuse: true,
      reason: "no_matching_guideline",
      copy: "No local guideline matches this condition.",
    };
    const a = fromRefusalDecision(d);
    expect(a.kind).toBe("abstention");
    expect(a.reason).toBe("no_matching_guideline");
    expect(a.source).toBe("no-guideline");
    expect(a.headline).toBe(d.copy);
  });

  it("maps a weight_missing refusal with source pre-llm", () => {
    const d: RefusalDecision = {
      refuse: true,
      reason: "weight_missing",
      copy: "Weight is required for a weight-based dose.",
    };
    const a = fromRefusalDecision(d);
    expect(a.reason).toBe("weight_missing");
    expect(a.source).toBe("pre-llm");
  });

  it("fails CLOSED on a null reason (defensive weight_missing, not a malformed pass)", () => {
    const d: RefusalDecision = { refuse: true, reason: null, copy: "" };
    const a = fromRefusalDecision(d);
    expect(a.kind).toBe("abstention");
    expect(a.reason).toBe("weight_missing");
    expect(a.headline.length).toBeGreaterThan(0);
  });
});
