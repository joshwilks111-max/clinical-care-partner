// app/api/turn1/route.ts
//
// TURN 1 — the JUDGMENT half + the TRUST-BOUNDARY entry point. POST a clinical
// note; get back a differential + extracted facts + a server-owned CaseState.
//
// THE FLOW (DESIGN.md "The thesis", "Two-turn HITL"):
//   STEP 1  PRE-LLM REFUSAL GATE — FIRST, before any model call.
//           A weight-MISSING note must refuse with ZERO model calls (the Loom
//           0:00 shot: key-free, reproducible 100/100). Because facts normally
//           come FROM the model, we run a CHEAP DETERMINISTIC weight-presence
//           pre-check on the raw note (a kg-weight regex) to drive the pre-LLM
//           gate. No kg weight detectable → refuse immediately, no SDK touched.
//   STEP 2  MODEL CALL — only if a weight is present. Extract ExtractedFacts +
//           build the Differential as STRUCTURED output (Output.object) with the
//           untrusted note wrapped as DATA (prompts/turn1.ts delimiters).
//   STEP 3  STOP. Return { caseState, differential, extractedFacts,
//           candidateGuidelines } for the UI to render selection buttons + a
//           weight-confirm step. We DO NOT route, dose, or auto-advance to
//           turn 2 here — that is turn 2, which consumes the CaseState verbatim.
//
// ERROR MODEL: a clinical refusal is AMBER (deliberate abstention). A model/SDK
// failure or a Zod parse failure is RED (technical error) — distinct `error`
// shape so the UI never renders "something broke" as a clinical decision.

import { NextResponse } from "next/server";
import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText, Output, stepCountIs } from "ai";
import { refusalGate } from "@/lib/refusal-gate";
import { buildCaseState } from "@/lib/case-state";
import { Turn1Output } from "@/lib/schemas";
import { buildTurn1SystemPrompt, buildTurn1UserPrompt } from "@/prompts/turn1";

// Node runtime (NOT edge): the SDK + node:crypto (CaseState hash) need it.
// maxDuration 300s gives the opus-4-7 call headroom. (DESIGN.md Stack section.)
export const runtime = "nodejs";
export const maxDuration = 300;

const MODEL = "claude-opus-4-7";
const MAX_OUTPUT_TOKENS = 1500; // cost discipline — a differential is small.

// ---------------------------------------------------------------------------
// STEP-1 helper: deterministic PRE-LLM weight-presence pre-check.
//
// HEURISTIC (documented): the pre-LLM gate must fire on a weight-MISSING note
// with NO model call, but the model is what extracts facts. So we cheaply detect
// whether the RAW note plausibly contains a kg weight at all, using a regex for
// a number immediately followed by a kg unit (kg / kgs / kilogram[s]), with an
// optional decimal. Matches "14.2kg", "14.2 kg", "20 kilograms".
//
// This is a PRESENCE check, not extraction: if it matches, we let the MODEL do
// the real, authoritative weight extraction (which can still come back null —
// e.g. pounds-only — and the post-model gate catches that too). If it does NOT
// match, there is no kg weight to dose on, so we refuse with zero model calls.
// We deliberately do NOT try to parse the value here (no estimating, no unit
// conversion) — the gate's only question is "is a kg weight present at all?".
//
// Pounds-only notes ("31 lb") do NOT match → refuse pre-LLM, which is correct:
// we never convert lb→kg, so a pounds-only note has no usable weight (GUARD-2).
const KG_WEIGHT_PRESENT = /\d+(?:\.\d+)?\s*(?:kg|kgs|kilograms?)\b/i;

/**
 * Deterministic, model-free kg-weight presence check. Exported so the unit test
 * can assert the pre-LLM gate's decision WITHOUT a model call (the model-free
 * guarantee is testable: weightless note → hasKgWeight false → STEP 1 refuses
 * before STEP 2's SDK import is ever reached).
 */
export function hasKgWeight(note: string): boolean {
  return KG_WEIGHT_PRESENT.test(note);
}

// ---------------------------------------------------------------------------
// Response shapes (discriminated by `status`) so the UI can branch cleanly.
// ---------------------------------------------------------------------------

type RefusalResponse = {
  status: "refusal";
  reason: string;
  // Clinician-facing amber copy (deliberate abstention).
  message: string;
};

type TechnicalErrorResponse = {
  status: "error";
  // RED technical-error state — distinct from the amber clinical refusal.
  message: string;
};

// ---------------------------------------------------------------------------
// POST handler.
// ---------------------------------------------------------------------------

export async function POST(req: Request): Promise<Response> {
  // --- Parse the note from the request (bad body → red technical error). ---
  let note: string;
  try {
    const body = (await req.json()) as { note?: unknown };
    if (typeof body.note !== "string" || body.note.trim().length === 0) {
      const err: TechnicalErrorResponse = {
        status: "error",
        message: "Request must include a non-empty `note` string.",
      };
      return NextResponse.json(err, { status: 400 });
    }
    note = body.note;
  } catch {
    const err: TechnicalErrorResponse = {
      status: "error",
      message: "Could not parse request body as JSON.",
    };
    return NextResponse.json(err, { status: 400 });
  }

  // ===================================================================
  // STEP 1 — PRE-LLM REFUSAL GATE. Runs BEFORE any model/SDK touch.
  // Deterministic kg-weight presence pre-check → refusalGate. If no kg weight
  // is present, we refuse here with ZERO model calls (the key-free Loom opener).
  // ===================================================================
  if (!hasKgWeight(note)) {
    const decision = refusalGate({ weight_kg: null });
    const refusal: RefusalResponse = {
      status: "refusal",
      reason: decision.reason ?? "weight_missing",
      message: decision.copy,
    };
    // 200: a refusal is a SUCCESSFUL deliberate decision, not an HTTP error.
    return NextResponse.json(refusal);
  }

  // ===================================================================
  // STEP 2 — MODEL CALL (only reached when a kg weight is present).
  // Extract facts + build the differential as STRUCTURED output. The untrusted
  // note is wrapped as DATA via prompts/turn1.ts (the enforced trust boundary).
  // ===================================================================

  // env plumbing (mirrors the spike): pin /v1 so an ambient ANTHROPIC_BASE_URL
  // without /v1 can't cause a 404. (The .env.local BOM was stripped, so the key
  // reads as ANTHROPIC_API_KEY normally — no BOM-prefixed fallback needed.)
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const anthropic = createAnthropic({
    apiKey,
    baseURL: "https://api.anthropic.com/v1",
  });

  let parsed: Turn1Output;
  try {
    const result = await generateText({
      model: anthropic(MODEL),
      // NO temperature: opus-4-7 rejects/ignores it (the SDK warns).
      // Reproducibility comes from structured output + the deterministic
      // downstream tool, not a temperature knob. (DESIGN.md Stack section.)
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      stopWhen: stepCountIs(1), // single-shot structured extraction; no tools.
      system: buildTurn1SystemPrompt(),
      prompt: buildTurn1UserPrompt(note),
      experimental_output: Output.object({ schema: Turn1Output }),
    });

    // Validate the structured output (a parse failure → RED technical state).
    parsed = Turn1Output.parse(result.experimental_output);
  } catch (e) {
    // Model unreachable, SDK error, or Zod parse failure — all RED technical.
    const err: TechnicalErrorResponse = {
      status: "error",
      message:
        "Turn 1 could not produce a structured differential (model or schema error). " +
        (e instanceof Error ? e.message : String(e)),
    };
    return NextResponse.json(err, { status: 502 });
  }

  // Post-model defensive gate: even with a kg weight present in the raw text,
  // the model's authoritative extraction may still be null (e.g. it judged the
  // figure not a usable patient weight). Refuse rather than proceed — never dose
  // on a null weight. (This is NOT a re-extraction; it reads turn-1's output.)
  const postGate = refusalGate({ weight_kg: parsed.extracted_facts.weight_kg });
  if (postGate.refuse) {
    const refusal: RefusalResponse = {
      status: "refusal",
      reason: postGate.reason ?? "weight_missing",
      message: postGate.copy,
    };
    return NextResponse.json(refusal);
  }

  // ===================================================================
  // STEP 3 — STOP. Build the server-owned CaseState (turn 2 consumes it
  // verbatim, re-extracting NOTHING) and return for the UI to render. We do NOT
  // route, dose, or auto-advance — the clinician selects the guideline next.
  // ===================================================================
  const caseState = buildCaseState({
    note,
    extractedFacts: parsed.extracted_facts,
    differential: parsed.differential,
  });

  return NextResponse.json({
    status: "ok",
    caseState,
    differential: parsed.differential,
    extractedFacts: parsed.extracted_facts,
    candidateGuidelines: parsed.differential.candidate_guidelines,
  });
}
