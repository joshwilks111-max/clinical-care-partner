// @vitest-environment jsdom
//
// app/console/note-pane.test.tsx
//
// Asserts the NotePane contract (D4):
//   - Pasted note renders inside the textarea (controlled component).
//   - Collapsed facts accordion toggles open/closed.
//   - Case-header avatar uses correct two-letter initials from patientName.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { NotePane } from "./note-pane";

const NOTE =
  "Jack T, 3yo, 14.2 kg. Barky cough, stridor at rest. ?croup — moderate. Dose?";

describe("NotePane", () => {
  it("renders the pasted note in the textarea", () => {
    render(
      <NotePane note={NOTE} onNoteChange={() => {}} patientName="Jack T" />,
    );
    const textarea = screen.getByLabelText(
      "Clinical note",
    ) as HTMLTextAreaElement;
    expect(textarea.value).toBe(NOTE);
  });

  it("toggles the extracted-facts accordion when the trigger is clicked", () => {
    render(
      <NotePane
        note={NOTE}
        onNoteChange={() => {}}
        patientName="Jack T"
        facts={{
          condition: "croup",
          severity: "moderate",
          age_years: 3,
          weight_kg: 14.2,
        }}
      />,
    );
    // The accordion trigger is the "EXTRACTED FACTS" button.
    const trigger = screen.getByRole("button", { name: /extracted facts/i });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    // Once open, the facts table should show the weight value.
    expect(screen.getByText("14.2 kg")).toBeInTheDocument();
  });

  it("renders the case-header avatar with correct two-letter initials", () => {
    const { rerender } = render(
      <NotePane note="" onNoteChange={() => {}} patientName="Jack T" />,
    );
    expect(screen.getByText("JT")).toBeInTheDocument();

    rerender(
      <NotePane note="" onNoteChange={() => {}} patientName="Mia Rangi" />,
    );
    expect(screen.getByText("MR")).toBeInTheDocument();

    // Missing name → "—" placeholder, no crash.
    rerender(<NotePane note="" onNoteChange={() => {}} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
