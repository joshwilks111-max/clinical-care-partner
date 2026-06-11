// evals/mock-skips.ts
//
// Shared by run-api.ts and regrade.ts: when a case defines mock_tool_returns,
// the REAL route returns real tool values, so assertions pinned to specific
// mock values (exact tool_call_ids, mock field values) cannot pass and are
// force-skipped. emits_dose_card / emits_reassessment_card are retained —
// the real tools still return success envelopes for valid inputs.
//
// Detail-key prefixes use the grader's ACTUAL key spelling:
//   dose_card_field:<name>            (singular — one entry per field)
//   dose_card_omits:<name>
//   reassessment_card_field:<name>    (singular)

import type { GradeResult } from "./types";

const MOCK_DEPENDENT_PREFIXES = [
  "dose_card_field:",
  "dose_card_omits:",
  "reassessment_card_field:",
];

const MOCK_DEPENDENT_SOFTFAIL_MARKERS = [
  "dose_card_field",
  "dose_card_omits",
  "reassessment_card_field",
];

/**
 * Force mock-dependent details to "skip", drop their softFails, and
 * recompute ok. Apply only to transcripts produced against the REAL route
 * (harness "api") for cases that define mock_tool_returns.
 */
export function applyMockSkips(result: GradeResult): GradeResult {
  const details = { ...result.details };
  let changed = false;

  for (const key of Object.keys(details)) {
    const isMockKey = MOCK_DEPENDENT_PREFIXES.some((p) => key.startsWith(p));
    if (isMockKey && details[key] !== "skip") {
      details[key] = "skip";
      changed = true;
    }
  }

  if (!changed) return result;

  const filteredSoftFails = result.softFails.filter(
    (sf) => !MOCK_DEPENDENT_SOFTFAIL_MARKERS.some((m) => sf.includes(m)),
  );

  return {
    ...result,
    softFails: filteredSoftFails,
    ok: result.hardFails.length === 0 && filteredSoftFails.length === 0,
    details,
  };
}
