// lib/schemas.test.ts
//
// Unit tests for the turn-1 Zod schemas — the structured-output contract.
// Pure, no model. Asserts the schemas match DESIGN.md "Typed schemas" exactly:
// nullable fact fields, the likelihood enum, and the REQUIRED negative_evidence
// (the differentiator). A schema that drifts here breaks the trust contract.

import { describe, it, expect } from "vitest";
import { ExtractedFacts, Differential, Turn1Output } from "./schemas";

describe("ExtractedFacts schema", () => {
  it("accepts a full, valid facts object", () => {
    const r = ExtractedFacts.safeParse({
      condition_hints: ["croup"],
      severity: "moderate",
      weight_kg: 14.2,
      age: "3yo",
      profession: "ED clinician",
      setting: "hospital ED",
    });
    expect(r.success).toBe(true);
  });

  it("accepts nulls for the nullable fields (weight_kg null is the gate signal)", () => {
    const r = ExtractedFacts.safeParse({
      condition_hints: [],
      severity: null,
      weight_kg: null,
      age: null,
      profession: null,
      setting: null,
    });
    expect(r.success).toBe(true);
  });

  it("rejects a string weight_kg (must be number|null)", () => {
    const r = ExtractedFacts.safeParse({
      condition_hints: [],
      severity: null,
      weight_kg: "14.2",
      age: null,
      profession: null,
      setting: null,
    });
    expect(r.success).toBe(false);
  });

  it("rejects a missing required field (condition_hints)", () => {
    const r = ExtractedFacts.safeParse({
      severity: null,
      weight_kg: null,
      age: null,
      profession: null,
      setting: null,
    });
    expect(r.success).toBe(false);
  });
});

describe("Differential schema", () => {
  const validCondition = {
    name: "Croup",
    likelihood: "likely",
    positive_evidence: ["barking cough"],
    negative_evidence: ["no cyanosis documented"],
  };

  it("accepts a valid differential with candidate guidelines", () => {
    const r = Differential.safeParse({
      conditions: [validCondition],
      candidate_guidelines: [
        { guideline_id: "starship-croup-2020", label: "Starship — Croup" },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("requires negative_evidence on every condition (the differentiator)", () => {
    const { negative_evidence, ...withoutNeg } = validCondition;
    const r = Differential.safeParse({
      conditions: [withoutNeg],
      candidate_guidelines: [],
    });
    expect(r.success).toBe(false);
  });

  it("rejects a likelihood outside the enum (no fake %, no free text)", () => {
    const r = Differential.safeParse({
      conditions: [{ ...validCondition, likelihood: "0.9" }],
      candidate_guidelines: [],
    });
    expect(r.success).toBe(false);
  });

  it("accepts all three valid likelihood bands", () => {
    for (const likelihood of ["likely", "possible", "must-not-miss"]) {
      const r = Differential.safeParse({
        conditions: [{ ...validCondition, likelihood }],
        candidate_guidelines: [],
      });
      expect(r.success).toBe(true);
    }
  });

  it("accepts an empty candidate_guidelines array (the abstain path)", () => {
    const r = Differential.safeParse({
      conditions: [validCondition],
      candidate_guidelines: [],
    });
    expect(r.success).toBe(true);
  });
});

describe("Turn1Output schema — the combined structured-output contract", () => {
  it("requires both extracted_facts and differential", () => {
    const r = Turn1Output.safeParse({
      extracted_facts: {
        condition_hints: ["croup"],
        severity: "moderate",
        weight_kg: 14.2,
        age: "3yo",
        profession: null,
        setting: null,
      },
      confidence: "high",
      differential: {
        conditions: [
          {
            name: "Croup",
            likelihood: "likely",
            positive_evidence: ["stridor"],
            negative_evidence: ["no cyanosis"],
          },
        ],
        candidate_guidelines: [
          { guideline_id: "starship-croup-2020", label: "Starship — Croup" },
        ],
      },
    });
    expect(r.success).toBe(true);
  });

  it("rejects an object missing the differential", () => {
    const r = Turn1Output.safeParse({
      extracted_facts: {
        condition_hints: [],
        severity: null,
        weight_kg: 14.2,
        age: null,
        profession: null,
        setting: null,
      },
    });
    expect(r.success).toBe(false);
  });
});
