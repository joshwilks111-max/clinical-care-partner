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
import { normConditionKey } from "@/lib/condition-key";

// ---------------------------------------------------------------------------
// Public decision shape.
// ---------------------------------------------------------------------------

export type CollapseAction = "ask" | "plan" | "abstain";

/**
 * Why the decider abstained (only set when action === "abstain"). The caller
 * (Turn 2's gate) maps this to a distinct refusal copy:
 *
 *   "unresolved_dangers"  — Rule 2 (positive must-not-miss) or Rule 3
 *                           (>1 unresolved must-not-miss) fired. A treatable
 *                           guideline may exist; we just won't dose past the
 *                           undischarged danger(s). Maps to
 *                           `unresolvedDangersAbstention()`.
 *   "no_treatable"        — Rule 1 (empty differential), Rule 3 (>1 treatable
 *                           tie), or Rule 6 (no treatable maps to a guideline).
 *                           Maps to `noGuidelineAbstention()`.
 */
export type CollapseAbstainReason = "unresolved_dangers" | "no_treatable";

export type CollapseDecision = {
  action: CollapseAction;
  /** The must-not-miss condition NAME to ask about (only when action === "ask"). */
  target?: string;
  /** That must-not-miss's negative_evidence findings to ask about (when "ask"). */
  discriminators?: string[];
  /** The candidate guideline to dose against (only when action === "plan"). */
  guidelineId?: string;
  /** Why we abstained (only set when action === "abstain") — drives copy choice. */
  reason?: CollapseAbstainReason;
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
 * Set of NORMALIZED condition keys the clinician can be asked a discriminating
 * question about — i.e. conditions with non-empty registry discriminators.
 *
 * THE SEMANTICS (F-018): an unresolved must-not-miss whose key is NOT in this
 * set is unanswerable — no discriminator exists to flip — so it cannot be
 * used to gate dosing. It still appears in the differential UI for clinician
 * awareness, but Rule 3a/4/6 ignore it as a blocker. This is a softening of
 * the original "any unresolved must-not-miss blocks" posture, traded off
 * deliberately so that the live LLM's broader-than-fixture differentials can
 * still produce doses on canonical cases (see TODOS.md). Pass an EMPTY set
 * to preserve the legacy posture.
 *
 * The caller (Turn 2 route) builds this from CONDITION_META; the decider
 * stays pure (no registry import).
 */
export type AskableConditionSet = ReadonlySet<string>;

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
  return normConditionKey(s);
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
// demoteSharedFindings — preprocess BEFORE decideCollapse to fix the over-abstain.
//
// THE PROBLEM (observed live, fixture-hidden): the LLM correctly lists a single
// shared physical finding (e.g. "stridor at rest") under EVERY must-not-miss
// condition the finding is consistent with. The downstream Rule 2 ("any positive
// must-not-miss → abstain") then reads three innocuous shared mentions as three
// CONFIRMED dangerous conditions, and abstains — even when the only positive
// evidence on each is the same generic finding.
//
// THE FIX: a positive must-not-miss finding that is ALSO positive on the leading
// treatable condition is SHARED — it does not discriminate; it cannot confirm.
// We remove it from the must-not-miss positive arms (it stays on the treatable —
// the treatable's case is still made). Discriminating findings (e.g. "drooling"
// only under epiglottitis) are PRESERVED — Rule 2 still triggers on those.
//
// SAFETY (load-bearing): we ONLY demote when the finding appears on a TREATABLE
// (likelihood "likely" or "possible") condition AND is in the registry map. A
// finding that is shared across must-not-miss conditions but NOT on any treatable
// is left alone — there's no benign explanation to anchor it to. Rule 2 keeps
// firing in that case (correctly: multiple dangers with shared evidence and no
// treatable hypothesis is genuinely ambiguous → fail toward stopping).
//
// PURE + IMMUTABLE: returns a NEW Differential; never mutates the input.
// ---------------------------------------------------------------------------

/**
 * Normalize a finding-string for cross-condition matching: lowercase, collapse
 * whitespace, strip trailing parenthetical and surrounding punctuation. The
 * LLM phrases the same underlying clinical fact differently across conditions
 * (e.g. "stridor at rest" on the treatable Croup vs "stridor at rest in a
 * toddler" on the must-not-miss Foreign body aspiration). Exact set-membership
 * misses these; normalized substring containment catches them. The brittleness
 * was discovered live during F-018 QA (see TODOS.md "softened safety posture").
 */
function normFinding(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * True iff the must-not-miss finding shares its clinical content with at least
 * one benign-anchor finding from a treatable condition. Match is normalized
 * substring containment in either direction — "stridor at rest" inside
 * "stridor at rest in a toddler" matches, but "rash" inside "purpuric rash"
 * also matches (intentional: same finding, qualified). The benign-anchor
 * filter (only treatable conditions contribute) prevents must-not-miss-only
 * symptoms from accidentally demoting each other.
 */
function findingShared(mnmFinding: string, benignAnchors: string[]): boolean {
  const mnmKey = normFinding(mnmFinding);
  if (mnmKey.length === 0) return false;
  return benignAnchors.some((anchor) => {
    const anchorKey = normFinding(anchor);
    if (anchorKey.length === 0) return false;
    return mnmKey.includes(anchorKey) || anchorKey.includes(mnmKey);
  });
}

export function demoteSharedFindings(
  d: Differential,
  map: ConditionGuidelineMap,
): Differential {
  // Collect every finding that is positive on at least one TREATABLE-AND-ROUTED
  // condition. These are the benign-anchor findings — ones a treatable
  // hypothesis already explains. A must-not-miss positive that shares clinical
  // content with one of these isn't a confirmation; it's a non-discriminating
  // co-mention. NB: deduplicated by exact value (preserve qualifier text for
  // the audit trail) — substring matching happens in findingShared.
  const benignAnchors: string[] = [];
  const seenAnchors = new Set<string>();
  for (const c of d.conditions) {
    if (isTreatableTop(c, map)) {
      for (const f of c.positive_evidence) {
        if (!seenAnchors.has(f)) {
          seenAnchors.add(f);
          benignAnchors.push(f);
        }
      }
    }
  }

  // No treatable anchor → no benign explanation to demote against. Leave
  // untouched (Rule 2 handles "multiple dangers, no treatable" correctly).
  if (benignAnchors.length === 0) {
    return {
      conditions: [...d.conditions],
      candidate_guidelines: d.candidate_guidelines,
    };
  }

  const conditions = d.conditions.map((c) => {
    if (c.likelihood !== "must-not-miss") return c;
    const shared = c.positive_evidence.filter((f) =>
      findingShared(f, benignAnchors),
    );
    if (shared.length === 0) return c;
    // Move shared findings from positive_evidence INTO negative_evidence with a
    // "shared / non-discriminating" prefix so the audit trail records WHY they
    // moved — the UI / future review can read the differential and see the
    // demotion was intentional, not a data loss.
    // Re-use the same fuzzy-match predicate so positives and the audit log
    // stay in lockstep — no off-by-one where shared lists a finding but
    // newPositive still contains it (exact-match would do that).
    const newPositive = c.positive_evidence.filter(
      (f) => !findingShared(f, benignAnchors),
    );
    const newNegative = [
      ...c.negative_evidence,
      ...shared.map((f) => `[shared / non-discriminating]: ${f}`),
    ];
    return {
      name: c.name,
      likelihood: c.likelihood,
      positive_evidence: newPositive,
      negative_evidence: newNegative,
    };
  });

  return { conditions, candidate_guidelines: d.candidate_guidelines };
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
  /**
   * Optional. When ABSENT (the legacy semantic), every unresolved must-not-miss
   * is treated as askable — preserves pre-F-018 callers and the test fixtures
   * built before the registry-discriminator filter existed. When PROVIDED, only
   * unresolved must-not-miss conditions whose normalized name is in the set
   * count as blockers. Production callers (Turn 2 route) pass a real set built
   * from CONDITION_META so unanswerable must-not-miss conditions don't gate.
   */
  askable?: AskableConditionSet,
): CollapseDecision {
  // Rule 1: nothing to reason over → stop. No treatable could exist.
  if (d.conditions.length === 0) {
    return { action: "abstain", reason: "no_treatable" };
  }

  // Rule 2 (safety-critical, checked EARLY): a must-not-miss with ANY positive
  // evidence is confirmed-enough to be terminal. NEVER plan or ask past it.
  // A guideline may exist for the treatable — the abstain is about the danger,
  // not the registry — so reason = unresolved_dangers.
  if (d.conditions.some(isPositiveMustNotMiss)) {
    return { action: "abstain", reason: "unresolved_dangers" };
  }

  // F-018 softening: an unresolved must-not-miss whose discriminators are NOT
  // in the registry is UNANSWERABLE — there's no question we can ask to flip
  // it. Treating it as a blocker forces an abstain on cases that have one
  // strong treatable plus a clinically-warranted but unaskable red flag (e.g.
  // foreign body aspiration with no registered discriminators). The clinician
  // still sees it in the differential. The askable set carries the policy.
  // When askable is undefined (legacy callers / fixture tests pre-F-018),
  // every unresolved must-not-miss is treated as askable — preserves prior
  // behaviour. When provided, only set members count as blockers.
  const isAskableUnresolvedMustNotMiss = (
    c: DifferentialCondition,
  ): boolean => {
    if (!isUnresolvedMustNotMiss(c)) return false;
    if (askable === undefined) return true;
    return askable.has(norm(c.name));
  };

  const unresolvedMustNotMiss = d.conditions.filter(
    isAskableUnresolvedMustNotMiss,
  );
  let treatableTops = d.conditions.filter((c) => isTreatableTop(c, map));

  // Rule 3a: more than one unresolved must-not-miss → genuinely ambiguous on
  // the safety axis (we can only ask once). The treatable may still exist; the
  // abstain is about not dosing past undischarged dangers.
  if (unresolvedMustNotMiss.length > 1) {
    return { action: "abstain", reason: "unresolved_dangers" };
  }
  // Rule 3b: more than one treatable top mapping to a guideline → the registry
  // alone cannot disambiguate which to apply, UNLESS the likelihood bands
  // already rank them. The Turn 1 prompt now demotes secondary differentials
  // to "possible" when one treatable clearly leads (F-016A), so a single
  // "likely" alongside multiple "possible" treatables is the COMMON live shape
  // for a leading diagnosis with co-considered alternatives. Treat that as
  // unambiguous: the "likely" wins, the "possible" alternatives stay in the
  // differential UI for clinician awareness but don't block dosing.
  // Genuine ties (more than one "likely" treatable, or all-"possible" with
  // no clear leader) still abstain.
  if (treatableTops.length > 1) {
    const likelyTreatables = treatableTops.filter(
      (c) => c.likelihood === "likely",
    );
    if (likelyTreatables.length !== 1) {
      return { action: "abstain", reason: "no_treatable" };
    }
    // Exactly one "likely" treatable + ≥1 "possible" treatables — keep only
    // the leading one as the treatable for downstream Rule 4/5 evaluation.
    treatableTops = [likelyTreatables[0]];
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
  // ambiguity. Fail toward stopping. Reason is "unresolved_dangers" when an
  // unresolved must-not-miss is the blocker; "no_treatable" otherwise.
  const reason: CollapseAbstainReason =
    unresolvedMustNotMiss.length > 0 ? "unresolved_dangers" : "no_treatable";
  return { action: "abstain", reason };
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
