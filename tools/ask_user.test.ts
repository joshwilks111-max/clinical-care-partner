// tools/ask_user.test.ts
//
// Tests for the structured slot tool. The three required tests from the
// lane brief:
//   - kind enum exhaustiveness
//   - return shape ({ answer: string })
//   - structured slot emission (args validated, parse throws on garbage)

import { describe, it, expect } from "vitest";
import { ask_user, AskUserKind, AskUserArgsSchema } from "./ask_user";

describe("ask_user — kind enum", () => {
  it("exposes the five canonical slot kinds (weight_kg, severity, region, confirm, free_text)", () => {
    const values = AskUserKind.options.sort();
    expect(values).toEqual([
      "confirm",
      "free_text",
      "region",
      "severity",
      "weight_kg",
    ]);
  });

  it("rejects an unknown kind (model can't fabricate a new slot)", () => {
    expect(() => AskUserKind.parse("invalid_kind")).toThrow();
  });
});

describe("ask_user — return shape", () => {
  it("returns { answer: string } — the SHAPE the harness fills after the form submit", () => {
    const r = ask_user({
      kind: "weight_kg",
      prompt: "What is the patient's weight in kg?",
    });
    expect(r).toHaveProperty("answer");
    expect(typeof r.answer).toBe("string");
  });

  it("answer is initially empty — the harness wires the real value via onFinish", () => {
    const r = ask_user({
      kind: "severity",
      prompt: "Which severity row best matches the presentation?",
    });
    expect(r.answer).toBe("");
  });
});

describe("ask_user — structured slot emission (args validation)", () => {
  it("accepts valid args with optional context", () => {
    const args = AskUserArgsSchema.parse({
      kind: "weight_kg",
      prompt: "What is the patient's weight in kg?",
      context: "Weight is required for the dexamethasone dose calculation.",
    });
    expect(args.kind).toBe("weight_kg");
    expect(args.context).toMatch(/dexamethasone/);
  });

  it("rejects a whitespace-only prompt (no silently-empty asks)", () => {
    expect(() =>
      AskUserArgsSchema.parse({
        kind: "weight_kg",
        prompt: "   ",
      }),
    ).toThrow();
  });

  it("rejects a fabricated kind via the tool entry point too (defense in depth)", () => {
    expect(() =>
      ask_user({
        // @ts-expect-error — testing runtime guard against an injected kind
        kind: "made_up_slot",
        prompt: "Test",
      }),
    ).toThrow();
  });
});
