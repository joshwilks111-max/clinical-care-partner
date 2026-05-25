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

  it("has no chatbot composer / Conversation shell (it is a structured console)", () => {
    render(<Console />);
    // A chat shell would expose a free-text message input + send. The console
    // has neither — the reviewer drives it entirely with demo buttons.
    expect(document.querySelector("textarea")).not.toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText(/type|message|ask/i),
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
    const fetchMock = vi.fn(async () =>
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

    // It POSTed to /api/turn1 with the prefilled note (no typing).
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/turn1");
    const sentNote = JSON.parse(init.body as string).note as string;
    expect(sentNote).toBe(DEMO_NOTES.find((d) => d.id === "refusal")?.note);

    // The refusal renders amber (the safety Alert), not red.
    const refusal = screen.getByTestId("turn1-refusal");
    expect(refusal).toHaveAttribute("data-slot", "alert");
    expect(refusal).toHaveTextContent(/DELIBERATE ABSTENTION/);
  });
});

// Minimal Response-like stub for the mocked fetch.
function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    json: async () => body,
  } as Response;
}
