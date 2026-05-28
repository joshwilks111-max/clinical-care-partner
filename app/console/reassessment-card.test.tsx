// @vitest-environment jsdom
//
// app/console/reassessment-card.test.tsx
//
// Asserts the ReassessmentCard contract:
//   - Renders watch chips from watch_for[]
//   - Renders 2 branch buttons from next_branches[]
//   - "If worse" / escalate branch is amber-bordered
//   - universal_rails renders in the footer
//   - no_reassessment_required (reassess_in_minutes:null) renders a
//     single muted line INSTEAD of the full card

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import {
  ReassessmentCard,
  type ReassessmentCardProps,
} from "./reassessment-card";

const BASE: ReassessmentCardProps = {
  watch_for_summary: "Watch-for signs · two branches",
  next_steps_summary: "Reassess in 2 hours",
  reassess_in_minutes: 120,
  watch_for: ["stridor at rest", "work of breathing", "agitation → lethargy"],
  next_branches: [
    {
      if_severity_at_reassessment: "worse",
      then: "Escalate · adrenaline neb",
      escalate: true,
    },
    {
      if_severity_at_reassessment: "improving",
      then: "Continue obs · discharge plan",
    },
  ],
  universal_rails: [
    "any red-flag → senior airway support",
    "no airway manipulation if features change",
  ],
  source_version: "Starship 2020",
  source_url: "https://example.test/reassess",
};

describe("ReassessmentCard", () => {
  it("renders one watch chip per watch_for[] entry", () => {
    render(<ReassessmentCard {...BASE} />);
    expect(screen.getByText("stridor at rest")).toBeInTheDocument();
    expect(screen.getByText("work of breathing")).toBeInTheDocument();
    expect(screen.getByText(/agitation/)).toBeInTheDocument();
  });

  it("renders 2 branch buttons from next_branches[]", () => {
    render(<ReassessmentCard {...BASE} />);
    expect(screen.getByText("Escalate · adrenaline neb")).toBeInTheDocument();
    expect(
      screen.getByText("Continue obs · discharge plan"),
    ).toBeInTheDocument();
    // The if/then label pair is present
    expect(screen.getByText("If worse")).toBeInTheDocument();
    expect(screen.getByText("If improving")).toBeInTheDocument();
  });

  it("renders the escalate branch with amber-bordered safety styling", () => {
    render(<ReassessmentCard {...BASE} />);
    // The escalate branch button should carry the safety class signature.
    // We locate by its visible label and then assert the styling chain.
    const escalateButton = screen
      .getByText("Escalate · adrenaline neb")
      .closest("button");
    expect(escalateButton).not.toBeNull();
    expect(escalateButton?.className).toMatch(/safety/);
    // The non-escalate branch should NOT have a safety-border class.
    const improvingButton = screen
      .getByText("Continue obs · discharge plan")
      .closest("button");
    expect(improvingButton?.className).not.toMatch(/border-safety/);
  });

  it("renders universal_rails in the footer", () => {
    render(<ReassessmentCard {...BASE} />);
    expect(screen.getByText("Universal:")).toBeInTheDocument();
    expect(
      screen.getByText(/any red-flag → senior airway support/),
    ).toBeInTheDocument();
  });

  it("renders a single muted line when reassess_in_minutes is null (no_reassessment_required)", () => {
    render(<ReassessmentCard {...BASE} reassess_in_minutes={null} />);
    expect(
      screen.getByText("No structured reassessment for this drug."),
    ).toBeInTheDocument();
    // The full-card chips should NOT appear.
    expect(screen.queryByText("stridor at rest")).toBeNull();
    expect(screen.queryByText("Escalate · adrenaline neb")).toBeNull();
  });
});
