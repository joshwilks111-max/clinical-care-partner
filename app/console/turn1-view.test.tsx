// @vitest-environment jsdom
//
// app/console/turn1-view.test.tsx
//
// Component tests for the Turn 1 differential view AND the Turn-1 decision gate,
// rendered against the typed fixture. After the Beat-4 split these are TWO
// components in one file: Turn1View renders ONLY the differential (it enables
// nothing); Turn1DecisionGate renders the dose-enabling guideline buttons.
//
// Asserts the DESIGN.md contract:
//   - must-not-miss surfaces FIRST even though the fixture lists it second (D1),
//   - negative evidence renders as muted pills (D5),
//   - the differential is badged LLM judgment (D6),
//   - the "your turn" guideline buttons (now in Turn1DecisionGate) are gated on
//     weight confirmation and fire the callback (D3), badged clinician-selected.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { Turn1View, Turn1DecisionGate } from "./turn1-view";
import { FIXTURE_TURN1_SUCCESS } from "./fixtures";

describe("Turn1View — differential ranking (D1)", () => {
  it("renders the must-not-miss condition FIRST despite fixture order", () => {
    render(<Turn1View turn1={FIXTURE_TURN1_SUCCESS} />);
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

  it("does NOT render the dose-enabling guideline buttons (the split)", () => {
    // The differential view enables nothing: the buttons live in the gate, which
    // the shell renders ONLY on a turn-1.5 status:"ok". Proves the split is real.
    render(<Turn1View turn1={FIXTURE_TURN1_SUCCESS} />);
    expect(
      document.querySelector('[data-guideline-id="starship-croup-2020"]'),
    ).not.toBeInTheDocument();
  });
});

describe("Turn1View — negative evidence (D5)", () => {
  it("renders absent findings as muted pills", () => {
    render(<Turn1View turn1={FIXTURE_TURN1_SUCCESS} />);
    const pills = document.querySelectorAll("[data-negative-evidence]");
    expect(pills.length).toBeGreaterThan(0);
    // The croup row's absent findings include "drooling".
    const text = Array.from(pills).map((p) => p.textContent);
    expect(text).toContain("drooling");
  });
});

describe("Turn1View — provenance seam (D6, differential side)", () => {
  it("badges the differential as LLM judgment", () => {
    render(<Turn1View turn1={FIXTURE_TURN1_SUCCESS} />);
    expect(
      document.querySelector('[data-provenance="llm-differential"]'),
    ).toBeInTheDocument();
  });
});

describe("Turn1DecisionGate — the 'your turn' affordance (D3)", () => {
  it("disables guideline buttons until the weight is confirmed", () => {
    render(
      <Turn1DecisionGate
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
      <Turn1DecisionGate
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
    // FIX 1 (P0) — the click carries the guideline's REGISTERED condition.
    expect(onSelect).toHaveBeenCalledWith("starship-croup-2020", "croup");
  });
});

describe("Turn1DecisionGate — provenance seam (D6, clinician side)", () => {
  it("badges the buttons as clinician-selected", () => {
    render(
      <Turn1DecisionGate
        turn1={FIXTURE_TURN1_SUCCESS}
        onSelectGuideline={() => {}}
        weightConfirmed={true}
      />,
    );
    expect(
      document.querySelector('[data-provenance="clinician-selected"]'),
    ).toBeInTheDocument();
  });
});
