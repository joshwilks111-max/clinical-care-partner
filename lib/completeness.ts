// lib/completeness.ts
//
// THE OMISSION GUARD — a TRUE deterministic gate, NO LLM judge.
//
// Closes the documented "faithful-but-incomplete" failure (DESIGN.md "safety
// spine": a clinical RAG system can be 99.5% faithful and still unsafe via
// OMISSION). This is a STRUCTURED-SLOT check, not a substring search over prose:
// given a slot record (slot → {present, value}) and a guideline's RequiredFields,
// EVERY required slot must be present AND value != null AND value non-empty.
// "Escalation: not specified" / "" / whitespace must FAIL.
//
// ── RequiredFields TYPE DECISION (the deferred call from the registry) ────────
// The registry types RequiredFields as { fields: string[] }. I deliberately do
// NOT tighten the slot names into a closed union, and I leave the registry
// UNTOUCHED. Rationale:
//   * The gate's safety property — "present AND non-null AND non-empty" — is a
//     RUNTIME property over whatever slots a guideline declares; it is enforced
//     here regardless of whether the names are typed. A union buys no runtime
//     safety for this gate.
//   * The two guidelines declare DIFFERENT slot sets (croup: severity/disposition;
//     anaphylaxis: positioning/monitoring). A closed union would be the union of
//     both, so a typed slot name would not guarantee a given guideline actually
//     requires it — the type would over-promise.
//   * YAGNI for 2 guidelines: string[] is the lighter choice and keeps the
//     registry's 18 tests untouched. If the registry grows many guidelines and a
//     shared PlanOutput shape needs typo-proof slot keys, revisit then.
// Decision: consume string[]; registry NOT modified.

import { type RequiredFields } from "@/registry/guidelines";

/** A single output slot: was it produced, and what value did it carry? */
export type Slot = { present: boolean; value: string | null };

/** The structured plan slots, keyed by required-field name. */
export type SlotRecord = Record<string, Slot>;

export type CompletenessResult = {
  /** True iff every required slot is present AND non-null AND non-empty. */
  complete: boolean;
  /** The required slots that FAILED (missing, null, or empty/placeholder). */
  missing: string[];
};

/** Placeholder values that masquerade as content but mean "absent". */
const PLACEHOLDERS = new Set([
  "not specified",
  "n/a",
  "none",
  "tbd",
  "unknown",
]);

/** A value counts as non-empty only if it carries real, non-placeholder text. */
function isNonEmptyValue(value: string | null): boolean {
  if (value === null) return false;
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  // Treat a bare placeholder (optionally after a "Label: " prefix) as empty.
  const afterColon = trimmed.includes(":")
    ? trimmed.slice(trimmed.indexOf(":") + 1).trim()
    : trimmed;
  if (PLACEHOLDERS.has(trimmed.toLowerCase())) return false;
  if (PLACEHOLDERS.has(afterColon.toLowerCase())) return false;
  return true;
}

/**
 * Assert every required slot is present AND non-null AND non-empty.
 * Deterministic — same input, same verdict, every time. NO model call.
 */
export function checkCompleteness(
  slots: SlotRecord,
  required: RequiredFields,
): CompletenessResult {
  const missing: string[] = [];
  for (const field of required.fields) {
    const slot = slots[field];
    if (!slot || slot.present !== true || !isNonEmptyValue(slot.value)) {
      missing.push(field);
    }
  }
  return { complete: missing.length === 0, missing };
}
