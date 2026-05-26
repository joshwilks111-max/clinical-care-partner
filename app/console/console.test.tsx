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
    expect(screen.getByLabelText(/paste your own note/i)).toBeInTheDocument();
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
    expect(screen.getByTestId("case-panel")).toHaveTextContent(/The case/i);
  });
});

describe("Console — refusal flow (amber)", () => {
  it("POSTs the prefilled note to /api/turn1 and renders an amber refusal", async () => {
    // Type the mock with fetch's own signature so the recorded call args
    // (fetchMock.mock.calls[0]) are a proper [input, init?] tuple — not the
    // zero-arg [] a param-less mock infers, which can't be cast to a 2-tuple.
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        status: "refusal",
        reason: "weight_missing",
        message: "Weight is required. I will not estimate it.",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<Console />);
    fireEvent.click(
      document.querySelector('[data-demo-id="refusal"]') as HTMLButtonElement,
    );

    await waitFor(() => {
      expect(screen.getByTestId("turn1-refusal")).toBeInTheDocument();
    });

    // It POSTed to /api/turn1 with the prefilled note (no typing). The mock is
    // typed with fetch's signature, so calls[0] is a proper [input, init?] tuple.
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/turn1");
    const sentNote = JSON.parse((init as RequestInit).body as string)
      .note as string;
    expect(sentNote).toBe(DEMO_NOTES.find((d) => d.id === "refusal")?.note);

    // The refusal renders amber (the safety Alert), not red.
    const refusal = screen.getByTestId("turn1-refusal");
    expect(refusal).toHaveAttribute("data-slot", "alert");
    expect(refusal).toHaveTextContent(/DELIBERATE ABSTENTION/);
  });
});

describe("Console — paste-your-own intake (Task B, free-form note/transcript)", () => {
  it("renders the labelled textarea and a disabled Run until text is entered", () => {
    render(<Console />);
    const ta = screen.getByLabelText(/paste your own note/i);
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
    fireEvent.change(screen.getByLabelText(/paste your own note/i), {
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
    const ta = screen.getByLabelText(/paste your own note/i);
    fireEvent.change(ta, { target: { value: "barky cough, no weight" } });
    fireEvent.keyDown(ta, { key: "Enter", ctrlKey: true });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/turn1");
  });

  it("both transcript demo buttons are present and POST their fixture notes", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        status: "refusal",
        reason: "weight_missing",
        message: "x",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<Console />);
    for (const id of ["transcript-croup", "transcript-noweight"] as const) {
      const btn = document.querySelector(`[data-demo-id="${id}"]`);
      expect(btn).toBeInTheDocument();
    }
    fireEvent.click(
      document.querySelector(
        '[data-demo-id="transcript-noweight"]',
      ) as HTMLButtonElement,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const sent = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string,
    ).note as string;
    expect(sent).toBe(
      DEMO_NOTES.find((d) => d.id === "transcript-noweight")?.note,
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
        // decide → plan short-circuit → ok (0 model calls). The croup demo case.
        return jsonResponse({
          status: "ok",
          guidelineId: "starship-croup-2020",
          caseState: FIXTURE_TURN1_SUCCESS.caseState,
          provenance: {
            phase: "decide",
            action: "plan",
            target: null,
            round: 0,
          },
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
    fireEvent.change(screen.getByLabelText(/paste your own note/i), {
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
    const ta = screen.getByLabelText(/paste your own note/i);
    fireEvent.change(ta, { target: { value: "   \n  " } });
    fireEvent.keyDown(ta, { key: "Enter", metaKey: true }); // Mac path too
    // Give any erroneous async call a tick to fire; assert none did.
    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// THE HONESTY INVARIANT — the urgent abstention copy must reflect the condition
// the SERVER identified, never a hardcoded one. These tests drive the real
// Console flow (turn1 → turn1.5 ask → answer not_assessed → abstention) through
// the fetch router, varying ONLY the server's `target`, and assert the rendered
// eyebrow/headline track it. A hardcoded "epiglottitis" string would fail the
// non-epiglottitis-target test below — that test is the data-driven proof.
// ===========================================================================

/** A turn1.5 "ask" wire response with the given must-not-miss target. */
function askResponse(target: string, discriminators: string[]) {
  return {
    status: "ask",
    question: `Is there ${discriminators.join(" or ")}?`,
    target,
    discriminators,
    provenance: { phase: "decide", action: "ask", target, round: 0 },
  };
}

/** The turn1.5 abstention wire shape — the MACHINE reason stays
 *  no_matching_guideline (server-side, unchanged); the headline/detail are the
 *  server fallbacks the UI uses ONLY when there was no prior ask. */
function abstentionResponse() {
  return {
    status: "abstention",
    reason: "no_matching_guideline",
    headline:
      "No local guideline matches this condition. I will not guess a plan from outside the registry.",
    detail: "Only croup and anaphylaxis are in the committed registry for v1.",
    source: "no-guideline",
  };
}

/**
 * Render the Console and drive it through: croup demo → confirm weight →
 * turn1.5 "decide" returns the given ask → answer "not_assessed" → turn1.5
 * "answer" returns an abstention. Returns once the abstention has rendered.
 */
async function driveToAbstentionViaAsk(
  target: string,
  discriminators: string[],
) {
  let turn15Calls = 0;
  const fetchMock = vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    if (url === "/api/turn1") return jsonResponse(FIXTURE_TURN1_SUCCESS);
    if (url === "/api/turn1.5") {
      turn15Calls += 1;
      // 1st turn1.5 (decide) → ask; 2nd turn1.5 (answer not_assessed) → abstain.
      return turn15Calls === 1
        ? jsonResponse(askResponse(target, discriminators))
        : jsonResponse(abstentionResponse());
    }
    return jsonResponse(FIXTURE_TURN2_OK); // turn2 — should not be reached here.
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
  // The ask card appears.
  await waitFor(() =>
    expect(screen.getByTestId("safety-check-card")).toBeInTheDocument(),
  );
  // "Not assessed" → fail-closed → abstention.
  fireEvent.click(
    document.querySelector('[data-answer="not_assessed"]') as HTMLButtonElement,
  );
  await waitFor(() =>
    expect(screen.getByTestId("turn15-abstention")).toBeInTheDocument(),
  );
}

describe("Console — turn-1.5 abstention copy is data-driven (the honesty invariant)", () => {
  it("renders the ACTUAL identified target (epiglottitis) in the urgent copy", async () => {
    await driveToAbstentionViaAsk("Epiglottitis", [
      "drooling",
      "tripod posture",
      "muffled voice",
    ]);
    const block = screen.getByTestId("turn15-abstention");
    // Eyebrow + headline name the server-identified condition.
    expect(screen.getByTestId("turn15-abstention-alert")).toHaveTextContent(
      "SUSPECTED EPIGLOTTITIS",
    );
    expect(block).toHaveTextContent(/possible epiglottitis/i);
    // The discriminators the server sent drive the rationale line.
    expect(block).toHaveTextContent(
      /drooling \/ tripod posture \/ muffled voice/,
    );
  });

  it("renders a DIFFERENT identified target (bacterial tracheitis), NOT a hardcoded epiglottitis — the data-driven proof", async () => {
    // THE PROOF: the only reachable demo abstention happens to be croup/
    // epiglottitis, so a hardcoded string passes on camera. Here the SERVER
    // identifies a different must-not-miss — the UI MUST follow it.
    await driveToAbstentionViaAsk("Bacterial tracheitis", [
      "high fever",
      "toxic appearance",
    ]);
    const block = screen.getByTestId("turn15-abstention");
    expect(screen.getByTestId("turn15-abstention-alert")).toHaveTextContent(
      "SUSPECTED BACTERIAL TRACHEITIS",
    );
    expect(block).toHaveTextContent(/possible bacterial tracheitis/i);
    expect(block).toHaveTextContent(/high fever \/ toxic appearance/);
    // It must NOT have invented the old hardcoded condition.
    expect(block).not.toHaveTextContent(/epiglottitis/i);
  });

  it("falls back to the SERVER headline/detail when there was NO prior ask (lastAsk null)", async () => {
    // A decide-phase abstention with no ask first → lastAsk stays null → the
    // component renders the server's own copy, never a hardcoded condition.
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url === "/api/turn1") return jsonResponse(FIXTURE_TURN1_SUCCESS);
      if (url === "/api/turn1.5") return jsonResponse(abstentionResponse());
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
      expect(screen.getByTestId("turn15-abstention")).toBeInTheDocument(),
    );
    const block = screen.getByTestId("turn15-abstention");
    // The honest fallback: the SERVER's headline + detail, no fabricated condition.
    expect(block).toHaveTextContent(
      /No local guideline matches this condition/,
    );
    expect(block).toHaveTextContent(
      /Only croup and anaphylaxis are in the committed registry/,
    );
    // No "SUSPECTED <X>" claim and no invented condition name.
    expect(block).not.toHaveTextContent(/SUSPECTED/);
    expect(block).not.toHaveTextContent(/epiglottitis/i);
  });
});

describe("Console — must-not-miss CLEARED banner is data-driven", () => {
  it("templates the ruled-out condition NAME from the identified target", async () => {
    // Drive: croup → confirm → ask (Epiglottitis) → answer "absent" →
    // answer-ok (the must-not-miss cleared) → the cleared banner + Turn 2.
    let turn15Calls = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url === "/api/turn1") return jsonResponse(FIXTURE_TURN1_SUCCESS);
      if (url === "/api/turn1.5") {
        turn15Calls += 1;
        if (turn15Calls === 1) {
          return jsonResponse(
            askResponse("Epiglottitis", ["drooling", "tripod posture"]),
          );
        }
        // answer "absent" cleared the must-not-miss → answer-ok.
        return jsonResponse({
          status: "ok",
          guidelineId: "starship-croup-2020",
          caseState: FIXTURE_TURN1_SUCCESS.caseState,
          provenance: {
            phase: "answer",
            action: "plan",
            target: null,
            round: 1,
          },
        });
      }
      return jsonResponse(FIXTURE_TURN2_OK); // auto-run Turn 2 after clear.
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
      expect(screen.getByTestId("safety-check-card")).toBeInTheDocument(),
    );
    fireEvent.click(
      document.querySelector('[data-answer="absent"]') as HTMLButtonElement,
    );
    await waitFor(() =>
      expect(screen.getByTestId("turn15-cleared")).toBeInTheDocument(),
    );
    // The cleared banner names the EXACT condition that was ruled out.
    expect(screen.getByTestId("turn15-cleared")).toHaveTextContent(
      /Epiglottitis ruled out/,
    );

    // Regression guard for the answer-ok selected_condition seeding bug: the
    // turn2 POST body must carry selected_condition:"croup" (derived from the
    // registry via getGuideline("starship-croup-2020")?.condition). Without this,
    // turn2's auditRoutedGuideline sees "" ≠ "croup" and returns wrong_guideline.
    await waitFor(() =>
      expect(screen.getByTestId("turn2-ok")).toBeInTheDocument(),
    );
    const turn2Calls = fetchMock.mock.calls.filter(
      ([url]) => String(url) === "/api/turn2",
    );
    expect(turn2Calls).toHaveLength(1);
    const turn2Body = JSON.parse(
      (turn2Calls[0][1] as RequestInit).body as string,
    ) as { caseState: Record<string, unknown> };
    expect(turn2Body.caseState.selected_condition).toBe("croup");
    expect(turn2Body.caseState.selected_guideline_id).toBe(
      "starship-croup-2020",
    );
  });
});

// Minimal Response-like stub for the mocked fetch.
function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    json: async () => body,
  } as Response;
}
