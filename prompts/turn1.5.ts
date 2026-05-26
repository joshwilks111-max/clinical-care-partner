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
import { sanitizeDiscriminator, DISCRIMINATORS_OPEN, DISCRIMINATORS_CLOSE } from "@/prompts/turn1.5-sanitize";
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
export function differentialConditionNames(differential: Differential): string[] {
  return differential.conditions.map((c) => c.name);
}

/** Normalized keys for pair-check lookups. */
export function differentialConditionKeys(differential: Differential): string[] {
  return differential.conditions.map((c) => normConditionKey(c.name));
}

/** Must-not-miss condition names in the differential. */
export function mustNotMissTargets(differential: Differential): string[] {
  return differential.conditions
    .filter((c) => c.likelihood === "must-not-miss")
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
  const mnmEnum =
    mnmNames.length > 0
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
    const targetInDiff = differential.conditions.find(
      (c) => normConditionKey(c.name) === targetKey,
    );
    if (targetInDiff?.likelihood !== "must-not-miss") {
      return "invented_condition";
    }
  }

  return null;
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
    "  - target_condition (when needs_question is true) MUST be a must-not-miss",
    "    condition from the differential — the one whose answer rules out the most danger.",
    "  - question must be ONE plain-text clinical question, no markdown, ending with ?.",
    "  - rationale_summary: max 200 chars, no chain-of-thought, audit-facing only.",
    "  - If every must-not-miss is already ruled out by absent negative evidence, set",
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
