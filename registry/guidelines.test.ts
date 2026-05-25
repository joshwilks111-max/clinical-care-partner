// registry/guidelines.test.ts
//
// Deterministic tests for the guideline registry — the single source of truth.
// These assert the EXACT clinical constants from DESIGN.md "Verified clinical
// numbers" so a silent edit to any dose/cap is caught.
//
// Vitest syntax (the Next.js scaffold uses the Vitest convention). Run with
// `npx vitest run registry/` once the scaffold lands the runner.

import { describe, it, expect } from "vitest";
import {
  GUIDELINES,
  getGuideline,
  ROUTING_TABLE,
  type Guideline,
  type DoseRule,
} from "./guidelines";

const REQUIRED_DOSE_RULE_KEYS: Array<keyof DoseRule> = [
  "dose_rule_id",
  "drug",
  "mg_per_kg",
  "max_mg",
  "route",
  "frequency",
  "source_section",
  "source_version",
  "source_url",
  "human_verified",
];

describe("guideline registry", () => {
  it("loads with both guidelines present", () => {
    expect(Object.keys(GUIDELINES).length).toBe(2);
    expect(GUIDELINES["starship-croup-2020"]).toBeTruthy();
    expect(GUIDELINES["ascia-anaphylaxis-2024"]).toBeTruthy();
  });

  it("getGuideline returns the croup guideline", () => {
    const g = getGuideline("starship-croup-2020");
    expect(g).not.toBeNull();
    expect((g as Guideline).condition).toBe("croup");
  });

  it("getGuideline returns the anaphylaxis guideline", () => {
    const g = getGuideline("ascia-anaphylaxis-2024");
    expect(g).not.toBeNull();
    expect((g as Guideline).condition).toBe("anaphylaxis");
  });

  it("getGuideline returns null for an unknown id", () => {
    expect(getGuideline("nonexistent")).toBeNull();
  });
});

describe("dose rules — required fields populated and human-verified", () => {
  it("every dose rule has all required fields populated and human_verified===true", () => {
    for (const g of Object.values(GUIDELINES)) {
      expect(g.dose_rules.length).toBeGreaterThan(0);
      for (const rule of g.dose_rules) {
        for (const key of REQUIRED_DOSE_RULE_KEYS) {
          const v = rule[key];
          expect(v === null || v === undefined).toBe(false);
        }
        // non-empty strings on the identity/source fields
        expect(rule.dose_rule_id.length).toBeGreaterThan(0);
        expect(rule.drug.length).toBeGreaterThan(0);
        expect(rule.route.length).toBeGreaterThan(0);
        expect(rule.frequency.length).toBeGreaterThan(0);
        expect(rule.source_section.length).toBeGreaterThan(0);
        expect(rule.source_version.length).toBeGreaterThan(0);
        expect(rule.source_url.length).toBeGreaterThan(0);
        expect(rule.human_verified).toBe(true);
      }
    }
  });
});

describe("croup guideline — dosing constants", () => {
  const croup = getGuideline("starship-croup-2020") as Guideline;

  it("has both a moderate and a severe dexamethasone rule", () => {
    const ids = croup.dose_rules.map((r) => r.dose_rule_id).sort();
    expect(ids).toEqual(["croup-dex-moderate", "croup-dex-severe"]);
  });

  it("moderate rule: dexamethasone 0.15 mg/kg, max 12 mg, oral, no concentration", () => {
    const moderate = croup.dose_rules.find(
      (r) => r.dose_rule_id === "croup-dex-moderate",
    ) as DoseRule;
    expect(moderate.drug).toBe("dexamethasone");
    expect(moderate.mg_per_kg).toBe(0.15);
    expect(moderate.max_mg).toBe(12);
    expect(moderate.min_mg).toBeNull();
    expect(moderate.route).toBe("oral");
    expect(moderate.concentration_mg_per_ml).toBeNull();
    expect(moderate.rounding).toEqual({
      direction: "down",
      increment_mg: 0.01,
    });
  });

  it("severe rule: dexamethasone 0.6 mg/kg, max 12 mg, oral", () => {
    const severe = croup.dose_rules.find(
      (r) => r.dose_rule_id === "croup-dex-severe",
    ) as DoseRule;
    expect(severe.drug).toBe("dexamethasone");
    expect(severe.mg_per_kg).toBe(0.6);
    expect(severe.max_mg).toBe(12);
    expect(severe.route).toBe("oral");
    expect(severe.concentration_mg_per_ml).toBeNull();
  });

  it("required_fields includes escalation_criteria (the dropped-slot eval target)", () => {
    expect(croup.required_fields.fields).toContain("escalation_criteria");
  });
});

describe("anaphylaxis guideline — dosing constants", () => {
  const ana = getGuideline("ascia-anaphylaxis-2024") as Guideline;

  it("has exactly one adrenaline IM rule", () => {
    expect(ana.dose_rules.length).toBe(1);
    expect(ana.dose_rules[0].dose_rule_id).toBe("anaphylaxis-adrenaline-im");
  });

  it("adrenaline rule: 0.01 mg/kg, max 0.5 mg, IM, concentration 1.0 mg/mL", () => {
    const rule = ana.dose_rules[0];
    expect(rule.drug).toBe("adrenaline");
    expect(rule.mg_per_kg).toBe(0.01);
    expect(rule.max_mg).toBe(0.5);
    expect(rule.min_mg).toBeNull();
    expect(rule.route).toBe("IM");
    expect(rule.concentration_mg_per_ml).toBe(1.0);
  });

  it("required_fields includes escalation_criteria", () => {
    expect(ana.required_fields.fields).toContain("escalation_criteria");
  });
});

describe("routing table — data only (croup + anaphylaxis)", () => {
  it("maps each condition to its guideline_id", () => {
    const byCondition = Object.fromEntries(
      ROUTING_TABLE.map((r) => [r.condition, r.guideline_id]),
    );
    expect(byCondition["croup"]).toBe("starship-croup-2020");
    expect(byCondition["anaphylaxis"]).toBe("ascia-anaphylaxis-2024");
  });

  it("every routed guideline_id resolves in the registry", () => {
    for (const row of ROUTING_TABLE) {
      expect(getGuideline(row.guideline_id)).not.toBeNull();
    }
  });
});
