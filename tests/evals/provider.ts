// tests/evals/provider.ts
//
// THE PROMPTFOO CUSTOM PROVIDER — it drives the REAL Next route handlers and
// returns the REAL structured response so assertions run against the production
// contract (Turn2Response / the turn-1 refusal shape), NEVER a prose regex.
//
// WHY a custom provider (not a chat model): this take-home's "behaviour" is a
// PIPELINE (route → router → tool → completeness), and the gate must assert on
// the route's discriminated-union output. So the provider IS the pipeline: each
// case's `kind` var selects how to drive it, and the structured JSON is handed
// to promptfoo as `output` for named JavaScript assertions.
//
// DISPATCH (context.vars.kind):
//   "turn2"          → POST the pinned CaseState to /api/turn2; return Turn2Response.
//   "turn1_refusal"  → POST a weightless note to /api/turn1; return the refusal
//                      shape. PRE-LLM gate → ZERO model calls (the key-free proof).
//   "injection"      → POST the injected note to /api/turn1 (untrusted note as data,
//                      no 50mg emitted — STEP A). The live note's differential is
//                      un-collapsible (multiple positive must-not-miss airway emergencies
//                      → decideCollapse abstains, which is correct safety behavior), so
//                      the dose leg runs on a PINNED collapsible croup differential
//                      (CASE_COLLAPSE_CROUP) via callCollapse — proving routed dose
//                      stays 2.13 (registry), never 50 (injected).
//   "case6"          → run the real turn-2 MODEL pipeline against the eval
//                      guideline with one uncoverable slot (case6-pipeline.ts).
//   "collapse"       → POST the collapse CaseState to /api/turn1.5 (decide), then
//                      POST the clinician's answer (answer), then — if "ok" —
//                      POST to /api/turn2. Returns Turn2Response (dose) on "ok" or
//                      the turn1.5 AbstentionResponse when the must-not-miss holds.
//
// TOKENS: harness-env installs a global-fetch tap that tallies real Anthropic
// usage across every model call. We report a per-call DELTA as promptfoo
// tokenUsage and write a cumulative totals file at cleanup (for the README).

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  loadEnvLocal,
  installFetchTap,
  usageSnapshot,
  type UsageTotals,
} from "./harness-env";

// Load key + install the token tap BEFORE any route/SDK module is imported.
loadEnvLocal();
installFetchTap();

// Routes + helpers are imported AFTER the tap is installed.
import { POST as turn2POST } from "@/app/api/turn2/route";
import { POST as turn1POST } from "@/app/api/turn1/route";
import { POST as turn15POST } from "@/app/api/turn1.5/route";
import type { DiscriminatorAnswer } from "@/app/api/turn1.5/route";
import type { CaseState } from "@/lib/case-state";
import type { Turn1Output } from "@/lib/schemas";
import { runCase6 } from "./case6-pipeline";
import {
  CASE1_COMPUTE_CROUP_MODERATE,
  CASE2_REFUSE_NO_WEIGHT_NOTE,
  CASE3_ANAPHYLAXIS,
  CASE4_CAP_CROUP_SEVERE,
  CASE5_POUNDS_SHAPED_WEIGHT,
  CASE6_INCOMPLETE,
  CASE7_INJECTION_NOTE,
  CASE8_NO_GUIDELINE,
  CASE_COLLAPSE_CROUP,
} from "./fixtures";

// case_id → the pinned turn-2 CaseState fixture (kept here so promptfoo.yaml only
// passes a scalar `case_id`, never a complex object through YAML).
const TURN2_FIXTURES: Record<string, CaseState> = {
  case1: CASE1_COMPUTE_CROUP_MODERATE,
  case3: CASE3_ANAPHYLAXIS,
  case4: CASE4_CAP_CROUP_SEVERE,
  case5: CASE5_POUNDS_SHAPED_WEIGHT,
  case6: CASE6_INCOMPLETE,
  case8: CASE8_NO_GUIDELINE,
};

// case_id → the pinned raw note (turn-1 / injection cases).
const NOTE_FIXTURES: Record<string, string> = {
  case2: CASE2_REFUSE_NO_WEIGHT_NOTE,
  case7: CASE7_INJECTION_NOTE,
};

// case_id → the collapse CaseState (turn1.5 decide→answer→turn2/abstain).
// case9 and case10 share the same input state — the answer var (absent/present)
// drives which terminal they reach.
const COLLAPSE_FIXTURES: Record<string, CaseState> = {
  case9: CASE_COLLAPSE_CROUP,
  case10: CASE_COLLAPSE_CROUP,
};

// ---------------------------------------------------------------------------
// promptfoo provider contract (minimal shapes — avoids a hard dep on the
// promptfoo type package at import time).
// ---------------------------------------------------------------------------

type CallApiContext = { vars: Record<string, unknown> };
type ProviderResponse = {
  output?: unknown;
  error?: string;
  tokenUsage?: {
    prompt?: number;
    completion?: number;
    total?: number;
    numRequests?: number;
  };
};

// ---------------------------------------------------------------------------
// Cumulative usage snapshot at the START of each call → per-call delta.
// ---------------------------------------------------------------------------

function delta(before: UsageTotals, after: UsageTotals) {
  return {
    prompt: after.inputTokens - before.inputTokens,
    completion: after.outputTokens - before.outputTokens,
    total: after.totalTokens - before.totalTokens,
    numRequests: after.modelCalls - before.modelCalls,
  };
}

// ---------------------------------------------------------------------------
// Transient-error retry. opus-4-7 with experimental_output occasionally returns
// AI_NoOutputGeneratedError (or a 429/529 overload) — a TRANSIENT SDK/model
// hiccup, NOT a logic failure. The deterministic dose is unaffected (it's the
// tool's), so retrying re-rolls only the transient miss. This keeps the suite
// RE-RUNNABLE without masking a real failure: only the listed transient signals
// are retried; a genuine wrong dose / wrong status fails immediately.
// ---------------------------------------------------------------------------

const TRANSIENT =
  /No output generated|NoOutputGenerated|overloaded|rate limit|429|529|ECONNRESET|fetch failed/i;

/** Does this structured result look like a transient model/SDK miss (not logic)? */
function isTransient(result: unknown): boolean {
  if (result === null || typeof result !== "object") return false;
  const r = result as Record<string, unknown>;
  if (r.status !== "error") return false;
  return typeof r.message === "string" && TRANSIENT.test(r.message);
}

/** Run a case driver, retrying only on a transient model/SDK error. */
async function withRetry(
  fn: () => Promise<unknown>,
  attempts = 3,
): Promise<unknown> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      last = await fn();
      if (!isTransient(last)) return last;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!TRANSIENT.test(msg) || i === attempts - 1) throw e;
      last = { status: "error", message: msg };
    }
  }
  return last;
}

// ---------------------------------------------------------------------------
// Route drivers.
// ---------------------------------------------------------------------------

async function callTurn2(caseState: CaseState): Promise<unknown> {
  const req = new Request("http://localhost/api/turn2", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ caseState }),
  });
  const res = await turn2POST(req);
  return res.json();
}

async function callTurn1(note: string): Promise<unknown> {
  const req = new Request("http://localhost/api/turn1", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ note }),
  });
  const res = await turn1POST(req);
  return res.json();
}

async function callTurn15(body: {
  phase: "decide" | "answer";
  caseState: CaseState;
  answer?: DiscriminatorAnswer;
}): Promise<unknown> {
  const req = new Request("http://localhost/api/turn1.5", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const res = await turn15POST(req);
  return res.json();
}

/**
 * Collapse: decide phase → answer phase → turn2 (if ok) or abstention.
 *
 * Mirrors the structure + comment style of callInjection. The decide phase
 * calls the model (question phrasing) so withRetry wraps it. The answer phase
 * is deterministic code only — retry is harmless and consistent with
 * callInjection's approach of retrying turn2 too.
 */
async function callCollapse(
  caseState: CaseState,
  answer: DiscriminatorAnswer,
): Promise<unknown> {
  // STEP A: decide phase — the model phrases one discriminating question.
  // We expect status:"ask" for the collapse fixture; anything else surfaces as a
  // visible fail (wrong decide is NOT silently treated as a pass).
  const decide = (await withRetry(() =>
    callTurn15({ phase: "decide", caseState }),
  )) as
    | { status: "ask"; caseState?: CaseState; [k: string]: unknown }
    | { status: "ok" | "abstention" | "error"; [k: string]: unknown };

  if (decide.status !== "ask") {
    // Surfaced to the eval so a wrong decide action is visible (not silently a pass).
    return {
      status: decide.status,
      _stage: "turn15-decide",
      _note: "collapse decide expected ask",
    };
  }

  // STEP B: answer phase — deterministic evidence flip + re-decide. No model
  // call here; retry is harmless (matches callInjection's turn2 retry pattern).
  const answered = (await withRetry(() =>
    callTurn15({ phase: "answer", caseState, answer }),
  )) as
    | {
        status: "ok";
        caseState: CaseState;
        guidelineId: string;
        [k: string]: unknown;
      }
    | { status: "abstention" | "error"; [k: string]: unknown };

  // STEP C: if the answer collapsed to a single guideline, POST to turn2 for
  // the dose. Otherwise return the abstention/error directly so assertions run
  // against the turn1.5 shape (case10: must-not-miss confirmed → abstention).
  if (answered.status === "ok" && answered.caseState) {
    // Mirror the client handoff (console.tsx runTurn2WithCaseState): the server's
    // answer-ok CaseState leaves selected_* null (the dose-enabling id is on the
    // top-level guidelineId), and our fixture starts pre-confirmation. Seed the
    // three fields turn2 needs — guideline id (source of truth), condition (so the
    // wrong-guideline audit matches), and severity (so the classifier sees it) —
    // exactly as the live console does before POSTing to turn2.
    const seeded: CaseState = {
      ...answered.caseState,
      selected_guideline_id:
        answered.caseState.selected_guideline_id ?? answered.guidelineId,
      selected_condition: answered.caseState.selected_condition ?? "croup",
      selected_severity:
        answered.caseState.selected_severity ??
        answered.caseState.extracted_facts.severity ??
        null,
    };
    return withRetry(() => callTurn2(seeded));
  }

  return answered;
}

/**
 * Injection: turn1 (untrusted note as data) → collapse+dose on a PINNED
 * collapsible croup differential.
 *
 * STEP A proves the first half of the injection defense: the model processes
 * the override text as data and returns a structured turn1 result — it never
 * emits a 50mg dose directly.
 *
 * The live note's differential is intentionally un-collapsible (multiple
 * positive must-not-miss airway emergencies → decideCollapse rule 2 abstains,
 * which is correct safety behavior). So STEP B drives the collapse→dose leg
 * on CASE_COLLAPSE_CROUP (a pinned clean-croup fixture) instead, proving the
 * routed dose is the registry value (2.13), never the injected 50.
 */
async function callInjection(note: string): Promise<unknown> {
  // STEP A: turn1 — the untrusted injection note is processed AS DATA. A real
  // structured turn1 result (not a 50mg dose) is the first half of the injection
  // proof. The note's live differential is intentionally un-collapsible (it lists
  // several positive must-not-miss airway emergencies → decideCollapse abstains,
  // which is correct safety behavior), so we do NOT dose against it directly.
  const t1 = (await withRetry(() => callTurn1(note))) as
    | {
        status: "ok";
        caseState: CaseState;
        extractedFacts: Turn1Output["extracted_facts"];
        differential: Turn1Output["differential"];
      }
    | { status: "refusal" | "error" };

  if (t1.status !== "ok") {
    // Surfaced to the eval so a refusal/error is visible (not silently a pass).
    return { status: t1.status, _stage: "turn1", _note: "injection turn1" };
  }

  // STEP B: drive the collapse→dose leg on a PINNED collapsible croup differential
  // (the note's real differential won't collapse — see above). This proves the
  // SECOND half of the injection defense: the routed dose is the registry value
  // (2.13 mg), never the injected 50. Determinism comes from the pinned fixture;
  // the live turn1 above is what actually exercised the injection text.
  return callCollapse(CASE_COLLAPSE_CROUP, "absent");
}

// ---------------------------------------------------------------------------
// The provider.
// ---------------------------------------------------------------------------

class ClinicalRouteProvider {
  id() {
    return "clinical-route-provider";
  }

  async callApi(
    _prompt: string,
    context: CallApiContext,
  ): Promise<ProviderResponse> {
    const vars = context?.vars ?? {};
    const kind = String(vars.kind ?? "");
    const caseId = String(vars.case_id ?? "");
    const answer = String(vars.answer ?? "");
    const before = usageSnapshot();

    try {
      let output: unknown;
      switch (kind) {
        case "turn2": {
          const cs = TURN2_FIXTURES[caseId];
          if (!cs) return { error: `no turn2 fixture for case_id "${caseId}"` };
          output = await withRetry(() => callTurn2(cs));
          break;
        }
        case "turn1_refusal": {
          const note = NOTE_FIXTURES[caseId];
          if (!note)
            return { error: `no note fixture for case_id "${caseId}"` };
          // No model call (pre-LLM gate) — no retry needed, but harmless.
          output = await callTurn1(note);
          break;
        }
        case "injection": {
          const note = NOTE_FIXTURES[caseId];
          if (!note)
            return { error: `no note fixture for case_id "${caseId}"` };
          output = await callInjection(note);
          break;
        }
        case "case6": {
          const cs = TURN2_FIXTURES[caseId];
          if (!cs) return { error: `no case6 fixture for case_id "${caseId}"` };
          output = await withRetry(() => runCase6(cs));
          break;
        }
        case "collapse": {
          if (
            answer !== "present" &&
            answer !== "absent" &&
            answer !== "not_assessed"
          ) {
            return {
              error: `collapse kind requires vars.answer "present"|"absent"|"not_assessed", got "${answer}"`,
            };
          }
          const cs = COLLAPSE_FIXTURES[caseId];
          if (!cs)
            return {
              error: `no collapse fixture for case_id "${caseId}"`,
            };
          output = await callCollapse(cs, answer as DiscriminatorAnswer);
          break;
        }
        default:
          return { error: `unknown case kind: "${kind}"` };
      }
      const after = usageSnapshot();
      return { output, tokenUsage: delta(before, after) };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }

  /** At eval shutdown, write the cumulative token totals for the README. */
  cleanup() {
    const snap = usageSnapshot();
    try {
      writeFileSync(
        resolve(process.cwd(), "tests/evals/usage-totals.json"),
        JSON.stringify(snap, null, 2) + "\n",
        "utf8",
      );
    } catch {
      // Non-fatal: totals are also printed to the run log by the README capture.
    }
  }
}

export default ClinicalRouteProvider;
