// lib/refusal-gate.ts
//
// THE PRE-LLM DETERMINISTIC REFUSAL GATE — the Loom opener.
//
// If weight is missing, the system REFUSES with NO model call: reproducible
// 100/100, key-free. This module is intentionally PURE — synchronous, no imports
// of any model/SDK/network code, no fetch. That purity is the guarantee (the
// refusal-gate test asserts it structurally), so the dangerous-quiet failure
// (dosing on a guessed weight) is impossible by construction, before a key is
// ever needed.
//
// Three distinct deterministic refusal paths, each with its OWN copy:
//   * weight missing       → reason "weight_missing"        (GUARD-1)
//   * no matching guideline → reason "no_matching_guideline" (null-context abstain)
//   * wrong guideline      → reason "wrong_guideline"       (condition/guideline mismatch)

/** A minimal view of extracted facts — only the field this gate needs. */
export type WeightFacts = { weight_kg?: number | null };

export type RefusalReasonPreLLM =
  | "weight_missing"
  | "no_matching_guideline"
  | "wrong_guideline";

export type RefusalDecision = {
  /** True iff the system must abstain before any model call. */
  refuse: boolean;
  /** Which deterministic path fired (null when not refusing). */
  reason: RefusalReasonPreLLM | null;
  /** Clinician-facing copy — distinct per failure mode. Empty when not refusing. */
  copy: string;
};

const WEIGHT_MISSING_COPY =
  "Weight is required for a weight-based dose and was not documented. " +
  "I won't estimate it from age — please add the patient's weight in kg and re-run.";

const NO_GUIDELINE_COPY =
  "No local guideline matches this condition, so I won't guess a plan. " +
  "Confirm the condition or add a guideline to the registry.";

const WRONG_GUIDELINE_COPY =
  "The selected guideline is for a different condition than the one confirmed, " +
  "so I won't apply it. Re-select the guideline that matches the confirmed condition.";

/**
 * Pre-LLM weight gate. Returns refuse:true with NO side effects when weight is
 * null / absent / NaN. A present, numeric weight passes (refuse:false) — the
 * downstream plausibility range (GUARD-7) is the dose tool's job, not the gate's.
 *
 * PURE: synchronous, dependency-free, no network. Do NOT add async/imports here.
 */
export function refusalGate(facts: WeightFacts): RefusalDecision {
  const w = facts.weight_kg;
  const missing = w === null || w === undefined || Number.isNaN(w);
  if (missing) {
    return {
      refuse: true,
      reason: "weight_missing",
      copy: WEIGHT_MISSING_COPY,
    };
  }
  return { refuse: false, reason: null, copy: "" };
}

/**
 * The no-matching-guideline abstention (router returned null / get_guideline
 * empty). Distinct copy from the weight refusal so the UI/Loom reads the two
 * failure modes apart. Also deterministic + pure.
 */
export function noGuidelineAbstention(): RefusalDecision {
  return {
    refuse: true,
    reason: "no_matching_guideline",
    copy: NO_GUIDELINE_COPY,
  };
}

/**
 * The wrong-guideline abstention (a guideline was selected but it targets a
 * different condition than the one confirmed). Distinct copy from both
 * weight_missing and no_matching_guideline — a guideline EXISTS, it just
 * does not match the confirmed condition. Also deterministic + pure.
 */
export function wrongGuidelineAbstention(): RefusalDecision {
  return {
    refuse: true,
    reason: "wrong_guideline",
    copy: WRONG_GUIDELINE_COPY,
  };
}
