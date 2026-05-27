// @vitest-environment jsdom
//
// app/console/refusal-card.test.tsx
//
// Asserts the RefusalCard contract (D14):
//   - Each RefusalKind renders verbatim in mono small-caps in the header.
//   - The next_action chip renders when provided.
//   - The Alert uses variant="safety" (amber background, NEVER red).

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { RefusalCard } from "./refusal-card";

describe("RefusalCard", () => {
  it("renders the RefusalKind verbatim in the header (unresolved_dangers)", () => {
    render(
      <RefusalCard
        kind="unresolved_dangers"
        message="Differential is too wide; cannot pick a guideline."
        next_action="Refer for senior review."
      />,
    );
    expect(screen.getByText("unresolved_dangers")).toBeInTheDocument();
  });

  it("renders the next_action chip when provided", () => {
    render(
      <RefusalCard
        kind="weight_missing"
        message="A weight is required to compute a paediatric dose."
        next_action="Provide a weight in kilograms."
      />,
    );
    expect(
      screen.getByText(/Provide a weight in kilograms/),
    ).toBeInTheDocument();
    // The chip prefix "Next:" reads as audit instruction text.
    expect(screen.getByText(/Next:/)).toBeInTheDocument();
  });

  it("uses Alert variant='safety' (amber), NEVER red", () => {
    const { container } = render(
      <RefusalCard
        kind="out_of_scope"
        message="No guideline modelled for this condition."
      />,
    );
    const alert = container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    // Safety variant uses the bg-safety class; destructive variant uses
    // text-destructive. We assert ONE present and the OTHER absent.
    expect(alert?.className).toMatch(/bg-safety/);
    expect(alert?.className).not.toMatch(/text-destructive/);
  });
});
