// app/api/turn2/route.ts
//
// TURN 2 — THE APPLY PIPELINE. The KEYSTONE: this is where "judgment up,
// execution down" becomes real in ONE request. It consumes the clinician's
// CONFIRMED CaseState and routes deterministically → retrieves the whole
// guideline → lets the model pick the severity ROW (bounded rule-application) →
// calls the DETERMINISTIC dose tool (which owns every number) → synthesises a
// Zod-constrained cited plan → runs the completeness gate.
//
// ════════════════════════════════════════════════════════════════════════════
//   THE BOUNDARY (commented at each step):
//     JUDGMENT (model)  : pick the severity row by id; write cited prose.
//     EXECUTION (code)  : router, getGuideline, calculate_dose, completeness.
//   The model picks the dose RULE BY ID and can never set the cap or do the
//   math. The tool owns numbers. Turn 2 NEVER re-reads the untrusted note —
//   CaseState carries only note_hash + confirmed structured facts (ZERO
//   re-extraction); there is no untrusted command channel in this turn.
// ════════════════════════════════════════════════════════════════════════════
//
// HOW calculate_dose IS WIRED — a DIRECT in-code call between two model calls,
// NOT an SDK tool({execute}). Rationale (DESIGN.md asks for the clearest
// deterministic seam): calling the tool directly in route code makes the
// boundary unambiguous — the model's STEP-A output is just a rule id string; the
// route hands that id to the deterministic tool; the tool's number is the ONLY
// dose that exists and is fed (read-only) into STEP B. There is no SDK tool
// surface the model could route a fabricated dose through, and the tool's
// refusal is a plain return value the route maps to an Abstention — no
// tool-error plumbing. The seam is visible and the numbers provably the tool's.
//
// RESULT MODEL (discriminated by `status`, so the UI can't mis-handle):
//   "ok"            — success: dose + trace + plan + provenance.
//   "abstention"    — amber deliberate abstention (the unified Abstention shape).
//   "incomplete"    — amber: completeness gate fired; the missing slot(s) named.
//   "error"         — RED technical error (bad body, model/SDK, Zod parse fail).

import { NextResponse } from "next/server";
import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText, Output, stepCountIs } from "ai";

import { route, auditRoutedGuideline } from "@/lib/router";
import { getGuideline } from "@/registry/guidelines";
import {
  calculate_dose,
  isRefusal,
  type DoseResult,
} from "@/tools/calculate_dose";
import { checkCompleteness, type SlotRecord } from "@/lib/completeness";
import { noGuidelineAbstention } from "@/lib/refusal-gate";
import {
  PlanOutput,
  buildPlanOutputSchema,
  fromDoseRefusal,
  fromRefusalDecision,
  type Abstention,
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

// Node runtime (NOT edge): the SDK needs it. maxDuration 300s gives the two
// opus-4-7 calls headroom. (DESIGN.md Stack section — matches turn1.)
export const runtime = "nodejs";
export const maxDuration = 300;

const MODEL = "claude-opus-4-7";
// Cost discipline: classification is tiny; synthesis a little larger. Bounded.
const SEVERITY_MAX_OUTPUT_TOKENS = 600;
const PLAN_MAX_OUTPUT_TOKENS = 1800;

// ---------------------------------------------------------------------------
// Response shapes (discriminated by `status`).
// ---------------------------------------------------------------------------

type Provenance = {
  /** The deterministically routed guideline id (logged + returned for audit). */
  routed_guideline_id: string;
  /** The severity row the model classified (rule-application, surfaced). */
  severity_row: string;
  /** The dose_rule_id the model selected (by id; bounded to the registry). */
  dose_rule_id: string;
  /** The model's rule-application reasoning (show-the-working at the edge). */
  severity_reasoning: string;
};

export type SuccessResponse = {
  status: "ok";
  /** The deterministic dose result (the tool owns every number here). */
  dose: Omit<DoseResult, "kind">;
  /** The Zod-validated, citation-carrying plan. */
  plan: PlanOutputType;
  /** The visible judgment→execution seam: how this plan was produced. */
  provenance: Provenance;
};

export type AbstentionResponse = { status: "abstention" } & Omit<
  Abstention,
  "kind"
>;

// Renders amber like an abstention, but is a DISTINCT status: a plan EXISTS and
// is returned to show with the missing field(s) flagged (not a deliberate refusal).
export type IncompleteResponse = {
  status: "incomplete";
  /** The required slots that FAILED the completeness gate (named for the UI). */
  missing: string[];
  /** Amber headline naming the omission (the "faithful but incomplete" shot). */
  headline: string;
  /** The plan that was synthesised but is incomplete (shown with the gap flagged). */
  plan: PlanOutputType;
  provenance: Provenance;
};

export type TechnicalErrorResponse = {
  status: "error";
  message: string;
};

/** The full turn-2 response union (discriminated by `status`) — exported so the
 * console UI consumes the exact wire shape instead of hand-redeclaring it. */
export type Turn2Response =
  | SuccessResponse
  | AbstentionResponse
  | IncompleteResponse
  | TechnicalErrorResponse;

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

/** Map a unified Abstention onto the HTTP response shape (drops `kind`). */
function abstentionResponse(a: Abstention): AbstentionResponse {
  return {
    status: "abstention",
    reason: a.reason,
    headline: a.headline,
    detail: a.detail,
    source: a.source,
  };
}

/** Narrow + validate the posted CaseState enough to drive turn 2 safely. */
function isCaseStateLike(v: unknown): v is CaseState {
  if (typeof v !== "object" || v === null) return false;
  const c = v as Record<string, unknown>;
  const facts = c.extracted_facts;
  if (typeof facts !== "object" || facts === null) return false;
  const f = facts as Record<string, unknown>;
  const weightOk = f.weight_kg === null || typeof f.weight_kg === "number";
  return (
    typeof c.note_hash === "string" &&
    weightOk &&
    (c.selected_condition === null ||
      typeof c.selected_condition === "string") &&
    (c.selected_guideline_id === null ||
      typeof c.selected_guideline_id === "string")
  );
}

// ---------------------------------------------------------------------------
// POST handler.
// ---------------------------------------------------------------------------

export async function POST(req: Request): Promise<Response> {
  // --- Parse the CaseState from the request (bad body → red technical error). ---
  let caseState: CaseState;
  try {
    const body = (await req.json()) as { caseState?: unknown };
    if (!isCaseStateLike(body.caseState)) {
      const err: TechnicalErrorResponse = {
        status: "error",
        message: "Request must include a valid `caseState` object from turn 1.",
      };
      return NextResponse.json(err, { status: 400 });
    }
    caseState = body.caseState;
  } catch {
    const err: TechnicalErrorResponse = {
      status: "error",
      message: "Could not parse request body as JSON.",
    };
    return NextResponse.json(err, { status: 400 });
  }

  const facts = caseState.extracted_facts;

  // ===================================================================
  // EXECUTION — STEP 2: DETERMINISTIC ROUTER. (condition, profession, setting)
  // → guideline_id. The clinician confirmed the condition in turn 1; this table
  // DISPATCHES it (it does not diagnose). Profession/setting default per the
  // schema's documented defaults. Log the routed id for every case (audit hook).
  // ===================================================================
  const condition = caseState.selected_condition ?? "";
  const profession = facts.profession ?? "ED clinician";
  const setting = facts.setting ?? "hospital ED";

  const routedId = route(condition, profession, setting);
  // Audit log: the routed guideline id for every case (DESIGN.md audit hook).
  console.log(
    `[turn2] routed condition="${condition}" → guideline_id=${routedId ?? "(none)"}`,
  );

  // No row matched → abstain "no local guideline" (distinct copy). Unified shape.
  if (routedId === null) {
    return NextResponse.json(
      abstentionResponse(fromRefusalDecision(noGuidelineAbstention())),
    );
  }

  // Wrong-guideline AUDIT: the routed id must match the confirmed condition.
  // (The auto-abstain BEHAVIOUR is the deferred guard; here we DO abstain on a
  // mismatch — fail closed rather than apply a guideline for the wrong condition.)
  if (!auditRoutedGuideline(condition, routedId)) {
    return NextResponse.json(
      abstentionResponse(fromRefusalDecision(noGuidelineAbstention())),
    );
  }

  // ===================================================================
  // EXECUTION — STEP 3: RETRIEVE the whole guideline (deterministic registry
  // lookup). Empty / unknown id → abstain "no local guideline".
  // ===================================================================
  const guideline = getGuideline(routedId);
  if (guideline === null) {
    return NextResponse.json(
      abstentionResponse(fromRefusalDecision(noGuidelineAbstention())),
    );
  }

  // env plumbing (matches turn1): pin /v1 so an ambient ANTHROPIC_BASE_URL
  // without /v1 can't cause a 404.
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const anthropic = createAnthropic({
    apiKey,
    baseURL: "https://api.anthropic.com/v1",
  });

  // ===================================================================
  // JUDGMENT (bounded) — STEP 4: SEVERITY CLASSIFICATION. The model reads the
  // guideline's severity table + the CONFIRMED facts (zero re-extraction) and
  // picks the severity ROW → a dose_rule_id. Bounded: it may only choose from
  // the guideline's actual rule ids (prompt-listed AND re-validated below).
  // ===================================================================
  let classification: SeverityClassification;
  try {
    const result = await generateText({
      model: anthropic(MODEL),
      // NO temperature: opus-4-7 ignores it. (DESIGN.md Stack section.)
      maxOutputTokens: SEVERITY_MAX_OUTPUT_TOKENS,
      stopWhen: stepCountIs(1), // single-shot bounded classification; no tools.
      system: buildSeveritySystemPrompt(guideline),
      prompt: buildSeverityUserPrompt(caseState),
      experimental_output: Output.object({ schema: SeverityClassification }),
    });
    classification = SeverityClassification.parse(result.experimental_output);
  } catch (e) {
    const err: TechnicalErrorResponse = {
      status: "error",
      message:
        "Turn 2 severity classification failed (model or schema error). " +
        (e instanceof Error ? e.message : String(e)),
    };
    return NextResponse.json(err, { status: 502 });
  }

  // ===================================================================
  // EXECUTION — STEP 5: calculate_dose(routedId, chosen_rule_id, weight_kg).
  // THE DETERMINISTIC TOOL DOES ALL MATH. Called DIRECTLY here (not via an SDK
  // tool surface) so the boundary is unambiguous: the model gave a rule-id
  // STRING; the tool owns the number. The tool itself re-validates the rule id,
  // human_verified, and weight plausibility — an invalid id / unverified rule /
  // implausible weight returns a refusal we map to the unified Abstention.
  //
  // weight_kg should be present (turn 1's pre-LLM + post gate already refused a
  // null weight). We pass NaN as a defensive sentinel if it is somehow null so
  // the tool's GUARD-7 abstains rather than dosing on a non-number.
  // ===================================================================
  const weight = facts.weight_kg ?? Number.NaN;
  const doseResult = calculate_dose(
    routedId,
    classification.dose_rule_id,
    weight,
  );
  if (isRefusal(doseResult)) {
    return NextResponse.json(abstentionResponse(fromDoseRefusal(doseResult)));
  }

  const provenance: Provenance = {
    routed_guideline_id: routedId,
    severity_row: classification.severity_row,
    dose_rule_id: classification.dose_rule_id,
    severity_reasoning: classification.reasoning,
  };

  // ===================================================================
  // JUDGMENT (constrained) — STEP 6: PLAN SYNTHESIS. Given the whole guideline +
  // the ALREADY-COMPUTED dose (read-only), the model writes recommendations that
  // cite the guideline VERBATIM (citation is Zod-enforced) and fills
  // required_fields FROM the guideline. A Zod parse failure → RED technical
  // error (distinct from the amber abstention).
  // ===================================================================
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

  let plan: PlanOutputType;
  try {
    // Per-guideline schema FORCES the model to emit every required_fields slot
    // (a bare record lets it return {} and skip them all). The result is then
    // re-validated against the wire PlanOutput shape.
    const planSchema = buildPlanOutputSchema(guideline);
    const result = await generateText({
      model: anthropic(MODEL),
      maxOutputTokens: PLAN_MAX_OUTPUT_TOKENS,
      stopWhen: stepCountIs(1), // single-shot constrained synthesis; no tools.
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
    const err: TechnicalErrorResponse = {
      status: "error",
      message:
        "Turn 2 plan synthesis failed (model or schema error). " +
        (e instanceof Error ? e.message : String(e)),
    };
    return NextResponse.json(err, { status: 502 });
  }

  // ===================================================================
  // EXECUTION — STEP 7: COMPLETENESS GATE. Deterministic, NO LLM judge. Every
  // RequiredFields slot must be present AND non-null AND non-empty. If a slot is
  // missing/null/empty the gate FIRES — return a structured "incomplete" result
  // the UI renders amber with the missing field NAMED (the "faithful but
  // incomplete" money-shot). We do NOT silently pass it.
  // ===================================================================
  const slots: SlotRecord = plan.required_fields;
  const completeness = checkCompleteness(slots, guideline.required_fields);
  if (!completeness.complete) {
    const incomplete: IncompleteResponse = {
      status: "incomplete",
      missing: completeness.missing,
      headline: `Plan is faithful but INCOMPLETE — missing required field(s): ${completeness.missing.join(", ")}.`,
      plan,
      provenance,
    };
    return NextResponse.json(incomplete);
  }

  // ===================================================================
  // STEP 8: SUCCESS — dose + trace + cited plan + the visible provenance seam.
  // ===================================================================
  // Strip the tool's `kind` discriminator; the rest IS the wire dose shape.
  const { kind: _k, ...dose } = doseResult;
  const ok: SuccessResponse = {
    status: "ok",
    dose,
    plan,
    provenance,
  };
  return NextResponse.json(ok);
}
