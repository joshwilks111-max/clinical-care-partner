// @vitest-environment jsdom
//
// app/console/ask-user-form.test.tsx
//
// Asserts the AskUserForm contract:
//   - weight kind → number input with "kg" suffix
//   - condition kind → text input
//   - severity kind → <Select> with mild | moderate | severe
//   - submit fires onSubmit with the typed answer

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { AskUserForm } from "./ask-user-form";

describe("AskUserForm", () => {
  it("weight kind renders a number input with kg suffix", () => {
    render(
      <AskUserForm
        kind="weight"
        question="What is the patient's weight in kilograms?"
        onSubmit={() => {}}
      />,
    );
    const input = screen.getByLabelText(
      "What is the patient's weight in kilograms?",
    ) as HTMLInputElement;
    expect(input.type).toBe("number");
    expect(screen.getByText("kg")).toBeInTheDocument();
  });

  it("condition kind renders a text input", () => {
    render(
      <AskUserForm
        kind="condition"
        question="What condition are you treating?"
        onSubmit={() => {}}
      />,
    );
    const input = screen.getByLabelText(
      "What condition are you treating?",
    ) as HTMLInputElement;
    expect(input.type).toBe("text");
  });

  it("severity kind renders a Select trigger (mild | moderate | severe)", () => {
    render(
      <AskUserForm kind="severity" question="Severity?" onSubmit={() => {}} />,
    );
    // The select trigger has role="combobox" via Radix; we locate by aria-label.
    const trigger = screen.getByLabelText("Severity?");
    expect(trigger).toBeInTheDocument();
    // Placeholder is visible until the user picks a value.
    expect(screen.getByText("Select severity")).toBeInTheDocument();
  });

  it("submit fires onSubmit with the trimmed answer", () => {
    const onSubmit = vi.fn();
    render(
      <AskUserForm
        kind="weight"
        question="Weight in kg?"
        onSubmit={onSubmit}
      />,
    );
    const input = screen.getByLabelText("Weight in kg?") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "14.2" } });
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));
    expect(onSubmit).toHaveBeenCalledWith("14.2");
  });
});
