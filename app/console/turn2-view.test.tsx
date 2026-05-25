// @vitest-environment jsdom
//
// app/console/turn2-view.test.tsx
//
// Component tests for the Turn 2 view — the keystone. Rendered against the typed
// fixtures (no live model call). Asserts the DESIGN.md state contract:
//   - all four `status` members render their distinct branch,
//   - amber (variant="safety") for incomplete + abstention; RED
//     (variant="destructive") ONLY for status:"error",
//   - the missing-field NAME is the headline on incomplete (the money-shot),
//   - the capped trace segment is styled distinctly,
//   - the ok state shows the dose headline + the green completeness card,
//   - provenance badges make the judgment→execution boundary visible.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { Turn2View } from "./turn2-view";
import {
  FIXTURE_TURN2_OK,
  FIXTURE_TURN2_CAPPED,
  FIXTURE_TURN2_INCOMPLETE,
  FIXTURE_TURN2_ABSTENTION,
  FIXTURE_TURN2_ERROR,
} from "./fixtures";

describe("Turn2View — status:ok", () => {
  it("renders the dose + drug + route as one bold headline", () => {
    render(<Turn2View result={FIXTURE_TURN2_OK} />);
    const headline = screen.getByTestId("dose-headline");
    expect(headline).toHaveTextContent("2.13 mg dexamethasone");
    expect(headline).toHaveTextContent("oral");
  });

  it("renders the deterministic dose-tool provenance badge", () => {
    render(<Turn2View result={FIXTURE_TURN2_OK} />);
    expect(
      document.querySelector('[data-provenance="dose-tool"]'),
    ).toBeInTheDocument();
  });

  it("renders a guideline-citation provenance badge and a clickable source link", () => {
    render(<Turn2View result={FIXTURE_TURN2_OK} />);
    expect(
      document.querySelector('[data-provenance="guideline-citation"]'),
    ).toBeInTheDocument();
    // source_url renders the resolved registry citation as a clickable link.
    const link = document.querySelector(
      'a[href*="starship.org.nz"]',
    ) as HTMLAnchorElement | null;
    expect(link).not.toBeNull();
    expect(link?.getAttribute("href")).toBe(
      "https://www.starship.org.nz/guidelines/croup/",
    );
  });

  it("shows the green completeness card (all fields present) — not the amber fired one", () => {
    render(<Turn2View result={FIXTURE_TURN2_OK} />);
    const card = screen.getByTestId("completeness-card");
    // The OK completeness card is the complete (green) variant, NOT the amber
    // fired one (which would carry variant="safety").
    expect(card).toHaveAttribute("data-complete", "true");
    expect(card.className).not.toContain("bg-safety");
    expect(card).toHaveTextContent(/Plan complete/i);
  });

  it("does NOT render a styled CAPPED segment when the dose is under cap", () => {
    render(<Turn2View result={FIXTURE_TURN2_OK} />);
    expect(screen.queryByTestId("cap-segment")).not.toBeInTheDocument();
  });
});

describe("Turn2View — status:ok (cap fired, D4)", () => {
  it("renders the CAPPED segment in the distinct amber accent", () => {
    render(<Turn2View result={FIXTURE_TURN2_CAPPED} />);
    const cap = screen.getByTestId("cap-segment");
    expect(cap).toHaveTextContent("→ CAPPED to 12 mg");
    // The capped segment carries the amber accent class (DESIGN.md D4).
    expect(cap.className).toContain("amber");
  });

  it("shows the capped dose as the bold headline", () => {
    render(<Turn2View result={FIXTURE_TURN2_CAPPED} />);
    expect(screen.getByTestId("dose-headline")).toHaveTextContent(
      "12 mg dexamethasone",
    );
  });
});

describe("Turn2View — status:incomplete (the money-shot)", () => {
  it("makes the missing field NAME the amber headline", () => {
    render(<Turn2View result={FIXTURE_TURN2_INCOMPLETE} />);
    const headline = screen.getByTestId("incomplete-headline");
    // amber = the safety Alert variant.
    expect(headline).toHaveAttribute("data-slot", "alert");
    expect(headline).toHaveTextContent("escalation_criteria");
    expect(headline).toHaveTextContent(/COMPLETENESS CHECK/);
  });

  it("renders the completeness gate as fired (amber, names the field)", () => {
    render(<Turn2View result={FIXTURE_TURN2_INCOMPLETE} />);
    const card = screen.getByTestId("completeness-card");
    expect(card).toHaveAttribute("data-slot", "alert");
    expect(card).toHaveTextContent("escalation_criteria");
  });

  it("still renders the (incomplete) plan, not a blank screen", () => {
    render(<Turn2View result={FIXTURE_TURN2_INCOMPLETE} />);
    expect(screen.getByTestId("turn2-incomplete")).toHaveTextContent(
      /dexamethasone/,
    );
  });
});

describe("Turn2View — status:abstention", () => {
  it("renders the abstention sentence as an amber DELIBERATE ABSTENTION headline", () => {
    render(<Turn2View result={FIXTURE_TURN2_ABSTENTION} />);
    const headline = screen.getByTestId("abstention-headline");
    expect(headline).toHaveAttribute("data-slot", "alert");
    expect(headline).toHaveTextContent(/DELIBERATE ABSTENTION/);
    expect(headline).toHaveTextContent(/No local guideline/i);
  });
});

describe("Turn2View — status:error (the ONLY red state)", () => {
  it("renders RED (destructive), not amber", () => {
    render(<Turn2View result={FIXTURE_TURN2_ERROR} />);
    const err = screen.getByTestId("error-headline");
    expect(err).toHaveAttribute("data-slot", "alert");
    expect(err.className).toContain("destructive");
    expect(err).toHaveTextContent(/Technical error/);
  });

  it("never renders a safety (amber) alert for a technical error", () => {
    render(<Turn2View result={FIXTURE_TURN2_ERROR} />);
    // No amber intent labels should appear on the error path.
    expect(screen.queryByText(/DELIBERATE ABSTENTION/)).not.toBeInTheDocument();
    expect(screen.queryByText(/COMPLETENESS CHECK/)).not.toBeInTheDocument();
  });
});
