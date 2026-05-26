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
import {
  decideCollapse,
  demoteSharedFindings,
  type CollapseAbstainReason,
} from "@/lib/collapse";
import {
  getGuideline,
  getDoseRule,
  buildConditionGuidelineMap,
} from "@/registry/guidelines";
import {
  calculate_dose,
  isRefusal,
  type DoseResult,
} from "@/tools/calculate_dose";
import { checkCompleteness, type SlotRecord } from "@/lib/completeness";
import {
  noGuidelineAbstention,
  unresolvedDangersAbstention,
  wrongGuidelineAbstention,
} from "@/lib/refusal-gate";
import { withTransientRetry } from "@/lib/retry";
import {
  PlanOutput,
  buildPlanOutputSchema,
  fromDoseRefusal,
  fromRefusalDecision,
  toAbstentionResponse,
  type AbstentionResponse,
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
import {
  isCaseStateLike,
  withDefaultedDiscriminatingQa,
  collapseRoundForGate,
  type CaseState,
} from "@/lib/case-state";

// Node runtime (NOT edge): the SDK needs it. maxDuration 300s gives the two
// opus-4-7 calls headroom. (DESIGN.md Stack section — matches turn1.)
export const runtime = "nodejs";
export const maxDuration = 300;

const MODEL = "claude-opus-4-7";
// Cost discipline: classification is tiny; synthesis a little larger. Bounded.
const SEVERITY_MAX_OUTPUT_TOKENS = 600;
const PLAN_MAX_OUTPUT_TOKENS = 1800;

// FIX 5 (ADV-6) — body-size cap. A CaseState is small structured data (facts +
// a hashed note + the differential), so 64 KB is generous headroom while still
// rejecting an oversized payload BEFORE we parse + drive two model calls off it.
// This is a spend/DoS guard on a public, key-spending route. Larger than turn 1's
// 16 KB note cap because CaseState also carries the differential JSON.
const MAX_CASESTATE_BODY_BYTES = 64 * 1024;

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

/**
 * FIX 3 (ADV-4) — normalise a string for quote-verification substring matching:
 * lowercase + collapse all whitespace runs (incl. newlines) to single spaces +
 * strip surrounding quote marks/punctuation + trim. The guideline text is
 * multi-line; the model's "verbatim" quote may reflow whitespace or add/drop an
 * edge period or wrapping quotes. We tolerate FORMATTING/edge-punctuation while
 * still proving the quote's WORD SEQUENCE came from the guideline — a
 * hallucinated quote (different words) still fails the substring check.
 */
function normalizeForQuoteMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^[\s"'“”.,;:–—-]+|[\s"'“”.,;:–—-]+$/g, "")
    .trim();
}

// ---------------------------------------------------------------------------
// POST handler.
// ---------------------------------------------------------------------------

export async function POST(req: Request): Promise<Response> {
  // --- Parse the CaseState from the request (bad body → red technical error). ---
  let caseState: CaseState;
  try {
    // FIX 5 (ADV-6) — cap the request body BEFORE parsing it. Read the raw text
    // (bounded by length) so a huge payload can't be parsed into memory or fed to
    // the two model calls. content-length is advisory (a client can lie / omit
    // it), so we also re-check the actual decoded length as the authoritative
    // guard. Oversized → 413 technical error, ZERO model calls.
    const rawBody = await req.text();
    if (rawBody.length > MAX_CASESTATE_BODY_BYTES) {
      const err: TechnicalErrorResponse = {
        status: "error",
        message: "Request too large.",
      };
      return NextResponse.json(err, { status: 413 });
    }
    const body = JSON.parse(rawBody) as { caseState?: unknown };
    if (!isCaseStateLike(body.caseState)) {
      const err: TechnicalErrorResponse = {
        status: "error",
        message: "Request must include a valid `caseState` object from turn 1.",
      };
      return NextResponse.json(err, { status: 400 });
    }
    caseState = withDefaultedDiscriminatingQa(body.caseState);
  } catch {
    const err: TechnicalErrorResponse = {
      status: "error",
      message: "Could not parse request body as JSON.",
    };
    return NextResponse.json(err, { status: 400 });
  }

  const facts = caseState.extracted_facts;

  // ===================================================================
  // STEP 1.5 — DEFENSE-IN-DEPTH COLLAPSE GATE.
  //
  // Turn 1.5 is advisory only (ask | ok | recorded | error) — it never abstains
  // or collapses the differential. This gate is PURE defense-in-depth: a hand-
  // crafted POST that skips turn 1.5 must not dose past an unresolved must-not-
  // miss. We demote shared findings (Rule-2 over-abstain fix) then run
  // decideCollapse with the SAME map builder as the collapse core.
  //
  // Engaged advisory Q&A sets gateRound via collapseRoundForGate (round 1).
  // Gate fires ONLY on `abstain` — ask and plan fall through. If it fires: ZERO
  // model calls, amber abstention.
  // ===================================================================
  {
    const collapseMap = buildConditionGuidelineMap();
    const differentialForGate = demoteSharedFindings(
      caseState.differential,
      collapseMap,
    );
    const gateRound = collapseRoundForGate(caseState);
    const collapseDecision = decideCollapse(
      differentialForGate,
      collapseMap,
      gateRound,
    );
    if (collapseDecision.action === "abstain") {
      // F-016 — pick the copy that matches the actual blocker. Rule 2 (positive
      // must-not-miss) and Rule 3a (>1 unresolved must-not-miss) are about
      // undischarged danger, NOT a registry miss; using the "no guideline"
      // copy lied to the clinician. The decider tells us which it was.
      const abstainReason: CollapseAbstainReason =
        collapseDecision.reason ?? "no_treatable";
      const refusal =
        abstainReason === "unresolved_dangers"
          ? unresolvedDangersAbstention()
          : noGuidelineAbstention();
      console.log(
        `[turn2:gate] defense-in-depth collapse gate fired: action=abstain, reason=${abstainReason}, round=${gateRound} — returning abstention, ZERO model calls`,
      );
      return NextResponse.json(
        toAbstentionResponse(fromRefusalDecision(refusal)),
      );
    }
  }

  // ===================================================================
  // EXECUTION — STEP 2: SELECT the guideline the clinician CLICKED.
  //
  // FIX 1 (P0) — selected_guideline_id is the SOURCE OF TRUTH. The clinician's
  // click carries the exact guideline they chose to apply; turn 2 honours THAT,
  // it does NOT re-derive a guideline from the confirmed condition (a note with
  // two candidate conditions could otherwise route "Apply Croup" to anaphylaxis
  // and dose the wrong drug). The deterministic router remains as a defensive
  // fallback for a hand-crafted POST that omits the id.
  //
  // The audit then becomes NON-TAUTOLOGICAL: we check the CLICKED guideline's
  // registered condition against the confirmed condition. A mismatch (the picked
  // guideline is for a different condition than the one confirmed) ABSTAINS —
  // fail closed rather than apply a guideline for the wrong condition. Because
  // routedId is no longer derived from `condition`, this check can actually fail.
  // ===================================================================
  const condition = caseState.selected_condition ?? "";
  const profession = facts.profession ?? "ED clinician";
  const setting = facts.setting ?? "hospital ED";

  let routedId: string | null;
  if (caseState.selected_guideline_id) {
    // Primary path: use the clinician's CLICKED guideline as the source of truth.
    routedId = caseState.selected_guideline_id;
  } else {
    // Defensive fallback (the UI always sets selected_guideline_id; a raw POST
    // might not): route deterministically from the confirmed condition.
    routedId = route(condition, profession, setting);
  }

  // Audit log: the selected/routed guideline id for every case (DESIGN.md hook).
  console.log(
    `[turn2] condition="${condition}" selected_guideline_id=${caseState.selected_guideline_id ?? "(none)"} → guideline_id=${routedId ?? "(none)"}`,
  );

  // No guideline determined → abstain "no local guideline" (distinct copy).
  if (routedId === null) {
    return NextResponse.json(
      toAbstentionResponse(fromRefusalDecision(noGuidelineAbstention())),
    );
  }

  // Wrong-guideline AUDIT (now non-tautological): the CLICKED guideline's
  // registered condition must equal the clinician-confirmed condition. This
  // CATCHES the wrong-guideline case (e.g. condition "croup" but the clicked id
  // is the anaphylaxis guideline) and abstains with reason "wrong_guideline"
  // rather than silently dosing the wrong drug. The copy is distinct from
  // "no guideline matches" — a guideline EXISTS, it just does not match the
  // confirmed condition.
  if (!auditRoutedGuideline(condition, routedId)) {
    return NextResponse.json(
      toAbstentionResponse(fromRefusalDecision(wrongGuidelineAbstention())),
    );
  }

  // ===================================================================
  // EXECUTION — STEP 3: RETRIEVE the whole guideline (deterministic registry
  // lookup). Empty / unknown id → abstain "no local guideline".
  // ===================================================================
  const guideline = getGuideline(routedId);
  if (guideline === null) {
    return NextResponse.json(
      toAbstentionResponse(fromRefusalDecision(noGuidelineAbstention())),
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
    // Bounded transient-only retry (STEP A). A no-output / overloaded / 429 /
    // 529 / network miss is re-rolled up to twice with short backoff; a Zod
    // parse failure is non-transient → re-thrown on the first attempt with ZERO
    // retries, falling through to the SAME red catch below.
    classification = await withTransientRetry(async () => {
      const result = await generateText({
        model: anthropic(MODEL),
        // NO temperature: opus-4-7 ignores it. (DESIGN.md Stack section.)
        maxOutputTokens: SEVERITY_MAX_OUTPUT_TOKENS,
        stopWhen: stepCountIs(1), // single-shot bounded classification; no tools.
        system: buildSeveritySystemPrompt(guideline),
        prompt: buildSeverityUserPrompt(caseState),
        experimental_output: Output.object({ schema: SeverityClassification }),
      });
      return SeverityClassification.parse(result.experimental_output);
    });
  } catch (e) {
    // FIX 4 (SEC-2) — log the full error SERVER-side; return a GENERIC client
    // message. The raw e.message can carry provider internals / a leaked key
    // fragment / a stack trace — never echo it to the client.
    console.error("[turn2] severity classification failed:", e);
    const err: TechnicalErrorResponse = {
      status: "error",
      message:
        "A technical error occurred during turn 2 severity classification.",
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
    return NextResponse.json(toAbstentionResponse(fromDoseRefusal(doseResult)));
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
    // Bounded transient-only retry (STEP B). Same scoping as STEP A: only a
    // transient model/SDK miss is re-rolled; a Zod parse failure is
    // non-transient → re-thrown immediately to the SAME red catch below.
    plan = await withTransientRetry(async () => {
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
      return PlanOutput.parse(result.experimental_output);
    });
  } catch (e) {
    // FIX 4 (SEC-2) — log the full error SERVER-side; return a GENERIC client
    // message (never echo e.message — it can carry provider internals / secrets).
    console.error("[turn2] plan synthesis failed:", e);
    const err: TechnicalErrorResponse = {
      status: "error",
      message: "A technical error occurred during turn 2 plan synthesis.",
    };
    return NextResponse.json(err, { status: 502 });
  }

  // ===================================================================
  // SECURITY — STEP 6.5: PIN CITATION FIELDS FROM THE REGISTRY + VERIFY QUOTES.
  //
  // FIX 2 (SEC-1, XSS): the model must NOT author the security-sensitive
  // source_url (it renders as an anchor href; a model-emitted javascript:/data:
  // URL would execute). The registry OWNS the citation. We OVERWRITE every
  // recommendation's source_url / source_section / source_version with the
  // matched dose-rule's registry values (falling back to the guideline's first
  // rule). The model still PICKS the rule; the registry stamps the URL.
  //
  // FIX 3 (ADV-4): the model must NOT fabricate a verbatim quote (it renders as a
  // cited blockquote). We VERIFY each quote is a real substring of the
  // guideline's whole_document_text (whitespace/case-normalised). An
  // unverifiable quote is BLANKED so the UI never shows a fake verbatim citation;
  // the recommendation text is kept (it is the model's prose, not a fake quote).
  // ===================================================================
  const citationRule =
    getDoseRule(routedId, classification.dose_rule_id) ??
    guideline.dose_rules[0] ??
    null;
  const verifiedDocText = normalizeForQuoteMatch(guideline.whole_document_text);
  plan = {
    ...plan,
    recommendations: plan.recommendations.map((rec) => {
      const quoteVerified =
        rec.quote.length > 0 &&
        verifiedDocText.includes(normalizeForQuoteMatch(rec.quote));
      return {
        ...rec,
        // FIX 2 — registry-stamped citation (the model's values are discarded).
        source_section: citationRule?.source_section ?? rec.source_section,
        source_version: citationRule?.source_version ?? rec.source_version,
        source_url: citationRule?.source_url ?? rec.source_url,
        // FIX 3 — blank an unverifiable quote (do not render a fabricated one).
        quote: quoteVerified ? rec.quote : "",
      };
    }),
  };

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
