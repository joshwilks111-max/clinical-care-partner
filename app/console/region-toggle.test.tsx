// @vitest-environment jsdom
//
// app/console/region-toggle.test.tsx
//
// Asserts the RegionToggle contract (D16):
//   - Reads the region cookie on mount (defaults NZ).
//   - Switching region prompts a confirm dialog.
//   - On confirm, the region cookie is written AND the session cookie
//     is deleted AND the page reloads.

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

import { RegionToggle } from "./region-toggle";

// jsdom doesn't implement HTMLElement.scrollIntoView() or
// Element.hasPointerCapture/setPointerCapture/releasePointerCapture —
// Radix's <Select> hits both on open. Polyfill them as no-ops so the
// component opens cleanly under test. These are the canonical jsdom
// gaps for Radix; the polyfill is identical across every project that
// runs vitest + Radix + jsdom.
beforeAll(() => {
  if (!HTMLElement.prototype.scrollIntoView) {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    HTMLElement.prototype.scrollIntoView = function () {};
  }
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.setPointerCapture) {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    Element.prototype.setPointerCapture = function () {};
  }
  if (!Element.prototype.releasePointerCapture) {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    Element.prototype.releasePointerCapture = function () {};
  }
});

describe("RegionToggle", () => {
  beforeEach(() => {
    // Clear cookies between tests so the stub starts from a clean slate.
    document.cookie = "care-partner-region=; path=/; max-age=0; SameSite=Lax";
    document.cookie = "care-partner-session=; path=/; max-age=0; SameSite=Lax";
  });

  it("defaults to NZ on first mount", () => {
    render(<RegionToggle />);
    // The trigger renders the current value text. NZ is the default.
    expect(screen.getByLabelText("Region")).toHaveTextContent("NZ");
  });

  it("reads the cookie and reflects AU when set", async () => {
    document.cookie = "care-partner-region=AU; path=/; SameSite=Lax";
    render(<RegionToggle />);
    // useEffect runs after mount; act() flushes the state update.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.getByLabelText("Region")).toHaveTextContent("AU");
  });

  it("fires the confirm dialog AND clears the session cookie on switch", async () => {
    // Seed a session cookie so we can assert it gets cleared.
    document.cookie = "care-partner-session=abc123; path=/; SameSite=Lax";
    const confirmFn = vi.fn(() => true);
    const reloadFn = vi.fn();

    render(<RegionToggle confirmFn={confirmFn} reloadFn={reloadFn} />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // Drive Radix's <Select> via the lower-level keyboard/event API.
    // We open the trigger and click the AU item.
    const trigger = screen.getByLabelText("Region");
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(trigger);
    // Find and click the AU option — Radix renders it as role="option".
    const auOption = await screen.findByRole("option", { name: "AU" });
    fireEvent.click(auOption);

    expect(confirmFn).toHaveBeenCalledWith(
      "Switch region? This clears the current chat.",
    );
    expect(reloadFn).toHaveBeenCalled();
    // The session cookie should have been cleared (max-age=0 wins).
    expect(document.cookie).not.toMatch(/care-partner-session=abc123/);
    // The region cookie should now read AU.
    expect(document.cookie).toMatch(/care-partner-region=AU/);
  });
});
