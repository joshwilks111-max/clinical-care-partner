// app/console/case-canvas.tsx
//
// The CENTER COLUMN of the Bluey 3-column shell (1fr, target reading width
// ~720px). Hosts the existing patient-facing flow without changing any
// clinical behaviour:
//
//   - CasePanel (reused, NOT renamed; eng-review lock #6) — extracted facts
//     + confirm-weight CTA.
//   - The turn-1 phase loader.
//   - Turn1View (the JUDGMENT differential).
//   - All four Turn-1.5 advisory cards: high-impact question, no-question
//     banner, answer-recorded banner, error alert. They live HERE (not in
//     the Evidence panel) because they sit between Turn 1 and the
//     guideline-pick — the clinician needs them inline with the differential.
//   - Turn1DecisionGate — the "your turn — select the guideline to apply"
//     buttons. Still the sole dose-enabling affordance.
//   - The refusal/error banners for Turn 1.
//
// Empty state: "Pick a case to begin." (eng-review lock #5 — original copy,
// NOT "Ready when you are." Heidi-borrow).
//
// Console (the state owner) passes everything down as plain props
// (eng-review lock #3: no context, no custom hooks).

"use client";

import { ShieldAlert, OctagonX } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

import { CasePanel } from "./case-panel";
import { Turn1View, Turn1DecisionGate } from "./turn1-view";
import {
  HighImpactQuestionCard,
  NoQuestionNeededBanner,
  AnswerRecordedBanner,
} from "./safety-check-card";
import { PhaseLoader } from "./phase-loader";
import type { Turn1Response, Turn1Success } from "./fixtures";
import type {
  AskResponse,
  DiscriminatorAnswer,
  Turn15Response,
} from "@/app/api/turn1.5/route";
import type { ExtractedFacts } from "@/lib/schemas";

export type CaseCanvasProps = {
  /** Raw note (display only, never re-sent after turn 1). */
  note: string;
  /** Turn-1 full response (success/refusal/error), or null before turn 1 runs. */
  turn1: Turn1Response | null;
  /** Turn-1 success narrowing for the views that need it. */
  turn1Ok: Turn1Success | null;
  /** Extracted facts surfaced in the case panel. */
  facts: ExtractedFacts | null;
  /** True once the human has confirmed the surfaced weight. */
  weightConfirmed: boolean;
  onConfirmWeight: () => void;
  /** Turn-1 in flight (phase loader). */
  turn1Busy: boolean;
  /** Turn-2 in flight (disables guideline buttons). */
  turn2Busy: boolean;
  /** Turn-1.5 advisory state (null if not run / advisory-skipped). */
  turn15: Turn15Response | null;
  /** Turn-1.5 in flight (phase loader). */
  turn15Busy: boolean;
  /** Pending discriminating question, if status="ask". */
  pendingAsk: AskResponse | null;
  /** Highlight the model-recommended guideline. */
  recommendedGuidelineId: string | null;
  /** True when the gate is open (turn1Ok + weight confirmed + !turn15Busy). */
  guidelineGateOpen: boolean;
  onAnswerTurn15: (answer: DiscriminatorAnswer | null) => void;
  onSelectGuideline: (guidelineId: string, condition: string) => void;
  /** Ref forwarded so console.tsx can scroll the active turn-1.5/turn-2 zone into view. */
  activeStateRef: React.RefObject<HTMLDivElement | null>;
};

export function CaseCanvas({
  note,
  turn1,
  turn1Ok,
  facts,
  weightConfirmed,
  onConfirmWeight,
  turn1Busy,
  turn2Busy,
  turn15,
  turn15Busy,
  pendingAsk,
  recommendedGuidelineId,
  guidelineGateOpen,
  onAnswerTurn15,
  onSelectGuideline,
  activeStateRef,
}: CaseCanvasProps) {
  const empty = turn1 === null && !turn1Busy;

  // Patient-header copy (layout-refinement #3). We render real, dynamic
  // values from `facts` instead of the variant's hard-coded "Jack T. ·
  // 3 years · 14.2 kg" — but each piece is optional so the strip degrades
  // gracefully when the LLM extracts only some fields.
  const patientPieces: string[] = [];
  if (facts?.age) patientPieces.push(facts.age);
  if (facts?.weight_kg !== undefined && facts?.weight_kg !== null) {
    patientPieces.push(`${facts.weight_kg} kg`);
  }
  const patientLine =
    patientPieces.length > 0 ? patientPieces.join(" · ") : "Active case";

  // Turn status pill copy — mirrors variant ("Turn 1 — building differential",
  // "Turn 1.5 — checking safety", "Turn 2 — applying guideline").
  let statusPill: string | null = null;
  if (turn1Busy) statusPill = "Turn 1 · building differential";
  else if (turn15Busy) statusPill = "Turn 1.5 · checking safety";
  else if (turn2Busy) statusPill = "Turn 2 · applying guideline";
  else if (turn1Ok && !weightConfirmed)
    statusPill = "Confirm weight to continue";
  else if (guidelineGateOpen) statusPill = "Awaiting guideline selection";

  return (
    <main className="overflow-y-auto bg-background px-7 py-6">
      <div className="mx-auto flex min-h-full max-w-[760px] flex-col">
        {/* PATIENT HEADER STRIP — layout-refinement #3. Always rendered so
            the canvas has a stable top edge; copy is dynamic. */}
        <header className="mb-4 flex items-end justify-between border-b border-hairline pb-3">
          <div>
            <div className="mb-0.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
              Active case
            </div>
            <h1 className="text-[22px] font-semibold tracking-tight text-foreground">
              {patientLine}
            </h1>
          </div>
          {statusPill && (
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <span className="size-2 animate-pulse rounded-full bg-primary" />
              <span>{statusPill}</span>
            </div>
          )}
        </header>

        <div className="flex-1 space-y-4">
          {/* CasePanel — REUSED inside the canvas (eng-review lock #6, NOT
            renamed). Its <aside> stays the same DOM shape so case-panel.test
            keeps passing. Always rendered: the persistent case-panel surface
            is the visible spine of the workflow (it shows "Extracted facts"
            with placeholder copy before a note loads). */}
          <CasePanel
            note={note}
            facts={facts}
            weightConfirmed={weightConfirmed}
            onConfirmWeight={onConfirmWeight}
          />

          {/* EMPTY STATE — eng-review lock #5 (original copy, not "Ready when
            you are."). */}
          {empty && (
            <div
              data-testid="canvas-empty"
              className="rounded-xl border border-hairline bg-white p-10 text-center"
            >
              <h2 className="text-[15px] font-semibold text-foreground">
                Pick a case to begin.
              </h2>
              <p className="mt-1 text-[12.5px] text-muted-foreground">
                Click a demo case in the rail, or paste a clinical note.
              </p>
            </div>
          )}

          {turn1Busy && <PhaseLoader phase="building-differential" />}

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
            {turn15Busy && <PhaseLoader phase="checking-safety" />}

            {turn15?.status === "ask" && pendingAsk && (
              <HighImpactQuestionCard
                target={pendingAsk.target}
                question={pendingAsk.question}
                rationaleSummary={pendingAsk.rationale_summary}
                onAnswer={onAnswerTurn15}
                onSkip={() => onAnswerTurn15(null)}
                busy={turn15Busy}
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
                busy={turn2Busy}
                recommendedGuidelineId={recommendedGuidelineId}
                onSelectGuideline={onSelectGuideline}
              />
            )}
          </div>
        </div>

        {/* BOTTOM MICROCOPY STRIP — layout-refinement #4. Reinforces "this is
            a serious tool" the way Heidi's "Provide feedback · 0 tasks" does. */}
        <footer className="mt-6 flex items-center justify-end gap-3 border-t border-hairline pt-3 text-[11px] text-muted-foreground">
          <span>Show working</span>
          <span aria-hidden>·</span>
          <span>Audit log</span>
          <span aria-hidden>·</span>
          <span className="font-mono">v1.2.0</span>
        </footer>
      </div>
    </main>
  );
}
