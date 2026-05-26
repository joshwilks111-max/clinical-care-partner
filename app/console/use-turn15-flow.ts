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

export type Turn15FlowBusy = { kind: "turn15"; phase: "checking-safety" } | null;

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
    if (!turn1Ok || !pendingAsk) return;
    setTurn15Busy({ kind: "turn15", phase: "checking-safety" });
    let data: Turn15Response;
    try {
      const res = await fetch("/api/turn1.5", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          phase: "answer",
          caseState: turn1Ok.caseState,
          answer,
          target: pendingAsk.target,
          question: pendingAsk.question,
          recommended_condition: pendingAsk.recommended_condition,
          recommended_guideline: pendingAsk.recommended_guideline,
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
      onCaseStateUpdated(data.caseState);
      storeRecommendation({
        recommended_condition: data.recommended_condition,
        recommended_guideline: data.recommended_guideline,
      });
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
