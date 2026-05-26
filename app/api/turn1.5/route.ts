// app/api/turn1.5/route.ts
//
// TURN 1.5 — THE COLLAPSE DECIDER. THE P0 KEYSTONE: this route is the SINGLE,
// SERVER-SIDE decider for BOTH rounds of the discriminate→narrow loop. The
// browser NEVER runs the collapse decision: it does NOT call applyAnswer +
// re-decideCollapse and then hit turn2 on its own. The dose-ENABLING decision
// (does this case collapse to a single guideline we may dose against?) lives
// HERE, on the server, where the deterministic core (lib/collapse) and the
// registry are the only authorities. The client only RENDERS what this route
// returns (P0, Decision #9).
//
// ════════════════════════════════════════════════════════════════════════════
//   THE BOUNDARY (commented at each step):
//     JUDGMENT (model)  : PHRASE one discriminating question (ask phase only).
//     EXECUTION (code)  : decideCollapse, applyAnswer, the round counter, the
//                         CaseState rebuild, every plan/abstain terminal.
//   The model's ONLY job in this turn is to phrase a question — it never decides
//   ask-vs-plan-vs-abstain, never flips evidence, never increments a round. Those
//   are deterministic code paths in lib/collapse (a locked PURE module). turn1.5
//   NEVER re-reads the untrusted note — CaseState carries only note_hash + the
//   confirmed structured facts.
// ════════════════════════════════════════════════════════════════════════════
//
// TWO PHASES, discriminated on an EXPLICIT literal `phase` (never on the
// presence/absence of an `answer` field — that would be a fragile implicit
// switch):
//
//   phase "decide"  ({ phase, caseState }):
//     build the condition→guideline map → decideCollapse(differential, map,
//     round). The three collapse actions map to three terminals:
//       - "ask"     → ONE bounded model call to phrase the question →
//                     { status:"ask", question, target, discriminators }.
//       - "plan"    → SHORT-CIRCUIT, NO model call → { status:"ok", guidelineId,
//                     caseState } (caseState unchanged at this phase).
//       - "abstain" → NO model call → { status:"abstention", ... }.
//
//   phase "answer"  ({ phase, caseState, answer }) where answer is the CLOSED
//     enum "present" | "absent" | "not_assessed":
//       the server runs applyAnswer(differential, target, discriminators,
//       present) — `present` DERIVES from the enum (see DISCRIMINATOR_ANSWER) —
//       then re-decideCollapse(round + 1) (the round is incremented SERVER-side).
//       The result is a terminal { status:"ok", guidelineId, caseState } (the
//       server-owned updated CaseState, with the Q&A appended + the round bumped)
//       OR { status:"abstention", ... }. The client NEVER decides dosing. NOTE:
//       a re-decide after an answer can itself want to "ask" again, but the
//       round was incremented to MAX_ROUNDS, so decideCollapse rule 6 abstains
//       instead of asking a second time (fail toward stopping).
//
// RESULT MODEL (discriminated by `status`, standardised on turn2's vocabulary):
//   "ask"         — a question for the clinician (turn-1.5-specific sub-shape).
//   "ok"          — the case collapsed to a single guideline we may dose against.
//   "abstention"  — amber deliberate abstention (the unified Abstention shape).
//   "error"       — RED technical error (bad body, oversized body, model fail).

import { NextResponse } from "next/server";
import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText, Output, stepCountIs } from "ai";

import {
  decideCollapse,
  applyAnswer,
  demoteSharedFindings,
  type ConditionGuidelineMap,
} from "@/lib/collapse";
import { buildConditionGuidelineMap } from "@/registry/guidelines";
import {
  noGuidelineAbstention,
  unresolvedDangersAbstention,
} from "@/lib/refusal-gate";
import { withTransientRetry } from "@/lib/retry";
import {
  fromRefusalDecision,
  toAbstentionResponse,
  type Abstention,
  type AbstentionResponse,
} from "@/lib/plan-schema";
import {
  DiscriminatingQuestion,
  buildQuestionSystemPrompt,
  buildQuestionUserPrompt,
  type ConfirmedFactsSummary,
} from "@/prompts/turn1.5";
import { isCaseStateLike, type CaseState } from "@/lib/case-state";
import type { Differential } from "@/lib/schemas";

// Node runtime (NOT edge): the SDK needs it. maxDuration 300s matches turn1/turn2.
export const runtime = "nodejs";
export const maxDuration = 300;

const MODEL = "claude-opus-4-7";
// Cost discipline: this is a one-sentence question — keep the budget tiny.
const QUESTION_MAX_OUTPUT_TOKENS = 300;

// Body-size cap (mirrors turn2's ADV-6 guard): a CaseState is small structured
// data, so 64 KB is generous headroom while still rejecting an oversized payload
// BEFORE we parse it or drive a model call. Spend/DoS guard on a key-spending route.
const MAX_TURN15_BODY_BYTES = 64 * 1024;

// ---------------------------------------------------------------------------
// The CLOSED discriminator-answer enum + its mapping to applyAnswer's `present`.
//
// SAFETY-CRITICAL — read the rationale before touching the `not_assessed` row.
//
//   present       → present:true   (the finding is THERE).
//   absent        → present:false  (the finding is confirmed ABSENT → narrows dx).
//   not_assessed  → present:TRUE   (NOT false — fail CLOSED).
//
// Why not_assessed maps to TRUE: "we don't know if the dangerous finding is
// there" must be treated IDENTICALLY to "it might be there." applyAnswer(true)
// keeps the must-not-miss in its band and moves the named findings INTO
// positive_evidence — so the must-not-miss now has positive evidence, and the
// downstream decideCollapse rule 2 (positive/unresolved must-not-miss) ABSTAINS.
// That is the intended "not assessed → abstain" outcome.
//
// Mapping not_assessed to FALSE would instead route through applyAnswer's
// present:false path, which (when discriminators actually flip) DEMOTES the
// must-not-miss out of its band to "possible" — making it look RESOLVED and
// letting decideCollapse reach "plan", ENABLING a dose without ruling out the
// danger. That is the exact false-negative this whole beat exists to prevent.
// So not_assessed must be true. Do NOT "simplify" this to false.
// ---------------------------------------------------------------------------
export type DiscriminatorAnswer = "present" | "absent" | "not_assessed";

const DISCRIMINATOR_ANSWERS: readonly DiscriminatorAnswer[] = [
  "present",
  "absent",
  "not_assessed",
];

/** Derive applyAnswer's `present` boolean from the closed answer enum. See the
 *  safety rationale above: `not_assessed` is true (fail closed), NOT false. */
function presentFromAnswer(a: DiscriminatorAnswer): boolean {
  // present → true; absent → false; not_assessed → true (fail closed).
  return a !== "absent";
}

// ---------------------------------------------------------------------------
// Request + response contracts (route-local exports, matching turn2's
// convention of exporting its response union from the route file).
// ---------------------------------------------------------------------------

/** The decide-phase body: ask the collapse core what to do for this CaseState. */
export type Turn15DecideRequest = {
  phase: "decide";
  caseState: CaseState;
};

/** The answer-phase body: the clinician answered the discriminating question. */
export type Turn15AnswerRequest = {
  phase: "answer";
  caseState: CaseState;
  answer: DiscriminatorAnswer;
};

/** The full turn-1.5 request union (discriminated by `phase`). */
export type Turn15Request = Turn15DecideRequest | Turn15AnswerRequest;

/** The visible decision seam: what the decider did + on what target (audit). */
type Turn15Provenance = {
  /** Which phase ran ("decide" | "answer"). */
  phase: "decide" | "answer";
  /** The collapse action the deterministic core returned. */
  action: "ask" | "plan" | "abstain";
  /** The must-not-miss target asked about (ask phase) — null otherwise. */
  target: string | null;
  /** The round the decision was made at (server-owned counter). */
  round: number;
};

/** "ask": a discriminating question for the clinician (turn-1.5-specific). */
export type AskResponse = {
  status: "ask";
  /** The model-phrased question. RENDER-SIDE NOTE: this is model-authored and
   *  MUST be escaped on render (Task 9/10) — it is NOT pre-escaped here. */
  question: string;
  /** The must-not-miss condition the question discriminates. */
  target: string;
  /** The discriminating findings the question asks about. */
  discriminators: string[];
  provenance: Turn15Provenance;
};

/** "ok": the case collapsed to a single guideline we may now dose against. */
export type OkResponse = {
  status: "ok";
  /** The guideline_id the case collapsed to (turn2 will dose against it). */
  guidelineId: string;
  /** The server-owned CaseState (UNCHANGED on a decide-plan; on an answer it
   *  carries the appended Q&A + the incremented round). */
  caseState: CaseState;
  provenance: Turn15Provenance;
};

/** "error": RED technical error (bad body, oversized body, model/parse fail). */
export type TechnicalErrorResponse = {
  status: "error";
  message: string;
};

/** The full turn-1.5 response union (discriminated by `status`). */
export type Turn15Response =
  | AskResponse
  | OkResponse
  | AbstentionResponse
  | TechnicalErrorResponse;

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

/** Normalise a CaseState's server-owned counters: a hand-crafted / pre-turn1.5
 *  POST may omit round / discriminating_qa, so default them defensively. */
function withDefaultedCounters(c: CaseState): CaseState {
  return {
    ...c,
    round: typeof c.round === "number" ? c.round : 0,
    discriminating_qa: Array.isArray(c.discriminating_qa)
      ? c.discriminating_qa
      : [],
  };
}

/** Build the model-facing confirmed-facts summary from the CaseState facts. */
function confirmedFactsFrom(caseState: CaseState): ConfirmedFactsSummary {
  const facts = caseState.extracted_facts;
  return {
    age: facts.age,
    weight_kg: facts.weight_kg,
    severity: caseState.selected_severity ?? facts.severity,
  };
}

/** The no-matching-guideline abstention, as a wire response. For the
 *  epiglottitis-style collapse (a must-not-miss with no clean single guideline),
 *  the MACHINE reason stays no_matching_guideline (Decision) — the headline/detail
 *  carry the urgency; we reuse the gate copy + adapter rather than hand-rolling. */
function noGuidelineResponse(): AbstentionResponse {
  return toAbstentionResponse(fromRefusalDecision(noGuidelineAbstention()));
}

/** The unresolved-dangers abstention, as a wire response. Fires when the
 *  (post-demote) differential carries a positive must-not-miss (Rule 2) OR
 *  multiple unresolved must-not-miss conditions (Rule 3) — i.e. dangers we
 *  cannot rule out from this note alone. Distinct copy from
 *  noGuidelineResponse: a treatable guideline DOES exist, the data just
 *  doesn't let us safely route to it. */
function unresolvedDangersResponse(): AbstentionResponse {
  return toAbstentionResponse(
    fromRefusalDecision(unresolvedDangersAbstention()),
  );
}

/** Pick the right abstention wire response for a "abstain" decision: name the
 *  WHY (multiple dangers vs no matching guideline) so the UI copy is honest.
 *  Uses the post-demote differential — the same view decideCollapse saw. */
function abstainResponseFor(
  differential: Differential,
  map: ConditionGuidelineMap,
): AbstentionResponse {
  // Mirror decideCollapse's internal predicates (we don't import them to keep
  // collapse.ts's surface minimal): a "danger" is either a positive must-not-
  // miss (Rule 2 trigger) or a count > 1 of unresolved must-not-miss (Rule 3).
  const conditions = differential.conditions;
  const hasPositiveMnm = conditions.some(
    (c) => c.likelihood === "must-not-miss" && c.positive_evidence.length > 0,
  );
  const unresolvedMnmCount = conditions.filter(
    (c) => c.likelihood === "must-not-miss" && c.positive_evidence.length === 0,
  ).length;
  // Treatable-tops count via the same norm spirit as collapse: stripped
  // parentheticals + lowercase. We hash by the registry map's already-
  // normalized keys, so we just have to normalize the differential names
  // the same way (matching lib/collapse.ts norm()).
  const norm = (s: string) =>
    s
      .toLowerCase()
      .trim()
      .replace(/\s*\([^)]*\)\s*$/, "")
      .trim()
      .replace(/\s+/g, " ");
  const treatableTopsCount = conditions.filter(
    (c) =>
      c.likelihood !== "must-not-miss" &&
      Object.prototype.hasOwnProperty.call(map, norm(c.name)),
  ).length;

  // Dangerous-conditions explanation if any danger predicate is true AND we
  // have at least one treatable top (otherwise "no matching guideline" is
  // genuinely the right message — there's no benign hypothesis to route to).
  if (treatableTopsCount > 0 && (hasPositiveMnm || unresolvedMnmCount > 1)) {
    return unresolvedDangersResponse();
  }
  return noGuidelineResponse();
}

// ---------------------------------------------------------------------------
// POST handler.
// ---------------------------------------------------------------------------

export async function POST(req: Request): Promise<Response> {
  // --- Parse + size-cap + phase-validate the body (bad body → red 400/413). ---
  let body: { phase?: unknown; caseState?: unknown; answer?: unknown };
  try {
    // Cap the body BEFORE parsing (mirrors turn2 ADV-6): a huge payload can't be
    // parsed into memory or drive a model call. Oversized → 413, ZERO model calls.
    const rawBody = await req.text();
    if (rawBody.length > MAX_TURN15_BODY_BYTES) {
      const err: TechnicalErrorResponse = {
        status: "error",
        message: "Request too large.",
      };
      return NextResponse.json(err, { status: 413 });
    }
    body = JSON.parse(rawBody) as typeof body;
  } catch {
    const err: TechnicalErrorResponse = {
      status: "error",
      message: "Could not parse request body as JSON.",
    };
    return NextResponse.json(err, { status: 400 });
  }

  // Discriminate on the EXPLICIT literal phase (never on field presence).
  if (body.phase !== "decide" && body.phase !== "answer") {
    const err: TechnicalErrorResponse = {
      status: "error",
      message: "Request must include phase: 'decide' or 'answer'.",
    };
    return NextResponse.json(err, { status: 400 });
  }

  // Validate the CaseState shape (shared guard) for both phases.
  if (!isCaseStateLike(body.caseState)) {
    const err: TechnicalErrorResponse = {
      status: "error",
      message: "Request must include a valid `caseState` object from turn 1.",
    };
    return NextResponse.json(err, { status: 400 });
  }
  const caseState = withDefaultedCounters(body.caseState);

  // EXECUTION: build the condition→guideline map ONCE (the same map both phases
  // pass to decideCollapse — collapse never imports the registry).
  const map = buildConditionGuidelineMap();

  if (body.phase === "decide") {
    return handleDecide(caseState, map);
  }

  // phase === "answer": validate the CLOSED answer enum (else 400).
  if (
    typeof body.answer !== "string" ||
    !DISCRIMINATOR_ANSWERS.includes(body.answer as DiscriminatorAnswer)
  ) {
    const err: TechnicalErrorResponse = {
      status: "error",
      message:
        "Answer phase requires answer: 'present' | 'absent' | 'not_assessed'.",
    };
    return NextResponse.json(err, { status: 400 });
  }
  return handleAnswer(caseState, map, body.answer as DiscriminatorAnswer);
}

// ---------------------------------------------------------------------------
// phase "decide" — run the collapse core; ask / plan / abstain.
// ---------------------------------------------------------------------------

async function handleDecide(
  caseState: CaseState,
  map: ConditionGuidelineMap,
): Promise<Response> {
  // EXECUTION: demote shared findings BEFORE deciding. A finding the live model
  // lists as positive on multiple must-not-miss conditions BECAUSE it is also
  // positive on the leading treatable is shared / non-discriminating — it
  // cannot confirm any one of them. Demoting prevents Rule 2 (positive
  // must-not-miss → abstain) from over-firing on clinically routine fact
  // patterns where one finding (e.g. "stridor at rest") is consistent with
  // both the treatable and several danger conditions. Discriminating findings
  // (only on the danger) are preserved — Rule 2 still triggers correctly.
  const differential = demoteSharedFindings(caseState.differential, map);
  const decision = decideCollapse(differential, map, caseState.round);

  // Audit log of the decision (action + target), mirroring turn2:262.
  console.log(
    `[turn1.5:decide] action=${decision.action} target=${decision.target ?? "(none)"} round=${caseState.round}`,
  );

  const provenance: Turn15Provenance = {
    phase: "decide",
    action: decision.action,
    target: decision.target ?? null,
    round: caseState.round,
  };

  // "abstain" → NO model call. Fail toward stopping. Pick the right copy:
  // "unresolved_dangers" when a treatable hypothesis exists but dangers can't
  // be ruled out; "no_matching_guideline" otherwise (no treatable to route to).
  if (decision.action === "abstain") {
    return NextResponse.json(abstainResponseFor(differential, map));
  }

  // "plan" → SHORT-CIRCUIT, NO model call. The case already collapses to a single
  // guideline; caseState is UNCHANGED at this phase (no Q&A, no round bump).
  if (decision.action === "plan") {
    // guidelineId is guaranteed present on a "plan" decision by the collapse
    // contract; guard defensively (a missing id is a no-guideline abstain).
    if (!decision.guidelineId) {
      return NextResponse.json(noGuidelineResponse());
    }
    const ok: OkResponse = {
      status: "ok",
      guidelineId: decision.guidelineId,
      caseState,
      provenance,
    };
    return NextResponse.json(ok);
  }

  // "ask" → the ONLY phase that calls the model. JUDGMENT (bounded): the model
  // PHRASES one plain-text discriminating question from the FIXED target +
  // discriminators (it does not pick them; collapse did). Sanitization +
  // data-wrapping happen inside the prompt builders (prompts/turn1.5.ts).
  //
  // Collapse-contract-violation guard (fail toward stopping): decideCollapse
  // guarantees target + discriminators are present on action==="ask", but if
  // the contract is ever violated we must NOT call the model with empty inputs.
  if (!decision.target || !decision.discriminators?.length) {
    console.log(
      `[turn1.5:decide] collapse contract violation: ask with no target/discriminators → abstain`,
    );
    return NextResponse.json(noGuidelineResponse());
  }
  const target = decision.target;
  const discriminators = decision.discriminators;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const anthropic = createAnthropic({
    apiKey,
    // Pin /v1 so an ambient ANTHROPIC_BASE_URL without /v1 can't 404 (matches turn2).
    baseURL: "https://api.anthropic.com/v1",
  });

  let question: string;
  try {
    // Bounded transient-only retry (ask phase is the only phase that calls the
    // model). A transient miss is re-rolled up to twice; a Zod parse failure is
    // non-transient → re-thrown on the first attempt → the red catch below.
    const result = await withTransientRetry(async () => {
      const r = await generateText({
        model: anthropic(MODEL),
        // NO temperature: opus-4-7 ignores it (matches turn1/turn2).
        maxOutputTokens: QUESTION_MAX_OUTPUT_TOKENS,
        stopWhen: stepCountIs(1), // single-shot bounded phrasing; no tools.
        system: buildQuestionSystemPrompt(target, discriminators),
        prompt: buildQuestionUserPrompt(
          target,
          discriminators,
          confirmedFactsFrom(caseState),
        ),
        experimental_output: Output.object({ schema: DiscriminatingQuestion }),
      });
      return DiscriminatingQuestion.parse(r.experimental_output).question;
    });
    question = result;
  } catch (e) {
    // Log the full error SERVER-side; return a GENERIC client message (never echo
    // e.message — it can carry provider internals / a leaked key fragment).
    console.error("[turn1.5:decide] question phrasing failed:", e);
    const err: TechnicalErrorResponse = {
      status: "error",
      message: "A technical error occurred while phrasing the question.",
    };
    return NextResponse.json(err, { status: 502 });
  }

  const ask: AskResponse = {
    status: "ask",
    question, // NOT pre-escaped — the render side escapes it (Task 9/10).
    target,
    discriminators,
    provenance,
  };
  return NextResponse.json(ask);
}

// ---------------------------------------------------------------------------
// phase "answer" — flip evidence, re-decide at round+1; ok / abstain. NO model.
// ---------------------------------------------------------------------------

function handleAnswer(
  caseState: CaseState,
  map: ConditionGuidelineMap,
  answer: DiscriminatorAnswer,
): Response {
  // The answer is to the question asked about the must-not-miss target at the
  // CURRENT round. We re-derive the decision at this round to recover the target
  // + discriminators deterministically (the client does NOT send them back — it
  // only renders; the server is the single decider, so it re-derives them).
  // Mirror handleDecide: demote shared findings BEFORE the re-derive so the
  // prior decision matches what decideCollapse returned in the decide phase.
  const priorDifferential = demoteSharedFindings(caseState.differential, map);
  const priorDecision = decideCollapse(priorDifferential, map, caseState.round);

  // Defense-in-depth: the answer phase is only meaningful after an "ask". If the
  // prior decision was NOT an ask (e.g. a client posted an answer out of order),
  // fail toward stopping rather than flip evidence on a target that wasn't asked.
  if (priorDecision.action !== "ask" || !priorDecision.target) {
    console.log(
      `[turn1.5:answer] no pending ask (prior action=${priorDecision.action}) → abstain`,
    );
    return NextResponse.json(noGuidelineResponse());
  }

  const target = priorDecision.target;
  const discriminators = priorDecision.discriminators ?? [];
  const present = presentFromAnswer(answer);

  // EXECUTION: the deterministic evidence flip (the model does NOT re-rank).
  // Apply to the DEMOTED differential so the post-answer state stays consistent
  // with the pre-answer view (no surprise re-introduction of shared findings).
  const updatedDifferential = applyAnswer(
    priorDifferential,
    target,
    discriminators,
    present,
  );

  // EXECUTION: re-decide at round + 1 (the round is incremented SERVER-side; the
  // client never bumps it). At MAX_ROUNDS an unresolved must-not-miss can no
  // longer be asked about → decideCollapse abstains (fail toward stopping).
  const nextRound = caseState.round + 1;
  const decision = decideCollapse(updatedDifferential, map, nextRound);

  console.log(
    `[turn1.5:answer] answer=${answer} present=${present} target=${target} action=${decision.action} round=${nextRound}`,
  );

  // Rebuild the server-owned CaseState by SPREADING the incoming one (we do NOT
  // call buildCaseState — it needs the raw note to re-hash, which this phase does
  // not have; note_hash + every other field stay VERBATIM). We override only:
  //   - differential   : the applyAnswer result.
  //   - round           : incremented server-side.
  //   - discriminating_qa: the Q&A appended. We did NOT re-call the model in this
  //     phase, so no question string is available — we record "" for `question`
  //     (the answer + round are the load-bearing audit fields). Decision: keep
  //     the rebuild honest rather than fabricate a question we never asked here.
  const updatedCaseState: CaseState = {
    ...caseState,
    differential: updatedDifferential,
    round: nextRound,
    discriminating_qa: [
      ...caseState.discriminating_qa,
      { question: "", answer, round: caseState.round },
    ],
  };

  const provenance: Turn15Provenance = {
    phase: "answer",
    action: decision.action,
    target: decision.target ?? null,
    round: nextRound,
  };

  // Terminal: "plan" → ok (collapsed to a single guideline). Anything else
  // (abstain, or a would-be second "ask" the round guard prevents) → abstain.
  if (decision.action === "plan" && decision.guidelineId) {
    const ok: OkResponse = {
      status: "ok",
      guidelineId: decision.guidelineId,
      caseState: updatedCaseState,
      provenance,
    };
    return NextResponse.json(ok);
  }

  // Post-answer abstain: pick the right copy based on the UPDATED differential.
  // If unresolved dangers still exist after the clinician's answer, say so —
  // do not mislead with "no matching guideline" when guidelines exist.
  return NextResponse.json(abstainResponseFor(updatedDifferential, map));
}
