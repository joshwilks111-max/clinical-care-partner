// @vitest-environment jsdom
//
// app/console/turn1-view.test.tsx
//
// Component tests for the Turn 1 view, rendered against the typed fixture.
// Asserts the DESIGN.md contract:
//   - must-not-miss surfaces FIRST even though the fixture lists it second (D1),
//   - negative evidence renders as muted pills (D5),
//   - the "your turn" guideline buttons are gated on weight confirmation (D3),
//   - the LLM-differential + clinician-selected provenance badges are present.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { Turn1View } from "./turn1-view";
import { FIXTURE_TURN1_SUCCESS } from "./fixtures";

describe("Turn1View — differential ranking (D1)", () => {
  it("renders the must-not-miss condition FIRST despite fixture order", () => {
    render(
      <Turn1View
        turn1={FIXTURE_TURN1_SUCCESS}
        onSelectGuideline={() => {}}
        weightConfirmed={false}
      />,
    );
    const rows = Array.from(
      document.querySelectorAll("[data-condition]"),
    ) as HTMLElement[];
    // The fixture lists Croup (likely) first and Epiglottitis (must-not-miss)
    // second; the view must reorder must-not-miss to the top.
    expect(rows[0]?.getAttribute("data-condition")).toBe("Epiglottitis");
    expect(
      rows[0]
        ?.querySelector("[data-likelihood]")
        ?.getAttribute("data-likelihood"),
    ).toBe("must-not-miss");
  });
});

describe("Turn1View — negative evidence (D5)", () => {
  it("renders absent findings as muted pills", () => {
    render(
      <Turn1View
        turn1={FIXTURE_TURN1_SUCCESS}
        onSelectGuideline={() => {}}
        weightConfirmed={false}
      />,
    );
    const pills = document.querySelectorAll("[data-negative-evidence]");
    expect(pills.length).toBeGreaterThan(0);
    // The croup row's absent findings include "drooling".
    const text = Array.from(pills).map((p) => p.textContent);
    expect(text).toContain("drooling");
  });
});

describe("Turn1View — the 'your turn' affordance (D3)", () => {
  it("disables guideline buttons until the weight is confirmed", () => {
    render(
      <Turn1View
        turn1={FIXTURE_TURN1_SUCCESS}
        onSelectGuideline={() => {}}
        weightConfirmed={false}
      />,
    );
    const btn = document.querySelector(
      '[data-guideline-id="starship-croup-2020"]',
    ) as HTMLButtonElement;
    expect(btn).toBeDisabled();
    expect(screen.getByTestId("confirm-weight-first")).toBeInTheDocument();
  });

  it("enables the guideline button once weight is confirmed and fires the callback", () => {
    const onSelect = vi.fn();
    render(
      <Turn1View
        turn1={FIXTURE_TURN1_SUCCESS}
        onSelectGuideline={onSelect}
        weightConfirmed={true}
      />,
    );
    const btn = document.querySelector(
      '[data-guideline-id="starship-croup-2020"]',
    ) as HTMLButtonElement;
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(onSelect).toHaveBeenCalledWith("starship-croup-2020", "croup");
  });
});

describe("Turn1View — provenance seam (D6)", () => {
  it("badges the differential as LLM judgment and the buttons as clinician-selected", () => {
    render(
      <Turn1View
        turn1={FIXTURE_TURN1_SUCCESS}
        onSelectGuideline={() => {}}
        weightConfirmed={true}
      />,
    );
    expect(
      document.querySelector('[data-provenance="llm-differential"]'),
    ).toBeInTheDocument();
    expect(
      document.querySelector('[data-provenance="clinician-selected"]'),
    ).toBeInTheDocument();
  });
});
