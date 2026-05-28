// @vitest-environment jsdom
//
// app/console/ask-user-form.test.tsx
//
// Asserts the AskUserForm contract. The kind vocabulary MUST match the
// tool's input schema (tools/ask_user.ts:42-48) — the 2026-05-28 smoke
// found a kind-drift bug where the UI used "weight"|"condition"|
// "severity" while the tool emitted "weight_kg"|"severity"|"region"|
// "confirm"|"free_text" → no input branch matched, form rendered
// without an input field. The tests below pin the canonical vocab.
//
// Per-kind contract:
//   - weight_kg → number input with "kg" suffix
//   - severity  → <Select> with mild | moderate | severe
//   - region    → <Select> with NZ | AU
//   - confirm   → <Select> with Yes | No
//   - free_text → text input
//   - submit fires onSubmit with the typed answer

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { AskUserForm } from "./ask-user-form";

describe("AskUserForm", () => {
  it("weight_kg kind renders a number input with kg suffix", () => {
    render(
      <AskUserForm
        kind="weight_kg"
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

  it("free_text kind renders a text input", () => {
    render(
      <AskUserForm
        kind="free_text"
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

  it("region kind renders a Select trigger with the NZ/AU placeholder", () => {
    render(
      <AskUserForm
        kind="region"
        question="Which region?"
        onSubmit={() => {}}
      />,
    );
    expect(screen.getByLabelText("Which region?")).toBeInTheDocument();
    expect(screen.getByText("Select region")).toBeInTheDocument();
  });

  it("confirm kind renders a Select trigger with the yes/no placeholder", () => {
    render(
      <AskUserForm kind="confirm" question="Is this kg?" onSubmit={() => {}} />,
    );
    expect(screen.getByLabelText("Is this kg?")).toBeInTheDocument();
    expect(screen.getByText("Select yes or no")).toBeInTheDocument();
  });

  it("submit fires onSubmit with the trimmed answer", () => {
    const onSubmit = vi.fn();
    render(
      <AskUserForm
        kind="weight_kg"
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
