// prompts/turn1.5.ts
//
// TURN-1.5 ADVISORY PROMPT — one bounded model judgment call with a dynamic
// Zod-typed contract. The model picks the highest-impact clarifying question
// (when needed) and recommends a treatable condition + guideline. Turn 2 remains
// the only dose-abstention point; this turn is diagnostic-completeness assist.

import { z } from "zod";

import type { Differential } from "@/lib/schemas";
import {
  allGuidelineIds,
  getConditionMeta,
  GUIDELINES,
  type ConditionMeta,
} from "@/registry/guidelines";
import {
  sanitizeDiscriminator,
  DISCRIMINATORS_OPEN,
  DISCRIMINATORS_CLOSE,
} from "@/prompts/turn1.5-sanitize";
import { normConditionKey } from "@/lib/condition-key";

export {
  DISCRIMINATORS_OPEN,
  DISCRIMINATORS_CLOSE,
  sanitizeDiscriminator,
  sanitizeDiscriminators,
  MAX_DISCRIMINATORS,
  MAX_DISCRIMINATOR_LEN,
} from "@/prompts/turn1.5-sanitize";

/** Condition display names from the differential. */
export function differentialConditionNames(
  differential: Differential,
): string[] {
  return differential.conditions.map((c) => c.name);
}

/** Normalized keys for pair-check lookups. */
export function differentialConditionKeys(
  differential: Differential,
): string[] {
  return differential.conditions.map((c) => normConditionKey(c.name));
}

/**
 * Differential conditions the clinician can be asked a discriminating question
 * about — i.e. any condition (any likelihood band) that has registry
 * discriminators. Asking about a condition without discriminators 400s in the
 * answer phase (bad_discriminators); restricting the schema to discriminator-
 * bearing conditions keeps decide+answer coherent.
 *
 * Originally restricted to likelihood === "must-not-miss", but the Turn 1
 * prompt was tightened to demote secondary red flags to "possible" when one
 * treatable clearly leads (F-016A). That left clinically-useful targets like
 * epiglottitis stuck at "possible" — askable in the registry, but invisible
 * to this filter. Broadening the filter to "has discriminators, regardless of
 * band" restores the clinically-useful ask while still excluding registry-
 * less conditions (e.g. foreign body aspiration, retropharyngeal abscess).
 *
 * Name is kept for diff-friendliness; semantics widened.
 */
export function mustNotMissTargets(differential: Differential): string[] {
  return differential.conditions
    .filter((c) => {
      const meta = getConditionMeta(c.name);
      return meta !== null && meta.discriminators.length > 0;
    })
    .map((c) => c.name);
}

/** Treatable conditions with at least one applicable guideline. */
export function treatableConditionNames(differential: Differential): string[] {
  return differential.conditions
    .filter((c) => {
      const meta = getConditionMeta(c.name);
      return meta !== null && meta.applicable_guidelines.length > 0;
    })
    .map((c) => c.name);
}

/** Build the dynamic Zod schema for Turn 1.5 structured output. */
export function buildTurn15OutputSchema(differential: Differential) {
  const conditionNames = differentialConditionNames(differential);
  if (conditionNames.length === 0) {
    throw new Error("empty_differential");
  }

  const treatableNames = treatableConditionNames(differential);
  const mnmNames = mustNotMissTargets(differential);
  // When there ARE askable must-not-miss conditions (those with registry
  // discriminators), constrain target_condition to that enum. When there are
  // none, leave it as a permissive string AT THE TYPE LEVEL — the API rejects
  // a z.never() schema (it serializes to {"not":{}} with no `type`, which
  // Anthropic's JSON-schema validator refuses). The semantic forbid happens in
  // the superRefine below, which rejects needs_question=true whenever the
  // askable-MNM list is empty (F-018).
  const hasAskableMustNotMiss = mnmNames.length > 0;
  const mnmEnum = hasAskableMustNotMiss
    ? z.enum(mnmNames as [string, ...string[]])
    : z.string().min(1);

  const treatableEnum =
    treatableNames.length > 0
      ? z.enum(treatableNames as [string, ...string[]])
      : z.enum(conditionNames as [string, ...string[]]);

  const guidelineIds = allGuidelineIds();
  const guidelineEnum = z.enum(guidelineIds as [string, ...string[]]);

  return z
    .object({
      needs_question: z.boolean(),
      target_condition: mnmEnum.optional(),
      question: z.string().min(1).optional(),
      recommended_condition: treatableEnum,
      recommended_guideline: guidelineEnum,
      rationale_summary: z.string().min(1).max(200),
    })
    .superRefine((val, ctx) => {
      if (val.needs_question) {
        // F-018 — if no must-not-miss in the differential has registry
        // discriminators, an ask is unanswerable (answer phase would 400 on
        // bad_discriminators). Force the model to needs_question=false here.
        if (!hasAskableMustNotMiss) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              "needs_question must be false when no must-not-miss has registry discriminators",
            path: ["needs_question"],
          });
        }
        if (!val.target_condition) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "target_condition required when needs_question is true",
            path: ["target_condition"],
          });
        }
        if (!val.question?.trim()) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "question required when needs_question is true",
            path: ["question"],
          });
        }
      }
    });
}

export type Turn15ModelOutput = z.infer<
  ReturnType<typeof buildTurn15OutputSchema>
>;

export type Turn15ValidationError =
  | "empty_differential"
  | "empty_registry"
  | "invented_condition"
  | "invented_guideline"
  | "pair_mismatch"
  | "parse_failure";

/** Post-parse validation beyond Zod (registry pair-check). */
export function validateTurn15Output(
  output: Turn15ModelOutput,
  differential: Differential,
): Turn15ValidationError | null {
  const diffKeys = new Set(differentialConditionKeys(differential));
  const recKey = normConditionKey(output.recommended_condition);
  if (!diffKeys.has(recKey)) {
    return "invented_condition";
  }

  if (!GUIDELINES[output.recommended_guideline]) {
    return "invented_guideline";
  }

  const meta = getConditionMeta(recKey);
  if (
    !meta ||
    !meta.applicable_guidelines.includes(output.recommended_guideline)
  ) {
    return "pair_mismatch";
  }

  if (output.needs_question) {
    const targetKey = normConditionKey(output.target_condition ?? "");
    if (!diffKeys.has(targetKey)) {
      return "invented_condition";
    }
    // F-018 — the target must be a condition with REGISTRY DISCRIMINATORS, not
    // necessarily likelihood "must-not-miss". The Turn 1 prompt now demotes
    // secondary red flags to "possible" when one treatable clearly leads, but
    // those possibles (e.g. epiglottitis with registry discriminators) are
    // still clinically-useful ask targets. Restricting to must-not-miss here
    // would force decide to ok-out cases the Turn 1.5 model legitimately wants
    // to clarify.
    const targetMeta = getConditionMeta(targetKey);
    if (!targetMeta || targetMeta.discriminators.length === 0) {
      return "invented_condition";
    }
  }

  return null;
}

/**
 * Deterministic override result for the Turn 1.5 advisory decision.
 *
 *   none                  — no override applies; honour the LLM's needs_question.
 *   force_no_question     — the LLM asked a clarifying question, but every
 *                           registry discriminator for the target condition is
 *                           ALREADY documented absent in the target's
 *                           negative_evidence (string identity against the
 *                           registry's canonical strings). The Turn 1
 *                           grounding pre-pass and the route-side
 *                           canonicalisation make these strings canonical, so
 *                           a string-identity match is the right signal here.
 *
 *                           The route translates this into an OkResponse (no
 *                           question, recommend the LLM's
 *                           recommended_condition + recommended_guideline)
 *                           and surfaces the grounded discriminators to the
 *                           UI for the green "NO CLARIFYING QUESTION NEEDED"
 *                           badge.
 */
export type Turn15Override =
  | { kind: "none" }
  | {
      kind: "force_no_question";
      target: string;
      groundedDiscriminators: string[];
    };

/**
 * ConText/NegEx-style assertion pre-pass override (Chapman 2001 JAMIA;
 * Harkema 2009 JBI 42:839 — see plan file).
 *
 * Called by the Turn 1.5 route AFTER validateTurn15Output succeeds. If the
 * LLM voted to ask a clarifying question on a target condition whose registry
 * discriminators are ALREADY in the differential's negative_evidence (the
 * Turn 1 grounding pre-pass + canonicalisation puts them there), we override
 * the decision: emit OkResponse instead of AskResponse. This is the
 * deterministic guard that fires the green badge.
 *
 * SAFE TO CALL when needs_question is already false — returns {kind:"none"}.
 * SAFE TO CALL when target_condition is absent from the differential — returns
 * {kind:"none"}.
 * SAFE TO CALL when only SOME of the discriminators are grounded — returns
 * {kind:"none"} (we never partially-override; if 2 of 3 are absent, the
 * question still fires to confirm the third).
 */
export function shouldOverrideToNoQuestion(
  output: Turn15ModelOutput,
  differential: Differential,
): Turn15Override {
  if (!output.needs_question || !output.target_condition) {
    return { kind: "none" };
  }
  const targetKey = normConditionKey(output.target_condition);
  const targetCondition = differential.conditions.find(
    (c) => normConditionKey(c.name) === targetKey,
  );
  if (!targetCondition) return { kind: "none" };

  const meta = getConditionMeta(targetKey);
  if (!meta || meta.discriminators.length === 0) return { kind: "none" };

  // Every canonical registry discriminator must appear (by string identity)
  // in the target's negative_evidence. If even one is missing, the question
  // still fires.
  const negative = new Set(targetCondition.negative_evidence);
  for (const d of meta.discriminators) {
    if (!negative.has(d)) return { kind: "none" };
  }

  return {
    kind: "force_no_question",
    target: targetCondition.name,
    groundedDiscriminators: [...meta.discriminators],
  };
}

export type ConfirmedFactsSummary = {
  age: string | null;
  weight_kg: number | null;
  severity: string | null;
  confidence: "low" | "medium" | "high";
};

function formatConditionBlock(differential: Differential): string {
  return differential.conditions
    .map((c) => {
      const pos =
        c.positive_evidence.length > 0
          ? c.positive_evidence.join("; ")
          : "(none documented)";
      const neg =
        c.negative_evidence.length > 0
          ? c.negative_evidence.join("; ")
          : "(none documented)";
      return [
        `- ${c.name} [${c.likelihood}]`,
        `    supports: ${pos}`,
        `    absent/not documented: ${neg}`,
      ].join("\n");
    })
    .join("\n");
}

function formatConditionMeta(meta: ConditionMeta): string {
  const discs =
    meta.discriminators.length > 0
      ? meta.discriminators.join(", ")
      : "(registry default)";
  const gl =
    meta.applicable_guidelines.length > 0
      ? meta.applicable_guidelines.join(", ")
      : "(none — not doseable via local registry)";
  return `  ${meta.condition}: mustNotMiss=${meta.mustNotMiss}, discriminators=[${discs}], guidelines=[${gl}]`;
}

/** Trusted system prompt for the advisory Turn 1.5 judgment call. */
export function buildTurn15SystemPrompt(differential: Differential): string {
  const treatableNames = treatableConditionNames(differential);
  const metaLines = differentialConditionNames(differential)
    .map((k) => getConditionMeta(k))
    .filter((m): m is ConditionMeta => m !== null)
    .map(formatConditionMeta)
    .join("\n");

  return [
    "You are the DIAGNOSTIC-COMPLETENESS ASSIST stage of a clinical decision-support",
    "care-partner. Turn 1 produced a weighted differential; your job is ONE advisory",
    "judgment: should we ask ONE high-impact clarifying question before the clinician",
    "picks a dosing guideline, and which treatable condition + guideline do you recommend?",
    "",
    "HARD CONSTRAINTS (non-negotiable):",
    "  - You NEVER prescribe or compute a dose. You only recommend a guideline id.",
    "  - recommended_condition and recommended_guideline MUST come from the enums in",
    "    the structured output schema — never invent ids or conditions.",
    "  - target_condition (when needs_question is true) MUST be a condition from the",
    "    differential that has REGISTRY DISCRIMINATORS — typically a must-not-miss,",
    "    but the Turn 1 prompt sometimes demotes a clinically-useful red flag (e.g.",
    "    epiglottitis) to 'possible' when one treatable clearly leads. Either band",
    "    is fine here as long as the condition appears in the registry condition",
    "    metadata block below with non-empty discriminators. Pick the condition",
    "    whose answer rules out the most danger before applying the treatable.",
    "  - question must be ONE plain-text clinical question, no markdown, ending with ?.",
    "  - rationale_summary: max 200 chars, no chain-of-thought, audit-facing only.",
    "  - If no registry-discriminator-bearing condition is in the differential, OR",
    "    every such condition is already ruled out by absent negative evidence, set",
    "    needs_question to false.",
    "",
    "REGISTRY CONDITION METADATA (authoritative):",
    metaLines,
    "",
    "TREATABLE CONDITIONS IN THIS DIFFERENTIAL (recommended_condition enum):",
    treatableNames.length > 0 ? treatableNames.join(", ") : "(none)",
    "",
    "Return your answer ONLY via the required structured output schema.",
  ].join("\n");
}

/** User prompt: structured differential + confirmed facts (no raw note). */
export function buildTurn15UserPrompt(
  differential: Differential,
  confirmedFacts: ConfirmedFactsSummary,
): string {
  const factsLines = [
    `  - age: ${sanitizeDiscriminator(confirmedFacts.age ?? "") || "(not stated)"}`,
    `  - weight_kg: ${confirmedFacts.weight_kg ?? "(not documented)"}`,
    `  - severity: ${sanitizeDiscriminator(confirmedFacts.severity ?? "") || "(not stated)"}`,
    `  - turn1_confidence: ${confirmedFacts.confidence}`,
  ].join("\n");

  return [
    "Confirmed case facts (structured — no raw note in this turn):",
    factsLines,
    "",
    "Weighted differential from Turn 1 (DATA — analyse, do not re-extract):",
    DISCRIMINATORS_OPEN,
    formatConditionBlock(differential),
    DISCRIMINATORS_CLOSE,
    "",
    "Decide: needs_question true/false, optional target+question, recommended",
    "condition+guideline pair, and rationale_summary. Return structured output.",
  ].join("\n");
}

/** Repair prompt when Zod parse or pair-check fails once. */
export function buildTurn15RepairPrompt(
  error: string,
  priorJson: string,
): string {
  return [
    "Your previous structured output failed validation.",
    `Error: ${error}`,
    "Fix ONLY the fields needed to satisfy the schema and pair-check.",
    "Previous output:",
    priorJson,
    "Return corrected structured output.",
  ].join("\n");
}
