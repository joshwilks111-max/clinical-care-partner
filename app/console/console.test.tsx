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
import { DEMO_NOTES } from "./fixtures";

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

  it("POSTs the TYPED text verbatim to /api/turn1 (the single trust-boundary path)", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        status: "refusal",
        reason: "weight_missing",
        message: "Weight is required.",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<Console />);
    const typed = "Parent: barky cough, stridor at rest. Doctor: weight?";
    fireEvent.change(screen.getByLabelText(/paste your own note/i), {
      target: { value: typed },
    });
    fireEvent.click(screen.getByTestId("paste-run"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    // The endpoint MUST be /api/turn1 (a bypass refactor would change this) and
    // the body note MUST equal the typed string verbatim.
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/turn1");
    const sentNote = JSON.parse((init as RequestInit).body as string)
      .note as string;
    expect(sentNote).toBe(typed);
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

  it("running a demo, then pasting+running, clears stale turn-1 state", async () => {
    // First call returns an OK-ish refusal so turn1 renders; second call (the
    // paste) returns a fresh refusal. The reset means we never show two stacked
    // turn-1 results — the second render replaces the first.
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        status: "refusal",
        reason: "weight_missing",
        message: "Weight is required.",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<Console />);
    fireEvent.click(
      document.querySelector('[data-demo-id="refusal"]') as HTMLButtonElement,
    );
    await waitFor(() =>
      expect(screen.getByTestId("turn1-refusal")).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByLabelText(/paste your own note/i), {
      target: { value: "different note, still no weight" },
    });
    fireEvent.click(screen.getByTestId("paste-run"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    // Exactly one refusal alert at a time (reset cleared the prior turn-1).
    expect(screen.getAllByTestId("turn1-refusal")).toHaveLength(1);
  });
});

// Minimal Response-like stub for the mocked fetch.
function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    json: async () => body,
  } as Response;
}
