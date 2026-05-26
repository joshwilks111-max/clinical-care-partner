// @vitest-environment jsdom
//
// High-impact question card + advisory console gate tests.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { Console } from "./console";
import {
  HighImpactQuestionCard,
  NoQuestionNeededBanner,
  AnswerRecordedBanner,
} from "./safety-check-card";
import { FIXTURE_TURN1_SUCCESS } from "./fixtures";
import type { Turn15Response } from "@/app/api/turn1.5/route";

afterEach(() => {
  vi.restoreAllMocks();
});

function jsonResponse(body: unknown): Response {
  return { ok: true, json: async () => body } as Response;
}

function mockFetch(opts: {
  turn15?: Turn15Response;
  turn15Throws?: boolean;
}) {
  const fetchMock = vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    if (url === "/api/turn1") return jsonResponse(FIXTURE_TURN1_SUCCESS);
    if (url === "/api/turn1.5") {
      if (opts.turn15Throws) throw new Error("network down");
      return jsonResponse(opts.turn15!);
    }
    return jsonResponse({
      status: "ok",
      dose: { dose_mg: 2.13 },
      plan: { recommendations: [], required_fields: {} },
      provenance: {},
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

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

function guidelineButton(): HTMLElement | null {
  return document.querySelector('[data-guideline-id="starship-croup-2020"]');
}

const ASK: Turn15Response = {
  status: "ask",
  question: "Is there drooling or tripod posture?",
  target: "Epiglottitis",
  discriminators: ["drooling", "tripod posture"],
  recommended_condition: "Croup",
  recommended_guideline: "starship-croup-2020",
  rationale_summary: "Rule out epiglottitis before dosing.",
  caseState: FIXTURE_TURN1_SUCCESS.caseState,
};

const OK: Turn15Response = {
  status: "ok",
  recommended_condition: "Croup",
  recommended_guideline: "starship-croup-2020",
  rationale_summary: "No clarifying question needed.",
  caseState: FIXTURE_TURN1_SUCCESS.caseState,
};

describe("HighImpactQuestionCard — XSS + equal-weight answers", () => {
  it("escapes injected script in question text", () => {
    const malicious = '<script>alert("xss")</script> Is there drooling?';
    render(
      <HighImpactQuestionCard
        target="Epiglottitis"
        question={malicious}
        rationaleSummary="Test"
        onAnswer={() => {}}
        onSkip={() => {}}
      />,
    );
    const q = screen.getByTestId("high-impact-question");
    expect(q.textContent).toBe(malicious);
    expect(q.querySelector("script")).toBeNull();
  });

  it("renders Yes / No / Not assessed with equal outline styling", () => {
    render(
      <HighImpactQuestionCard
        target="Epiglottitis"
        question="Is there drooling?"
        rationaleSummary="Test"
        onAnswer={() => {}}
        onSkip={() => {}}
      />,
    );
    const absent = document.querySelector('[data-answer="absent"]');
    const present = document.querySelector('[data-answer="present"]');
    const notAssessed = document.querySelector('[data-answer="not_assessed"]');
    expect(absent?.className).toBe(present?.className);
    expect(present?.className).toBe(notAssessed?.className);
  });
});

describe("Console advisory gate — guideline buttons stay visible", () => {
  it("turn1.5 ask → high-impact card AND guideline buttons both render", async () => {
    mockFetch({ turn15: ASK });
    await driveToTurn15();
    await waitFor(() =>
      expect(screen.getByTestId("high-impact-question-card")).toBeInTheDocument(),
    );
    expect(guidelineButton()).toBeInTheDocument();
  });

  it("turn1.5 ok → no-question banner AND guideline buttons render", async () => {
    mockFetch({ turn15: OK });
    await driveToTurn15();
    await waitFor(() =>
      expect(screen.getByTestId("turn15-no-question")).toBeInTheDocument(),
    );
    expect(guidelineButton()).toBeInTheDocument();
  });

  it("turn1.5 error → red error AND guideline buttons still render", async () => {
    mockFetch({
      turn15: { status: "error", message: "A technical error occurred." },
    });
    await driveToTurn15();
    await waitFor(() =>
      expect(screen.getByTestId("turn15-error")).toBeInTheDocument(),
    );
    expect(guidelineButton()).toBeInTheDocument();
  });
});

describe("AnswerRecordedBanner", () => {
  it("shows engaged vs skipped copy", () => {
    const { rerender } = render(
      <AnswerRecordedBanner target="Epiglottitis" engaged={true} />,
    );
    expect(screen.getByTestId("turn15-recorded")).toHaveTextContent(
      /Answer recorded for Epiglottitis/,
    );
    rerender(<AnswerRecordedBanner target="Epiglottitis" engaged={false} />);
    expect(screen.getByTestId("turn15-recorded")).toHaveTextContent(/Skipped/);
  });
});

describe("NoQuestionNeededBanner", () => {
  it("renders optional rationale", () => {
    render(<NoQuestionNeededBanner rationaleSummary="Differential is clear." />);
    expect(screen.getByTestId("turn15-no-question")).toHaveTextContent(
      /NO CLARIFYING QUESTION NEEDED/,
    );
    expect(screen.getByText(/Differential is clear/)).toBeInTheDocument();
  });
});
