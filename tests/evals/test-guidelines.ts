// tests/evals/test-guidelines.ts
//
// EVAL-ONLY guideline for CASE 6 (incomplete-but-faithful). We do NOT touch the
// production registry (that is another lane's file and both real guidelines
// happen to cover every required slot, so a real model run would never honestly
// drop one). Instead, this eval-only guideline is the croup text VERBATIM but
// declares ONE extra required_fields slot the Starship text genuinely does not
// cover (`discharge_medication_reconciliation`).
//
// Why this is an HONEST gate, not a faked one:
//   - The turn-2 plan-synthesis prompt instructs the model: fill every slot FROM
//     the guideline; if the guideline does NOT cover a slot, set present:false +
//     value:null (do NOT write "not specified"). Croup is a VIRAL illness — the
//     Starship text has ZERO antibiotic content and antibiotics are not indicated,
//     so a FAITHFUL model citing only the text MUST honestly null this slot. (An
//     earlier choice, discharge_medication_reconciliation, was too close to the
//     disposition section — the model sometimes rationalised content into it,
//     making the gate non-deterministic. antibiotic_selection has no textual
//     basis at all, so the honest null — and the gate firing — is reproducible.)
//   - calculate_dose still runs on the real dose rule (2.13 mg), the citations
//     are real, the recommendations are real — only the uncoverable slot is null.
//   - The deterministic completeness gate then FIRES on that structured null
//     slot (not a substring search) → status "incomplete", slot named.
// This demonstrates the completeness gate firing on REAL model output, which is
// exactly the "faithful but incomplete" money-shot (DESIGN.md case 6).

import { getGuideline, type Guideline } from "@/registry/guidelines";

/**
 * The slot the croup guideline text cannot support: croup is viral, the Starship
 * text has no antibiotic content, so a faithful model honestly nulls this →
 * the completeness gate fires reproducibly.
 */
export const UNCOVERABLE_SLOT = "antibiotic_selection";

/** Guideline id used only by the case-6 eval pipeline. */
export const EVAL_INCOMPLETE_GUIDELINE_ID = "eval-croup-uncoverable-slot";

/**
 * The eval-only croup guideline: identical clinical text + dose rules to the
 * production Starship croup guideline, with one extra required_fields slot the
 * text cannot satisfy. Built from the real registry entry so the dose math,
 * citations and severity table are all the genuine ones.
 */
export function buildEvalIncompleteGuideline(): Guideline {
  const croup = getGuideline("starship-croup-2020");
  if (croup === null) {
    throw new Error(
      "test-guidelines: production croup guideline not found — registry drift?",
    );
  }
  return {
    ...croup,
    guideline_id: EVAL_INCOMPLETE_GUIDELINE_ID,
    required_fields: {
      // The real croup slots PLUS one the guideline text cannot cover.
      fields: [...croup.required_fields.fields, UNCOVERABLE_SLOT],
    },
  };
}
