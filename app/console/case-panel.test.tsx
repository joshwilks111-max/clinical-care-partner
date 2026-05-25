// @vitest-environment jsdom
//
// app/console/case-panel.test.tsx
//
// Component tests for the LEFT case panel. Asserts the note + extracted facts
// display and the one-click [Confirm weight] affordance (the human owns the
// safety-critical input — DESIGN.md trust boundary / D3).

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { CasePanel } from "./case-panel";
import { FIXTURE_TURN1_SUCCESS } from "./fixtures";

const facts = FIXTURE_TURN1_SUCCESS.extractedFacts;

describe("CasePanel", () => {
  it("displays the note and the extracted weight fact", () => {
    render(
      <CasePanel
        note="Jack T, 3yo, 14.2 kg. ?croup."
        facts={facts}
        weightConfirmed={false}
        onConfirmWeight={() => {}}
      />,
    );
    expect(screen.getByTestId("case-panel")).toHaveTextContent("Jack T");
    expect(screen.getByTestId("extracted-facts")).toHaveTextContent("14.2 kg");
  });

  it("surfaces a one-click Confirm-weight button and fires the callback", () => {
    const onConfirm = vi.fn();
    render(
      <CasePanel
        note="Jack T, 3yo, 14.2 kg. ?croup."
        facts={facts}
        weightConfirmed={false}
        onConfirmWeight={onConfirm}
      />,
    );
    const btn = screen.getByTestId("confirm-weight-button");
    expect(btn).toHaveTextContent("Confirm 14.2 kg");
    fireEvent.click(btn);
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("shows a confirmed state once the weight is confirmed", () => {
    render(
      <CasePanel
        note="Jack T, 3yo, 14.2 kg. ?croup."
        facts={facts}
        weightConfirmed={true}
        onConfirmWeight={() => {}}
      />,
    );
    expect(screen.getByTestId("confirm-weight")).toHaveTextContent(
      /Weight confirmed: 14.2 kg/,
    );
    // No confirm button once confirmed.
    expect(
      screen.queryByTestId("confirm-weight-button"),
    ).not.toBeInTheDocument();
  });
});
