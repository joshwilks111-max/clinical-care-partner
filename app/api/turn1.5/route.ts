// app/api/turn1.5/route.ts
//
// TURN 1.5 — DIAGNOSTIC-COMPLETENESS ASSIST (advisory only).
//
// One bounded model judgment call + Zod validation. The model may recommend ONE
// high-impact clarifying question and a treatable condition + guideline pair.
// Turn 2 remains the only dose-abstention point; this route never abstains.
//
// STATUSES: ask | ok | recorded | error (no Turn 1.5 abstention).
//
// PHASES:
//   decide — model judgment; returns ask or ok with recommendations.
//   answer — logs clinician answer or skip; returns recorded + updated CaseState.

import { NextResponse } from "next/server";
import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText, Output, stepCountIs } from "ai";

import { applyAnswer } from "@/lib/collapse";
import { getConditionMeta } from "@/registry/guidelines";
import { withTransientRetry } from "@/lib/retry";
import {
  buildTurn15OutputSchema,
  buildTurn15RepairPrompt,
  buildTurn15SystemPrompt,
  buildTurn15UserPrompt,
  shouldOverrideToNoQuestion,
  validateTurn15Output,
  type ConfirmedFactsSummary,
  type Turn15ModelOutput,
} from "@/prompts/turn1.5";
import {
  isCaseStateLike,
  withDefaultedDiscriminatingQa,
  type CaseState,
} from "@/lib/case-state";
import type { DiscriminatorAnswer } from "@/lib/schemas";

export type { DiscriminatorAnswer };

export const runtime = "nodejs";
export const maxDuration = 300;

const MODEL = "claude-opus-4-7";
const TURN15_MAX_OUTPUT_TOKENS = 800;
const MAX_TURN15_BODY_BYTES = 64 * 1024;

const DISCRIMINATOR_ANSWERS: readonly DiscriminatorAnswer[] = [
  "present",
  "absent",
  "not_assessed",
];

function presentFromAnswer(a: DiscriminatorAnswer): boolean {
  return a !== "absent";
}

export type Turn15DecideRequest = {
  phase: "decide";
  caseState: CaseState;
  /** Turn 1 confidence for the prompt (optional on wire; defaults medium). */
  confidence?: "low" | "medium" | "high";
};

export type Turn15AnswerRequest = {
  phase: "answer";
  caseState: CaseState;
  answer: DiscriminatorAnswer | null;
  target: string;
  question: string;
  recommended_condition: string;
  recommended_guideline: string;
};

export type Turn15Request = Turn15DecideRequest | Turn15AnswerRequest;

export type AskResponse = {
  status: "ask";
  question: string;
  target: string;
  discriminators: string[];
  recommended_condition: string;
  recommended_guideline: string;
  rationale_summary: string;
  caseState: CaseState;
};

export type OkResponse = {
  status: "ok";
  recommended_condition: string;
  recommended_guideline: string;
  rationale_summary: string;
  caseState: CaseState;
  /**
   * Populated when the response came via the deterministic
   * ConText/NegEx-style override (shouldOverrideToNoQuestion) — the LLM said
   * needs_question=true but every registry discriminator for `overridden_target`
   * was already documented absent in the differential. The UI uses these
   * fields to render the green "NO CLARIFYING QUESTION NEEDED — drooling,
   * tripod posture, muffled voice all documented absent" badge. Absent on
   * the normal needs_question=false path.
   */
  overridden_target?: string;
  overridden_discriminators?: string[];
};

export type RecordedResponse = {
  status: "recorded";
  caseState: CaseState;
  recommended_condition: string;
  recommended_guideline: string;
};

export type TechnicalErrorResponse = {
  status: "error";
  message: string;
  code?: string;
};

export type Turn15Response =
  | AskResponse
  | OkResponse
  | RecordedResponse
  | TechnicalErrorResponse;

function confirmedFactsFrom(
  caseState: CaseState,
  confidence: "low" | "medium" | "high",
): ConfirmedFactsSummary {
  const facts = caseState.extracted_facts;
  return {
    age: facts.age,
    weight_kg: facts.weight_kg,
    severity: caseState.selected_severity ?? facts.severity,
    confidence,
  };
}

function discriminatorsForTarget(target: string): string[] {
  const meta = getConditionMeta(target);
  return meta?.discriminators ?? [];
}

async function runTurn15Judgment(
  caseState: CaseState,
  confidence: "low" | "medium" | "high",
): Promise<
  | { ok: true; output: Turn15ModelOutput }
  | { ok: false; code: string; message: string }
> {
  const differential = caseState.differential;
  if (differential.conditions.length === 0) {
    return {
      ok: false,
      code: "empty_differential",
      message: "Empty differential — re-run Turn 1.",
    };
  }

  let schema;
  try {
    schema = buildTurn15OutputSchema(differential);
  } catch {
    return {
      ok: false,
      code: "empty_differential",
      message: "Empty differential — re-run Turn 1.",
    };
  }

  const treatable = differential.conditions.filter((c) => {
    const meta = getConditionMeta(c.name);
    return meta && meta.applicable_guidelines.length > 0;
  });
  if (treatable.length === 0) {
    return {
      ok: false,
      code: "empty_registry",
      message: "No treatable guideline matches this differential.",
    };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const anthropic = createAnthropic({
    apiKey,
    baseURL: "https://api.anthropic.com/v1",
  });

  const system = buildTurn15SystemPrompt(differential);
  const prompt = buildTurn15UserPrompt(
    differential,
    confirmedFactsFrom(caseState, confidence),
  );

  let lastRawOutput: unknown = null;

  const attempt = async (
    userPrompt: string,
  ): Promise<Turn15ModelOutput | null> => {
    const result = await generateText({
      model: anthropic(MODEL),
      maxOutputTokens: TURN15_MAX_OUTPUT_TOKENS,
      stopWhen: stepCountIs(1),
      system,
      prompt: userPrompt,
      experimental_output: Output.object({ schema }),
    });
    lastRawOutput = result.experimental_output;
    const parsed = schema.safeParse(result.experimental_output);
    if (!parsed.success) return null;
    const validationErr = validateTurn15Output(parsed.data, differential);
    if (validationErr) return null;
    return parsed.data;
  };

  try {
    let output = await withTransientRetry(() => attempt(prompt));

    if (!output) {
      const repairPrompt = buildTurn15RepairPrompt(
        "Schema or pair-check validation failed",
        JSON.stringify(lastRawOutput ?? {}),
      );
      output = await withTransientRetry(() => attempt(repairPrompt));
    }

    if (!output) {
      return {
        ok: false,
        code: "parse_failure",
        message:
          "Could not validate the advisory judgment. Guideline buttons remain available.",
      };
    }

    return { ok: true, output };
  } catch (e) {
    console.error("[turn1.5:decide] model call failed:", e);
    return {
      ok: false,
      code: "model_failure",
      message:
        "A technical error occurred during the advisory check. Guideline buttons remain available.",
    };
  }
}

export async function POST(req: Request): Promise<Response> {
  let body: {
    phase?: unknown;
    caseState?: unknown;
    answer?: unknown;
    confidence?: unknown;
    target?: unknown;
    question?: unknown;
    recommended_condition?: unknown;
    recommended_guideline?: unknown;
  };
  try {
    const rawBody = await req.text();
    if (rawBody.length > MAX_TURN15_BODY_BYTES) {
      const err: TechnicalErrorResponse = {
        status: "error",
        message: "Request too large.",
        code: "payload_too_large",
      };
      return NextResponse.json(err, { status: 413 });
    }
    body = JSON.parse(rawBody) as typeof body;
  } catch {
    const err: TechnicalErrorResponse = {
      status: "error",
      message: "Could not parse request body as JSON.",
      code: "bad_json",
    };
    return NextResponse.json(err, { status: 400 });
  }

  if (body.phase !== "decide" && body.phase !== "answer") {
    const err: TechnicalErrorResponse = {
      status: "error",
      message: "Request must include phase: 'decide' or 'answer'.",
      code: "bad_phase",
    };
    return NextResponse.json(err, { status: 400 });
  }

  if (!isCaseStateLike(body.caseState)) {
    const err: TechnicalErrorResponse = {
      status: "error",
      message: "Request must include a valid `caseState` object from turn 1.",
      code: "bad_case_state",
    };
    return NextResponse.json(err, { status: 400 });
  }
  const caseState = withDefaultedDiscriminatingQa(body.caseState);

  if (body.phase === "decide") {
    const confidence =
      body.confidence === "low" ||
      body.confidence === "medium" ||
      body.confidence === "high"
        ? body.confidence
        : "medium";

    const result = await runTurn15Judgment(caseState, confidence);
    if (!result.ok) {
      const err: TechnicalErrorResponse = {
        status: "error",
        message: result.message,
        code: result.code,
      };
      return NextResponse.json(err, {
        status: result.code === "empty_differential" ? 400 : 502,
      });
    }

    const output = result.output;
    console.log(
      `[turn1.5:decide] needs_question=${output.needs_question} recommended=${output.recommended_condition}/${output.recommended_guideline}`,
    );

    if (output.needs_question && output.target_condition && output.question) {
      // OVERRIDE CHECK — ConText/NegEx-style assertion pre-pass.
      //
      // The LLM voted to ask, but if every registry discriminator for the
      // target condition is ALREADY documented absent in the differential
      // (the Turn 1 grounding pre-pass + canonicalisation puts them there),
      // we skip the question and emit OkResponse instead. The green badge
      // in the UI reads `overridden_target` + `overridden_discriminators`.
      const override = shouldOverrideToNoQuestion(
        output,
        caseState.differential,
      );
      if (override.kind === "force_no_question") {
        const ok: OkResponse = {
          status: "ok",
          recommended_condition: output.recommended_condition,
          recommended_guideline: output.recommended_guideline,
          rationale_summary: output.rationale_summary,
          caseState,
          overridden_target: override.target,
          overridden_discriminators: override.groundedDiscriminators,
        };
        console.log(
          `[turn1.5:decide] override=force_no_question target=${override.target} (all ${override.groundedDiscriminators.length} discriminators grounded absent)`,
        );
        return NextResponse.json(ok);
      }

      const target = output.target_condition;
      const ask: AskResponse = {
        status: "ask",
        question: output.question,
        target,
        discriminators: discriminatorsForTarget(target),
        recommended_condition: output.recommended_condition,
        recommended_guideline: output.recommended_guideline,
        rationale_summary: output.rationale_summary,
        caseState,
      };
      return NextResponse.json(ask);
    }

    const ok: OkResponse = {
      status: "ok",
      recommended_condition: output.recommended_condition,
      recommended_guideline: output.recommended_guideline,
      rationale_summary: output.rationale_summary,
      caseState,
    };
    return NextResponse.json(ok);
  }

  // phase === "answer"
  const answerRaw = body.answer;
  if (
    answerRaw !== null &&
    (typeof answerRaw !== "string" ||
      !DISCRIMINATOR_ANSWERS.includes(answerRaw as DiscriminatorAnswer))
  ) {
    const err: TechnicalErrorResponse = {
      status: "error",
      message:
        "Answer phase requires answer: 'present' | 'absent' | 'not_assessed' | null (skip).",
      code: "bad_answer",
    };
    return NextResponse.json(err, { status: 400 });
  }

  if (
    typeof body.target !== "string" ||
    typeof body.question !== "string" ||
    typeof body.recommended_condition !== "string" ||
    typeof body.recommended_guideline !== "string"
  ) {
    const err: TechnicalErrorResponse = {
      status: "error",
      message:
        "Answer phase requires target, question, recommended_condition, and recommended_guideline from the prior ask.",
      code: "bad_answer_context",
    };
    return NextResponse.json(err, { status: 400 });
  }

  const target = body.target;
  const question = body.question;
  const recommended_condition = body.recommended_condition;
  const recommended_guideline = body.recommended_guideline;
  const skipped = answerRaw === null;

  let updatedDifferential = caseState.differential;
  if (!skipped) {
    const answer = answerRaw as DiscriminatorAnswer;
    const discriminators = discriminatorsForTarget(target);
    if (discriminators.length === 0) {
      const err: TechnicalErrorResponse = {
        status: "error",
        message: `Registry has no discriminators for target "${target}" — cannot apply answer.`,
        code: "bad_discriminators",
      };
      return NextResponse.json(err, { status: 400 });
    }
    const present = presentFromAnswer(answer);
    updatedDifferential = applyAnswer(
      caseState.differential,
      target,
      discriminators,
      present,
    );
    console.log(
      `[turn1.5:answer] answer=${answer} present=${present} target=${target} engaged=true`,
    );
  } else {
    console.log(`[turn1.5:answer] skip target=${target} engaged=false`);
  }

  const updatedCaseState: CaseState = {
    ...caseState,
    differential: updatedDifferential,
    discriminating_qa: [
      ...caseState.discriminating_qa,
      {
        target,
        question,
        answer: skipped ? "skipped" : (answerRaw as DiscriminatorAnswer),
        engaged: !skipped,
        recorded_at: new Date().toISOString(),
      },
    ],
  };

  const recorded: RecordedResponse = {
    status: "recorded",
    caseState: updatedCaseState,
    recommended_condition,
    recommended_guideline,
  };
  return NextResponse.json(recorded);
}
