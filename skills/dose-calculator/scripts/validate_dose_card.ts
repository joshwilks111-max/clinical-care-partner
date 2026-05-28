#!/usr/bin/env bun
/**
 * validate_dose_card.ts — strict-schema check on the dose-card and
 * reassessment-card JSON blocks emitted by the skill.
 *
 * The schemas defined here are the SOURCE OF TRUTH for what the skill
 * emits. The harness-side validator (lib/dose-card-validator.ts) should
 * import these and use them as the inbound contract — guaranteeing the
 * skill and harness cannot drift.
 *
 * Run standalone:
 *   bun scripts/validate_dose_card.ts <path-to-output.md>
 *
 * Use as a library (from the harness):
 *   import { DoseCardEmittedSchema, ReassessmentCardEmittedSchema }
 *     from "<skill>/scripts/validate_dose_card.ts";
 */

import { z } from "zod";

/* ─── Closed unions (single source of truth) ─────────────────────────── */

/**
 * RefusalKind for calculate_dose. The harness's calculate_dose tool MUST
 * return one of these on a refusal. The skill SKILL.md surfaces the
 * matching string verbatim in its refusal template. Adding a new kind
 * here is the only correct way to introduce a new refusal — prose
 * additions without an enum entry will drift and the validator will
 * miss them.
 */
export const CalculateDoseRefusalKind = z.enum([
  "weight_missing",
  "implausible_weight",
  "invalid_dose_rule_id",
  "rule_not_verified",
  "airway_emergency",
  "unresolved_dangers",
  "out_of_scope",
]);
export type CalculateDoseRefusalKind = z.infer<typeof CalculateDoseRefusalKind>;

/**
 * RefusalKind for get_reassessment_plan. Distinct set from
 * CalculateDoseRefusalKind: a reassessment plan can legitimately be
 * "not required" for a one-shot drug, whereas a dose can never be
 * "not required". The harness's get_reassessment_plan tool MUST return
 * one of these on a refusal.
 */
export const ReassessmentRefusalKind = z.enum([
  "no_reassessment_required",
  "rule_not_verified",
  "invalid_severity_label",
  "invalid_guideline_id",
  "invalid_dose_rule_id",
  "out_of_scope",
]);
export type ReassessmentRefusalKind = z.infer<typeof ReassessmentRefusalKind>;

/**
 * The union of every refusal kind the skill might surface. Used by the
 * grader and by the harness's refusal-routing UI dispatcher.
 */
export const AnyRefusalKind = z.union([
  CalculateDoseRefusalKind,
  ReassessmentRefusalKind,
]);
export type AnyRefusalKind = z.infer<typeof AnyRefusalKind>;

/* ─── Emitted-block schemas ──────────────────────────────────────────── */

const TOOL_CALL_ID = /^[a-zA-Z0-9_-]{8,32}$/;

/**
 * .trim().min(1) instead of .min(1): rejects whitespace-only fields
 * the model might slip in to satisfy "required" without authoring
 * content. Surfaces during validation as "Expected non-whitespace
 * string" rather than passing silently as a one-space lie.
 */
const nonEmpty = () => z.string().trim().min(1);

/**
 * What the skill is allowed to emit on a dose-card block.
 * .strict() rejects any extra key — including numerics — which is the
 * mechanical enforcement of invariant 5 ("never author a number").
 */
export const DoseCardEmittedSchema = z
  .object({
    tool_call_id: z
      .string()
      .regex(TOOL_CALL_ID, "tool_call_id must match ^[a-zA-Z0-9_-]{8,32}$"),
    drug: nonEmpty(),
    route: nonEmpty(),
    severity_row: nonEmpty(),
    assessment: nonEmpty(),
    plan: nonEmpty(),
  })
  .strict();

/**
 * Phase 5 reassessment block. Same structural-handoff pattern as the
 * dose-card: the skill emits qualitative fields keyed by tool_call_id;
 * the harness sources reassess_in_minutes and the branch table from
 * the get_reassessment_plan tool result.
 */
export const ReassessmentCardEmittedSchema = z
  .object({
    tool_call_id: z
      .string()
      .regex(TOOL_CALL_ID, "tool_call_id must match ^[a-zA-Z0-9_-]{8,32}$"),
    watch_for_summary: nonEmpty(),
    next_steps_summary: nonEmpty(),
  })
  .strict();

export type DoseCardEmitted = z.infer<typeof DoseCardEmittedSchema>;
export type ReassessmentCardEmitted = z.infer<
  typeof ReassessmentCardEmittedSchema
>;

/* ─── Block extraction ───────────────────────────────────────────────── */

function extractBlocks(
  source: string,
  kind: "dose-card" | "reassessment-card",
): string[] {
  const fence = new RegExp("```" + kind + "\\s*\\n([\\s\\S]*?)\\n```", "g");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = fence.exec(source)) !== null) out.push(m[1]);
  return out;
}

function validateBlock(
  raw: string,
  schema: z.ZodTypeAny,
  kind: string,
  idx: number,
): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.error(`  ${kind} #${idx}: invalid JSON — ${(e as Error).message}`);
    return false;
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    console.error(`  ${kind} #${idx}: schema violation`);
    for (const issue of result.error.issues) {
      console.error(
        `    - ${issue.path.join(".") || "(root)"}: ${issue.message}`,
      );
    }
    return false;
  }
  return true;
}

/* ─── CLI ─────────────────────────────────────────────────────────────── */

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error(
      "usage: bun scripts/validate_dose_card.ts <path-to-output.md>",
    );
    process.exit(2);
  }
  const source = await Bun.file(arg).text();

  const doseBlocks = extractBlocks(source, "dose-card");
  const reassessBlocks = extractBlocks(source, "reassessment-card");

  if (doseBlocks.length === 0 && reassessBlocks.length === 0) {
    console.log(
      "ok: no structured blocks emitted (likely a refusal — that's fine)",
    );
    process.exit(0);
  }

  let allOk = true;
  console.log(
    `found ${doseBlocks.length} dose-card, ${reassessBlocks.length} reassessment-card block(s)`,
  );
  doseBlocks.forEach((b, i) => {
    if (!validateBlock(b, DoseCardEmittedSchema, "dose-card", i + 1))
      allOk = false;
  });
  reassessBlocks.forEach((b, i) => {
    if (
      !validateBlock(
        b,
        ReassessmentCardEmittedSchema,
        "reassessment-card",
        i + 1,
      )
    )
      allOk = false;
  });

  if (allOk) {
    console.log("ok: all blocks pass strict schema");
    process.exit(0);
  }
  console.error("FAIL: at least one block violates the strict schema");
  process.exit(1);
}

if (import.meta.main) main();
