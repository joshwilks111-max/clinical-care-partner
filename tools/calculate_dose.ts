// tools/calculate_dose.ts
//
// THE DETERMINISTIC DOSE TOOL — the safety spine of the care-partner.
//
// INVARIANT (the judgment→execution boundary, made literal):
//   The LLM picks the rule BY ID; this tool owns every number and does all math.
//   The LLM passes only (guideline_id, dose_rule_id, weight_kg) — NEVER the drug,
//   mg_per_kg, cap, concentration, or rounding. The tool looks the rule up itself
//   from the committed registry (getDoseRule), so an injected note can change
//   WHICH rule is requested but never WHAT a rule says.
//
// Refusals are STRUCTURED RETURN VALUES, never thrown (GUARD-12) — a clinical
// tool that can't safely compute must return a legible refusal the UI renders,
// not crash the request.
//
// COMPUTE ORDER (documented, and the trace reflects it):
//   1. raw   = weight_kg × mg_per_kg
//   2. floor = max(raw, min_mg)              (min_mg floor, if min_mg != null)
//   3. round = applyRounding(floor, rule.rounding)   (GUARD-8, data not inference)
//   4. cap   = min(round, max_mg)            (GUARD-5, the HARD final clamp)
// Cap is applied LAST so it always wins as the ceiling. Rounding before cap is
// safe (cap is a hard limit; rounding can only move within an increment).

import { getDoseRule, type DoseRule } from "@/registry/guidelines";

// ---------------------------------------------------------------------------
// Result + refusal types
// ---------------------------------------------------------------------------

export type DoseResult = {
  kind: "dose";
  dose_mg: number;
  dose_ml: number | null;
  drug: string;
  route: string;
  frequency: string;
  /** GUARD-9: human-readable working (weight × mg/kg = raw → cap → final). */
  calculation_trace: string;
  /** GUARD-5: true iff the raw dose STRICTLY exceeded max_mg and was clamped. */
  capped: boolean;
  /** The limit that bound the result (max_mg) when capped; null otherwise. */
  binding_limit: number | null;
  /** Non-fatal flags surfaced to the clinician (floor applied, weight-confirm). */
  data_gaps: string[];
};

/** The discrete refusal reasons — a closed set so callers can switch on them. */
export type RefusalReason =
  | "weight_missing" // GUARD-1 (defensive): null/absent/NaN weight
  | "implausible_weight" // GUARD-7: <=0, >200, non-finite
  | "invalid_dose_rule_id" // unknown guideline or rule id
  | "rule_not_verified"; // human_verified === false

export type DoseRefusal = {
  kind: "refusal";
  reason: RefusalReason;
  /** Clinician-facing sentence — the headline of the refusal state. */
  message: string;
};

/** Type guard: is this result a refusal? */
export function isRefusal(r: DoseResult | DoseRefusal): r is DoseRefusal {
  return r.kind === "refusal";
}

// ---------------------------------------------------------------------------
// GUARD-2 helper — string-unit rejection (used by upstream extraction).
// calculate_dose receives a numeric weight_kg; this exported helper lets the
// extraction layer reject "lb/lbs/pounds" BEFORE a number ever reaches the tool.
// Kept numeric + testable, not "looks like pounds".
// ---------------------------------------------------------------------------

const POUNDS_UNIT = /\b(lb|lbs|pound|pounds)\b/i;

/** True iff a raw weight string carries an imperial (pounds) unit. */
export function isPounds(weightText: string): boolean {
  return POUNDS_UNIT.test(weightText);
}

// GUARD-2 numeric heuristic: a unitless weight this large for a paediatric
// dosing context is implausible (the shape of a lb→kg confusion). It is still
// within GUARD-7 range, so we do NOT refuse — we FLAG it for clinician confirm.
const PAEDIATRIC_CONFIRM_THRESHOLD_KG = 100;

// ---------------------------------------------------------------------------
// Rounding (GUARD-8) — applied from rule DATA, never inferred from drug class.
// Integer-cents arithmetic avoids binary-float drift (2.13 must be exact).
// ---------------------------------------------------------------------------

function applyRounding(value: number, rounding: DoseRule["rounding"]): number {
  if (rounding === null) return value;
  const { direction, increment_mg } = rounding;
  if (increment_mg <= 0) return value;
  // CRITICAL float-safety: 14.2 × 0.15 = 2.1299999999999994 in IEEE-754, so
  // value/increment = 212.9999999... and a naive Math.floor would TRUNCATE a
  // whole increment (→ 2.12, a clinical error). Snap `steps` to 9 dp first so
  // 212.99999994 → 213 before flooring. This is the "provably right, not just
  // looks right" fix the dose math demands.
  const steps = Number((value / increment_mg).toFixed(9));
  const roundedSteps =
    direction === "down" ? Math.floor(steps) : Math.round(steps);
  // Re-multiply then snap to the increment's decimal places to kill float drift.
  const raw = roundedSteps * increment_mg;
  const decimals = decimalPlaces(increment_mg);
  return Number(raw.toFixed(decimals));
}

/** Decimal places of an increment (0.01 → 2), for clean re-snapping. */
function decimalPlaces(n: number): number {
  const s = String(n);
  const dot = s.indexOf(".");
  return dot === -1 ? 0 : s.length - dot - 1;
}

/** Round a derived mL volume to 2dp (clinical-facts: 0.142 → 0.14). */
function roundMl(ml: number): number {
  return Number(ml.toFixed(2));
}

/** Format a number for the trace. JS String() already drops trailing-zero
 *  noise (12.0 → "12", 2.13 → "2.13"), which is exactly the scannable form the
 *  fixed dose-trace format wants. */
function fmt(n: number): string {
  return String(n);
}

// ---------------------------------------------------------------------------
// Public entry — the LLM-facing tool. Looks the rule up; never trusts caller numbers.
// ---------------------------------------------------------------------------

export function calculate_dose(
  guideline_id: string,
  dose_rule_id: string,
  weight_kg: number,
): DoseResult | DoseRefusal {
  // Reject invalid rule id FIRST (GUARD: the tool owns lookup, not the LLM).
  const rule = getDoseRule(guideline_id, dose_rule_id);
  if (rule === null) {
    return {
      kind: "refusal",
      reason: "invalid_dose_rule_id",
      message: `No dose rule "${dose_rule_id}" in guideline "${guideline_id}". I will not guess a rule.`,
    };
  }
  return calculateDoseFromRule(rule, weight_kg);
}

// ---------------------------------------------------------------------------
// Rule-level core — exported so branches that real registry data does not
// exercise (human_verified:false, min_mg floor) can be tested with stub rules.
// ---------------------------------------------------------------------------

export function calculateDoseFromRule(
  rule: DoseRule,
  weight_kg: number,
): DoseResult | DoseRefusal {
  // human_verified gate: never execute an unverified rule.
  if (rule.human_verified !== true) {
    return {
      kind: "refusal",
      reason: "rule_not_verified",
      message: `Dose rule "${rule.dose_rule_id}" is not human-verified. I will not execute an unverified clinical rule.`,
    };
  }

  // GUARD-1 (defensive): null/absent weight → refuse, never estimate. This is
  // "weight was NEVER provided" (the tool's backstop for the pre-LLM gate).
  // (NaN/Infinity are a value that IS present but not usable → caught by GUARD-7
  // below as "implausible", a distinct, more accurate reason.)
  if (weight_kg === null || weight_kg === undefined) {
    return {
      kind: "refusal",
      reason: "weight_missing",
      message:
        "Weight is required to calculate a weight-based dose. I will not estimate it.",
    };
  }

  // GUARD-7: plausibility — 0 < weight <= 200, finite (rejects NaN/Infinity too).
  if (!Number.isFinite(weight_kg) || weight_kg <= 0 || weight_kg > 200) {
    return {
      kind: "refusal",
      reason: "implausible_weight",
      message: `Weight ${weight_kg} kg is outside the plausible range (0 < weight ≤ 200 kg). I will not dose on it.`,
    };
  }

  const data_gaps: string[] = [];

  // GUARD-2 numeric heuristic: flag (do not refuse) an implausibly-large
  // unitless weight for a paediatric dosing context — the shape of lb→kg confusion.
  if (weight_kg >= PAEDIATRIC_CONFIRM_THRESHOLD_KG) {
    data_gaps.push(
      `Weight ${weight_kg} kg is unusually high — confirm it is kilograms, not pounds.`,
    );
  }

  // --- COMPUTE ORDER (documented at the top of this file) ---

  // 1. raw
  const raw = weight_kg * rule.mg_per_kg;

  // 2. min_mg floor (if specified) — flagged in data_gaps + trace.
  let floored = raw;
  let floorApplied = false;
  if (rule.min_mg !== null && raw < rule.min_mg) {
    floored = rule.min_mg;
    floorApplied = true;
    data_gaps.push(
      `Raw dose ${fmt(round2(raw))} mg below min ${fmt(rule.min_mg)} mg — floored to min.`,
    );
  }

  // 3. rounding (GUARD-8, data not inference)
  const rounded = applyRounding(floored, rule.rounding);

  // 4. cap (GUARD-5) — the HARD final clamp; cap STRICTLY-over only.
  const capped = rounded > rule.max_mg;
  const dose_mg = capped ? rule.max_mg : rounded;
  const binding_limit = capped ? rule.max_mg : null;

  // dose_ml: DERIVE from concentration; never assume dose_ml === dose_mg.
  const dose_ml =
    rule.concentration_mg_per_ml !== null
      ? roundMl(dose_mg / rule.concentration_mg_per_ml)
      : null;

  // GUARD-9: build the trace reflecting the ACTUAL compute order.
  const calculation_trace = buildTrace({
    weight_kg,
    mg_per_kg: rule.mg_per_kg,
    raw,
    floorApplied,
    min_mg: rule.min_mg,
    capped,
    max_mg: rule.max_mg,
    dose_mg,
  });

  return {
    kind: "dose",
    dose_mg,
    dose_ml,
    drug: rule.drug,
    route: rule.route,
    frequency: rule.frequency,
    calculation_trace,
    capped,
    binding_limit,
    data_gaps,
  };
}

// ---------------------------------------------------------------------------
// Trace builder (GUARD-9) — fixed, scannable format (DESIGN.md UI contract).
// ---------------------------------------------------------------------------

function buildTrace(args: {
  weight_kg: number;
  mg_per_kg: number;
  raw: number;
  floorApplied: boolean;
  min_mg: number | null;
  capped: boolean;
  max_mg: number;
  dose_mg: number;
}): string {
  const {
    weight_kg,
    mg_per_kg,
    raw,
    floorApplied,
    min_mg,
    capped,
    max_mg,
    dose_mg,
  } = args;
  const head = `${fmt(weight_kg)} kg × ${fmt(mg_per_kg)} mg/kg = ${fmt(round2(raw))} mg`;

  if (capped) {
    // e.g. "25 kg × 0.6 mg/kg = 15 mg → CAPPED to 12 mg"
    return `${head} → CAPPED to ${fmt(max_mg)} mg`;
  }
  if (floorApplied && min_mg !== null) {
    // e.g. "0.5 kg × 1 mg/kg = 0.5 mg → floored to 2 mg (min 2 mg)"
    return `${head} → floored to ${fmt(dose_mg)} mg (min ${fmt(min_mg)} mg)`;
  }
  // e.g. "14.2 kg × 0.15 mg/kg = 2.13 mg (under 12 mg cap)"
  return `${head} (under ${fmt(max_mg)} mg cap)`;
}

/** Round to 2dp for trace display (raw values only — the dose itself is exact). */
function round2(n: number): number {
  return Number(n.toFixed(2));
}
