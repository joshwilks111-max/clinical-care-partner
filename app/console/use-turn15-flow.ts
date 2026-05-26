"use client";

import { useState } from "react";

import type {
  Turn15Response,
  DiscriminatorAnswer,
  AskResponse,
} from "@/app/api/turn1.5/route";
import type { CaseState } from "@/lib/case-state";
import type { Turn1Success } from "./fixtures";

export type Turn15Recommendation = {
  recommended_condition: string;
  recommended_guideline: string;
};

export type Turn15FlowBusy = {
  kind: "turn15";
  phase: "checking-safety";
} | null;

export function turn15InFlight(busy: Turn15FlowBusy): boolean {
  return busy?.kind === "turn15";
}

export function gateOpen(args: {
  turn1Ok: Turn1Success | null;
  weightConfirmed: boolean;
  turn15Busy: Turn15FlowBusy;
}): boolean {
  return (
    args.turn1Ok !== null &&
    args.weightConfirmed &&
    !turn15InFlight(args.turn15Busy)
  );
}

export function useTurn15Flow(
  turn1Ok: Turn1Success | null,
  onCaseStateUpdated: (updated: CaseState) => void,
) {
  const [turn15, setTurn15] = useState<Turn15Response | null>(null);
  const [lastRecommendation, setLastRecommendation] =
    useState<Turn15Recommendation | null>(null);
  const [turn15Busy, setTurn15Busy] = useState<Turn15FlowBusy>(null);

  const pendingAsk: AskResponse | null =
    turn15?.status === "ask" ? turn15 : null;

  const recommendedGuidelineId =
    lastRecommendation?.recommended_guideline ??
    (turn15?.status === "ask" || turn15?.status === "ok"
      ? turn15.recommended_guideline
      : turn15?.status === "recorded"
        ? turn15.recommended_guideline
        : null);

  function storeRecommendation(rec: Turn15Recommendation) {
    setLastRecommendation(rec);
  }

  function resetTurn15() {
    setTurn15(null);
    setLastRecommendation(null);
    setTurn15Busy(null);
  }

  async function runDecide(confidence: "low" | "medium" | "high" = "medium") {
    if (!turn1Ok) return;
    // F-014 sibling — busy-guard. Without this, a tight double-click (within
    // the same render cycle, before turn15Busy disables the trigger button)
    // would fire two runDecide calls; the second's setTurn15(null) corrupts
    // the first's pending result. The card's disabled={busy} guard handles
    // the common case; this catches the React-batching window.
    if (turn15Busy) return;
    setTurn15(null);
    setTurn15Busy({ kind: "turn15", phase: "checking-safety" });
    try {
      const res = await fetch("/api/turn1.5", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          phase: "decide",
          caseState: turn1Ok.caseState,
          confidence,
        }),
      });
      const data = (await res.json()) as Turn15Response;
      setTurn15(data);
      if (data.status === "ask") {
        storeRecommendation({
          recommended_condition: data.recommended_condition,
          recommended_guideline: data.recommended_guideline,
        });
      } else if (data.status === "ok") {
        storeRecommendation({
          recommended_condition: data.recommended_condition,
          recommended_guideline: data.recommended_guideline,
        });
      }
    } catch (e) {
      setTurn15({
        status: "error",
        message:
          "Could not reach the advisory check endpoint. " +
          (e instanceof Error ? e.message : String(e)),
      });
    } finally {
      setTurn15Busy(null);
    }
  }

  async function runAnswer(answer: DiscriminatorAnswer | null) {
    // F-014 — snapshot pendingAsk + turn1Ok at function entry. The previous
    // version read them from outer-scope closure, so a render between click
    // and fetch could swap pendingAsk to a stale ref (if Turn 1 re-ran or
    // the parent reset turn15) — the body would then mix the CURRENT
    // caseState with a STALE ask. Snapshotting at entry makes the function's
    // contract "answer the ask that was active when you clicked".
    const askSnapshot = pendingAsk;
    const turn1Snapshot = turn1Ok;
    if (!turn1Snapshot || !askSnapshot) return;
    setTurn15Busy({ kind: "turn15", phase: "checking-safety" });
    let data: Turn15Response;
    try {
      const res = await fetch("/api/turn1.5", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          phase: "answer",
          caseState: turn1Snapshot.caseState,
          answer,
          target: askSnapshot.target,
          question: askSnapshot.question,
          recommended_condition: askSnapshot.recommended_condition,
          recommended_guideline: askSnapshot.recommended_guideline,
        }),
      });
      data = (await res.json()) as Turn15Response;
    } catch (e) {
      setTurn15({
        status: "error",
        message:
          "Could not record the answer. " +
          (e instanceof Error ? e.message : String(e)),
      });
      setTurn15Busy(null);
      return;
    }
    setTurn15(data);
    setTurn15Busy(null);
    if (data.status === "recorded") {
      // Adversarial review finding #4 (2026-05-27) — write-side ask-validity
      // check. F-014 snapshotted the ask at function entry (read side); this
      // guards the write side. If a fresh runDecide invalidated our ask while
      // the answer fetch was in flight (parent state change, programmatic
      // re-run), pendingAsk now points at a NEW ask. Calling
      // onCaseStateUpdated with the answer-mutated caseState would write the
      // demoted differential into the parent while the UI shows the new
      // decide's question — Turn 2 would then dose against the demoted view.
      // The check: still pointing at the same ask we answered? If not, drop
      // the write — the audit log already records the engagement via the
      // server-stored discriminating_qa entry; the parent's caseState stays
      // consistent with the UI's current decide state.
      const askStillActive = pendingAsk === askSnapshot;
      if (askStillActive) {
        onCaseStateUpdated(data.caseState);
        storeRecommendation({
          recommended_condition: data.recommended_condition,
          recommended_guideline: data.recommended_guideline,
        });
      }
    }
  }

  return {
    turn15,
    pendingAsk,
    lastRecommendation,
    recommendedGuidelineId,
    turn15Busy,
    resetTurn15,
    runDecide,
    runAnswer,
  };
}
