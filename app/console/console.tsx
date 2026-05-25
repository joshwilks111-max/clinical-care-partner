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
//   2. Turn 1 renders the differential + the "your turn" guideline buttons;
//      a refusal renders amber, a technical error renders red.
//   3. The clinician confirms the surfaced weight (left panel), then picks a
//      guideline. We seed the CaseState's selected_* and POST /api/turn2.
//   4. Turn 2 renders one of its four states (ok / incomplete / abstention /
//      error). Turn 1 stays visible above so the full chain shows on camera.

"use client";

import { useState } from "react";

import { ShieldAlert, OctagonX } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

import { CasePanel } from "./case-panel";
import { Turn1View } from "./turn1-view";
import { Turn2View } from "./turn2-view";
import { PhaseLoader, type Phase } from "./phase-loader";
import {
  DEMO_NOTES,
  type DemoCase,
  type Turn1Response,
  type Turn1Success,
} from "./fixtures";
import type { Turn2Response } from "@/app/api/turn2/route";
import type { CaseState } from "@/lib/case-state";

type Busy = { kind: "turn1" } | { kind: "turn2"; phase: Phase } | null;

export function Console() {
  const [note, setNote] = useState("");
  const [turn1, setTurn1] = useState<Turn1Response | null>(null);
  const [weightConfirmed, setWeightConfirmed] = useState(false);
  const [turn2, setTurn2] = useState<Turn2Response | null>(null);
  const [busy, setBusy] = useState<Busy>(null);

  const turn1Ok: Turn1Success | null = turn1?.status === "ok" ? turn1 : null;

  // --- Step 1: a demo button → POST /api/turn1. Resets downstream state. ---
  async function runTurn1(demo: DemoCase) {
    setNote(demo.note);
    setTurn1(null);
    setTurn2(null);
    setWeightConfirmed(false);
    setBusy({ kind: "turn1" });
    try {
      const res = await fetch("/api/turn1", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ note: demo.note }),
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

  // --- Step 3/4: clinician picked a guideline → seed CaseState → POST /api/turn2.
  async function runTurn2(guidelineId: string, condition: string) {
    if (!turn1Ok) return;
    // Seed the server-owned CaseState with the clinician's confirmations. The
    // route consumes this verbatim (zero re-extraction).
    const caseState: CaseState = {
      ...turn1Ok.caseState,
      selected_condition: condition,
      selected_guideline_id: guidelineId,
      selected_severity: turn1Ok.extractedFacts.severity,
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
          <h1 className="text-lg font-semibold">Care Partner Console</h1>
          <p className="text-sm text-muted-foreground">
            Clinical decision support · judgment up, execution down
          </p>
        </div>
      </header>

      {/* 1-click demo buttons — the reviewer never types (X5). */}
      <section data-testid="demo-buttons" className="mb-5">
        <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Demo cases — one click, no typing
        </p>
        <div className="flex flex-wrap gap-2">
          {DEMO_NOTES.map((demo) => (
            <div key={demo.id} className="flex flex-col">
              <Button
                variant="outline"
                data-demo-id={demo.id}
                disabled={busy !== null}
                onClick={() => runTurn1(demo)}
              >
                {demo.label}
              </Button>
              <span className="mt-1 max-w-[200px] text-[10.5px] leading-tight text-muted-foreground">
                {demo.caption}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Two-panel grid: LEFT case · RIGHT stepped flow. */}
      <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-[300px_1fr]">
        {/* LEFT — the case. */}
        <CasePanel
          note={note}
          facts={turn1Ok?.extractedFacts ?? null}
          weightConfirmed={weightConfirmed}
          onConfirmWeight={() => setWeightConfirmed(true)}
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
                <span className="font-mono text-[10px] tracking-wide">
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

          {/* Turn-1 success — the differential + "your turn". */}
          {turn1Ok && (
            <Turn1View
              turn1={turn1Ok}
              weightConfirmed={weightConfirmed}
              busy={busy?.kind === "turn2"}
              onSelectGuideline={runTurn2}
            />
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
