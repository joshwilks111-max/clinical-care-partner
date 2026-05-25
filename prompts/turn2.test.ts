// prompts/turn2.test.ts
//
// Pure tests for the turn-2 prompt builders. No model — assert the STRUCTURAL
// properties that make the prompts safe + bounded:
//   - severity classification is BOUNDED to the guideline's real dose_rule_ids,
//   - the prompts forbid the model emitting a dose number,
//   - turn 2 operates on CONFIRMED facts and NEVER the raw note (zero re-extract),
//   - plan synthesis lists the required-field slots + the verbatim citation values
//     and tells the model NOT to recompute the dose.

import { describe, it, expect } from "vitest";
import {
  buildSeveritySystemPrompt,
  buildSeverityUserPrompt,
  buildPlanSystemPrompt,
  buildPlanUserPrompt,
  type ComputedDoseForPrompt,
} from "./turn2";
import { getGuideline } from "@/registry/guidelines";
import type { CaseState } from "@/lib/case-state";

const croup = getGuideline("starship-croup-2020")!;
const ascia = getGuideline("ascia-anaphylaxis-2024")!;

const caseState: CaseState = {
  note_hash: "deadbeef",
  extracted_facts: {
    condition_hints: ["croup", "stridor"],
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
};

const computedDose: ComputedDoseForPrompt = {
  drug: "dexamethasone",
  route: "oral",
  frequency: "single dose",
  dose_mg: 2.13,
  dose_ml: null,
  calculation_trace: "14.2 kg × 0.15 mg/kg = 2.13 mg (under 12 mg cap)",
  capped: false,
  binding_limit: null,
};

describe("buildSeveritySystemPrompt — bounded rule-application", () => {
  it("lists EVERY one of the guideline's actual dose_rule_ids (the bound)", () => {
    const p = buildSeveritySystemPrompt(croup);
    for (const r of croup.dose_rules) {
      expect(p).toContain(r.dose_rule_id);
    }
  });

  it("includes the guideline's severity text so the model reads the rubric", () => {
    const p = buildSeveritySystemPrompt(croup);
    expect(p).toContain("SEVERITY ASSESSMENT");
    expect(p).toContain("stridor at rest");
  });

  it("forbids the model from emitting a dose number", () => {
    // Collapse whitespace so a line-wrapped instruction still matches.
    const p = buildSeveritySystemPrompt(croup)
      .toLowerCase()
      .replace(/\s+/g, " ");
    expect(p).toContain("do not compute");
    expect(p).toContain("never output a number");
  });

  it("frames the task as rule-application, not a new clinical opinion", () => {
    const p = buildSeveritySystemPrompt(croup).toLowerCase();
    expect(p).toContain("rule-application");
    expect(p).toContain("not forming a new");
  });
});

describe("buildSeverityUserPrompt — zero re-extraction, confirmed facts only", () => {
  it("includes the confirmed structured facts", () => {
    const p = buildSeverityUserPrompt(caseState);
    expect(p).toContain("14.2"); // confirmed weight
    expect(p).toContain("croup"); // confirmed condition
  });

  it("explicitly states there is NO raw note in this turn", () => {
    const p = buildSeverityUserPrompt(caseState).toLowerCase();
    expect(p).toContain("no raw note");
    expect(p).toContain("do not re-extract");
  });

  it("never carries an untrusted-note delimiter into turn 2", () => {
    const p = buildSeverityUserPrompt(caseState);
    expect(p).not.toContain("UNTRUSTED_CLINICAL_NOTE");
  });
});

describe("buildPlanSystemPrompt — grounded, no recompute, slots listed", () => {
  it("lists EVERY required-field slot for the guideline", () => {
    const p = buildPlanSystemPrompt(croup);
    for (const f of croup.required_fields.fields) {
      expect(p).toContain(f);
    }
  });

  it("carries the verbatim citation values for the source_* fields", () => {
    const p = buildPlanSystemPrompt(croup);
    const rule = croup.dose_rules[0]!;
    expect(p).toContain(rule.source_section);
    expect(p).toContain(rule.source_version);
    expect(p).toContain(rule.source_url);
  });

  it("requires a verbatim quote per recommendation", () => {
    const p = buildPlanSystemPrompt(croup).toLowerCase();
    expect(p).toContain("verbatim");
    expect(p).toContain("quote");
  });

  it("tells the model NOT to recompute the dose", () => {
    const p = buildPlanSystemPrompt(croup).toLowerCase();
    expect(p).toContain("do not recompute");
  });

  it("instructs honest null (not 'not specified') for an uncovered slot", () => {
    const p = buildPlanSystemPrompt(croup).toLowerCase();
    expect(p).toContain("present=false");
    expect(p).toContain("value=null");
  });

  it("works for a different guideline's slots (anaphylaxis: positioning/monitoring)", () => {
    const p = buildPlanSystemPrompt(ascia);
    expect(p).toContain("positioning");
    expect(p).toContain("monitoring");
  });
});

describe("buildPlanUserPrompt — hands the computed dose in, no raw note", () => {
  it("includes the deterministic dose + trace verbatim", () => {
    const p = buildPlanUserPrompt(caseState, "moderate", computedDose);
    expect(p).toContain("2.13");
    expect(p).toContain(computedDose.calculation_trace);
  });

  it("includes the classified severity row", () => {
    const p = buildPlanUserPrompt(caseState, "moderate", computedDose);
    expect(p).toContain("moderate");
  });

  it("tells the model not to recompute, and carries no raw note", () => {
    const p = buildPlanUserPrompt(caseState, "moderate", computedDose);
    expect(p.toLowerCase()).toContain("do not recompute");
    expect(p).not.toContain("UNTRUSTED_CLINICAL_NOTE");
  });
});
