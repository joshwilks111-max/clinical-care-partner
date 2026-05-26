// @vitest-environment jsdom
//
// app/console/safety-check-card.test.tsx
//
// THE FAIL-CLOSED DELIVERABLE. The single most important safety property of this
// beat: the dose-ENABLING guideline buttons must render ONLY when an explicit
// POSITIVE turn-1.5 signal (status:"ok") is held in state. In EVERY other
// turn-1.5 state — error / ask / abstention — the buttons must be ABSENT from the
// DOM (not merely disabled). These tests are NON-VACUOUS: each would FAIL if
// someone changed the gate to "show buttons unless error".
//
// Two layers:
//   1. SafetyCheckCard unit tests  — XSS escaping + three equal-weight answers.
//   2. <Console /> integration tests — drive the real wiring (turn1 → confirm →
//      turn1.5) with a per-endpoint fetch router and assert button presence/
//      absence in the DOM for ok / error / ask / abstention / not_assessed.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { Console } from "./console";
import { SafetyCheckCard } from "./safety-check-card";
import { FIXTURE_TURN1_SUCCESS } from "./fixtures";
import type { Turn15Response } from "@/app/api/turn1.5/route";

afterEach(() => {
  vi.restoreAllMocks();
});

// Minimal Response-like stub for the mocked fetch (mirrors console.test.tsx).
function jsonResponse(body: unknown): Response {
  return { ok: true, json: async () => body } as Response;
}

/**
 * A per-ENDPOINT fetch router. Robust to call ordering: turn1 always returns the
 * success fixture; turn1.5 returns the caller-supplied response (or throws for
 * the fail-closed error case); turn2 returns a benign ok so an accidental
 * auto-run doesn't blow up the test. Returns the mock for call assertions.
 */
function mockFetch(opts: {
  turn15?: Turn15Response;
  turn15Throws?: boolean;
  onTurn15?: (body: { phase: string; answer?: string }) => Turn15Response;
}) {
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    if (url === "/api/turn1") return jsonResponse(FIXTURE_TURN1_SUCCESS);
    if (url === "/api/turn1.5") {
      if (opts.turn15Throws) throw new Error("network down");
      if (opts.onTurn15) {
        const body = JSON.parse((init as RequestInit).body as string);
        return jsonResponse(opts.onTurn15(body));
      }
      return jsonResponse(opts.turn15);
    }
    // /api/turn2 — benign ok so an auto-run after answer-ok doesn't throw.
    return jsonResponse({
      status: "abstention",
      reason: "no_matching_guideline",
      headline: "x",
      detail: null,
      source: "no-guideline",
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Drive Console to the post-weight-confirm point (turn1 ok → confirm weight →
 *  turn1.5 fires). Returns once the turn1 differential is on screen + confirmed. */
async function driveToTurn15() {
  render(<Console />);
  fireEvent.click(
    document.querySelector('[data-demo-id="croup"]') as HTMLButtonElement,
  );
  await waitFor(() =>
    expect(screen.getByTestId("turn1-view")).toBeInTheDocument(),
  );
  fireEvent.click(screen.getByTestId("confirm-weight-button"));
}

/** The dose-enabling guideline button, or null when absent from the DOM. */
function guidelineButton(): HTMLElement | null {
  return document.querySelector('[data-guideline-id="starship-croup-2020"]');
}

// ---------------------------------------------------------------------------
// SafetyCheckCard — unit tests (XSS escape + three equal-weight answers).
// ---------------------------------------------------------------------------

describe("SafetyCheckCard — renders the model question as ESCAPED text (XSS guard)", () => {
  it("renders an injected <script> as literal text, never as HTML", () => {
    const malicious = '<script>alert("xss")</script> Is there drooling?';
    render(
      <SafetyCheckCard
        target="Epiglottitis"
        question={malicious}
        onAnswer={() => {}}
      />,
    );
    const q = screen.getByTestId("safety-check-question");
    // React escapes text children: the literal string is the textContent, and NO
    // <script> element was injected into the DOM.
    expect(q.textContent).toBe(malicious);
    expect(q.querySelector("script")).toBeNull();
    expect(document.querySelector("script")).toBeNull();
  });
});

describe("SafetyCheckCard — three equal-weight answer buttons (no biased default)", () => {
  it("renders No / Yes / Not assessed as three outline buttons, none filled-primary", () => {
    render(
      <SafetyCheckCard
        target="Epiglottitis"
        question="Is there drooling or tripod posture?"
        onAnswer={() => {}}
      />,
    );
    const absent = document.querySelector('[data-answer="absent"]');
    const present = document.querySelector('[data-answer="present"]');
    const notAssessed = document.querySelector('[data-answer="not_assessed"]');
    expect(absent).toBeInTheDocument();
    expect(present).toBeInTheDocument();
    expect(notAssessed).toBeInTheDocument();
    // Equal visual weight: a filled "No" would bias toward the dose-enabling
    // answer. All three share the SAME class list (the outline variant).
    expect(absent?.className).toBe(present?.className);
    expect(present?.className).toBe(notAssessed?.className);
  });

  it("fires onAnswer with the closed enum value for each button", () => {
    const onAnswer = vi.fn();
    render(
      <SafetyCheckCard
        target="Epiglottitis"
        question="Is there drooling?"
        onAnswer={onAnswer}
      />,
    );
    fireEvent.click(document.querySelector('[data-answer="absent"]')!);
    expect(onAnswer).toHaveBeenCalledWith("absent");
    fireEvent.click(document.querySelector('[data-answer="not_assessed"]')!);
    expect(onAnswer).toHaveBeenCalledWith("not_assessed");
  });
});

// ---------------------------------------------------------------------------
// FAIL-CLOSED integration tests (the core deliverable).
// ---------------------------------------------------------------------------

const ASK: Turn15Response = {
  status: "ask",
  question: "Is there drooling, tripod posture, or a muffled voice?",
  target: "Epiglottitis",
  discriminators: ["drooling", "tripod posture", "muffled voice"],
  provenance: {
    phase: "decide",
    action: "ask",
    target: "Epiglottitis",
    round: 0,
  },
};

const PLAN_OK: Turn15Response = {
  status: "ok",
  guidelineId: "starship-croup-2020",
  caseState: FIXTURE_TURN1_SUCCESS.caseState,
  provenance: { phase: "decide", action: "plan", target: null, round: 0 },
};

const ABSTENTION: Turn15Response = {
  status: "abstention",
  reason: "no_matching_guideline",
  headline: "No local guideline matches this condition.",
  detail: null,
  source: "no-guideline",
};

describe("Console fail-closed — turn1.5 RED error → dose buttons NOT shown", () => {
  it("a thrown turn1.5 decide leaves the guideline buttons ABSENT from the DOM and shows a red error", async () => {
    mockFetch({ turn15Throws: true });
    await driveToTurn15();

    // The red technical-error lands; the dose-enabling buttons are NOT rendered.
    await waitFor(() =>
      expect(screen.getByTestId("turn15-error")).toBeInTheDocument(),
    );
    // FAIL CLOSED: buttons absent from the DOM (not merely disabled).
    expect(guidelineButton()).toBeNull();
    expect(screen.queryByTestId("your-turn")).not.toBeInTheDocument();
  });

  it("a turn1.5 decide that RETURNS status:'error' also hides the dose buttons", async () => {
    mockFetch({
      turn15: { status: "error", message: "A technical error occurred." },
    });
    await driveToTurn15();
    await waitFor(() =>
      expect(screen.getByTestId("turn15-error")).toBeInTheDocument(),
    );
    expect(guidelineButton()).toBeNull();
  });
});

describe("Console fail-closed — turn1.5 ASK → safety question shown, dose buttons NOT shown", () => {
  it("renders the safety-check card and HIDES the guideline buttons while a question is pending", async () => {
    mockFetch({ turn15: ASK });
    await driveToTurn15();

    await waitFor(() =>
      expect(screen.getByTestId("safety-check-card")).toBeInTheDocument(),
    );
    // The model question renders (escaped); the dose buttons are NOT in the DOM.
    expect(screen.getByTestId("safety-check-question")).toHaveTextContent(
      "Is there drooling, tripod posture, or a muffled voice?",
    );
    expect(guidelineButton()).toBeNull();
    expect(screen.queryByTestId("your-turn")).not.toBeInTheDocument();
  });
});

describe("Console fail-closed — 'Not assessed' answer → abstention shown, dose buttons NOT shown", () => {
  it("answering not_assessed (server returns abstention) renders amber and keeps the buttons HIDDEN", async () => {
    // decide → ask; answer(not_assessed) → abstention (the fail-closed mapping).
    const fetchMock = mockFetch({
      onTurn15: (body) => (body.phase === "decide" ? ASK : ABSTENTION),
    });
    await driveToTurn15();

    await waitFor(() =>
      expect(screen.getByTestId("safety-check-card")).toBeInTheDocument(),
    );
    fireEvent.click(document.querySelector('[data-answer="not_assessed"]')!);

    await waitFor(() =>
      expect(screen.getByTestId("turn15-abstention")).toBeInTheDocument(),
    );
    // FAIL CLOSED: the amber abstention shows; NO guideline buttons in the DOM.
    expect(guidelineButton()).toBeNull();
    expect(screen.queryByTestId("your-turn")).not.toBeInTheDocument();
    // The answer was POSTed to turn1.5 phase "answer" with the closed enum.
    const answerCall = fetchMock.mock.calls.find(
      ([u, i]) =>
        u === "/api/turn1.5" &&
        JSON.parse((i as RequestInit).body as string).phase === "answer",
    );
    expect(answerCall).toBeDefined();
    expect(
      JSON.parse((answerCall![1] as RequestInit).body as string).answer,
    ).toBe("not_assessed");
  });
});

describe("Console fail-closed — turn1.5 PLAN ok → dose buttons DO render (the positive signal)", () => {
  it("on a decide→ok (plan short-circuit) the guideline buttons appear (proves the gate is non-vacuous)", async () => {
    // The complement of the fail-closed tests: WITH the positive ok-signal the
    // buttons MUST appear — otherwise the fail-closed tests would pass vacuously.
    mockFetch({ turn15: PLAN_OK });
    await driveToTurn15();

    await waitFor(() => expect(guidelineButton()).toBeInTheDocument());
    expect(screen.getByTestId("your-turn")).toBeInTheDocument();
    // No model call was needed for the plan short-circuit (decide returned ok).
  });
});
