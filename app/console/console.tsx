// app/console/console.tsx
//
// THE STRUCTURED CARE-PARTNER CONSOLE (DESIGN.md UI states) — a two-panel
// workspace, NOT a chatbot. There is no Conversation shell: the layout is
// LEFT = the case (persistent note + facts + confirm-weight), RIGHT = a stepped
// Turn 1 → Turn 2 flow as cards. The judgment→execution seam is on screen and
// persistent (it never scrolls away as it would in a chat thread).
//
// WIRING (the deterministic demo path, X5):
//   1. The reviewer clicks a 1-click demo button — NEVER types. Each button
//      POSTs its prefilled note to /api/turn1.
//   2. Turn 1 renders the differential; a refusal renders amber, a technical
//      error renders red.
//   3. The clinician confirms the surfaced weight (left panel). That ALWAYS runs
//      the turn-1.5 collapse decider (POST /api/turn1.5, phase "decide"):
//        - "ok" (plan short-circuit, 0 model calls) → the "your turn" guideline
//          buttons appear, UNCHANGED from before; the clinician picks one.
//        - "ask" → a SAFETY-CHECK card interrupts (a must-not-miss is unresolved);
//          the guideline buttons stay HIDDEN until it is answered safely.
//        - "abstention" → amber (e.g. suspected epiglottitis); buttons HIDDEN.
//        - "error" → RED; buttons HIDDEN. FAIL CLOSED.
//   4. On the safety question, the clinician's answer POSTs phase "answer". A safe
//      "No" clears the must-not-miss and auto-runs Turn 2; anything else abstains.
//   5. Picking a guideline seeds the CaseState's selected_* and POSTs /api/turn2.
//   6. Turn 2 renders one of its four states (ok / incomplete / abstention /
//      error). The whole chain stays visible above so it shows on camera.
//
// THE FAIL-CLOSED GATE (the load-bearing safety property): the dose-enabling
// guideline buttons (Turn1DecisionGate) render ONLY when `turn15?.status === "ok"`
// is held in state. The default / decide-in-flight / ask / abstention / error
// states are the ABSENCE of that signal → the buttons are NOT in the DOM. There
// is no code path where an error (or any non-ok turn-1.5 state) leaves the buttons
// visible — see `gateOpen` below, the single source of that decision.

"use client";

import { useState } from "react";

import { ShieldAlert, OctagonX } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

import { CasePanel } from "./case-panel";
import { Turn1View, Turn1DecisionGate } from "./turn1-view";
import {
  SafetyCheckCard,
  Turn15Abstention,
  MustNotMissClearedBanner,
} from "./safety-check-card";
import { Turn2View } from "./turn2-view";
import { PhaseLoader, type Phase } from "./phase-loader";
import { DEMO_NOTES, type Turn1Response, type Turn1Success } from "./fixtures";
import type { Turn2Response } from "@/app/api/turn2/route";
import type {
  Turn15Response,
  DiscriminatorAnswer,
} from "@/app/api/turn1.5/route";
import type { CaseState } from "@/lib/case-state";
import { getGuideline } from "@/registry/guidelines";

type Busy =
  | { kind: "turn1" }
  | { kind: "turn15"; phase: Phase }
  | { kind: "turn2"; phase: Phase }
  | null;

export function Console() {
  const [note, setNote] = useState("");
  const [draft, setDraft] = useState(""); // the paste textarea (draft-until-Run).
  const [turn1, setTurn1] = useState<Turn1Response | null>(null);
  const [weightConfirmed, setWeightConfirmed] = useState(false);
  // The turn-1.5 collapse decider's result. THE FAIL-CLOSED SIGNAL: the dose-
  // enabling guideline buttons render iff this is status:"ok" (see gateOpen).
  const [turn15, setTurn15] = useState<Turn15Response | null>(null);
  // The target + discriminators the SERVER identified in the preceding `ask`.
  // The abstention + cleared responses DROP these (they carry only reason/
  // headline/detail), so we RETAIN them here to data-drive the urgent abstention
  // and cleared copy — the UI must never name a condition the server didn't.
  // Same staleness discipline as turn15: reset everywhere turn15 resets, so a
  // prior case's target can never leak into a later case's display copy.
  const [lastAsk, setLastAsk] = useState<{
    target: string;
    discriminators: string[];
  } | null>(null);
  const [turn2, setTurn2] = useState<Turn2Response | null>(null);
  const [busy, setBusy] = useState<Busy>(null);

  const turn1Ok: Turn1Success | null = turn1?.status === "ok" ? turn1 : null;

  // THE FAIL-CLOSED GATE — the single source of the dose-enabling decision.
  // The guideline buttons (Turn1DecisionGate) render IFF this is true: i.e. ONLY
  // when the turn-1.5 decider returned status:"ok" (a plan short-circuit, OR a
  // safe answer that cleared the must-not-miss). EVERY other turn-1.5 value —
  // null (initial / decide in flight), "ask", "abstention", "error" — leaves this
  // false, so the buttons are NEVER in the DOM. Modelled as "show ONLY on ok",
  // never "show unless error": an unhandled/new turn-1.5 status fails CLOSED.
  const gateOpen = turn15?.status === "ok";

  // --- Step 1: run turn-1 on a raw note → POST /api/turn1. Resets downstream
  // state. SINGLE PATH for BOTH the demo buttons and the paste textarea — there
  // is no second fetch to /api/turn1, so pasted text is wrapped in the same
  // untrusted-note delimiters (prompts/turn1.ts) as demo notes. The trust
  // boundary is enforced by having exactly one path to the route. ---
  async function runTurn1(rawNote: string) {
    const note = rawNote.trim();
    if (note.length === 0) return;
    setNote(note); // left panel shows what was submitted (draft-until-Run).
    setTurn1(null);
    setTurn15(null);
    setLastAsk(null); // clear the retained ask target — no cross-case leakage.
    setTurn2(null);
    setWeightConfirmed(false);
    setBusy({ kind: "turn1" });
    try {
      const res = await fetch("/api/turn1", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ note }),
      });
      const data = (await res.json()) as Turn1Response;
      setTurn1(data);
    } catch (e) {
      setTurn1({
        status: "error",
        message:
          "Could not reach the turn-1 endpoint. " +
          (e instanceof Error ? e.message : String(e)),
      });
    } finally {
      setBusy(null);
    }
  }

  // --- Step 3: the clinician confirmed the weight → ALWAYS run the turn-1.5
  // collapse decider. Confirming weight is the trust-boundary event that lets the
  // flow proceed past the differential; from here the SERVER decides whether the
  // case collapses to a single guideline (ok), needs a discriminating question
  // (ask), or must abstain. The client NEVER runs the collapse decision. ---
  function onConfirmWeight() {
    setWeightConfirmed(true);
    runTurn15Decide();
  }

  // --- Step 3a: POST /api/turn1.5 phase "decide". On a "plan" the server SHORT-
  // CIRCUITS to status:"ok" with ZERO model calls (Jack's croup behaves exactly
  // as before — the ok-signal opens the guideline gate, the clinician clicks
  // Apply). On "ask" it returns a question; on "abstain"/error it abstains. A
  // thrown/non-parseable response FAILS CLOSED to a turn-1.5 error (buttons stay
  // hidden — see gateOpen). ---
  async function runTurn15Decide() {
    if (!turn1Ok) return;
    setTurn15(null);
    setLastAsk(null); // a fresh decide starts with no retained ask (anti-leak).
    setTurn2(null);
    setBusy({ kind: "turn15", phase: "checking-safety" });
    try {
      const res = await fetch("/api/turn1.5", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phase: "decide", caseState: turn1Ok.caseState }),
      });
      const data = (await res.json()) as Turn15Response;
      setTurn15(data);
      // RETAIN the server-identified target + discriminators ONLY on an ask. The
      // later abstention/cleared responses drop them, so this is the single place
      // they enter state. This is what data-drives the urgent abstention copy.
      if (data.status === "ask") {
        setLastAsk({
          target: data.target,
          discriminators: data.discriminators,
        });
      }
    } catch (e) {
      // FAIL CLOSED: a thrown fetch / parse failure becomes a turn-1.5 error —
      // gateOpen stays false, so the dose-enabling buttons are NEVER shown.
      setTurn15({
        status: "error",
        message:
          "Could not reach the safety-check endpoint. " +
          (e instanceof Error ? e.message : String(e)),
      });
    } finally {
      setBusy(null);
    }
  }

  // --- Step 4: the clinician answered the discriminating question → POST
  // /api/turn1.5 phase "answer". The SERVER flips the evidence + re-decides; the
  // client only renders the result. A safe answer that clears the must-not-miss
  // returns status:"ok" carrying the SERVER-UPDATED CaseState → we auto-run Turn 2
  // against it (the server owns that state). Anything else returns abstention. A
  // thrown/non-ok response FAILS CLOSED to a turn-1.5 error. ---
  async function runTurn15Answer(answer: DiscriminatorAnswer) {
    if (!turn1Ok) return;
    // The pending question was asked about turn1Ok's CaseState (unchanged at the
    // ask phase). Re-post that exact state with the answer; the server re-derives
    // the target deterministically and owns the round increment.
    setBusy({ kind: "turn15", phase: "checking-safety" });
    let data: Turn15Response;
    try {
      const res = await fetch("/api/turn1.5", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          phase: "answer",
          caseState: turn1Ok.caseState,
          answer,
        }),
      });
      data = (await res.json()) as Turn15Response;
    } catch (e) {
      setTurn15({
        status: "error",
        message:
          "Could not reach the safety-check endpoint. " +
          (e instanceof Error ? e.message : String(e)),
      });
      setBusy(null);
      return;
    }
    setTurn15(data);
    setBusy(null);

    // On a safe answer the must-not-miss is CLEARED → auto-run Turn 2 with the
    // SERVER-updated CaseState (it carries the appended Q&A + the bumped round).
    if (data.status === "ok") {
      runTurn2WithCaseState(data.guidelineId, data.caseState);
    }
  }

  // --- Step 5 (clinician-pick path): the clinician picked a guideline from the
  // decision gate → seed selected_* onto turn-1's CaseState → POST /api/turn2. ---
  function runTurn2(guidelineId: string, condition: string) {
    if (!turn1Ok) return;
    // Seed the server-owned CaseState with the clinician's confirmations. The
    // route consumes this verbatim (zero re-extraction).
    const caseState: CaseState = {
      ...turn1Ok.caseState,
      selected_condition: condition,
      selected_guideline_id: guidelineId,
      selected_severity: turn1Ok.extractedFacts.severity,
    };
    runTurn2WithCaseState(guidelineId, caseState);
  }

  // --- Step 5 (shared core): POST a fully-formed CaseState to /api/turn2. Used by
  // BOTH the clinician-pick path (decide→ok) and the auto-run after a safe
  // discriminating answer (answer→ok, where the SERVER owns the CaseState). On the
  // server path we still seed selected_guideline_id + selected_severity if the
  // server left them null, so turn-2's audit always sees the collapse result. ---
  async function runTurn2WithCaseState(
    guidelineId: string,
    incoming: CaseState,
  ) {
    const caseState: CaseState = {
      ...incoming,
      // Preserve the selected_severity seeding through the handoff: the server's
      // answer-ok CaseState may carry null severity, so fall back to turn-1's.
      selected_guideline_id: incoming.selected_guideline_id ?? guidelineId,
      selected_severity:
        incoming.selected_severity ?? turn1Ok?.extractedFacts.severity ?? null,
      // Seed selected_condition so turn-2's auditRoutedGuideline sees a non-empty
      // condition. On the clinician-pick path this is already set; on the answer-ok
      // auto-run path the server CaseState leaves it null, so we derive it from the
      // registry (the canonical source — same string norm() will normalize).
      selected_condition:
        incoming.selected_condition ??
        getGuideline(guidelineId)?.condition ??
        null,
    };

    setTurn2(null);
    setBusy({ kind: "turn2", phase: "retrieving-guideline" });
    try {
      // Drive the phase labels off the request lifecycle (the route is not
      // token-streamed). A short, honest sequence: retrieve → dose → complete.
      const res = await fetch("/api/turn2", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ caseState }),
      });
      setBusy({ kind: "turn2", phase: "checking-completeness" });
      const data = (await res.json()) as Turn2Response;
      setTurn2(data);
    } catch (e) {
      setTurn2({
        status: "error",
        message:
          "Could not reach the turn-2 endpoint. " +
          (e instanceof Error ? e.message : String(e)),
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
      {/* Header. */}
      <header className="mb-5 flex items-center gap-3 border-b pb-4">
        <div className="flex size-9 items-center justify-center rounded-lg bg-primary font-bold text-primary-foreground">
          H
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Care Partner Console
          </h1>
          <p className="text-sm text-muted-foreground">
            Clinical decision support · judgment up, execution down
          </p>
        </div>
      </header>

      {/* 1-click demo buttons — the deterministic on-camera path (X5). Grouped
          Notes vs Transcripts so the weight-present/weight-absent transcript pair
          reads as a deliberate parsing-vs-refusal contrast, not a button wall. */}
      <section data-testid="demo-buttons" className="mb-5">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Demo cases — one click, no typing
        </p>
        <div className="space-y-3">
          {(["note", "transcript"] as const).map((group) => (
            <div key={group}>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
                {group === "note" ? "Notes" : "Transcripts"}
              </p>
              {/* Grid (was flex-wrap) so the 4-card notes group lays out cleanly
                  at every breakpoint: 1-col mobile, 2x2 tablet (no orphan row),
                  4-col desktop. Transcripts group has 2 cards so 2-col tablet
                  also reads tidy. */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {DEMO_NOTES.filter((d) => d.group === group).map((demo) => (
                  <div key={demo.id} className="flex flex-col">
                    <Button
                      variant="outline"
                      data-demo-id={demo.id}
                      disabled={busy !== null}
                      onClick={() => runTurn1(demo.note)}
                      // min-h 44px: real touch target for a reviewer on a tablet.
                      className="h-auto min-h-[44px] py-2"
                    >
                      {demo.label}
                    </Button>
                    {/* Caption carries real clinical info (case + expected dose),
                        so it must be legible: 12px + AA-contrast colour. */}
                    <span className="mt-1 text-xs leading-tight text-foreground/70">
                      {demo.caption}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Paste-your-own — proves "accepts unstructured clinical text (note
          AND/OR transcript)" WITHOUT removing the no-typing demo path. Routed
          through the SAME runTurn1(note) → /api/turn1, so pasted text gets the
          same untrusted-note delimiters (no bypass). Draft-until-Run: typing
          here does not touch the left-panel case until Run. */}
      <section data-testid="paste-own" className="mb-5 border-t pt-4">
        <label
          htmlFor="paste-note"
          className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground"
        >
          Or paste your own note or transcript
        </label>
        <Textarea
          id="paste-note"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          // Cmd/Ctrl+Enter runs it — reviewers expect a keyboard submit.
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              if (draft.trim() && busy === null) runTurn1(draft);
            }
          }}
          disabled={busy !== null}
          rows={4}
          aria-describedby="paste-help"
          placeholder="Paste a free-text clinical note or a doctor-patient transcript, then Run. It flows through the same untrusted-note boundary as the demos."
          className="resize-y text-sm"
        />
        <div className="mt-2 flex items-center gap-3">
          <Button
            data-testid="paste-run"
            disabled={busy !== null || draft.trim().length === 0}
            onClick={() => runTurn1(draft)}
            className="h-auto min-h-[44px] py-2"
          >
            Run
          </Button>
          <span id="paste-help" className="text-xs text-muted-foreground">
            Same engine as the demos · ⌘/Ctrl+Enter to run · weightless input
            triggers the refusal gate.
          </span>
        </div>
      </section>

      {/* Two-panel grid: LEFT case · RIGHT stepped flow. */}
      <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-[300px_1fr]">
        {/* LEFT — the case. */}
        <CasePanel
          note={note}
          facts={turn1Ok?.extractedFacts ?? null}
          weightConfirmed={weightConfirmed}
          // Confirming weight ALWAYS runs the turn-1.5 collapse decider (step 3).
          onConfirmWeight={onConfirmWeight}
        />

        {/* RIGHT — stepped Turn 1 → Turn 2. */}
        <div className="space-y-4">
          {turn1 === null && busy === null && (
            <div className="rounded-xl border border-dashed bg-muted/20 p-8 text-center text-sm text-muted-foreground">
              Pick a demo case above to start. Turn 1 builds the differential;
              you confirm the weight and select a guideline; Turn 2 applies it.
            </div>
          )}

          {busy?.kind === "turn1" && (
            <PhaseLoader phase="building-differential" />
          )}

          {/* Turn-1 amber refusal (DELIBERATE ABSTENTION). */}
          {turn1?.status === "refusal" && (
            <Alert variant="safety" data-testid="turn1-refusal">
              <ShieldAlert />
              <AlertTitle className="flex items-center gap-2">
                <span className="font-mono text-[11px] tracking-wide">
                  DELIBERATE ABSTENTION
                </span>
              </AlertTitle>
              <AlertDescription className="text-[13px] font-semibold text-safety-foreground">
                {turn1.message}
              </AlertDescription>
            </Alert>
          )}

          {/* Turn-1 RED technical error. */}
          {turn1?.status === "error" && (
            <Alert variant="destructive" data-testid="turn1-error">
              <OctagonX />
              <AlertTitle>Technical error</AlertTitle>
              <AlertDescription>{turn1.message}</AlertDescription>
            </Alert>
          )}

          {/* Turn-1 success — the differential (JUDGMENT). Always safe to show:
              it enables nothing. The dose-enabling buttons are a SEPARATE,
              gated element below (Turn1DecisionGate). Layout order:
              1 header → differential → safety-check (ask) → guideline gate (ok
              only) → Turn 2. */}
          {turn1Ok && <Turn1View turn1={turn1Ok} />}

          {/* Turn-1.5 phase label while the collapse decider runs (decide OR
              answer). The only phase that may call the model is "ask". */}
          {busy?.kind === "turn15" && <PhaseLoader phase={busy.phase} />}

          {/* Turn-1.5 "ask" — the SAFETY-CHECK card interrupts BETWEEN the
              differential and the guideline buttons. While it is on screen the
              dose-enabling buttons are NOT rendered (gateOpen is false). */}
          {turn15?.status === "ask" && (
            <SafetyCheckCard
              target={turn15.target}
              question={turn15.question}
              onAnswer={runTurn15Answer}
              busy={busy !== null}
            />
          )}

          {/* Turn-1.5 amber abstention — e.g. SUSPECTED EPIGLOTTITIS. The machine
              reason stays no_matching_guideline; the DISPLAY copy is DATA-DRIVEN
              from the condition the SERVER identified in the prior ask (lastAsk),
              never hardcoded — the honesty invariant. When there was no prior ask
              the component falls back to the SERVER's own headline/detail. The
              dose buttons are NOT rendered here (gateOpen is false). */}
          {turn15?.status === "abstention" && (
            <Turn15Abstention
              target={lastAsk?.target ?? null}
              discriminators={lastAsk?.discriminators ?? []}
              serverHeadline={turn15.headline}
              serverDetail={turn15.detail}
            />
          )}

          {/* Turn-1.5 RED technical error (FAIL CLOSED). A silent turn-1.5 failure
              lands HERE — and because gateOpen keys ONLY on status:"ok", the dose
              buttons are NOT rendered while this error is shown. */}
          {turn15?.status === "error" && (
            <Alert variant="destructive" data-testid="turn15-error">
              <OctagonX />
              <AlertTitle>Technical error</AlertTitle>
              <AlertDescription>{turn15.message}</AlertDescription>
            </Alert>
          )}

          {/* THE GATE. The dose-enabling guideline buttons render ONLY when
              gateOpen (turn-1.5 status:"ok"). On an answer-ok we ALSO surface the
              must-not-miss CLEARED banner before Turn 2 auto-runs. */}
          {turn1Ok && gateOpen && (
            <>
              {turn15?.status === "ok" &&
                turn15.provenance.phase === "answer" && (
                  // Cleared banner — the ruled-out condition NAME is templated
                  // from the prior ask's target (lastAsk), not hardcoded.
                  <MustNotMissClearedBanner target={lastAsk?.target ?? null} />
                )}
              <Turn1DecisionGate
                turn1={turn1Ok}
                weightConfirmed={weightConfirmed}
                busy={busy?.kind === "turn2" || busy?.kind === "turn15"}
                onSelectGuideline={runTurn2}
              />
            </>
          )}

          {/* Turn-2 phase labels while applying. */}
          {busy?.kind === "turn2" && <PhaseLoader phase={busy.phase} />}

          {/* Turn-2 result — all four states handled by the view. */}
          {turn2 && <Turn2View result={turn2} />}
        </div>
      </div>
    </main>
  );
}
