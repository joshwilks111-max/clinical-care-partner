// app/console/console.tsx
//
// The 3-column Bluey shell — state owner only (eng-review lock #3).
//
// Console owns: note, draft, turn1, turn2, weightConfirmed, busy, and the new
// activeDemoId (lock #9). It composes three presentational children:
//
//   <Rail>            — brand block + paste textarea + 6 demo cases.
//   <CaseCanvas>      — CasePanel + turn1 + turn1.5 + decision gate.
//   <EvidencePanel>   — turn2 result (or empty state).
//
// Below the 1100px breakpoint the grid collapses to a single-column banner
// (lock #7, CSS-only — no JS matchMedia, no hydration-mismatch risk).
//
// Clinical behaviour is unchanged from pre-Bluey: same /api/turn1, /api/turn1.5,
// /api/turn2 calls; same CaseState contract; same gateOpen invariant; same
// scroll-into-view on turn-1.5/turn-2 status transitions.

"use client";

import { useEffect, useRef, useState } from "react";

import { Rail } from "./rail";
import { CaseCanvas } from "./case-canvas";
import { EvidencePanel } from "./evidence-panel";
import type { Turn1Response, Turn1Success } from "./fixtures";
import type { Turn2Response } from "@/app/api/turn2/route";
import type { CaseState } from "@/lib/case-state";
import { getGuideline } from "@/registry/guidelines";
import { gateOpen, useTurn15Flow } from "./use-turn15-flow";
import type { Phase } from "./phase-loader";

type Busy =
  | { kind: "turn1" }
  | { kind: "turn15"; phase: Phase }
  | { kind: "turn2"; phase: Phase }
  | null;

export function Console() {
  const [note, setNote] = useState("");
  const [draft, setDraft] = useState("");
  const [turn1, setTurn1] = useState<Turn1Response | null>(null);
  const [weightConfirmed, setWeightConfirmed] = useState(false);
  const [turn2, setTurn2] = useState<Turn2Response | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  // activeDemoId — eng-review lock #9. Set on demo-button click; clear on
  // paste-run. Drives the rail item's aria-current="true" highlight.
  const [activeDemoId, setActiveDemoId] = useState<string | null>(null);

  const turn1Ok: Turn1Success | null = turn1?.status === "ok" ? turn1 : null;

  function mergeCaseState(updated: CaseState) {
    setTurn1((prev) =>
      prev?.status === "ok" ? { ...prev, caseState: updated } : prev,
    );
  }

  const {
    turn15,
    pendingAsk,
    recommendedGuidelineId,
    turn15Busy,
    resetTurn15,
    runDecide: runTurn15Decide,
    runAnswer: runTurn15Answer,
  } = useTurn15Flow(turn1Ok, mergeCaseState);

  const activeStateRef = useRef<HTMLDivElement | null>(null);
  const turn15Code = turn15?.status ?? null;
  const turn2Code = turn2?.status ?? null;
  useEffect(() => {
    if (turn15Code === null && turn2Code === null) return;
    const el = activeStateRef.current;
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [turn15Code, turn2Code]);

  const turn15InFlight = turn15Busy !== null;
  const guidelineGateOpen = gateOpen({
    turn1Ok,
    weightConfirmed,
    turn15Busy,
  });

  // anyBusy — true while ANY turn is in flight. Wired into the rail's
  // disabled-during-work guard (the existing console used busy !== null ||
  // turn15Busy !== null inline).
  const anyBusy = busy !== null || turn15InFlight;

  async function runTurn1(rawNote: string) {
    const trimmed = rawNote.trim();
    if (trimmed.length === 0) return;
    setNote(trimmed);
    setTurn1(null);
    resetTurn15();
    setTurn2(null);
    setWeightConfirmed(false);
    setBusy({ kind: "turn1" });
    try {
      const res = await fetch("/api/turn1", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ note: trimmed }),
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

  function onRunPaste(rawNote: string) {
    // Paste-run is the "I'm not running a known demo" path — clear the
    // active highlight so no rail row stays selected against a different note.
    setActiveDemoId(null);
    void runTurn1(rawNote);
  }

  function onRunDemo(id: string, demoNote: string) {
    setActiveDemoId(id);
    void runTurn1(demoNote);
  }

  function onConfirmWeight() {
    setWeightConfirmed(true);
    void runTurn15Decide(turn1Ok?.confidence ?? "medium");
  }

  function runTurn2(guidelineId: string, condition: string) {
    if (!turn1Ok) return;
    const caseState: CaseState = {
      ...turn1Ok.caseState,
      selected_condition: condition,
      selected_guideline_id: guidelineId,
      selected_severity: turn1Ok.extractedFacts.severity,
    };
    runTurn2WithCaseState(guidelineId, caseState);
  }

  async function runTurn2WithCaseState(
    guidelineId: string,
    incoming: CaseState,
  ) {
    const caseState: CaseState = {
      ...incoming,
      selected_guideline_id: incoming.selected_guideline_id ?? guidelineId,
      selected_severity:
        incoming.selected_severity ?? turn1Ok?.extractedFacts.severity ?? null,
      selected_condition:
        incoming.selected_condition ??
        getGuideline(guidelineId)?.condition ??
        null,
    };

    setTurn2(null);
    setBusy({ kind: "turn2", phase: "retrieving-guideline" });
    try {
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

  const turn2Phase: Phase | null = busy?.kind === "turn2" ? busy.phase : null;

  return (
    <>
      {/* The 3-column shell (eng-review lock #2, fixed widths 272 + 1fr + 392).
          Tailwind v4 arbitrary value class so the widths are visible in the DOM
          for the mandatory regression test. */}
      <div
        data-testid="bluey-shell"
        className="bluey-shell grid h-screen w-full grid-cols-[272px_1fr_392px]"
      >
        <Rail
          draft={draft}
          onDraftChange={setDraft}
          onRun={onRunPaste}
          onRunDemo={onRunDemo}
          busy={anyBusy}
          activeDemoId={activeDemoId}
        />
        <CaseCanvas
          note={note}
          turn1={turn1}
          turn1Ok={turn1Ok}
          facts={turn1Ok?.extractedFacts ?? null}
          weightConfirmed={weightConfirmed}
          onConfirmWeight={onConfirmWeight}
          turn1Busy={busy?.kind === "turn1"}
          turn2Busy={busy?.kind === "turn2"}
          turn15={turn15}
          turn15Busy={turn15InFlight}
          pendingAsk={pendingAsk}
          recommendedGuidelineId={recommendedGuidelineId}
          guidelineGateOpen={guidelineGateOpen}
          onAnswerTurn15={(a) => void runTurn15Answer(a)}
          onSelectGuideline={runTurn2}
          activeStateRef={activeStateRef}
        />
        <EvidencePanel turn2={turn2} turn2Busy={turn2Phase} />
      </div>

      {/* Narrow-viewport banner (eng-review lock #7). CSS-only — no JS
          matchMedia listener, so no hydration-mismatch risk. The shell above
          is hidden in CSS at <1100px; this banner is hidden ≥1100px. */}
      <div
        data-testid="narrow-viewport-banner"
        className="narrow-viewport-banner hidden h-screen items-center justify-center bg-background px-6 text-center"
      >
        <div className="max-w-sm">
          <h1 className="text-[18px] font-semibold text-foreground">
            This demo is built for desktop.
          </h1>
          <p className="mt-2 text-[13px] text-muted-foreground">
            Open on a larger screen (≥ 1100px wide) to interact with the Bluey
            clinical care partner.
          </p>
        </div>
      </div>
    </>
  );
}
