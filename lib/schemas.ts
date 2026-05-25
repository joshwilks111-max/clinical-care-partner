// lib/schemas.ts
//
// Zod schemas for turn-1's STRUCTURED output (the JUDGMENT half of the flow).
// These define the contract the model must fill via the Vercel AI SDK's
// `experimental_output: Output.object({ schema })` — so the model's facts +
// differential arrive validated, not as free prose. They mirror DESIGN.md
// "Typed schemas" exactly (do NOT add/remove fields without updating the design).
//
// The differentiator lives here: `negative_evidence` — the findings that are
// ABSENT and argue AGAINST a condition ("[NOT MENTIONED]" reasoning). Retrieval
// systems weigh what's present; the care-partner layer also reasons about what's
// missing. The schema makes that reasoning a required, structured field.

import { z } from "zod";

// ---------------------------------------------------------------------------
// ExtractedFacts — what the model reads off the (untrusted) clinical note.
// Nullable fields are null when not stated; profession/setting carry sensible
// defaults at the application layer (DESIGN.md), the model returns what it saw.
// weight_kg === null is the signal the refusal gate keys on downstream — but
// note the route runs a deterministic PRE-LLM weight check; this field is the
// model's read of weight once a weight is known to be present.
// ---------------------------------------------------------------------------

export const ExtractedFacts = z.object({
  /** Surface conditions the model spotted, to seed the differential. */
  condition_hints: z.array(z.string()),
  /** e.g. "moderate"; null when severity is not stated in the note. */
  severity: z.string().nullable(),
  /** Weight in kg; null when not documented (the refusal-gate signal). */
  weight_kg: z.number().nullable(),
  /** Free-text age (e.g. "3yo"); null when not stated. */
  age: z.string().nullable(),
  /** Clinician role; null when unstated (app defaults to "ED clinician"). */
  profession: z.string().nullable(),
  /** Care setting; null when unstated (app defaults to "hospital ED"). */
  setting: z.string().nullable(),
});

// ---------------------------------------------------------------------------
// Differential — the weighted, evidence-backed ranking. likelihood is a
// qualitative band, NOT a fake percentage. Each condition carries BOTH the
// present findings that support it AND the absent findings that argue against
// it. candidate_guidelines is what the model PROPOSES from the registry; the
// clinician SELECTS in the UI (the table routes; the model never doses here).
// ---------------------------------------------------------------------------

export const DifferentialCondition = z.object({
  name: z.string(),
  /** Qualitative band — must-not-miss surfaces first in the UI. */
  likelihood: z.enum(["likely", "possible", "must-not-miss"]),
  /** Findings PRESENT in the note that support this condition. */
  positive_evidence: z.array(z.string()),
  /** Findings ABSENT / not documented that argue against it ("[NOT MENTIONED]"). */
  negative_evidence: z.array(z.string()),
});

export const CandidateGuideline = z.object({
  /** Must be a guideline_id the registry actually has (croup / anaphylaxis). */
  guideline_id: z.string(),
  /** Human-readable label for the clinician's selection button. */
  label: z.string(),
});

export const Differential = z.object({
  conditions: z.array(DifferentialCondition),
  candidate_guidelines: z.array(CandidateGuideline),
});

// ---------------------------------------------------------------------------
// The combined turn-1 output. We ask the model for facts + differential in ONE
// structured object so a single call produces the whole turn-1 result (and a
// single Zod parse validates it — a parse failure is the red technical-error
// path, distinct from the amber clinical refusal).
// ---------------------------------------------------------------------------

export const Turn1Output = z.object({
  extracted_facts: ExtractedFacts,
  differential: Differential,
});

// ---------------------------------------------------------------------------
// Inferred TS types — the single source of truth for downstream consumers.
// ---------------------------------------------------------------------------

export type ExtractedFacts = z.infer<typeof ExtractedFacts>;
export type DifferentialCondition = z.infer<typeof DifferentialCondition>;
export type CandidateGuideline = z.infer<typeof CandidateGuideline>;
export type Differential = z.infer<typeof Differential>;
export type Turn1Output = z.infer<typeof Turn1Output>;
