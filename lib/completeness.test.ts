// lib/completeness.test.ts
//
// TDD assertions for the omission guard (written before the implementation).
// This is a TRUE deterministic gate — NO LLM judge. Given a structured slot
// record (slot → {present, value}) and a guideline's RequiredFields, EVERY
// required slot must be present AND value != null AND value non-empty.
//
// The sharpest case (DESIGN.md case 6): a plan that cites correctly but leaves
// escalation_criteria null / "not specified" → the gate FIRES on the structured
// slot. This is a slot check, NOT a substring search over prose.

import { describe, it, expect } from "vitest";
import { checkCompleteness, type SlotRecord } from "./completeness";
import { getGuideline } from "@/registry/guidelines";

const croup = getGuideline("starship-croup-2020")!;
const croupFields = croup.required_fields.fields;

/** Build a fully-populated slot record for a set of field names. */
function allPresent(fields: string[]): SlotRecord {
  return Object.fromEntries(
    fields.map((f) => [f, { present: true, value: `value for ${f}` }]),
  );
}

describe("checkCompleteness — all slots present + non-null → PASS", () => {
  it("a fully-populated croup plan passes the gate", () => {
    const result = checkCompleteness(
      allPresent(croupFields),
      croup.required_fields,
    );
    expect(result.complete).toBe(true);
    expect(result.missing).toEqual([]);
  });
});

describe("checkCompleteness — a present-but-null slot FAILS", () => {
  it("escalation_criteria present but value null → FAIL (DESIGN.md case 6)", () => {
    const slots = allPresent(croupFields);
    slots["escalation_criteria"] = { present: true, value: null };
    const result = checkCompleteness(slots, croup.required_fields);
    expect(result.complete).toBe(false);
    expect(result.missing).toContain("escalation_criteria");
  });
});

describe("checkCompleteness — empty / placeholder strings FAIL (not a prose search)", () => {
  it('value "" (empty string) → FAIL', () => {
    const slots = allPresent(croupFields);
    slots["disposition"] = { present: true, value: "" };
    const result = checkCompleteness(slots, croup.required_fields);
    expect(result.complete).toBe(false);
    expect(result.missing).toContain("disposition");
  });

  it('value "   " (whitespace only) → FAIL', () => {
    const slots = allPresent(croupFields);
    slots["disposition"] = { present: true, value: "   " };
    const result = checkCompleteness(slots, croup.required_fields);
    expect(result.complete).toBe(false);
    expect(result.missing).toContain("disposition");
  });

  it('value "not specified" → FAIL (the placeholder is treated as empty)', () => {
    const slots = allPresent(croupFields);
    slots["escalation_criteria"] = {
      present: true,
      value: "not specified",
    };
    const result = checkCompleteness(slots, croup.required_fields);
    expect(result.complete).toBe(false);
    expect(result.missing).toContain("escalation_criteria");
  });

  it('value "Escalation: not specified" → FAIL', () => {
    const slots = allPresent(croupFields);
    slots["escalation_criteria"] = {
      present: true,
      value: "Escalation: not specified",
    };
    const result = checkCompleteness(slots, croup.required_fields);
    expect(result.complete).toBe(false);
    expect(result.missing).toContain("escalation_criteria");
  });
});

describe("checkCompleteness — a missing slot (present:false or absent key) FAILS", () => {
  it("slot flagged present:false → FAIL", () => {
    const slots = allPresent(croupFields);
    slots["severity"] = { present: false, value: null };
    const result = checkCompleteness(slots, croup.required_fields);
    expect(result.complete).toBe(false);
    expect(result.missing).toContain("severity");
  });

  it("slot key entirely absent from the record → FAIL", () => {
    const slots = allPresent(croupFields);
    delete slots["diagnosis"];
    const result = checkCompleteness(slots, croup.required_fields);
    expect(result.complete).toBe(false);
    expect(result.missing).toContain("diagnosis");
  });

  it("reports ALL missing slots, not just the first", () => {
    const slots = allPresent(croupFields);
    delete slots["diagnosis"];
    slots["severity"] = { present: true, value: null };
    slots["disposition"] = { present: true, value: "" };
    const result = checkCompleteness(slots, croup.required_fields);
    expect(result.complete).toBe(false);
    expect(result.missing.sort()).toEqual(
      ["diagnosis", "disposition", "severity"].sort(),
    );
  });
});

describe("checkCompleteness — works for the anaphylaxis required-field set too", () => {
  it("anaphylaxis fully populated passes; dropped positioning fails", () => {
    const ana = getGuideline("ascia-anaphylaxis-2024")!;
    const ok = checkCompleteness(
      allPresent(ana.required_fields.fields),
      ana.required_fields,
    );
    expect(ok.complete).toBe(true);

    const slots = allPresent(ana.required_fields.fields);
    slots["positioning"] = { present: true, value: null };
    const bad = checkCompleteness(slots, ana.required_fields);
    expect(bad.complete).toBe(false);
    expect(bad.missing).toContain("positioning");
  });
});
