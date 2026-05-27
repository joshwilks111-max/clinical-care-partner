// @vitest-environment jsdom
//
// app/console/session-rail.test.tsx
//
// Asserts the SessionRail contract (D4 / D15):
//   - All 5 demo sessions render.
//   - Clicking a session fires onLoadCase with the right note.
//   - The active session row carries the cream-2 + claret-left-border
//     styling signature.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { SessionRail, DEMO_SESSIONS } from "./session-rail";

describe("SessionRail", () => {
  it("renders all 5 demo sessions (D15)", () => {
    render(<SessionRail onLoadCase={() => {}} />);
    expect(DEMO_SESSIONS.length).toBe(5);
    // Each session's name should be present in the DOM.
    for (const s of DEMO_SESSIONS) {
      expect(screen.getByText(s.name)).toBeInTheDocument();
    }
  });

  it("fires onLoadCase with the right session when a row is clicked", () => {
    const onLoadCase = vi.fn();
    render(<SessionRail onLoadCase={onLoadCase} />);
    const target = DEMO_SESSIONS[2]; // mia-r-epiglottitis
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
