// lib/router.ts
//
// DETERMINISTIC routing — pure data lookup, NO diagnosis.
// The clinician confirms the condition (turn-1 button); this table DISPATCHES
// that confirmed diagnosis to its one guideline (turn 2). The table does not
// decide WHAT the patient has — it maps a confirmed condition to a guideline_id.
// Unknown condition → null → the caller abstains (never a guess).

import { ROUTING_TABLE, getGuideline } from "@/registry/guidelines";

/** Normalise a condition string for case-insensitive matching. */
function norm(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * Map (condition, profession, setting) → guideline_id, or null if no row matches.
 *
 * Per the registry's ROUTING_TABLE, profession is "(any)" in v1 (not used to
 * discriminate) and setting is "hospital ED". Matching is on the CONDITION;
 * the other two are carried for the audit log and future discrimination.
 */
export function route(
  condition: string,
  _profession: string,
  _setting: string,
): string | null {
  const want = norm(condition);
  if (want.length === 0) return null;
  const row = ROUTING_TABLE.find((r) => norm(r.condition) === want);
  return row ? row.guideline_id : null;
}

/**
 * Wrong-guideline AUDIT hook (DESIGN.md: routed id must match the confirmed
 * condition; mismatch → caller abstains). Returns whether the routed
 * guideline_id is the guideline whose registered condition equals the
 * confirmed condition. Unknown guideline_id or unknown condition → false
 * (we cannot confirm a match, so we fail closed).
 *
 * Task 9 asserts this; the auto-abstain BEHAVIOUR on mismatch is the deferred
 * guard — this function is the audit primitive it would consume.
 */
export function auditRoutedGuideline(
  confirmedCondition: string,
  routedGuidelineId: string,
): boolean {
  const guideline = getGuideline(routedGuidelineId);
  if (guideline === null) return false;
  return norm(guideline.condition) === norm(confirmedCondition);
}
