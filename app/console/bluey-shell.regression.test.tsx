// @vitest-environment jsdom
//
// app/console/bluey-shell.regression.test.tsx
//
// REGRESSION SUITE for the Bluey 3-column shell rebuild (DESIGN.md
// § "UI refresh — Bluey"). These 6+3 tests are MANDATORY per the
// /plan-eng-review locks — each one pins a non-obvious invariant that
// would silently rot the visual shell if the implementation drifted.
//
// 6 mandatory regression invariants (eng-review):
//   1. 3-column grid uses the locked widths (272 + 1fr + 392).
//   2. Bluey heeler SVG is in the left rail (no rebrand-without-mark fail).
//   3. Page title is "Bluey · Clinical care partner" (browser tab + bookmark).
//   4. Demo buttons live inside the rail aside (the new entry-point grammar).
//   5. Paste textarea lives inside the rail aside (the new entry-point grammar).
//   6. Empty-state copy renders before turn-1 runs (the eng-review-locked
//      "Pick a case to begin." — NOT "Ready when you are." Heidi-borrow).
//
// 3 high-value tests (also new):
//   7. activeDemoId flips on demo-button click (aria-current="true").
//   8. activeDemoId clears on paste-run (no rail row stays selected).
//   9. BlueyHeeler renders with aria-label + uses currentColor.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { Console } from "./console";
import { BlueyHeeler } from "@/components/icons/bluey-heeler";
import { metadata } from "@/app/layout";

afterEach(() => {
  vi.restoreAllMocks();
});

// ===========================================================================
// 1. 3-column grid on viewport ≥ 1100px
// ===========================================================================

describe("Bluey shell — 3-column grid (lock #2)", () => {
  it("renders a grid with locked widths 272px / 1fr / 392px", () => {
    render(<Console />);
    const shell = screen.getByTestId("bluey-shell");
    // The Tailwind arbitrary-value class encodes the locked widths in the
    // DOM. Asserting the substring (not equality) keeps this resilient to
    // additional sibling classes (h-screen, w-full, etc.) without losing
    // the regression signal — if the widths drift the substring fails.
    expect(shell.className).toContain("grid-cols-[272px_1fr_392px]");
  });
});

// ===========================================================================
// 2. Bluey heeler SVG is in the left rail
// ===========================================================================

describe("Bluey shell — heeler brand mark (lock #4)", () => {
  it("renders the heeler SVG inside an <aside> (the rail)", () => {
    render(<Console />);
    const heeler = screen.getByLabelText("Bluey");
    expect(heeler).toBeInTheDocument();
    // The heeler is wrapped by the rail aside (which carries data-testid="rail").
    const rail = heeler.closest("aside");
    expect(rail).not.toBeNull();
    expect(rail).toHaveAttribute("data-testid", "rail");
  });
});

// ===========================================================================
// 3. Page title metadata
// ===========================================================================

describe("Bluey shell — page title metadata (rebrand)", () => {
  it("exports the Bluey page title from app/layout", () => {
    // Direct import of metadata is the only way to assert this — jsdom does
    // not run the Next.js metadata pipeline, so document.title is unset in
    // unit tests.
    expect(metadata.title).toBe("Bluey · Clinical care partner");
  });
});

// ===========================================================================
// 4. Demo buttons live inside the rail aside
// ===========================================================================

describe("Bluey shell — demo buttons in the rail (lock #3)", () => {
  it("demo-buttons block has a parent <aside> with the rail testid", () => {
    render(<Console />);
    const demos = screen.getByTestId("demo-buttons");
    const rail = demos.closest("aside");
    expect(rail).not.toBeNull();
    expect(rail).toHaveAttribute("data-testid", "rail");
  });
});

// ===========================================================================
// 5. Paste textarea lives inside the rail aside
// ===========================================================================

describe("Bluey shell — paste textarea in the rail (lock #3)", () => {
  it("paste textarea has a parent <aside> with the rail testid", () => {
    render(<Console />);
    const ta = screen.getByLabelText(/patient note or transcript/i);
    const rail = ta.closest("aside");
    expect(rail).not.toBeNull();
    expect(rail).toHaveAttribute("data-testid", "rail");
  });
});

// ===========================================================================
// 6. Empty state "Pick a case to begin." renders before turn-1
// ===========================================================================

describe("Bluey shell — canvas empty state (lock #5, original copy)", () => {
  it("renders the eng-review-locked copy before any demo/paste runs", () => {
    render(<Console />);
    const empty = screen.getByTestId("canvas-empty");
    expect(empty).toBeInTheDocument();
    // Exact copy lock (eng-review #5) — NOT "Ready when you are."
    expect(empty).toHaveTextContent(/Pick a case to begin\./i);
    expect(empty).toHaveTextContent(
      /Click a demo case in the rail, or paste a clinical note\./i,
    );
  });
});

// ===========================================================================
// 7. activeDemoId flips on demo click
// ===========================================================================

describe("Bluey shell — activeDemoId on demo click (lock #9)", () => {
  it("sets aria-current='true' on the clicked demo row", () => {
    // fetch is stubbed because runTurn1 fires on click; we only care about
    // the synchronous aria-current state change, not the response.
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        ({
          ok: true,
          json: async () => ({
            status: "refusal",
            reason: "weight_missing",
            message: "x",
          }),
        }) as Response,
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<Console />);
    const croup = document.querySelector(
      '[data-demo-id="croup"]',
    ) as HTMLElement;
    expect(croup).toHaveAttribute("aria-current", "false");
    fireEvent.click(croup);
    // aria-current flips synchronously (state lives on the parent, plain
    // React setState).
    expect(croup).toHaveAttribute("aria-current", "true");
  });
});

// ===========================================================================
// 8. activeDemoId clears on paste-run
// ===========================================================================

describe("Bluey shell — activeDemoId clears on paste-run (lock #9)", () => {
  it("no rail row stays aria-current='true' after a paste-run", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        ({
          ok: true,
          json: async () => ({
            status: "refusal",
            reason: "weight_missing",
            message: "x",
          }),
        }) as Response,
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<Console />);
    // First, click a demo to set activeDemoId.
    fireEvent.click(
      document.querySelector('[data-demo-id="croup"]') as HTMLElement,
    );
    expect(document.querySelector('[data-demo-id="croup"]')).toHaveAttribute(
      "aria-current",
      "true",
    );

    // Wait for the demo's fetch to resolve so the busy flag clears (otherwise
    // the shadcn Button's disabled:pointer-events-none swallows the next click).
    // This mirrors the realistic user flow: 'I clicked the demo, saw the
    // refusal, now I want to paste a different note.'
    await waitFor(() =>
      expect(screen.getByTestId("turn1-refusal")).toBeInTheDocument(),
    );

    // Then paste-run with the Run button (now enabled).
    fireEvent.change(screen.getByLabelText(/patient note or transcript/i), {
      target: { value: "barky cough, no weight" },
    });
    fireEvent.click(screen.getByTestId("paste-run"));

    // Every demo row is now aria-current="false".
    const rows = document.querySelectorAll("[data-demo-id]");
    for (const row of Array.from(rows)) {
      expect(row).toHaveAttribute("aria-current", "false");
    }
  });
});

// ===========================================================================
// 9. BlueyHeeler component-level smoke
// ===========================================================================

describe("BlueyHeeler component", () => {
  it("renders an SVG with the Bluey aria-label", () => {
    const { container } = render(<BlueyHeeler />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute("aria-label", "Bluey");
    // fill="currentColor" is the IP-safe + theme-respecting contract.
    expect(svg).toHaveAttribute("fill", "currentColor");
  });
});
