// lib/plan-schema.ts
//
// TURN-2 OUTPUT CONTRACT + the UNIFIED ABSTENTION ADAPTER.
//
// Two jobs, both about making the safety architecture STRUCTURAL (not asserted):
//
// 1. PlanOutput (Zod) — the constrained plan the synthesis call must fill via
//    `experimental_output: Output.object({ schema: PlanOutput })`. Citation is
//    SCHEMA-ENFORCED: every recommendation must carry source_section + quote (a
//    recommendation without them fails the Zod parse → the RED technical-error
//    path). "Every recommendation cites its source" stops being a hope and
//    becomes a parse-time guarantee (DESIGN.md Decision #14). The model does NOT
//    emit any dose number into this schema — the deterministic tool owns numbers;
//    the plan PROSE references the tool's already-computed dose.
//
// 2. The UNIFIED ABSTENTION (the layering note). There are TWO refusal shapes in
//    the codebase, by design:
//      * DoseRefusal     (tools/calculate_dose) — reasons: weight_missing |
//        implausible_weight | invalid_dose_rule_id | rule_not_verified. Fires
//        INSIDE execution, when the deterministic tool cannot safely compute.
//      * RefusalDecision (lib/refusal-gate)      — reasons: weight_missing |
//        no_matching_guideline | wrong_guideline. Fires BEFORE the model / when
//        no guideline exists or the selected guideline mismatches the condition.
//    They live at DIFFERENT layers (pre-LLM context-gate vs in-tool math-gate),
//    so they SHOULD stay separate at their source. But the console UI
//    (app/console) must render ONE amber "deliberate abstention" state regardless
//    of which layer abstained. This module defines that single shape —
//    `Abstention` — plus the two small adapters that map each source refusal onto
//    it. The console consumes exactly ONE shape; it can't mis-handle a refusal it
//    didn't know about.

import { z } from "zod";
import type { DoseRefusal } from "@/tools/calculate_dose";
import type { RefusalDecision } from "@/lib/refusal-gate";
import type { Guideline } from "@/registry/guidelines";

// ---------------------------------------------------------------------------
// PlanOutput — the Zod-constrained synthesis result.
// ---------------------------------------------------------------------------

/**
 * One plan recommendation. Citation is REQUIRED at the type level: a
 * recommendation that omits source_section or quote fails the Zod parse, so a
 * uncited recommendation is structurally impossible (DESIGN.md "every
 * recommendation carries its citation — schema-enforced").
 */
export const PlanRecommendation = z.object({
  /** The clinical recommendation, in clinician-facing prose. */
  text: z.string().min(1),
  /** The guideline section this recommendation is grounded in. */
  source_section: z.string().min(1),
  /** The version-pinned guideline (e.g. "Starship NZ Clinical Guideline, 2020"). */
  source_version: z.string().min(1),
  /** Link to the cited guideline section. */
  source_url: z.string().min(1),
  /** A VERBATIM quote from the guideline supporting this recommendation. */
  quote: z.string().min(1),
});

/**
 * A single required-field slot the model fills FROM the guideline. The
 * completeness gate (lib/completeness) asserts each declared slot is present AND
 * non-null AND non-empty. `value: null` (or a placeholder) makes the gate FIRE —
 * the "faithful but incomplete" money-shot (DESIGN.md case 6).
 */
export const PlanRequiredField = z.object({
  present: z.boolean(),
  value: z.string().nullable(),
});

/**
 * The structured turn-2 plan (the WIRE / stored shape). recommendations each
 * carry their citation; required_fields is a record keyed by slot name. This is
 * the type the route returns and downstream consumers read.
 *
 * NOTE the synthesis MODEL CALL does NOT use this schema directly — see
 * buildPlanOutputSchema below. A bare z.record() has no required keys, so the
 * model can satisfy it with `{}` and skip every slot (observed live: it returned
 * required_fields:{} every time, and the completeness gate then fired on ALL
 * slots). The dynamic per-guideline schema FORCES the model to emit each slot;
 * its result is a strict subset that still validates against this wire shape.
 */
export const PlanOutput = z.object({
  recommendations: z.array(PlanRecommendation).min(1),
  required_fields: z.record(z.string(), PlanRequiredField),
});

export type PlanRecommendation = z.infer<typeof PlanRecommendation>;
export type PlanRequiredField = z.infer<typeof PlanRequiredField>;
export type PlanOutput = z.infer<typeof PlanOutput>;

/**
 * Build the MODEL-FACING synthesis schema for a specific guideline: identical to
 * PlanOutput except required_fields is a CLOSED z.object whose keys are EXACTLY
 * this guideline's RequiredFields slots — every one REQUIRED. This makes "fill
 * every slot" a schema guarantee (the model cannot return `{}`), turning the
 * completeness contract from a prompt hope into a structural one ("demonstrate,
 * don't assert"). The completeness gate still runs afterwards as the true gate —
 * it now catches an honest `value: null` (slot present in the schema but the
 * guideline genuinely doesn't cover it) rather than a wholesale empty object.
 *
 * The returned schema's output is assignable to PlanOutput (a fixed object is a
 * subset of a record), so the route can keep returning the wire PlanOutput type.
 */
export function buildPlanOutputSchema(guideline: Guideline) {
  const shape: Record<string, typeof PlanRequiredField> = {};
  for (const field of guideline.required_fields.fields) {
    shape[field] = PlanRequiredField;
  }
  return z.object({
    recommendations: z.array(PlanRecommendation).min(1),
    required_fields: z.object(shape),
  });
}

// ---------------------------------------------------------------------------
// The UNIFIED ABSTENTION — one amber shape for the UI, three source layers.
// ---------------------------------------------------------------------------

/**
 * Which layer abstained — kept for provenance/debugging and so the UI could (if
 * it wanted) badge the seam. It does NOT change the amber treatment.
 *   - "pre-llm"     : the pre-LLM weight gate (refusal-gate, weight_missing).
 *   - "no-guideline": no registry guideline / router null, OR a wrong-guideline
 *                     condition/guideline mismatch (refusal-gate).
 *   - "dose-tool"   : the deterministic dose tool refused mid-execution.
 */
export type AbstentionSource = "pre-llm" | "dose-tool" | "no-guideline";

/**
 * The UNION of every abstention reason across both source shapes. Keeping it a
 * single closed union means the UI can switch on `reason` exhaustively and the
 * compiler catches a new reason that isn't handled.
 */
export type AbstentionReason =
  // from RefusalDecision (lib/refusal-gate)
  | "weight_missing"
  | "no_matching_guideline"
  | "wrong_guideline"
  | "unresolved_dangers"
  // from DoseRefusal (tools/calculate_dose)
  | "implausible_weight"
  | "invalid_dose_rule_id"
  | "rule_not_verified";

/**
 * The ONE abstention shape the turn-2 route returns and the UI renders as amber
 * (DESIGN.md: one amber "safety accent" for all deliberate safety events). A
 * discriminated union member — `kind: "abstention"` — so the UI can branch it
 * apart from success / error / completeness-fired without ambiguity.
 */
export type Abstention = {
  kind: "abstention";
  /** The unified reason (one closed union over both source shapes). */
  reason: AbstentionReason;
  /** The headline sentence the amber state leads with. */
  headline: string;
  /** Optional supporting detail (kept short; the headline carries the message). */
  detail: string | null;
  /** Which layer abstained (provenance; does not change the amber treatment). */
  source: AbstentionSource;
};

/**
 * Adapt the dose tool's refusal onto the unified Abstention. The tool's
 * `message` is already a clinician-facing sentence (the headline); its `reason`
 * is a subset of AbstentionReason, so it maps straight through. source is
 * "dose-tool" — this refusal fired inside deterministic execution.
 */
export function fromDoseRefusal(r: DoseRefusal): Abstention {
  return {
    kind: "abstention",
    reason: r.reason,
    headline: r.message,
    detail: null,
    source: "dose-tool",
  };
}

/**
 * Adapt the pre-LLM / no-guideline / wrong-guideline refusal onto the unified
 * Abstention. The gate's `copy` is the headline. `source` is derived from the
 * reason: no_matching_guideline | wrong_guideline → "no-guideline";
 * weight_missing → "pre-llm". A refusal with `refuse: false` is a caller bug
 * (we only adapt a fired refusal), so we fail closed with a defensive
 * weight_missing abstention rather than emit a malformed "abstention" that
 * didn't actually abstain.
 */
export function fromRefusalDecision(d: RefusalDecision): Abstention {
  const reason = d.reason ?? "weight_missing";
  const source: AbstentionSource =
    reason === "no_matching_guideline" ||
    reason === "wrong_guideline" ||
    reason === "unresolved_dangers"
      ? "no-guideline"
      : "pre-llm";
  return {
    kind: "abstention",
    reason,
    headline:
      d.copy.length > 0
        ? d.copy
        : "Abstaining: a required safety condition was not met.",
    detail: null,
    source,
  };
}

// ---------------------------------------------------------------------------
// Shared HTTP response adapter — used by both turn1.5 and turn2 routes.
// ---------------------------------------------------------------------------

/**
 * The wire shape every route returns for a deliberate abstention. Defined once
 * here (alongside Abstention) so turn1.5/route.ts and turn2/route.ts don't each
 * redeclare an identical type and function.
 */
export type AbstentionResponse = { status: "abstention" } & Omit<
  Abstention,
  "kind"
>;

/**
 * Map a unified Abstention onto the HTTP response shape (drops `kind`).
 * Shared by turn1.5 and turn2 — the only place this mapping lives.
 */
export function toAbstentionResponse(a: Abstention): AbstentionResponse {
  return {
    status: "abstention",
    reason: a.reason,
    headline: a.headline,
    detail: a.detail,
    source: a.source,
  };
}
