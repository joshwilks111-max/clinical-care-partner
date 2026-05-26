// lib/case-state.test.ts
//
// Unit tests for the server-owned CaseState (the turn-1 → turn-2 contract).
// Pure logic only — no model call. Asserts:
//   - note_hash is a deterministic SHA-256 hex of the raw note;
//   - buildCaseState carries turn-1 outputs VERBATIM (the zero-re-extraction
//     invariant turn 2 relies on);
//   - selected_* default to null and can be seeded;
//   - isCaseStateLike correctly narrows valid CaseState shapes and rejects bad ones.

import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  buildCaseState,
  hashNote,
  isCaseStateLike,
  type CaseState,
} from "./case-state";
import type { ExtractedFacts, Differential } from "./schemas";

const facts: ExtractedFacts = {
  condition_hints: ["croup"],
  severity: "moderate",
  weight_kg: 14.2,
  age: "3yo",
  profession: null,
  setting: null,
};

const differential: Differential = {
  conditions: [
    {
      name: "Croup",
      likelihood: "likely",
      positive_evidence: ["barking cough", "stridor at rest"],
      negative_evidence: [
        "no cyanosis documented",
        "[NOT MENTIONED]: drooling",
      ],
    },
    {
      name: "Epiglottitis",
      likelihood: "must-not-miss",
      positive_evidence: [],
      negative_evidence: ["no drooling", "no toxic appearance"],
    },
  ],
  candidate_guidelines: [
    { guideline_id: "starship-croup-2020", label: "Starship NZ — Croup" },
  ],
};

describe("hashNote — deterministic SHA-256 hex of the raw note", () => {
  it("matches a direct node:crypto SHA-256 of the note", () => {
    const note = "Jack T., 3yo, 14.2kg, moderate croup.";
    const expected = createHash("sha256").update(note, "utf8").digest("hex");
    expect(hashNote(note)).toBe(expected);
  });

  it("is stable across calls (same input → same hash)", () => {
    const note = "same note text";
    expect(hashNote(note)).toBe(hashNote(note));
  });

  it("differs when the note differs (provenance is real)", () => {
    expect(hashNote("note A")).not.toBe(hashNote("note B"));
  });

  it("produces 64 hex chars (SHA-256)", () => {
    expect(hashNote("x")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("buildCaseState — carries turn-1 outputs verbatim (zero re-extraction)", () => {
  const note = "Jack T., 3yo, 14.2kg, moderate croup.";
  const state: CaseState = buildCaseState({
    note,
    extractedFacts: facts,
    differential,
  });

  it("note_hash is the SHA-256 of the raw note", () => {
    expect(state.note_hash).toBe(hashNote(note));
  });

  it("freezes extracted_facts identical to turn-1 output (deep equal)", () => {
    expect(state.extracted_facts).toEqual(facts);
  });

  it("freezes the differential identical to turn-1 output (deep equal)", () => {
    expect(state.differential).toEqual(differential);
  });

  it("preserves negative_evidence verbatim (the differentiator survives the boundary)", () => {
    expect(state.differential.conditions[0].negative_evidence).toEqual([
      "no cyanosis documented",
      "[NOT MENTIONED]: drooling",
    ]);
  });

  it("selected_* default to null (clinician confirmations not yet made)", () => {
    expect(state.selected_condition).toBeNull();
    expect(state.selected_guideline_id).toBeNull();
    expect(state.selected_severity).toBeNull();
  });

  it("does NOT carry the raw note text across the boundary (only its hash)", () => {
    // The untrusted note must not re-enter the model in turn 2; CaseState
    // carries provenance (hash) but not the text itself.
    expect(JSON.stringify(state)).not.toContain(note);
  });
});

describe("buildCaseState — clinician confirmations can be seeded", () => {
  it("seeds selected_* when provided", () => {
    const state = buildCaseState({
      note: "n",
      extractedFacts: facts,
      differential,
      selectedCondition: "croup",
      selectedGuidelineId: "starship-croup-2020",
      selectedSeverity: "moderate",
    });
    expect(state.selected_condition).toBe("croup");
    expect(state.selected_guideline_id).toBe("starship-croup-2020");
    expect(state.selected_severity).toBe("moderate");
  });
});

// A minimal well-formed CaseState for isCaseStateLike tests.
const wellFormedCaseState = {
  note_hash: "a".repeat(64),
  extracted_facts: {
    condition_hints: ["croup"],
    severity: "moderate",
    weight_kg: 14.2,
    age: "3yo",
    profession: null,
    setting: null,
  },
  differential: {
    conditions: [
      {
        name: "Croup",
        likelihood: "likely",
        positive_evidence: [],
        negative_evidence: [],
      },
    ],
    candidate_guidelines: [],
  },
  selected_condition: null,
  selected_guideline_id: null,
  selected_severity: null,
  discriminating_qa: [],
  round: 0,
};

describe("isCaseStateLike — shape guard for the turn-1 → turn-2 contract", () => {
  it("accepts a well-formed CaseState", () => {
    expect(isCaseStateLike(wellFormedCaseState)).toBe(true);
  });

  it("accepts a CaseState where weight_kg is null (unknown weight)", () => {
    expect(
      isCaseStateLike({
        ...wellFormedCaseState,
        extracted_facts: {
          ...wellFormedCaseState.extracted_facts,
          weight_kg: null,
        },
      }),
    ).toBe(true);
  });

  it("accepts a CaseState with round/discriminating_qa omitted (pre-turn1.5 shape)", () => {
    const {
      round: _r,
      discriminating_qa: _qa,
      ...withoutCounters
    } = wellFormedCaseState;
    expect(isCaseStateLike(withoutCounters)).toBe(true);
  });

  it("rejects null", () => {
    expect(isCaseStateLike(null)).toBe(false);
  });

  it("rejects a non-object (string)", () => {
    expect(isCaseStateLike("not-an-object")).toBe(false);
  });

  it("rejects a CaseState missing note_hash", () => {
    const { note_hash: _, ...noHash } = wellFormedCaseState;
    expect(isCaseStateLike(noHash)).toBe(false);
  });

  it("rejects a CaseState where differential.conditions is not an array", () => {
    expect(
      isCaseStateLike({
        ...wellFormedCaseState,
        differential: { conditions: "not-an-array", candidate_guidelines: [] },
      }),
    ).toBe(false);
  });

  it("rejects a CaseState with no differential at all", () => {
    const { differential: _, ...noDiff } = wellFormedCaseState;
    expect(isCaseStateLike(noDiff)).toBe(false);
  });

  it("rejects a CaseState where weight_kg is a string (bad UI value)", () => {
    expect(
      isCaseStateLike({
        ...wellFormedCaseState,
        extracted_facts: {
          ...wellFormedCaseState.extracted_facts,
          weight_kg: "14.2",
        },
      }),
    ).toBe(false);
  });
});
