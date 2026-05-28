// tools/load_guideline.test.ts
//
// Tests for the retrieval tool. Two things to lock in:
//   1. SUCCESS shape — the return payload carries everything the skill needs
//      to advance through Phase 2 (differential check), Phase 3 (severity
//      matching), Phase 4 (calculate_dose selection), Phase 5 (reassessment).
//   2. REFUSAL shape — typed refusals for region_unknown and out_of_scope.
//
// Note on the "unknown region → ?" decision: the lane prompt mentions a
// "fallback NZ" idea, but the Phase 1 type lock in tools/types.ts encodes
// `region_unknown` as a refusal kind. The types win — silently falling
// back to NZ on a malformed region would let an AU clinician get NZ dosing
// numbers with no signal. region_unknown surfaces the ambiguity instead.

import { describe, it, expect } from "vitest";
import {
  load_guideline,
  isLoadGuidelineRefusal,
  type LoadGuidelineOk,
} from "./load_guideline";

/** Assert-then-narrow helper so refusal-vs-ok branches stay legible in tests. */
function expectOk(r: ReturnType<typeof load_guideline>): LoadGuidelineOk {
  if (isLoadGuidelineRefusal(r)) {
    throw new Error(`expected ok but got refusal: ${r.reason} — ${r.message}`);
  }
  return r;
}

describe("load_guideline — NZ croup happy path", () => {
  it("returns the Starship NZ croup payload with all phase-5 fields populated", () => {
    const r = expectOk(load_guideline("croup", "NZ"));
    expect(r.status).toBe("ok");
    expect(r.guideline_id).toBe("starship-croup-2020");
    expect(r.condition).toBe("croup");
    expect(r.region).toBe("NZ");
    // citation chip data
    expect(r.source_version).toMatch(/Starship/);
    expect(r.source_url).toMatch(/starship\.org\.nz/);
    // tool_call_id conforms to the harness regex
    expect(r.tool_call_id).toMatch(/^[a-zA-Z0-9_-]{8,32}$/);
    // payload completeness — all four arrays present and non-empty
    expect(r.severity_rows.length).toBeGreaterThan(0);
    expect(r.dose_rules.length).toBeGreaterThan(0);
    expect(r.differential_check.length).toBeGreaterThan(0);
    expect(r.reassessment_plans.length).toBeGreaterThan(0);
  });
});

describe("load_guideline — AU croup happy path (D5)", () => {
  it("returns the RCH AU croup payload — same condition, different region, different rule ids", () => {
    const r = expectOk(load_guideline("croup", "AU"));
    expect(r.guideline_id).toBe("rch-croup-2020");
    expect(r.region).toBe("AU");
    expect(r.source_version).toMatch(/RCH/);
    expect(r.source_url).toMatch(/rch\.org\.au/);
    // RCH uses AU-suffixed rule ids — distinct from Starship's
    const ruleIds = r.dose_rules.map((d) => d.dose_rule_id).sort();
    expect(ruleIds).toEqual(["croup-dex-moderate-au", "croup-dex-severe-au"]);
  });
});

describe("load_guideline — out_of_scope refusal", () => {
  it("returns out_of_scope for asthma (no guideline modelled in v3.1)", () => {
    const r = load_guideline("asthma", "NZ");
    expect(r.status).toBe("refusal");
    if (r.status === "refusal") {
      expect(r.reason).toBe("out_of_scope");
      expect(r.message).toMatch(/asthma/i);
    }
  });

  it("returns out_of_scope for anaphylaxis (retired in v3.1, deferred per TODOS)", () => {
    const r = load_guideline("anaphylaxis", "NZ");
    expect(r.status).toBe("refusal");
    if (r.status === "refusal") {
      expect(r.reason).toBe("out_of_scope");
    }
  });
});

describe("load_guideline — region_unknown refusal", () => {
  it("returns region_unknown for an unknown region string (e.g. 'US')", () => {
    const r = load_guideline("croup", "US");
    expect(r.status).toBe("refusal");
    if (r.status === "refusal") {
      expect(r.reason).toBe("region_unknown");
      // The clinician needs to see the offending region to know what to fix
      expect(r.message).toMatch(/US/);
    }
  });

  it("returns region_unknown for a malformed region (empty string, garbage)", () => {
    expect(load_guideline("croup", "").status).toBe("refusal");
    expect(load_guideline("croup", "🇳🇿").status).toBe("refusal");
  });
});

describe("load_guideline — severity_rows[] shape", () => {
  it("each severity row carries a clinically-precise description and (where applicable) a dose_rule_id", () => {
    const r = expectOk(load_guideline("croup", "NZ"));
    // labels match the Bjornson modified CMAJ grading
    const labels = r.severity_rows.map((s) => s.label);
    expect(labels).toContain("mild");
    expect(labels).toContain("moderate");
    expect(labels).toContain("severe");
    expect(labels).toContain("impending_respiratory_failure");
    // every description non-empty
    for (const row of r.severity_rows) {
      expect(row.description.trim().length).toBeGreaterThan(0);
    }
    // every applies_to_dose_rule_id (when non-null) resolves to a real dose rule
    const ruleIds = new Set(r.dose_rules.map((d) => d.dose_rule_id));
    for (const row of r.severity_rows) {
      if (row.applies_to_dose_rule_id !== null) {
        expect(ruleIds.has(row.applies_to_dose_rule_id)).toBe(true);
      }
    }
  });
});

describe("load_guideline — dose_rules[] shape", () => {
  it("each dose rule carries the parameters calculate_dose needs (mg_per_kg, max_mg, route, human_verified)", () => {
    const r = expectOk(load_guideline("croup", "NZ"));
    for (const rule of r.dose_rules) {
      expect(typeof rule.mg_per_kg).toBe("number");
      expect(typeof rule.max_mg).toBe("number");
      expect(rule.route.length).toBeGreaterThan(0);
      expect(rule.human_verified).toBe(true);
      // citation fields populated (single source of truth = the registry)
      expect(rule.source_version.length).toBeGreaterThan(0);
      expect(rule.source_url.length).toBeGreaterThan(0);
    }
  });
});

describe("load_guideline — differential_check[] shape (HARNESS-BRIEF companion contract)", () => {
  it("returns the four must-not-miss croup differentials with non-empty distinguishing_features", () => {
    const r = expectOk(load_guideline("croup", "NZ"));
    expect(r.differential_check.length).toBe(4);
    for (const item of r.differential_check) {
      expect(item.hazard_level).toBe("must_not_miss");
      expect(item.condition.length).toBeGreaterThan(0);
      expect(item.distinguishing_features.length).toBeGreaterThan(0);
      for (const feature of item.distinguishing_features) {
        expect(feature.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("the four croup differentials cover the classic airway emergencies", () => {
    const r = expectOk(load_guideline("croup", "NZ"));
    const conditions = r.differential_check.map((d) => d.condition).sort();
    expect(conditions).toEqual([
      "anaphylactic airway oedema",
      "bacterial tracheitis",
      "epiglottitis",
      "foreign body aspiration",
    ]);
  });

  it("AU and NZ croup return the SAME four must-not-miss differentials (airway hazards don't change at the border)", () => {
    const nz = expectOk(load_guideline("croup", "NZ"));
    const au = expectOk(load_guideline("croup", "AU"));
    const nzConditions = nz.differential_check.map((d) => d.condition).sort();
    const auConditions = au.differential_check.map((d) => d.condition).sort();
    expect(nzConditions).toEqual(auConditions);
  });
});
