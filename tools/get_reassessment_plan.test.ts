// tools/get_reassessment_plan.test.ts
//
// Tests for the Phase 5 reassessment tool. The seven required tests from the
// lane brief:
//   - mild/moderate plan returns 120 min
//   - severe plan returns 240 min
//   - invalid_severity_label refusal
//   - invalid_guideline_id refusal
//   - rule_not_verified refusal (freshness check)
//   - no_reassessment_required refusal (valid clinical state)
//   - branches array shape
//
// The six-step selection order from HARNESS-BRIEF is what the implementation
// guarantees; each test below screens out exactly ONE failure mode so that
// step-reordering bugs surface as a single misnamed refusal kind in the diff.

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  get_reassessment_plan,
  isReassessmentRefusal,
  type ReassessmentPlanOk,
} from "./get_reassessment_plan";

/** Assert-then-narrow helper. */
function expectOk(
  r: ReturnType<typeof get_reassessment_plan>,
): ReassessmentPlanOk {
  if (isReassessmentRefusal(r)) {
    throw new Error(`expected ok but got refusal: ${r.reason} — ${r.message}`);
  }
  return r;
}

describe("get_reassessment_plan — happy paths (Starship NZ croup)", () => {
  it("moderate-on-initial + croup-dex-moderate rule → 120 min reassess (mild/moderate plan)", () => {
    const r = expectOk(
      get_reassessment_plan(
        "starship-croup-2020",
        "moderate",
        "croup-dex-moderate",
      ),
    );
    expect(r.reassess_in_minutes).toBe(120);
    // citation flows through from the registry — never authored by the LLM
    expect(r.source_version).toMatch(/Starship/);
    expect(r.tool_call_id).toMatch(/^[a-zA-Z0-9_-]{8,32}$/);
    // trace is a human-readable derivation, not a number-laden string
    expect(r.trace).toContain("Starship");
    expect(r.trace).toContain("moderate");
  });

  it("mild-on-initial + croup-dex-moderate rule → 120 min (mild shares the same plan)", () => {
    const r = expectOk(
      get_reassessment_plan(
        "starship-croup-2020",
        "mild",
        "croup-dex-moderate",
      ),
    );
    expect(r.reassess_in_minutes).toBe(120);
  });

  it("severe-on-initial + croup-dex-severe rule → 240 min (longer adrenaline window)", () => {
    const r = expectOk(
      get_reassessment_plan(
        "starship-croup-2020",
        "severe",
        "croup-dex-severe",
      ),
    );
    expect(r.reassess_in_minutes).toBe(240);
  });
});

describe("get_reassessment_plan — refusals", () => {
  it("invalid_guideline_id: unknown guideline id (step 1)", () => {
    const r = get_reassessment_plan(
      "nonexistent-guideline",
      "moderate",
      "croup-dex-moderate",
    );
    expect(r.status).toBe("refusal");
    if (r.status === "refusal") {
      expect(r.reason).toBe("invalid_guideline_id");
      expect(r.message).toContain("nonexistent-guideline");
    }
  });

  it("invalid_dose_rule_id: unknown rule id within an otherwise-valid guideline (step 3)", () => {
    const r = get_reassessment_plan(
      "starship-croup-2020",
      "moderate",
      "nonexistent-rule",
    );
    expect(r.status).toBe("refusal");
    if (r.status === "refusal") {
      expect(r.reason).toBe("invalid_dose_rule_id");
    }
  });

  it("invalid_severity_label: severity not in this guideline's severity_rows (step 4)", () => {
    const r = get_reassessment_plan(
      "starship-croup-2020",
      "extremely-mild", // not a Bjornson label
      "croup-dex-moderate",
    );
    expect(r.status).toBe("refusal");
    if (r.status === "refusal") {
      expect(r.reason).toBe("invalid_severity_label");
      // surfaces the valid labels so the clinician sees the choice
      expect(r.message).toMatch(/mild|moderate|severe/);
    }
  });

  it("no_reassessment_required: valid (severity, rule) but no plan modelled — VALID clinical state (step 5)", () => {
    // impending_respiratory_failure is a known severity_row but has no
    // applies_to_dose_rule_id (it's the airway-emergency row, not a dose-rule
    // row). Pair it with the moderate dose-rule and there's no matching plan
    // → the brief says this should be no_reassessment_required, not an error.
    const r = get_reassessment_plan(
      "starship-croup-2020",
      "impending_respiratory_failure",
      "croup-dex-moderate",
    );
    expect(r.status).toBe("refusal");
    if (r.status === "refusal") {
      expect(r.reason).toBe("no_reassessment_required");
    }
  });

  it("rule_not_verified: freshness check fails when 'now' is past the review window", () => {
    // Force the system clock to a date past the 120-month review window
    // from publication_date 2020-08-04 (so 2030-08-05 onwards is stale).
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2031-01-01"));
    try {
      const r = get_reassessment_plan(
        "starship-croup-2020",
        "moderate",
        "croup-dex-moderate",
      );
      expect(r.status).toBe("refusal");
      if (r.status === "refusal") {
        expect(r.reason).toBe("rule_not_verified");
      }
    } finally {
      vi.useRealTimers();
    }
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("get_reassessment_plan — branches[] shape", () => {
  it("the mild/moderate plan returns three branches (one per reassessment-severity outcome)", () => {
    const r = expectOk(
      get_reassessment_plan(
        "starship-croup-2020",
        "moderate",
        "croup-dex-moderate",
      ),
    );
    expect(r.next_branches.length).toBe(3);
    const severities = r.next_branches
      .map((b) => b.if_severity_at_reassessment)
      .sort();
    expect(severities).toEqual(["mild", "moderate", "severe"]);
    // every branch carries action + setting + notes (escalate_to may be null)
    for (const b of r.next_branches) {
      expect(b.action.length).toBeGreaterThan(0);
      expect([
        "discharge",
        "ward",
        "short_stay",
        "icu",
        "continue_current",
      ]).toContain(b.setting);
    }
  });

  it("watch_for + universal_rails are populated and non-empty for happy-path plans", () => {
    const r = expectOk(
      get_reassessment_plan(
        "starship-croup-2020",
        "moderate",
        "croup-dex-moderate",
      ),
    );
    expect(r.watch_for.length).toBeGreaterThan(0);
    for (const item of r.watch_for) {
      expect(item.sign.trim().length).toBeGreaterThan(0);
      expect(item.severity_implication.trim().length).toBeGreaterThan(0);
    }
    expect(r.universal_rails.length).toBeGreaterThan(0);
  });
});

describe("get_reassessment_plan — AU/NZ region delta surfaces in reassess_in_minutes", () => {
  it("AU RCH croup mild/moderate plan uses 60-min window (vs Starship's 120) — the demo's region-toggle payoff", () => {
    const r = expectOk(
      get_reassessment_plan(
        "rch-croup-2020",
        "moderate",
        "croup-dex-moderate-au",
      ),
    );
    expect(r.reassess_in_minutes).toBe(60);
  });
});
