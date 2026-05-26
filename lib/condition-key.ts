// lib/condition-key.ts
//
// Single canonical normalisation for condition names across collapse, registry,
// and Turn 1.5 prompts. Mirror of the former private norm() in lib/collapse.ts
// and normCondition in registry/guidelines.ts — one source, no registry↔collapse cycle.

/** Lowercase + trim + strip trailing parenthetical + collapse internal whitespace. */
export function normConditionKey(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim()
    .replace(/\s+/g, " ");
}
