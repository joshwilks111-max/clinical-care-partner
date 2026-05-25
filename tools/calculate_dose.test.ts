// tools/calculate_dose.test.ts
//
// TDD boundary assertions for the deterministic dose tool — the safety spine.
// Written BEFORE the implementation (superpowers:test-driven-development).
//
// INVARIANT under test: the LLM picks the rule by id; this tool owns every
// number and does all math. The tool looks the rule up itself via getDoseRule;
// the caller never passes drug/mg_per_kg/cap.
//
// Clinical numbers are the verified ones from DESIGN.md / research/clinical-facts.md:
//   croup moderate  0.15 mg/kg, cap 12, round down 0.01 → 14.2 kg = 2.13 mg
//   croup severe    0.6  mg/kg, cap 12               → 25 kg = 15 → CAPPED 12 mg
//   anaphylaxis     0.01 mg/kg, cap 0.5, conc 1.0    → 14.2 kg = 0.142 → 0.14 mg / 0.14 mL IM
//
// Branches not exercised by real registry data (every real rule has min_mg:null
// and human_verified:true) are tested via SYNTHETIC stub rules passed straight
// to the rule-level helper, so coverage is honest rather than asserted.

import { describe, it, expect } from "vitest";
import {
  calculate_dose,
  calculateDoseFromRule,
  isRefusal,
  isPounds,
  type DoseResult,
  type DoseRefusal,
} from "./calculate_dose";
import { type DoseRule } from "@/registry/guidelines";

/** Narrow a result to success or throw — surfaces an unexpected refusal in tests. */
function expectSuccess(r: DoseResult | DoseRefusal): DoseResult {
  if (isRefusal(r)) {
    throw new Error(`expected success but got refusal: ${r.reason}`);
  }
  return r;
}

/** Narrow a result to refusal or throw. */
function expectRefusal(r: DoseResult | DoseRefusal): DoseRefusal {
  if (!isRefusal(r)) {
    throw new Error(`expected refusal but got dose_mg=${r.dose_mg}`);
  }
  return r;
}

/** A synthetic, fully-valid base rule for branches real data doesn't exercise. */
function stubRule(overrides: Partial<DoseRule> = {}): DoseRule {
  return {
    dose_rule_id: "stub-rule",
    drug: "stubdrug",
    mg_per_kg: 1,
    min_mg: null,
    max_mg: 1000,
    route: "oral",
    frequency: "single dose",
    concentration_mg_per_ml: null,
    rounding: null,
    source_section: "stub section",
    source_version: "stub v1",
    source_url: "https://example.test/stub",
    human_verified: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// The four DESIGN.md demo cases (1, 3, 4 — case 2 refusal lives in refusal-gate)
// ---------------------------------------------------------------------------

describe("calculate_dose — DESIGN.md demo cases (real registry rules)", () => {
  it("CASE 1 (compute): Jack 14.2 kg moderate croup → dose_mg === 2.13", () => {
    const r = expectSuccess(
      calculate_dose("starship-croup-2020", "croup-dex-moderate", 14.2),
    );
    expect(r.dose_mg).toBe(2.13);
    expect(r.capped).toBe(false);
    expect(r.binding_limit).toBeNull();
    expect(r.dose_ml).toBeNull(); // oral: no concentration
    expect(r.drug).toBe("dexamethasone");
    expect(r.route).toBe("oral");
    // GUARD-9: show the working, with the under-cap note.
    expect(r.calculation_trace).toBe(
      "14.2 kg × 0.15 mg/kg = 2.13 mg (under 12 mg cap)",
    );
  });

  it("CASE 4 (cap fires): 25 kg severe croup → capped, binding_limit 12, dose_mg 12", () => {
    const r = expectSuccess(
      calculate_dose("starship-croup-2020", "croup-dex-severe", 25),
    );
    expect(r.dose_mg).toBe(12);
    expect(r.capped).toBe(true);
    expect(r.binding_limit).toBe(12);
    // GUARD-9 capped trace shows raw → CAPPED.
    expect(r.calculation_trace).toBe(
      "25 kg × 0.6 mg/kg = 15 mg → CAPPED to 12 mg",
    );
  });

  it("CASE 3 (generalise): anaphylaxis 14.2 kg → dose_mg 0.14, dose_ml 0.14, route IM", () => {
    const r = expectSuccess(
      calculate_dose(
        "ascia-anaphylaxis-2024",
        "anaphylaxis-adrenaline-im",
        14.2,
      ),
    );
    expect(r.dose_mg).toBe(0.14); // 0.142 → nearest 0.01 → 0.14
    expect(r.dose_ml).toBe(0.14); // derived: 0.14 mg / 1.0 mg/mL
    expect(r.capped).toBe(false);
    expect(r.drug).toBe("adrenaline");
    expect(r.route).toBe("IM");
  });
});

// ---------------------------------------------------------------------------
// GUARD-5 — hard cap boundary
// ---------------------------------------------------------------------------

describe("GUARD-5 — cap boundary semantics", () => {
  // BOUNDARY DECISION: raw EXACTLY at max is NOT flagged capped — the cap only
  // fires when raw STRICTLY exceeds max (raw > max). At raw === max nothing was
  // clamped, so capped:false / binding_limit:null. (Documented + tested.)
  it("raw exactly at cap (raw === max) is NOT flagged capped", () => {
    // stub: 12 mg/kg × 1 kg = 12 mg, max 12 → raw == max.
    const r = expectSuccess(
      calculateDoseFromRule(stubRule({ mg_per_kg: 12, max_mg: 12 }), 1),
    );
    expect(r.dose_mg).toBe(12);
    expect(r.capped).toBe(false);
    expect(r.binding_limit).toBeNull();
  });

  it("raw just over cap IS flagged capped", () => {
    // 13 mg/kg × 1 kg = 13 mg, max 12 → raw > max.
    const r = expectSuccess(
      calculateDoseFromRule(stubRule({ mg_per_kg: 13, max_mg: 12 }), 1),
    );
    expect(r.dose_mg).toBe(12);
    expect(r.capped).toBe(true);
    expect(r.binding_limit).toBe(12);
  });
});

// ---------------------------------------------------------------------------
// GUARD-7 — plausibility (0 < weight <= 200, finite)
// ---------------------------------------------------------------------------

describe("GUARD-7 — weight plausibility → structured refusal (never throw)", () => {
  it("zero weight refuses", () => {
    const r = expectRefusal(
      calculate_dose("starship-croup-2020", "croup-dex-moderate", 0),
    );
    expect(r.reason).toBe("implausible_weight");
  });

  it("negative weight refuses", () => {
    const r = expectRefusal(
      calculate_dose("starship-croup-2020", "croup-dex-moderate", -5),
    );
    expect(r.reason).toBe("implausible_weight");
  });

  it("NaN weight refuses", () => {
    const r = expectRefusal(
      calculate_dose("starship-croup-2020", "croup-dex-moderate", NaN),
    );
    expect(r.reason).toBe("implausible_weight");
  });

  it("Infinity weight refuses", () => {
    const r = expectRefusal(
      calculate_dose("starship-croup-2020", "croup-dex-moderate", Infinity),
    );
    expect(r.reason).toBe("implausible_weight");
  });

  it("weight above 200 kg refuses", () => {
    const r = expectRefusal(
      calculate_dose("starship-croup-2020", "croup-dex-moderate", 201),
    );
    expect(r.reason).toBe("implausible_weight");
  });

  it("weight at exactly 200 kg is allowed (boundary inclusive)", () => {
    const r = expectSuccess(
      calculate_dose("starship-croup-2020", "croup-dex-moderate", 200),
    );
    // 200 × 0.15 = 30 → capped to 12.
    expect(r.dose_mg).toBe(12);
    expect(r.capped).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GUARD-1 (defensive) — null/absent weight rejected by the tool too
// ---------------------------------------------------------------------------

describe("GUARD-1 (defensive) — null/absent weight refuses at the tool", () => {
  it("null weight refuses with weight_missing (never estimate)", () => {
    const r = expectRefusal(
      // deliberately pass null past the type to model an upstream gap
      calculate_dose(
        "starship-croup-2020",
        "croup-dex-moderate",
        null as unknown as number,
      ),
    );
    expect(r.reason).toBe("weight_missing");
  });

  it("undefined weight refuses with weight_missing", () => {
    const r = expectRefusal(
      calculate_dose(
        "starship-croup-2020",
        "croup-dex-moderate",
        undefined as unknown as number,
      ),
    );
    expect(r.reason).toBe("weight_missing");
  });
});

// ---------------------------------------------------------------------------
// Invalid rule id / unknown guideline → structured refusal (GUARD: reject id)
// ---------------------------------------------------------------------------

describe("rule lookup — invalid id refuses", () => {
  it("invalid dose_rule_id refuses", () => {
    const r = expectRefusal(
      calculate_dose("starship-croup-2020", "no-such-rule", 14.2),
    );
    expect(r.reason).toBe("invalid_dose_rule_id");
  });

  it("unknown guideline_id refuses", () => {
    const r = expectRefusal(
      calculate_dose("no-such-guideline", "croup-dex-moderate", 14.2),
    );
    expect(r.reason).toBe("invalid_dose_rule_id");
  });
});

// ---------------------------------------------------------------------------
// human_verified gate (stub — all real rules are human_verified:true)
// ---------------------------------------------------------------------------

describe("human_verified gate — refuse to execute an unverified rule", () => {
  it("human_verified:false refuses (tested via synthetic stub rule)", () => {
    const r = expectRefusal(
      calculateDoseFromRule(stubRule({ human_verified: false }), 14.2),
    );
    expect(r.reason).toBe("rule_not_verified");
  });
});

// ---------------------------------------------------------------------------
// GUARD-8 — rounding is DATA: both directions
// ---------------------------------------------------------------------------

describe("GUARD-8 — rounding applied from the rule (data, not inference)", () => {
  it("round DOWN 0.01: 14.2 × 0.15 = 2.13 (real croup rule)", () => {
    const r = expectSuccess(
      calculate_dose("starship-croup-2020", "croup-dex-moderate", 14.2),
    );
    expect(r.dose_mg).toBe(2.13);
  });

  it("round DOWN 0.01 truncates, not rounds: 2.137 → 2.13 (stub)", () => {
    // mg_per_kg chosen so raw = 2.137 then rounds down to 2.13.
    const r = expectSuccess(
      calculateDoseFromRule(
        stubRule({
          mg_per_kg: 2.137,
          rounding: { direction: "down", increment_mg: 0.01 },
        }),
        1,
      ),
    );
    expect(r.dose_mg).toBe(2.13);
  });

  it("round NEAREST 0.01: 0.142 → 0.14 (real anaphylaxis rule)", () => {
    const r = expectSuccess(
      calculate_dose(
        "ascia-anaphylaxis-2024",
        "anaphylaxis-adrenaline-im",
        14.2,
      ),
    );
    expect(r.dose_mg).toBe(0.14);
  });

  it("round NEAREST 0.01 rounds up at .5: 0.145 → 0.15 (stub)", () => {
    const r = expectSuccess(
      calculateDoseFromRule(
        stubRule({
          mg_per_kg: 0.0145,
          max_mg: 100,
          rounding: { direction: "nearest", increment_mg: 0.01 },
        }),
        10, // 10 × 0.0145 = 0.145 → nearest 0.01 → 0.15
      ),
    );
    expect(r.dose_mg).toBe(0.15);
  });

  it("round NEAREST 0.01 rounds DOWN just below .5: 0.144 → 0.14 (stub)", () => {
    // 'nearest' was only tested on the round-UP side. This exercises the DOWN
    // side: value sits below the half-increment so Math.round rounds toward zero.
    const r = expectSuccess(
      calculateDoseFromRule(
        stubRule({
          mg_per_kg: 0.0144,
          max_mg: 100,
          rounding: { direction: "nearest", increment_mg: 0.01 },
        }),
        10, // 10 × 0.0144 = 0.144 → nearest 0.01 → 0.14 (rounds DOWN)
      ),
    );
    expect(r.dose_mg).toBe(0.14);
  });

  it("increment_mg <= 0 short-circuits (divide-by-zero guard): raw passes through unchanged (stub)", () => {
    // applyRounding has `if (increment_mg <= 0) return value` to avoid dividing by
    // zero (which would yield Infinity/NaN). A rule with increment_mg:0 must leave
    // the raw value finite + untouched.
    const r = expectSuccess(
      calculateDoseFromRule(
        stubRule({
          mg_per_kg: 0.333,
          max_mg: 100,
          rounding: { direction: "down", increment_mg: 0 },
        }),
        1, // 1 × 0.333 = 0.333, no rounding applied → 0.333
      ),
    );
    expect(r.dose_mg).toBe(0.333);
    expect(Number.isFinite(r.dose_mg)).toBe(true);
  });

  it("no rounding rule (null) leaves the raw value", () => {
    const r = expectSuccess(
      calculateDoseFromRule(
        stubRule({ mg_per_kg: 0.333, max_mg: 100, rounding: null }),
        1,
      ),
    );
    expect(r.dose_mg).toBe(0.333);
  });
});

// ---------------------------------------------------------------------------
// min_mg floor (stub — both real rules have min_mg:null)
// ---------------------------------------------------------------------------

describe("min_mg floor — raw below min is floored to min, flagged", () => {
  it("raw < min_mg floors to min_mg and records a data gap (stub)", () => {
    // 0.5 mg/kg × 1 kg = 0.5 raw, min 2 → floored to 2.
    const r = expectSuccess(
      calculateDoseFromRule(
        stubRule({ mg_per_kg: 0.5, min_mg: 2, max_mg: 100 }),
        1,
      ),
    );
    expect(r.dose_mg).toBe(2);
    expect(r.data_gaps.some((g) => g.includes("min"))).toBe(true);
    expect(r.calculation_trace).toContain("floor");
  });

  it("raw above min_mg is untouched by the floor (stub)", () => {
    const r = expectSuccess(
      calculateDoseFromRule(
        stubRule({ mg_per_kg: 5, min_mg: 2, max_mg: 100 }),
        1,
      ),
    );
    expect(r.dose_mg).toBe(5);
    expect(r.data_gaps.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// dose_ml derivation (NOT assumed equal to dose_mg)
// ---------------------------------------------------------------------------

describe("dose_ml — derived from concentration, never assumed", () => {
  it("derives mL at a non-1.0 concentration (stub: conc 2.0)", () => {
    // 10 mg dose at 2.0 mg/mL → 5.0 mL (proves dose_ml !== dose_mg).
    const r = expectSuccess(
      calculateDoseFromRule(
        stubRule({
          mg_per_kg: 10,
          max_mg: 100,
          concentration_mg_per_ml: 2.0,
          rounding: { direction: "nearest", increment_mg: 0.01 },
        }),
        1,
      ),
    );
    expect(r.dose_mg).toBe(10);
    expect(r.dose_ml).toBe(5.0);
  });

  it("dose_ml is null when concentration is null", () => {
    const r = expectSuccess(
      calculate_dose("starship-croup-2020", "croup-dex-moderate", 14.2),
    );
    expect(r.dose_ml).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// GUARD-2 — kg enforcement (numeric plausibility + string-unit helper)
// ---------------------------------------------------------------------------

describe("GUARD-2 — enforce kg (numeric heuristic + unit-string helper)", () => {
  it("isPounds helper rejects lb / lbs / pounds units", () => {
    expect(isPounds("31 lb")).toBe(true);
    expect(isPounds("31 lbs")).toBe(true);
    expect(isPounds("31 pounds")).toBe(true);
    expect(isPounds("31 LB")).toBe(true);
    expect(isPounds("14.2 kg")).toBe(false);
    expect(isPounds("14.2")).toBe(false);
  });

  it("a plausibly-paediatric kg weight does NOT get the pounds-shape flag", () => {
    const r = expectSuccess(
      calculate_dose("starship-croup-2020", "croup-dex-moderate", 14.2),
    );
    expect(r.data_gaps.some((g) => g.toLowerCase().includes("pound"))).toBe(
      false,
    );
  });

  it("a pounds-shaped / implausible unitless number flags for confirmation", () => {
    // 150 is in-range for GUARD-7 (<=200) but implausibly large for a child;
    // it is the kind of value a lb→kg confusion produces. GUARD-2 flags it.
    const r = expectSuccess(
      calculate_dose("starship-croup-2020", "croup-dex-moderate", 150),
    );
    expect(r.data_gaps.some((g) => g.toLowerCase().includes("confirm"))).toBe(
      true,
    );
  });
});
