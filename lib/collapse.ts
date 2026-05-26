// lib/collapse.ts
//
// THE PURE COLLAPSE DECISION CORE — owns every ask / plan / abstain choice.
//
// This module is intentionally PURE — synchronous, dependency-free apart from a
// single TYPE import, no model/SDK/network/registry imports, no fetch (mirror the
// refusal-gate.ts purity rationale: purity is the guarantee, so the dangerous
// failure mode is impossible by construction). It owns the ask/plan/abstain
// decision so the LLM NEVER re-ranks the differential after turn 1: the model
// produces a differential once; from there, evidence flips and the collapse
// decision are DETERMINISTIC code paths, not further model judgement.
//
// Governing principle: FAIL TOWARD STOPPING. Every ambiguous, tied, or
// must-not-miss-with-positives situation resolves to "abstain" — we would rather
// stop and ask a human than auto-route to a drug dose the data cannot justify.
//
// CONTRIBUTOR RECIPE: Adding a 3rd guideline (TODOS #7) needs ZERO edits here —
// decideCollapse reads the registry-built ConditionGuidelineMap; extend the
// registry, not this file.

import type { Differential, DifferentialCondition } from "@/lib/schemas";

// ---------------------------------------------------------------------------
// Public decision shape.
// ---------------------------------------------------------------------------

export type CollapseAction = "ask" | "plan" | "abstain";

export type CollapseDecision = {
  action: CollapseAction;
  /** The must-not-miss condition NAME to ask about (only when action === "ask"). */
  target?: string;
  /** That must-not-miss's negative_evidence findings to ask about (when "ask"). */
  discriminators?: string[];
  /** The candidate guideline to dose against (only when action === "plan"). */
  guidelineId?: string;
};

/**
 * NORMALIZED condition name → guideline_id.
 *
 * CONTRACT: the CALLER (Task 6) builds this map with keys ALREADY normalized
 * (via the same norm() spirit used here). The differential's raw
 * `condition.name` (e.g. "Croup") is normalized INSIDE this module at lookup
 * time before indexing into the map (whose key is e.g. "croup").
 */
export type ConditionGuidelineMap = Record<string, string>;

/**
 * One clarifying round only. decideCollapse may ask at most once; once round
 * reaches MAX_ROUNDS, an unresolved must-not-miss can no longer be asked about
 * and the decision falls to abstain (fail toward stopping).
 */
export const MAX_ROUNDS = 1;

// ---------------------------------------------------------------------------
// Normalization (owned INSIDE this module — see ConditionGuidelineMap contract).
// Mirrors the spirit of router.ts norm() (lowercase + trim) plus an internal
// whitespace collapse so "Toxic  Shock" and "toxic shock" key identically.
// ---------------------------------------------------------------------------

function norm(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, " ");
}

// ---------------------------------------------------------------------------
// Predicates over a single condition.
// ---------------------------------------------------------------------------

/** A confirmed/positive must-not-miss: must-not-miss WITH positive evidence. */
function isPositiveMustNotMiss(c: DifferentialCondition): boolean {
  return c.likelihood === "must-not-miss" && c.positive_evidence.length > 0;
}

/** An unresolved must-not-miss: must-not-miss with ZERO positive evidence. */
function isUnresolvedMustNotMiss(c: DifferentialCondition): boolean {
  return c.likelihood === "must-not-miss" && c.positive_evidence.length === 0;
}

/**
 * A "treatable top condition": likelihood is NOT must-not-miss (i.e. "likely"
 * or "possible") AND its normalized name is a key in the map (so it routes to a
 * guideline). The map membership is checked against the SPECIFIC condition's
 * name — never mere map non-emptiness.
 */
function isTreatableTop(
  c: DifferentialCondition,
  map: ConditionGuidelineMap,
): boolean {
  if (c.likelihood === "must-not-miss") return false;
  return Object.prototype.hasOwnProperty.call(map, norm(c.name));
}

// ---------------------------------------------------------------------------
// decideCollapse — the ask / plan / abstain decision.
//
// Rules are evaluated in this SAFETY order (ordering is load-bearing — rule 2
// must beat rule 4: a must-not-miss WITH positive evidence is NEVER asked about,
// it is a terminal abstain):
//
//   1. Empty conditions                          → abstain
//   2. ANY positive (confirmed) must-not-miss    → abstain  (false-negative guard)
//   3. Multi-condition ties                      → abstain  (order-independent)
//        - > 1 unresolved must-not-miss          → abstain
//        - > 1 treatable top mapping to guideline→ abstain
//   4. exactly 1 unresolved must-not-miss AND
//      exactly 1 treatable top AND round < MAX   → ask
//   5. NO unresolved must-not-miss AND
//      exactly 1 treatable top mapping           → plan
//   6. otherwise                                 → abstain
// ---------------------------------------------------------------------------

export function decideCollapse(
  d: Differential,
  map: ConditionGuidelineMap,
  round: number,
): CollapseDecision {
  // Rule 1: nothing to reason over → stop.
  if (d.conditions.length === 0) {
    return { action: "abstain" };
  }

  // Rule 2 (safety-critical, checked EARLY): a must-not-miss with ANY positive
  // evidence is confirmed-enough to be terminal. NEVER plan or ask past it.
  if (d.conditions.some(isPositiveMustNotMiss)) {
    return { action: "abstain" };
  }

  const unresolvedMustNotMiss = d.conditions.filter(isUnresolvedMustNotMiss);
  const treatableTops = d.conditions.filter((c) => isTreatableTop(c, map));

  // Rule 3: deterministic, order-independent tie-breaks → abstain (never pick
  // an arbitrary target or auto-dose a drug the data cannot disambiguate).
  if (unresolvedMustNotMiss.length > 1) {
    return { action: "abstain" };
  }
  if (treatableTops.length > 1) {
    return { action: "abstain" };
  }

  // Rule 4: ask iff exactly one unresolved must-not-miss AND exactly one
  // treatable top AND we still have a round to spend.
  if (
    unresolvedMustNotMiss.length === 1 &&
    treatableTops.length === 1 &&
    round < MAX_ROUNDS
  ) {
    const target = unresolvedMustNotMiss[0];
    return {
      action: "ask",
      target: target.name,
      discriminators: target.negative_evidence,
    };
  }

  // Rule 5: plan iff NO unresolved must-not-miss remains AND exactly one
  // treatable top maps to a guideline.
  if (unresolvedMustNotMiss.length === 0 && treatableTops.length === 1) {
    return { action: "plan", guidelineId: map[norm(treatableTops[0].name)] };
  }

  // Rule 6: everything else — no treatable top maps to a guideline, OR an
  // unresolved must-not-miss survives at/after MAX_ROUNDS, OR any residual
  // ambiguity. Fail toward stopping.
  return { action: "abstain" };
}

// ---------------------------------------------------------------------------
// applyAnswer — the DETERMINISTIC evidence flip (the LLM does NOT re-rank).
//
// The clinician answers a discriminator question; we move the named findings
// between a condition's positive/negative evidence arms accordingly. We invent
// NOTHING: a finding not already present in either arm is UNKNOWN and skipped.
//
// IMMUTABLE + PURE: returns a NEW Differential; never mutates the input or any
// nested array/object (a test asserts the input is unchanged).
// ---------------------------------------------------------------------------

export function applyAnswer(
  d: Differential,
  conditionName: string,
  findings: string[],
  present: boolean,
): Differential {
  const wanted = norm(conditionName);

  // Locate the target condition by normalized name. None → return an unchanged
  // (shallow-cloned) differential: no semantic change.
  const idx = d.conditions.findIndex((c) => norm(c.name) === wanted);
  if (idx === -1) {
    return {
      conditions: [...d.conditions],
      candidate_guidelines: d.candidate_guidelines,
    };
  }

  const target = d.conditions[idx];

  // An "already-present" finding is one currently in EITHER arm. Findings in
  // neither arm are UNKNOWN → skipped (we do not invent evidence).
  const known = new Set<string>([
    ...target.positive_evidence,
    ...target.negative_evidence,
  ]);
  const toMove = new Set(findings.filter((f) => known.has(f)));

  let positive: string[];
  let negative: string[];
  let likelihood: DifferentialCondition["likelihood"] = target.likelihood;

  if (present) {
    // Confirmed PRESENT: each moved finding goes INTO positive_evidence and is
    // removed from negative_evidence. (Downstream decideCollapse will then
    // abstain via rule 2 — a must-not-miss now has positive evidence.) The
    // likelihood band is UNCHANGED: a confirmed must-not-miss stays must-not-miss.
    positive = dedupe([
      ...target.positive_evidence,
      ...target.negative_evidence.filter((f) => toMove.has(f)),
    ]);
    negative = dedupe(target.negative_evidence.filter((f) => !toMove.has(f)));
  } else {
    // Confirmed ABSENT: each moved finding is ensured in negative_evidence and
    // removed from positive_evidence. The must-not-miss stays at ZERO positive
    // evidence (we never invent positives), AND — because its discriminating
    // findings are now confirmed absent — the diagnosis is NARROWED: a
    // must-not-miss whose discriminators we actually flipped is demoted out of
    // the must-not-miss band to "possible" (it is no longer an UNRESOLVED
    // must-not-miss, so downstream decideCollapse can plan). This is the
    // deterministic "ask a discriminating question → narrow the dx" step
    // (DESIGN.md collapse loop); the LLM does NOT re-rank. We only demote when a
    // finding was actually confirmed absent (toMove non-empty) — an all-unknown
    // answer flips nothing, leaves the band intact, and stays unresolved →
    // abstain (the caller's "couldn't flip → not-ruled-out" path).
    positive = dedupe(target.positive_evidence.filter((f) => !toMove.has(f)));
    negative = dedupe([
      ...target.negative_evidence,
      ...target.positive_evidence.filter((f) => toMove.has(f)),
    ]);
    // SAFETY (do NOT simplify away the `toMove.size > 0` guard): only demote
    // when a discriminator was ACTUALLY confirmed absent. Removing the guard —
    // demoting unconditionally — would let an all-unknown answer (toMove empty)
    // demote the band to "possible" with no evidence; the must-not-miss would
    // then look resolved and decideCollapse could reach "plan", DOSING without
    // ruling out the danger (the exact false-negative this beat exists to
    // prevent). lib/collapse.test.ts pins both sides of this guard.
    if (target.likelihood === "must-not-miss" && toMove.size > 0) {
      likelihood = "possible";
    }
  }

  // Build a NEW condition object and a NEW conditions array (immutability).
  const updated: DifferentialCondition = {
    name: target.name,
    likelihood,
    positive_evidence: positive,
    negative_evidence: negative,
  };
  const conditions = d.conditions.map((c, i) => (i === idx ? updated : c));

  return { conditions, candidate_guidelines: d.candidate_guidelines };
}

/** Order-preserving string dedupe. */
function dedupe(xs: string[]): string[] {
  return [...new Set(xs)];
}
