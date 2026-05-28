// @vitest-environment jsdom
//
// app/console/session-rail.test.tsx
//
// Asserts the SessionRail contract (D4 / D15):
//   - Every eval case (lib/eval-cases.ts) renders as a row.
//   - case-1-jack-nz is FIRST (the real Heidi full note anchors the demo).
//   - The distinct group headers render (generic group renderer, not the old
//     hardcoded Today/Yesterday filter — a regression guard for the bug where
//     a non-Today/Yesterday group rendered nothing).
//   - Clicking a row fires onLoadCase with the right case (id + note).
//   - The active row carries the cream-2 + claret-left-border styling signature.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { SessionRail, DEMO_SESSIONS } from "./session-rail";

describe("SessionRail", () => {
  it("renders a row for every eval case", () => {
    render(<SessionRail onLoadCase={() => {}} />);
    expect(DEMO_SESSIONS.length).toBeGreaterThanOrEqual(10);
    for (const s of DEMO_SESSIONS) {
      expect(screen.getByText(s.name)).toBeInTheDocument();
    }
  });

  it("renders case-1-jack-nz first (the real Heidi full note)", () => {
    expect(DEMO_SESSIONS[0].id).toBe("case-1-jack-nz");
  });

  it("renders a header for each distinct group (generic group renderer)", () => {
    render(<SessionRail onLoadCase={() => {}} />);
    const groups = [...new Set(DEMO_SESSIONS.map((s) => s.group))];
    // More than one group exists, and each header text is in the DOM. This is
    // the regression guard: the old code hardcoded "Today"/"Yesterday" filters,
    // so any other group value rendered zero rows.
    expect(groups.length).toBeGreaterThan(1);
    for (const g of groups) {
      expect(screen.getByText(g)).toBeInTheDocument();
    }
  });

  it("fires onLoadCase with the right session when a row is clicked", () => {
    const onLoadCase = vi.fn();
    render(<SessionRail onLoadCase={onLoadCase} />);
    const target = DEMO_SESSIONS[0]; // case-1-jack-nz
    fireEvent.click(screen.getByText(target.name));
    expect(onLoadCase).toHaveBeenCalledTimes(1);
    expect(onLoadCase).toHaveBeenCalledWith(
      expect.objectContaining({
        id: target.id,
        note: target.note,
      }),
    );
  });

  it("renders the active row with the cream-2 + claret-left-border styling signature", () => {
    const active = DEMO_SESSIONS[0];
    render(<SessionRail activeSessionId={active.id} onLoadCase={() => {}} />);
    const activeButton = screen.getByText(active.name).closest("button");
    expect(activeButton).not.toBeNull();
    // aria-current="true" + bg-cream-2 + border-claret class chain.
    expect(activeButton?.getAttribute("aria-current")).toBe("true");
    expect(activeButton?.className).toMatch(/bg-\[var\(--cream-2\)\]/);
    expect(activeButton?.className).toMatch(/border-\[var\(--claret\)\]/);
  });
});
