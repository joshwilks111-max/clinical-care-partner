// registry/guidelines.regression.test.ts
//
// v3.1 schema-extension regression suite. The registry now carries:
//   - region: "NZ" | "AU" per guideline
//   - severity_rows[] with clinically-precise descriptions (Bjornson & Johnson
//     modified CMAJ 2013 grading for croup)
//   - differential_check[] with the four must-not-miss croup differentials
//   - reassessment_plans[] for the Phase 5 state machine
//   - publication_date + review_period_months for the freshness check
// And anaphylaxis is removed (deferred per TODOS).
//
// This file is the canary: if any of those promises break, this fails LOUD.
//
// Why this file exists separately from the legacy registry/guidelines.test.ts:
// the legacy file was tightly coupled to the v1 schema and the anaphylaxis
// guideline. Per the v3.1 plan §3 ("Surviving registry tests (~10 of the
// original 18 — drop the anaphylaxis cases)"), it gets replaced. This file is
// the replacement; the surviving NZ-croup assertions are folded in below.

import { describe, it, expect } from "vitest";
import {
  GUIDELINES,
  getGuideline,
  getDoseRule,
  getGuidelineByConditionAndRegion,
  ROUTING_TABLE,
  CONDITION_META,
  type DoseRule,
  type Guideline,
} from "./guidelines";
import { calculate_dose } from "@/tools/calculate_dose";

/** Assert-then-narrow: surface the registry's null contract instead of casting past it. */
function getOrThrow<T>(value: T | null, label: string): T {
  if (value === null) throw new Error(`fixture missing: ${label}`);
  return value;
}

// ---------------------------------------------------------------------------
// 1. SHAPE — both croup guidelines load, anaphylaxis is gone
// ---------------------------------------------------------------------------

describe("v3.1 registry shape", () => {
  it("loads exactly the two croup guidelines (NZ + AU); anaphylaxis is removed", () => {
    const ids = Object.keys(GUIDELINES).sort();
    expect(ids).toEqual(["rch-croup-2020", "starship-croup-2020"]);
  });

  it("ascia-anaphylaxis-2024 is gone (deferred per TODOS)", () => {
    expect(getGuideline("ascia-anaphylaxis-2024")).toBeNull();
    expect(CONDITION_META["anaphylaxis"]).toBeUndefined();
    expect(
      ROUTING_TABLE.find((r) => r.condition === "anaphylaxis"),
    ).toBeUndefined();
  });

  it("every guideline carries a region tag of 'NZ' or 'AU'", () => {
    for (const g of Object.values(GUIDELINES)) {
      expect(["NZ", "AU"]).toContain(g.region);
    }
  });

  it("every guideline carries publication_date + review_period_months for the freshness check", () => {
    for (const g of Object.values(GUIDELINES)) {
      // YYYY-MM-DD shape
      expect(g.publication_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(typeof g.review_period_months).toBe("number");
      expect(g.review_period_months).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. THE CORE PROMISE — Jack T. 14.2 kg NZ moderate still produces 2.13 mg
//    This is the regression that proves the schema extension didn't move a
//    single decimal place on the deterministic dose math. If this ever flips
//    to 2.12 or 2.14, the rounding contract has silently drifted.
// ---------------------------------------------------------------------------

describe("Jack T. regression — 14.2 kg moderate croup → 2.13 mg", () => {
  it("NZ Starship: 14.2 × 0.15 = 2.13 mg (under 12 mg cap)", () => {
    const result = calculate_dose(
      "starship-croup-2020",
      "croup-dex-moderate",
      14.2,
    );
    expect(result.kind).toBe("dose");
    if (result.kind === "dose") {
      expect(result.dose_mg).toBe(2.13);
      expect(result.drug).toBe("dexamethasone");
      expect(result.route).toBe("oral");
      expect(result.capped).toBe(false);
    }
  });

  it("AU RCH: same patient, same first-line rule, same arithmetic → 2.13 mg", () => {
    const result = calculate_dose(
      "rch-croup-2020",
      "croup-dex-moderate-au",
      14.2,
    );
    expect(result.kind).toBe("dose");
    if (result.kind === "dose") {
      // RCH uses the SAME 0.15 mg/kg first-line dose; the AU/NZ delta is in
      // the reassessment window, not the dose. The number must be byte-identical.
      expect(result.dose_mg).toBe(2.13);
      expect(result.drug).toBe("dexamethasone");
    }
  });
});

// ---------------------------------------------------------------------------
// 3. AU GUIDELINE SHAPE — schema completeness for the new rch-croup-2020 entry
// ---------------------------------------------------------------------------

describe("AU RCH croup guideline shape", () => {
  const rch = getOrThrow(getGuideline("rch-croup-2020"), "rch-croup-2020");

  it("has region 'AU' and condition 'croup'", () => {
    expect(rch.region).toBe("AU");
    expect(rch.condition).toBe("croup");
  });

  it("source_version mentions RCH and 2020 (verifiable citation)", () => {
    expect(rch.dose_rules[0].source_version).toMatch(/RCH/i);
    expect(rch.dose_rules[0].source_version).toMatch(/2020/);
  });

  it("has both a moderate and a severe dexamethasone rule (AU-suffixed)", () => {
    const ids = rch.dose_rules.map((r) => r.dose_rule_id).sort();
    expect(ids).toEqual(["croup-dex-moderate-au", "croup-dex-severe-au"]);
  });

  it("source_url points at rch.org.au (the actual AU citation)", () => {
    expect(rch.dose_rules[0].source_url).toMatch(/rch\.org\.au/);
  });

  it("every AU dose rule is human_verified", () => {
    for (const rule of rch.dose_rules) {
      expect(rule.human_verified).toBe(true);
    }
  });

  it("region-aware lookup: ('croup', 'AU') resolves to the RCH guideline", () => {
    const g = getGuidelineByConditionAndRegion("croup", "AU");
    expect(g?.guideline_id).toBe("rch-croup-2020");
  });

  it("region-aware lookup: ('croup', 'NZ') resolves to the Starship guideline", () => {
    const g = getGuidelineByConditionAndRegion("croup", "NZ");
    expect(g?.guideline_id).toBe("starship-croup-2020");
  });
});

// ---------------------------------------------------------------------------
// 4. SEVERITY_ROWS — the source of truth for severity matching
//    Per HARNESS-BRIEF "Companion contract addition — `severity_rows[].description`
//    is the source of truth", the skill matches the patient's note against
//    these strings rather than carrying the grading in its own prose.
// ---------------------------------------------------------------------------

describe("severity_rows[] — clinically-precise descriptions (Bjornson & Johnson modified CMAJ 2013)", () => {
  const starship = getOrThrow(getGuideline("starship-croup-2020"), "starship");
  const rch = getOrThrow(getGuideline("rch-croup-2020"), "rch");

  it("Starship NZ croup has four severity rows: mild, moderate, severe, impending_respiratory_failure", () => {
    const labels = starship.severity_rows.map((r) => r.label);
    expect(labels).toEqual([
      "mild",
      "moderate",
      "severe",
      "impending_respiratory_failure",
    ]);
  });

  it("RCH AU croup has the same four severity rows", () => {
    const labels = rch.severity_rows.map((r) => r.label);
    expect(labels).toEqual([
      "mild",
      "moderate",
      "severe",
      "impending_respiratory_failure",
    ]);
  });

  it("every severity_row description is non-empty and clinically substantive (≥ 30 chars)", () => {
    for (const g of Object.values(GUIDELINES)) {
      for (const row of g.severity_rows) {
        expect(row.description.trim().length).toBeGreaterThanOrEqual(30);
      }
    }
  });

  it("mild description matches the Bjornson grading verbatim (stridor only on exertion)", () => {
    const mild = starship.severity_rows.find((r) => r.label === "mild");
    expect(mild?.description).toBe(
      "stridor only on exertion; no rest stridor; minimal recession; alert and calm",
    );
  });

  it("moderate description matches Bjornson (rest stridor + mild-to-moderate recession)", () => {
    const moderate = starship.severity_rows.find((r) => r.label === "moderate");
    expect(moderate?.description).toBe(
      "inspiratory stridor at rest; mild-to-moderate suprasternal or intercostal recession; alert, mildly distressed",
    );
  });

  it("severe description matches Bjornson (persistent stridor + agitation trending to lethargy)", () => {
    const severe = starship.severity_rows.find((r) => r.label === "severe");
    expect(severe?.description).toBe(
      "persistent stridor; severe recession with accessory muscle use; agitation trending to lethargy; hypoxia",
    );
  });

  it("impending_respiratory_failure description matches Bjornson (stridor may diminish — ominous)", () => {
    const irf = starship.severity_rows.find(
      (r) => r.label === "impending_respiratory_failure",
    );
    expect(irf?.description).toBe(
      "stridor may diminish (ominous); exhausted; obtunded; severe hypoxia or cyanosis",
    );
  });

  it("each severity_row points at a real dose_rule_id (or null for IRF — the airway-emergency row)", () => {
    for (const g of Object.values(GUIDELINES)) {
      const validRuleIds = new Set(g.dose_rules.map((r) => r.dose_rule_id));
      for (const row of g.severity_rows) {
        if (row.applies_to_dose_rule_id !== null) {
          expect(validRuleIds.has(row.applies_to_dose_rule_id)).toBe(true);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 5. DIFFERENTIAL_CHECK — must-not-miss differentials per registry
//    Per HARNESS-BRIEF "Companion contract addition — `differential_check`",
//    the registry owns the must-not-miss list and the skill reads it in
//    Phase 2 instead of encoding the list in prose.
// ---------------------------------------------------------------------------

describe("differential_check[] — must-not-miss croup differentials (registry-owned)", () => {
  const starship = getOrThrow(getGuideline("starship-croup-2020"), "starship");
  const rch = getOrThrow(getGuideline("rch-croup-2020"), "rch");

  it("Starship croup has exactly four must-not-miss differentials", () => {
    expect(starship.differential_check.length).toBe(4);
    for (const item of starship.differential_check) {
      expect(item.hazard_level).toBe("must_not_miss");
    }
  });

  it("RCH croup has the same four must-not-miss differentials (same airway hazards apply in AU)", () => {
    expect(rch.differential_check.length).toBe(4);
    for (const item of rch.differential_check) {
      expect(item.hazard_level).toBe("must_not_miss");
    }
  });

  it("the four croup differentials are epiglottitis, bacterial tracheitis, foreign body aspiration, anaphylactic airway oedema", () => {
    const conditions = starship.differential_check
      .map((d) => d.condition)
      .sort();
    expect(conditions).toEqual([
      "anaphylactic airway oedema",
      "bacterial tracheitis",
      "epiglottitis",
      "foreign body aspiration",
    ]);
  });

  it("every differential has a non-empty distinguishing_features list (≥ 3 features each)", () => {
    for (const g of Object.values(GUIDELINES)) {
      for (const item of g.differential_check) {
        expect(item.distinguishing_features.length).toBeGreaterThanOrEqual(3);
        for (const feature of item.distinguishing_features) {
          expect(feature.trim().length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("epiglottitis features include the classic clinical mnemonics (drooling, tripod, muffled voice)", () => {
    const epi = starship.differential_check.find(
      (d) => d.condition === "epiglottitis",
    );
    expect(epi).toBeTruthy();
    const features = epi!.distinguishing_features.join(" ").toLowerCase();
    expect(features).toContain("drooling");
    expect(features).toContain("tripod");
    expect(features).toContain("muffled voice");
  });
});

// ---------------------------------------------------------------------------
// 6. REASSESSMENT_PLANS — Phase 5 state machine, registry-sourced
// ---------------------------------------------------------------------------

describe("reassessment_plans[] — Phase 5 state machine, registry-sourced", () => {
  const starship = getOrThrow(getGuideline("starship-croup-2020"), "starship");
  const rch = getOrThrow(getGuideline("rch-croup-2020"), "rch");

  it("Starship: mild/moderate plan reassesses at 120 minutes (per Starship flowchart)", () => {
    const plan = starship.reassessment_plans.find((p) =>
      p.applies_to_initial_severity.includes("moderate"),
    );
    expect(plan?.reassess_in_minutes).toBe(120);
  });

  it("Starship: severe plan reassesses at 240 minutes (longer adrenaline window)", () => {
    const plan = starship.reassessment_plans.find((p) =>
      p.applies_to_initial_severity.includes("severe"),
    );
    expect(plan?.reassess_in_minutes).toBe(240);
  });

  it("RCH: mild/moderate plan reassesses at 60 minutes (AU-vs-NZ delta — earlier discharge)", () => {
    const plan = rch.reassessment_plans.find((p) =>
      p.applies_to_initial_severity.includes("moderate"),
    );
    expect(plan?.reassess_in_minutes).toBe(60);
  });

  it("every reassessment_plan has next_branches with three severity outcomes (mild/moderate/severe)", () => {
    for (const g of Object.values(GUIDELINES)) {
      for (const plan of g.reassessment_plans) {
        const severities = plan.next_branches
          .map((b) => b.if_severity_at_reassessment)
          .sort();
        expect(severities).toEqual(["mild", "moderate", "severe"]);
      }
    }
  });

  it("every branch's setting is one of the closed enum values", () => {
    const validSettings = new Set([
      "discharge",
      "ward",
      "short_stay",
      "icu",
      "continue_current",
    ]);
    for (const g of Object.values(GUIDELINES)) {
      for (const plan of g.reassessment_plans) {
        for (const branch of plan.next_branches) {
          expect(validSettings.has(branch.setting)).toBe(true);
        }
      }
    }
  });

  it("every reassessment_plan has at least one universal_rail (the persistent banner content)", () => {
    for (const g of Object.values(GUIDELINES)) {
      for (const plan of g.reassessment_plans) {
        expect(plan.universal_rails.length).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("every reassessment_plan has watch_for items with both sign + severity_implication populated", () => {
    for (const g of Object.values(GUIDELINES)) {
      for (const plan of g.reassessment_plans) {
        expect(plan.watch_for.length).toBeGreaterThan(0);
        for (const item of plan.watch_for) {
          expect(item.sign.trim().length).toBeGreaterThan(0);
          expect(item.severity_implication.trim().length).toBeGreaterThan(0);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 7. SURVIVING NZ-CROUP ASSERTIONS — folded in from the deleted legacy file
//    (the v1 registry/guidelines.test.ts dropped along with anaphylaxis)
// ---------------------------------------------------------------------------

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

describe("surviving NZ-croup invariants (folded from legacy registry test)", () => {
  it("every dose rule has all required fields populated and human_verified===true", () => {
    for (const g of Object.values(GUIDELINES)) {
      expect(g.dose_rules.length).toBeGreaterThan(0);
      for (const rule of g.dose_rules) {
        for (const key of REQUIRED_DOSE_RULE_KEYS) {
          const v = rule[key];
          expect(v === null || v === undefined).toBe(false);
        }
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

  it("has no duplicate dose_rule_ids across guidelines", () => {
    const ids = Object.values(GUIDELINES).flatMap((g: Guideline) =>
      g.dose_rules.map((r) => r.dose_rule_id),
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("getDoseRule returns the croup-dex-moderate rule by id", () => {
    const rule = getOrThrow(
      getDoseRule("starship-croup-2020", "croup-dex-moderate"),
      "croup-dex-moderate",
    );
    expect(rule.dose_rule_id).toBe("croup-dex-moderate");
    expect(rule.drug).toBe("dexamethasone");
    expect(rule.mg_per_kg).toBe(0.15);
    expect(rule.max_mg).toBe(12);
  });

  it("getDoseRule returns null for an unknown rule id", () => {
    expect(getDoseRule("starship-croup-2020", "nonexistent")).toBeNull();
    expect(getDoseRule("nonexistent", "croup-dex-moderate")).toBeNull();
  });

  it("Starship croup severe rule is 0.6 mg/kg with the same 12 mg cap (cap-demo target)", () => {
    const severe = getOrThrow(
      getDoseRule("starship-croup-2020", "croup-dex-severe"),
      "croup-dex-severe",
    );
    expect(severe.mg_per_kg).toBe(0.6);
    expect(severe.max_mg).toBe(12);
  });

  it("ROUTING_TABLE maps croup → starship-croup-2020 (NZ default)", () => {
    const byCondition = Object.fromEntries(
      ROUTING_TABLE.map((r) => [r.condition, r.guideline_id]),
    );
    expect(byCondition["croup"]).toBe("starship-croup-2020");
  });

  it("every routed guideline_id resolves in the registry", () => {
    for (const row of ROUTING_TABLE) {
      expect(getGuideline(row.guideline_id)).not.toBeNull();
    }
  });
});
