// @vitest-environment jsdom
//
// app/console/console.test.tsx
//
// Console shell tests — the wiring + the two-panel/no-chatbot contract. fetch is
// mocked so the flow is exercised WITHOUT a live model call. Asserts:
//   - the 1-click demo buttons are present and prefilled (no typing — X5),
//   - clicking the refusal demo → POST /api/turn1 → amber refusal renders,
//   - it is a two-panel console: a "The case" panel exists; no chat composer.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { Console } from "./console";
import {
  DEMO_NOTES,
  FIXTURE_TURN1_SUCCESS,
  FIXTURE_TURN2_OK,
} from "./fixtures";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Console — demo buttons (X5, no typing)", () => {
  it("renders one prefilled button per demo case", () => {
    render(<Console />);
    for (const demo of DEMO_NOTES) {
      const btn = document.querySelector(`[data-demo-id="${demo.id}"]`);
      expect(btn).toBeInTheDocument();
      expect(btn).toHaveTextContent(demo.label);
    }
  });

  it("is a structured console, not a chatbot composer shell", () => {
    render(<Console />);
    // The structured console has a labelled "paste your own note/transcript"
    // textarea (Task B — proves free-form intake) but NOT a chat composer: no
    // message/ask placeholder, no send button. The paste box runs the same
    // turn-1 flow as the demos; it is not a conversational message channel.
    expect(
      screen.getByLabelText(/patient note or transcript/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText(
        /^type a message|ask anything|send a message/i,
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^send$/i }),
    ).not.toBeInTheDocument();
  });

  it("renders the LEFT case panel (two-panel layout)", () => {
    render(<Console />);
    expect(screen.getByTestId("case-panel")).toBeInTheDocument();
    expect(screen.getByTestId("case-panel")).toHaveTextContent(
      /Extracted facts/i,
    );
  });
});

describe("Console — refusal flow (amber)", () => {
  it("pasting a weightless note renders an amber refusal, zero model calls", async () => {
    // Paste a realistic clinical note that has no kg weight → the pre-LLM gate
    // refuses before any model call. The refusal UI must be amber (safety Alert),
    // not red (technical error).
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        status: "refusal",
        reason: "weight_missing",
        message: "Weight is required. I will not estimate it.",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<Console />);
    fireEvent.change(screen.getByLabelText(/paste your own note/i), {
      target: {
        value:
          "Jack T, 3yo. Barky cough, stridor at rest, no cyanosis. ?croup.",
      },
    });
    fireEvent.click(screen.getByTestId("paste-run"));

    await waitFor(() => {
      expect(screen.getByTestId("turn1-refusal")).toBeInTheDocument();
    });

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/turn1");

    // The refusal renders amber (the safety Alert), not red.
    const refusal = screen.getByTestId("turn1-refusal");
    expect(refusal).toHaveAttribute("data-slot", "alert");
    expect(refusal).toHaveTextContent(/DELIBERATE ABSTENTION/);
  });
});

describe("Console — paste-your-own intake (Task B, free-form note/transcript)", () => {
  it("renders the labelled textarea and a disabled Run until text is entered", () => {
    render(<Console />);
    const ta = screen.getByLabelText(/patient note or transcript/i);
    expect(ta).toBeInTheDocument();
    const run = screen.getByTestId("paste-run");
    // Empty draft → Run disabled (no accidental empty POST).
    expect(run).toBeDisabled();
    fireEvent.change(ta, { target: { value: "   " } });
    expect(run).toBeDisabled(); // whitespace-only is still empty.
    fireEvent.change(ta, { target: { value: "5yo 14.2 kg barky cough" } });
    expect(run).not.toBeDisabled();
  });

  it("POSTs the typed text (trimmed, inner content preserved) to /api/turn1 — the single trust-boundary path", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        status: "refusal",
        reason: "weight_missing",
        message: "Weight is required.",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<Console />);
    // Surrounding whitespace on purpose: runTurn1 trims the OUTER whitespace
    // (so an accidental trailing newline can't change the note) but preserves
    // the inner content exactly — that is the precise "verbatim" guarantee.
    const inner = "Parent: barky cough, stridor at rest. Doctor: weight?";
    const typed = `\n  ${inner}  \n`;
    fireEvent.change(screen.getByLabelText(/patient note or transcript/i), {
      target: { value: typed },
    });
    fireEvent.click(screen.getByTestId("paste-run"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    // The endpoint MUST be /api/turn1 (a bypass refactor would change this) and
    // the body note MUST equal the trimmed typed string (inner content intact).
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/turn1");
    const sentNote = JSON.parse((init as RequestInit).body as string)
      .note as string;
    expect(sentNote).toBe(inner);
  });

  it("Cmd/Ctrl+Enter in the textarea runs turn-1", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        status: "refusal",
        reason: "weight_missing",
        message: "x",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<Console />);
    const ta = screen.getByLabelText(/patient note or transcript/i);
    fireEvent.change(ta, { target: { value: "barky cough, no weight" } });
    fireEvent.keyDown(ta, { key: "Enter", ctrlKey: true });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/turn1");
  });

  it("transcript demo button is present and POSTs its fixture note", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        status: "refusal",
        reason: "weight_missing",
        message: "x",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<Console />);
    const btn = document.querySelector('[data-demo-id="transcript-croup"]');
    expect(btn).toBeInTheDocument();

    fireEvent.click(btn as HTMLButtonElement);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const sent = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string,
    ).note as string;
    expect(sent).toBe(
      DEMO_NOTES.find((d) => d.id === "transcript-croup")?.note,
    );
  });

  it("pasting+running clears a stale turn-2 RESULT (non-vacuous reset proof)", async () => {
    // The reset that actually matters is setTurn2(null) on a new run: without it,
    // a previous note's DOSE result would still render under the fresh turn-1 —
    // the dangerous "two notes' analysis stacked" bug. Drive a full turn-1 →
    // turn-1.5 decide (plan short-circuit) → turn-2 (dose), then paste a new note
    // and assert the old dose is GONE.
    //
    // Confirming weight now ALWAYS calls turn1.5; we mock its decide phase to
    // return status:"ok" (plan) so the EXISTING guideline-button → turn2 flow is
    // unchanged (Jack's croup behaves exactly as before). A per-ENDPOINT router
    // is used (not a positional array) so the extra turn1.5 call can't desync the
    // sequence. The 2nd turn1 (paste) returns a refusal.
    let turn1Calls = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url === "/api/turn1") {
        turn1Calls += 1;
        // 1st turn1 = success differential; 2nd turn1 (paste) = refusal.
        return turn1Calls === 1
          ? jsonResponse(FIXTURE_TURN1_SUCCESS)
          : jsonResponse({
              status: "refusal",
              reason: "weight_missing",
              message: "Weight is required.",
            });
      }
      if (url === "/api/turn1.5") {
        return jsonResponse({
          status: "ok",
          recommended_condition: "Croup",
          recommended_guideline: "starship-croup-2020",
          rationale_summary: "No clarifying question needed.",
          caseState: FIXTURE_TURN1_SUCCESS.caseState,
        });
      }
      // /api/turn2 → dose ok.
      return jsonResponse(FIXTURE_TURN2_OK);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Console />);
    // Turn 1: success differential.
    fireEvent.click(
      document.querySelector('[data-demo-id="croup"]') as HTMLButtonElement,
    );
    await waitFor(() =>
      expect(screen.getByTestId("turn1-view")).toBeInTheDocument(),
    );
    // Confirm weight (left panel) → turn1.5 decide → plan ok → buttons appear.
    fireEvent.click(screen.getByTestId("confirm-weight-button"));
    await waitFor(() =>
      expect(
        document.querySelector('[data-guideline-id="starship-croup-2020"]'),
      ).toBeInTheDocument(),
    );
    // Pick the guideline → turn 2 → dose.
    fireEvent.click(
      document.querySelector(
        '[data-guideline-id="starship-croup-2020"]',
      ) as HTMLButtonElement,
    );
    await waitFor(() =>
      expect(screen.getByTestId("turn2-ok")).toBeInTheDocument(),
    );

    // New run via paste → refusal. The stale DOSE result must clear.
    fireEvent.change(screen.getByLabelText(/patient note or transcript/i), {
      target: { value: "different note, still no weight" },
    });
    fireEvent.click(screen.getByTestId("paste-run"));
    await waitFor(() =>
      expect(screen.getByTestId("turn1-refusal")).toBeInTheDocument(),
    );
    // Fails if setTurn2(null) were removed: the old dose would still be on screen.
    expect(screen.queryByTestId("turn2-ok")).not.toBeInTheDocument();
  });

  it("Cmd/Ctrl+Enter with whitespace-only input makes ZERO fetch calls (guard)", async () => {
    // The Run button is disabled on empty input, but the keyboard path calls
    // runTurn1 directly — its internal trim()+early-return is the real guard.
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        status: "refusal",
        reason: "weight_missing",
        message: "x",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<Console />);
    const ta = screen.getByLabelText(/patient note or transcript/i);
    fireEvent.change(ta, { target: { value: "   \n  " } });
    fireEvent.keyDown(ta, { key: "Enter", metaKey: true }); // Mac path too
    // Give any erroneous async call a tick to fire; assert none did.
    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Advisory Turn 1.5 — high-impact question card shows server target in copy
// ===========================================================================

function askResponse(target: string) {
  return {
    status: "ask",
    question: `Is there evidence of ${target.toLowerCase()}?`,
    target,
    discriminators: ["drooling", "tripod posture"],
    recommended_condition: "Croup",
    recommended_guideline: "starship-croup-2020",
    rationale_summary: "One question before dosing.",
    caseState: FIXTURE_TURN1_SUCCESS.caseState,
  };
}

describe("Console — turn-1.5 ask copy is data-driven", () => {
  it("renders the server-identified target in the high-impact eyebrow", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url === "/api/turn1") return jsonResponse(FIXTURE_TURN1_SUCCESS);
      if (url === "/api/turn1.5")
        return jsonResponse(askResponse("Epiglottitis"));
      return jsonResponse(FIXTURE_TURN2_OK);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Console />);
    fireEvent.click(
      document.querySelector('[data-demo-id="croup"]') as HTMLButtonElement,
    );
    await waitFor(() =>
      expect(screen.getByTestId("turn1-view")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId("confirm-weight-button"));
    await waitFor(() =>
      expect(
        screen.getByTestId("high-impact-question-card"),
      ).toBeInTheDocument(),
    );
    expect(screen.getByTestId("high-impact-eyebrow")).toHaveTextContent(
      /EPIGLOTTITIS/,
    );
  });
});

describe("Console — answer recorded does not auto-run Turn 2", () => {
  it("records answer then waits for clinician guideline click", async () => {
    let turn15Calls = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url === "/api/turn1") return jsonResponse(FIXTURE_TURN1_SUCCESS);
      if (url === "/api/turn1.5") {
        turn15Calls += 1;
        if (turn15Calls === 1) return jsonResponse(askResponse("Epiglottitis"));
        return jsonResponse({
          status: "recorded",
          recommended_condition: "Croup",
          recommended_guideline: "starship-croup-2020",
          caseState: FIXTURE_TURN1_SUCCESS.caseState,
        });
      }
      return jsonResponse(FIXTURE_TURN2_OK);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Console />);
    fireEvent.click(
      document.querySelector('[data-demo-id="croup"]') as HTMLButtonElement,
    );
    await waitFor(() =>
      expect(screen.getByTestId("turn1-view")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId("confirm-weight-button"));
    await waitFor(() =>
      expect(
        screen.getByTestId("high-impact-question-card"),
      ).toBeInTheDocument(),
    );
    fireEvent.click(
      document.querySelector('[data-answer="absent"]') as HTMLButtonElement,
    );
    await waitFor(() =>
      expect(screen.getByTestId("turn15-recorded")).toBeInTheDocument(),
    );
    expect(
      fetchMock.mock.calls.filter(([u]) => String(u) === "/api/turn2"),
    ).toHaveLength(0);
  });
});

// Minimal Response-like stub for the mocked fetch.
function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    json: async () => body,
  } as Response;
}
