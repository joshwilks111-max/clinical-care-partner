// lib/router.test.ts
//
// TDD assertions for deterministic routing (written before the implementation).
// route() is a pure data lookup over ROUTING_TABLE — (condition, profession,
// setting) → guideline_id | null. Unknown condition → null → caller abstains.
// auditRoutedGuideline() is the wrong-guideline AUDIT hook: does the routed
// guideline_id match the confirmed condition? (DESIGN.md case: routed id must
// match confirmed condition; mismatch → abstain.)

import { describe, it, expect } from "vitest";
import { route, auditRoutedGuideline } from "./router";

describe("route — deterministic (condition, profession, setting) → guideline_id", () => {
  it("croup in hospital ED → starship-croup-2020", () => {
    expect(route("croup", "ED clinician", "hospital ED")).toBe(
      "starship-croup-2020",
    );
  });

  it("anaphylaxis in hospital ED → ascia-anaphylaxis-2024", () => {
    expect(route("anaphylaxis", "ED clinician", "hospital ED")).toBe(
      "ascia-anaphylaxis-2024",
    );
  });

  it("profession is (any) — different professions still route croup", () => {
    expect(route("croup", "GP", "hospital ED")).toBe("starship-croup-2020");
    expect(route("croup", "nurse practitioner", "hospital ED")).toBe(
      "starship-croup-2020",
    );
  });

  it("condition match is case-insensitive (Croup → croup)", () => {
    expect(route("Croup", "ED clinician", "hospital ED")).toBe(
      "starship-croup-2020",
    );
  });

  it("unknown condition → null (→ abstain)", () => {
    expect(route("sepsis", "ED clinician", "hospital ED")).toBeNull();
  });

  it("empty condition → null", () => {
    expect(route("", "ED clinician", "hospital ED")).toBeNull();
  });
});

describe("auditRoutedGuideline — wrong-guideline audit hook", () => {
  it("routed guideline matches confirmed condition → true", () => {
    expect(auditRoutedGuideline("croup", "starship-croup-2020")).toBe(true);
    expect(auditRoutedGuideline("anaphylaxis", "ascia-anaphylaxis-2024")).toBe(
      true,
    );
  });

  it("routed guideline does NOT match confirmed condition → false (mismatch)", () => {
    expect(auditRoutedGuideline("croup", "ascia-anaphylaxis-2024")).toBe(false);
    expect(auditRoutedGuideline("anaphylaxis", "starship-croup-2020")).toBe(
      false,
    );
  });

  it("case-insensitive on the confirmed condition", () => {
    expect(auditRoutedGuideline("Croup", "starship-croup-2020")).toBe(true);
  });

  it("unknown guideline_id → false (cannot confirm a match)", () => {
    expect(auditRoutedGuideline("croup", "no-such-guideline")).toBe(false);
  });

  it("unknown condition → false", () => {
    expect(auditRoutedGuideline("sepsis", "starship-croup-2020")).toBe(false);
  });
});
