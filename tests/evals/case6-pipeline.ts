// tests/evals/case6-pipeline.ts
//
// CASE 6 (incomplete-but-faithful) pipeline. This is a thin replica of the
// turn-2 route's MODEL steps (STEP A severity → calculate_dose → STEP B plan →
// completeness gate), driven against the EVAL-ONLY guideline that declares one
// uncoverable required slot (tests/evals/test-guidelines.ts). It reuses the REAL
// prompts, the REAL plan schema, the REAL dose tool, and the REAL completeness
// gate — only the guideline (and therefore the required-field set) differs from
// production, because both production guidelines happen to cover every slot.
//
// The result shape is the production Turn2Response union, so the eval asserts the
// SAME structured contract: a faithful, cited, correctly-dosed plan that the
// completeness gate marks `status:"incomplete"` with the uncoverable slot named.

import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText, Output, stepCountIs } from "ai";

import { calculate_dose, isRefusal } from "@/tools/calculate_dose";
import { checkCompleteness, type SlotRecord } from "@/lib/completeness";
import {
  PlanOutput,
  buildPlanOutputSchema,
  type PlanOutput as PlanOutputType,
} from "@/lib/plan-schema";
import {
  SeverityClassification,
  buildSeveritySystemPrompt,
  buildSeverityUserPrompt,
  buildPlanSystemPrompt,
  buildPlanUserPrompt,
  type ComputedDoseForPrompt,
} from "@/prompts/turn2";
import type { CaseState } from "@/lib/case-state";
import type { Guideline } from "@/registry/guidelines";
import { buildEvalIncompleteGuideline } from "./test-guidelines";

const MODEL = "claude-opus-4-7";

type Provenance = {
  routed_guideline_id: string;
  severity_row: string;
  dose_rule_id: string;
  severity_reasoning: string;
};

/** Mirrors the route's IncompleteResponse / SuccessResponse / error shapes. */
export type Case6Result =
  | {
      status: "incomplete";
      missing: string[];
      headline: string;
      plan: PlanOutputType;
      provenance: Provenance;
      dose: { dose_mg: number; capped: boolean };
    }
  | {
      status: "ok";
      plan: PlanOutputType;
      provenance: Provenance;
      dose: { dose_mg: number; capped: boolean };
    }
  | { status: "error"; message: string };

/**
 * Run the real turn-2 model pipeline against the eval guideline. The dose math,
 * citations, and completeness gate are all the production ones; only the
 * required_fields set (which includes one uncoverable slot) is the eval's.
 */
export async function runCase6(caseState: CaseState): Promise<Case6Result> {
  const guideline: Guideline = buildEvalIncompleteGuideline();
  const facts = caseState.extracted_facts;

  const anthropic = createAnthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseURL: "https://api.anthropic.com/v1",
  });

  // STEP A — severity classification (real prompt, real schema).
  let classification: SeverityClassification;
  try {
    const result = await generateText({
      model: anthropic(MODEL),
      maxOutputTokens: 600,
      stopWhen: stepCountIs(1),
      system: buildSeveritySystemPrompt(guideline),
      prompt: buildSeverityUserPrompt(caseState),
      experimental_output: Output.object({ schema: SeverityClassification }),
    });
    classification = SeverityClassification.parse(result.experimental_output);
  } catch (e) {
    return { status: "error", message: `STEP A failed: ${String(e)}` };
  }

  // calculate_dose — the REAL deterministic tool, on the REAL croup rule.
  const weight = facts.weight_kg ?? Number.NaN;
  const doseResult = calculate_dose(
    "starship-croup-2020", // real dose rule (eval guideline reuses croup rules)
    classification.dose_rule_id,
    weight,
  );
  if (isRefusal(doseResult)) {
    return { status: "error", message: `dose refused: ${doseResult.reason}` };
  }

  const provenance: Provenance = {
    routed_guideline_id: guideline.guideline_id,
    severity_row: classification.severity_row,
    dose_rule_id: classification.dose_rule_id,
    severity_reasoning: classification.reasoning,
  };

  const doseForPrompt: ComputedDoseForPrompt = {
    drug: doseResult.drug,
    route: doseResult.route,
    frequency: doseResult.frequency,
    dose_mg: doseResult.dose_mg,
    dose_ml: doseResult.dose_ml,
    calculation_trace: doseResult.calculation_trace,
    capped: doseResult.capped,
    binding_limit: doseResult.binding_limit,
  };

  // STEP B — plan synthesis (real prompt; the per-guideline schema includes the
  // uncoverable slot, which the model must honestly null per the prompt rules).
  let plan: PlanOutputType;
  try {
    const planSchema = buildPlanOutputSchema(guideline);
    const result = await generateText({
      model: anthropic(MODEL),
      maxOutputTokens: 1800,
      stopWhen: stepCountIs(1),
      system: buildPlanSystemPrompt(guideline),
      prompt: buildPlanUserPrompt(
        caseState,
        classification.severity_row,
        doseForPrompt,
      ),
      experimental_output: Output.object({ schema: planSchema }),
    });
    plan = PlanOutput.parse(result.experimental_output);
  } catch (e) {
    return { status: "error", message: `STEP B failed: ${String(e)}` };
  }

  // Completeness gate — the REAL deterministic gate, on the eval required_fields.
  const slots: SlotRecord = plan.required_fields;
  const completeness = checkCompleteness(slots, guideline.required_fields);
  const dose = { dose_mg: doseResult.dose_mg, capped: doseResult.capped };

  if (!completeness.complete) {
    return {
      status: "incomplete",
      missing: completeness.missing,
      headline: `Plan is faithful but INCOMPLETE — missing required field(s): ${completeness.missing.join(", ")}.`,
      plan,
      provenance,
      dose,
    };
  }
  return { status: "ok", plan, provenance, dose };
}
