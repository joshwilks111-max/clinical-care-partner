// @vitest-environment jsdom
//
// Regression test for F-014 — stale pendingAsk closure in runAnswer.
//
// Found by /qa on 2026-05-27 (static review during the F-016 fix loop).
// Report: .gstack/qa-reports/qa-report-localhost-2026-05-27.md
//
// WHAT BROKE
// ----------
// runAnswer read pendingAsk + turn1Ok from outer-scope closure. If a render
// landed between the user clicking an answer button and the fetch firing its
// body, the JSON payload could mix the CURRENT turn1Ok.caseState with a
// STALE pendingAsk (from a prior render before turn15 reset, etc.).
//
// WHAT FIXED IT
// -------------
// runAnswer now snapshots both into local consts at function entry. The
// async body uses the local consts exclusively, so the payload always
// describes the ask that was active when the user clicked.
//
// HOW THE TEST PROVES IT
// ----------------------
// 1. Render the hook with a turn1Ok fixture.
// 2. Run decide → server returns ask(target=Epiglottitis). pendingAsk is now
//    a live reference; hook re-renders.
// 3. While runAnswer is awaiting the fetch promise, EXTERNALLY mutate the
//    hook's parent state by calling resetTurn15 (which clears the closure's
//    pendingAsk to null in the next render).
// 4. Resolve the answer-phase fetch. Assert the body that was POSTed carries
//    the ORIGINAL ask's target — NOT the (now-null) closure value. Without
//    the snapshot fix, the body would either send target=undefined or the
//    early `if (!askSnapshot) return` guard would fire and no POST would
//    happen at all (also a failure mode worth catching).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { useTurn15Flow } from "./use-turn15-flow";
import { FIXTURE_TURN1_SUCCESS } from "./fixtures";

type FetchInit = RequestInit & { body?: string };

describe("F-014 — runAnswer snapshots pendingAsk at click-time, not closure", () => {
  let originalFetch: typeof globalThis.fetch;
  let bodies: unknown[];

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    bodies = [];
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("posts the ask-snapshot target even if state resets between click and resolve", async () => {
    // Two-stage fetch: decide returns ask(target=Epiglottitis); answer is
    // held until we explicitly resolve it, so we can mutate state mid-flight.
    let resolveAnswer: ((value: Response) => void) | undefined;
    globalThis.fetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = (init as FetchInit | undefined)?.body;
        const parsed = body
          ? (JSON.parse(body as string) as { phase: string })
          : null;
        bodies.push(parsed);
        if (parsed?.phase === "decide") {
          return new Response(
            JSON.stringify({
              status: "ask",
              question:
                "Is the child drooling, tripod-posturing, or muffled-voiced?",
              target: "Epiglottitis",
              discriminators: ["drooling", "tripod posture", "muffled voice"],
              recommended_condition: "croup",
              recommended_guideline: "starship-croup-2020",
              rationale_summary:
                "Rule out epiglottitis before applying croup guideline.",
              caseState: FIXTURE_TURN1_SUCCESS.caseState,
            }),
            { status: 200 },
          );
        }
        // phase === "answer": hold open until the test resolves it.
        return new Promise<Response>((resolve) => {
          resolveAnswer = resolve;
        });
      },
    ) as typeof globalThis.fetch;

    const onCaseStateUpdated = vi.fn();
    const { result } = renderHook(() =>
      useTurn15Flow(FIXTURE_TURN1_SUCCESS, onCaseStateUpdated),
    );

    // Stage 1: decide → ask. Hook re-renders; pendingAsk becomes live.
    await act(async () => {
      await result.current.runDecide();
    });
    expect(result.current.pendingAsk?.target).toBe("Epiglottitis");

    // Stage 2: fire runAnswer; do NOT await it yet. The fetch is in-flight,
    // held by the held-open Promise above.
    let answerPromise: Promise<void>;
    act(() => {
      answerPromise = result.current.runAnswer("absent");
    });

    // Stage 3: while the fetch is in-flight, MUTATE state by resetting.
    // This is the precise race: with the bug, runAnswer's body would now
    // either send target=undefined or have already serialized the stale
    // pendingAsk. With the fix, runAnswer's local snapshot is untouched.
    act(() => {
      result.current.resetTurn15();
    });
    expect(result.current.pendingAsk).toBeNull(); // reset took effect

    // Stage 4: resolve the held-open answer fetch with a recorded response.
    resolveAnswer?.(
      new Response(
        JSON.stringify({
          status: "recorded",
          caseState: FIXTURE_TURN1_SUCCESS.caseState,
          recommended_condition: "croup",
          recommended_guideline: "starship-croup-2020",
        }),
        { status: 200 },
      ),
    );
    await act(async () => {
      await answerPromise!;
    });

    // Assertion: the answer body carries the ORIGINAL ask snapshot, not
    // whatever state was visible at fetch-body-resolve time.
    const answerBody = bodies.find(
      (b) => (b as { phase?: string })?.phase === "answer",
    ) as
      | {
          phase: string;
          target: string;
          recommended_condition: string;
          recommended_guideline: string;
        }
      | undefined;
    expect(answerBody).toBeDefined();
    expect(answerBody!.target).toBe("Epiglottitis");
    expect(answerBody!.recommended_condition).toBe("croup");
    expect(answerBody!.recommended_guideline).toBe("starship-croup-2020");
  });

  it("returns early if no pendingAsk was active at function entry", async () => {
    // Negative control: calling runAnswer with no prior decide should make
    // ZERO fetches (the early guard fires). The fix's snapshot pattern must
    // not break this — askSnapshot is captured AFTER the guard read.
    globalThis.fetch = vi.fn(async () => {
      throw new Error("fetch should not be called — no pending ask at entry");
    }) as typeof globalThis.fetch;

    const { result } = renderHook(() =>
      useTurn15Flow(FIXTURE_TURN1_SUCCESS, vi.fn()),
    );
    expect(result.current.pendingAsk).toBeNull();

    await act(async () => {
      await result.current.runAnswer("absent");
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
