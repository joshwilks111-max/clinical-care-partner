// @vitest-environment jsdom
//
// app/console/dose-card.test.tsx
//
// Asserts the DoseCard rendering contract per D14:
//   - Dose value at 22-24px serif IS the visual headline.
//   - capped:true shows the amber CAPPED chip + the "binding limit Nmg" line.
//   - Missing optional fields (dose_ml, source_url) don't crash.
//   - aria-label includes the dose value so screen readers announce
//     "Computed dose: 2.13 milligrams oral dexamethasone, from Starship 2020".

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { DoseCard, type DoseCardProps } from "./dose-card";

const BASE: DoseCardProps = {
  drug: "oral dexamethasone",
  route: "PO",
  severity_row: "moderate",
  dose_mg: 2.13,
  max_mg: 12,
  capped: false,
  source_version: "Starship 2020",
  source_url: "https://example.test/starship/croup",
};

describe("DoseCard", () => {
  it("renders the dose value as the serif headline", () => {
    render(<DoseCard {...BASE} />);
    // The dose value renders as split text nodes ([2.13][mg]) inside a single
    // headline <div>. We query against the aria-labelled region (which carries
    // the canonical "2.13 milligrams ..." string) to assert presence without
    // tripping on DOM text fragmentation.
    const region = screen.getByLabelText(/Computed dose: 2\.13/);
    expect(region).toHaveTextContent(/2\.13.*mg/);
    expect(region).toHaveTextContent(/PO/);
  });

  it("shows an amber CAPPED chip and binding-limit sub-line when capped:true", () => {
    render(<DoseCard {...BASE} capped={true} dose_mg={12} />);
    expect(screen.getByText("CAPPED")).toBeInTheDocument();
    // The binding-limit sub-line is a separate <p> from the headline + trace.
    // getByText with an exact predicate disambiguates from the 3 other "12 mg"
    // occurrences (headline, trace, trace-cap-suffix).
    expect(
      screen.getByText(/Binding limit:\s*12 mg\. Dose clamped to cap\./i),
    ).toBeInTheDocument();
  });

  it("does not crash when optional fields (dose_ml, source_url) are absent", () => {
    const {
      drug,
      route,
      severity_row,
      dose_mg,
      max_mg,
      capped,
      source_version,
    } = BASE;
    expect(() =>
      render(
        <DoseCard
          drug={drug}
          route={route}
          severity_row={severity_row}
          dose_mg={dose_mg}
          max_mg={max_mg}
          capped={capped}
          source_version={source_version}
        />,
      ),
    ).not.toThrow();
    // Source still renders, just not as a link.
    expect(screen.getByText("Starship 2020")).toBeInTheDocument();
  });

  it("aria-label describes the dose value + drug + source", () => {
    render(<DoseCard {...BASE} />);
    const region = screen.getByLabelText(
      /Computed dose: 2\.13 milligrams oral dexamethasone, from Starship 2020/,
    );
    expect(region).toBeInTheDocument();
  });
});
