"use client";

import { useEffect, useRef, useState } from "react";

import { ShieldAlert, OctagonX } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

import { CasePanel } from "./case-panel";
import { Turn1View, Turn1DecisionGate } from "./turn1-view";
import {
  HighImpactQuestionCard,
  NoQuestionNeededBanner,
  AnswerRecordedBanner,
} from "./safety-check-card";
import { Turn2View } from "./turn2-view";
import { PhaseLoader, type Phase } from "./phase-loader";
import { DEMO_NOTES, type Turn1Response, type Turn1Success } from "./fixtures";
import type { Turn2Response } from "@/app/api/turn2/route";
import type { CaseState } from "@/lib/case-state";
import { getGuideline } from "@/registry/guidelines";
import { gateOpen, useTurn15Flow } from "./use-turn15-flow";

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

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
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
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {DEMO_NOTES.filter((d) => d.group === group).map((demo) => (
                  <div key={demo.id} className="flex flex-col">
                    <Button
                      variant="outline"
                      data-demo-id={demo.id}
                      disabled={busy !== null || turn15Busy !== null}
                      onClick={() => runTurn1(demo.note)}
                      className="h-auto min-h-[44px] py-2"
                    >
                      {demo.label}
                    </Button>
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
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              if (draft.trim() && busy === null && turn15Busy === null)
                runTurn1(draft);
            }
          }}
          disabled={busy !== null || turn15Busy !== null}
          rows={4}
          aria-describedby="paste-help"
          placeholder="Paste a free-text clinical note or a doctor-patient transcript, then Run."
          className="resize-y text-sm"
        />
        <div className="mt-2 flex items-center gap-3">
          <Button
            data-testid="paste-run"
            disabled={
              busy !== null || turn15Busy !== null || draft.trim().length === 0
            }
            onClick={() => runTurn1(draft)}
            className="h-auto min-h-[44px] py-2"
          >
            Run
          </Button>
          <span id="paste-help" className="text-xs text-muted-foreground">
            Same engine as the demos · ⌘/Ctrl+Enter to run
          </span>
        </div>
      </section>

      <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-[300px_1fr]">
        <CasePanel
          note={note}
          facts={turn1Ok?.extractedFacts ?? null}
          weightConfirmed={weightConfirmed}
          onConfirmWeight={onConfirmWeight}
        />

        <div className="space-y-4">
          {turn1 === null && busy === null && (
            <div className="rounded-xl border border-dashed bg-muted/20 p-8 text-center text-sm text-muted-foreground">
              Pick a demo case above to start.
            </div>
          )}

          {busy?.kind === "turn1" && (
            <PhaseLoader phase="building-differential" />
          )}

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

          {turn1?.status === "error" && (
            <Alert variant="destructive" data-testid="turn1-error">
              <OctagonX />
              <AlertTitle>Technical error</AlertTitle>
              <AlertDescription>{turn1.message}</AlertDescription>
            </Alert>
          )}

          {turn1Ok && <Turn1View turn1={turn1Ok} />}

          <div ref={activeStateRef} className="space-y-4">
            {turn15InFlight && <PhaseLoader phase="checking-safety" />}

            {turn15?.status === "ask" && pendingAsk && (
              <HighImpactQuestionCard
                target={pendingAsk.target}
                question={pendingAsk.question}
                rationaleSummary={pendingAsk.rationale_summary}
                onAnswer={(a) => void runTurn15Answer(a)}
                onSkip={() => void runTurn15Answer(null)}
                busy={turn15InFlight}
              />
            )}

            {turn15?.status === "ok" && (
              <NoQuestionNeededBanner
                rationaleSummary={turn15.rationale_summary}
                overriddenTarget={turn15.overridden_target}
                overriddenDiscriminators={turn15.overridden_discriminators}
              />
            )}

            {turn15?.status === "recorded" && (
              <AnswerRecordedBanner
                target={
                  turn15.caseState.discriminating_qa.at(-1)?.target ??
                  "question"
                }
                engaged={
                  turn15.caseState.discriminating_qa.at(-1)?.engaged ?? false
                }
              />
            )}

            {turn15?.status === "error" && (
              <Alert variant="destructive" data-testid="turn15-error">
                <OctagonX />
                <AlertTitle>Advisory check unavailable</AlertTitle>
                <AlertDescription>{turn15.message}</AlertDescription>
              </Alert>
            )}

            {guidelineGateOpen && turn1Ok && (
              <Turn1DecisionGate
                turn1={turn1Ok}
                weightConfirmed={weightConfirmed}
                busy={busy?.kind === "turn2"}
                recommendedGuidelineId={recommendedGuidelineId}
                onSelectGuideline={runTurn2}
              />
            )}

            {busy?.kind === "turn2" && <PhaseLoader phase={busy.phase} />}
            {turn2 && <Turn2View result={turn2} />}
          </div>
        </div>
      </div>
    </main>
  );
}
