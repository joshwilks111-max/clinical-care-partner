/**
 * contract.test.ts — the canary that catches skill ↔ harness drift.
 *
 * What this guards against:
 *   The skill ships `evals/cases.jsonl` (17 cases — the eval ground truth).
 *   The skill ships `scripts/validate_dose_card.ts` (Zod schemas — the
 *   harness contract per D10). The harness imports those schemas via the
 *   `@skills/*` tsconfig path and runs them at request-end.
 *
 *   If a future skill iteration bumps `cases.jsonl` (renames a refusal,
 *   tightens a field type, adds an enum member) without simultaneously
 *   bumping `validate_dose_card.ts`, the fixtures and the schema drift
 *   apart. The harness goes green in CI, ships, and silently rejects the
 *   model's correctly-shaped output in prod.
 *
 *   This file walks every case in `cases.jsonl` and asserts that the
 *   fixture's expected `dose_card_fields` / `reassessment_card_fields`
 *   are a valid PARTIAL of the schema, and that any expected
 *   `refusal_kind` is a member of `AnyRefusalKind`. One test per case
 *   plus structural canaries = 17 + 5 = 22 contract assertions.
 *
 *   Lane D's job: keep this file passing. If it fails after a skill
 *   refresh, the schema and the fixtures disagree — fix BOTH before
 *   the harness imports stale types.
 *
 * Why .pick() and not .safeParse():
 *   The fixtures intentionally encode only the FIELDS the LLM-emitted
 *   block is required to contain (tool_call_id, drug, route, severity_row);
 *   `assessment` and `plan` are model-generated prose that vary per case
 *   and are not pinned in the eval data. A naive
 *   `DoseCardEmittedSchema.safeParse(dose_card_fields)` would fail on
 *   "missing required field `assessment`" — a contract test failure that
 *   has nothing to do with drift. Picking the schema down to the fixture's
 *   keyset asserts the right invariant: every key in the fixture is a
 *   valid key in the schema, with valid types.
 *
 * Reads cases.jsonl synchronously at module-load time so vitest's
 * `test.each(...)` can enumerate the cases as named tests. No async
 * setup, no test-runner-specific fixture machinery.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { z } from "zod";

import {
  AnyRefusalKind,
  DoseCardEmittedSchema,
  ReassessmentCardEmittedSchema,
} from "@skills/dose-calculator/scripts/validate_dose_card";

/* ─── Case-shape (what the fixture file actually looks like) ──────────── */

const CaseSchema = z
  .object({
    id: z.string(),
    region: z.string().optional(),
    prompt: z.string(),
    expected_tools: z.array(z.string()).optional(),
    mock_tool_returns: z.record(z.unknown()).optional(),
    expected_output_shape: z
      .object({
        prose_contains: z.array(z.string()).optional(),
        prose_does_not_contain: z.array(z.string()).optional(),
        emits_dose_card: z.boolean().optional(),
        emits_reassessment_card: z.boolean().optional(),
        dose_card_fields: z.record(z.unknown()).optional(),
        reassessment_card_fields: z.record(z.unknown()).optional(),
        dose_card_omits: z.array(z.string()).optional(),
        refusal_kind: z.string().optional(),
      })
      .passthrough(),
  })
  .passthrough();
type Case = z.infer<typeof CaseSchema>;

/* ─── Load cases.jsonl ────────────────────────────────────────────────── */

const here = dirname(fileURLToPath(import.meta.url));
const casesPath = resolve(here, "evals", "cases.jsonl");
const raw = readFileSync(casesPath, "utf8");

const cases: Case[] = raw
  .split("\n")
  .filter((line) => line.trim().length > 0)
  .map((line, idx) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (e) {
      throw new Error(
        `cases.jsonl line ${idx + 1} is not valid JSON: ${(e as Error).message}`,
      );
    }
    const result = CaseSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(
        `cases.jsonl line ${idx + 1} fails CaseSchema:\n${result.error.message}`,
      );
    }
    return result.data;
  });

/* ─── Structural canaries (these catch refresh mistakes) ──────────────── */

describe("cases.jsonl structural canaries", () => {
  test("17 cases (12 originals + 5 adversarial)", () => {
    expect(cases).toHaveLength(17);
  });

  test("all case ids are unique", () => {
    const ids = cases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("case-13 prompt-injection is present", () => {
    // D9 promise: 5 adversarial cases including prompt-injection.
    expect(cases.some((c) => c.id === "case-13-prompt-injection")).toBe(true);
  });

  test("case-11 longitudinal-reassessment is present", () => {
    // The only case that emits reassessment-card WITHOUT a fresh dose-card.
    expect(
      cases.some((c) => c.id === "case-11-longitudinal-reassessment-question"),
    ).toBe(true);
  });

  test("five adversarial cases (13–17) are present", () => {
    // D9 promise: 5 adversarial cases.
    const adversarial = [
      "case-13-prompt-injection",
      "case-14-age-out-of-band",
      "case-15-weight-in-pounds",
      "case-16-conflicting-weights",
      "case-17-severity-asserted-vs-features",
    ];
    for (const id of adversarial) {
      expect(cases.some((c) => c.id === id)).toBe(true);
    }
  });
});

/* ─── Per-case contract assertions ────────────────────────────────────── */

describe("per-case schema-compatibility (skill ↔ harness contract)", () => {
  test.each(cases.map((c) => [c.id, c] as const))(
    "%s — emitted-block keys round-trip through committed Zod schemas",
    (_id, c) => {
      const shape = c.expected_output_shape;

      // dose-card: fixture keys must be a valid partial of the schema.
      // We .pick() the schema down to the fixture's keyset and assert
      // safeParse passes. This catches: key renamed (severity_row →
      // severity_label), type tightened (tool_call_id pattern bumped),
      // field added that the fixtures haven't picked up.
      if (shape.emits_dose_card === true && shape.dose_card_fields) {
        const keys = Object.keys(shape.dose_card_fields);
        expect(keys.length).toBeGreaterThan(0);
        const Picked = DoseCardEmittedSchema.pick(
          Object.fromEntries(keys.map((k) => [k, true])) as Record<
            keyof z.infer<typeof DoseCardEmittedSchema>,
            true
          >,
        );
        const result = Picked.safeParse(shape.dose_card_fields);
        if (!result.success) {
          throw new Error(
            `case ${c.id}: dose_card_fields fails picked-schema:\n${result.error.message}`,
          );
        }
      }

      // reassessment-card: same pattern.
      if (
        shape.emits_reassessment_card === true &&
        shape.reassessment_card_fields
      ) {
        const keys = Object.keys(shape.reassessment_card_fields);
        expect(keys.length).toBeGreaterThan(0);
        const Picked = ReassessmentCardEmittedSchema.pick(
          Object.fromEntries(keys.map((k) => [k, true])) as Record<
            keyof z.infer<typeof ReassessmentCardEmittedSchema>,
            true
          >,
        );
        const result = Picked.safeParse(shape.reassessment_card_fields);
        if (!result.success) {
          throw new Error(
            `case ${c.id}: reassessment_card_fields fails picked-schema:\n${result.error.message}`,
          );
        }
      }

      // refusal_kind: must be in AnyRefusalKind.
      // This is the canary for the prompt-injection (case-13) through
      // severity-asserted (case-17) range, AND for the 7 cases that
      // legitimately refuse (3, 4, 5, 7, 9, 14, 16).
      if (typeof shape.refusal_kind === "string") {
        const result = AnyRefusalKind.safeParse(shape.refusal_kind);
        if (!result.success) {
          throw new Error(
            `case ${c.id}: refusal_kind '${shape.refusal_kind}' is not a member of AnyRefusalKind`,
          );
        }
      }
    },
  );
});

/* ─── Schema-shape regression (single-source-of-truth guards) ─────────── */

describe("schema invariants — Lane D enforces D10", () => {
  test("DoseCardEmittedSchema is strict (rejects unknown keys)", () => {
    // Invariant 5 ("never author a number") is mechanically enforced by
    // .strict(): a stray `dose_mg` key in the emitted block fails parse.
    // If a future refresh accidentally drops .strict(), this test fires.
    const result = DoseCardEmittedSchema.safeParse({
      tool_call_id: "calc_abc123",
      drug: "dexamethasone",
      route: "PO",
      severity_row: "moderate",
      assessment: "Mild stridor at rest.",
      plan: "Single oral dose.",
      dose_mg: 2.13, // ← this MUST cause failure
    });
    expect(result.success).toBe(false);
  });

  test("DoseCardEmittedSchema rejects whitespace-only strings", () => {
    // nonEmpty() helper guards "no whitespace-padded lies". If the helper
    // is downgraded to .min(1) (silently accepts " "), this test fires.
    const result = DoseCardEmittedSchema.safeParse({
      tool_call_id: "calc_abc123",
      drug: " ",
      route: "PO",
      severity_row: "moderate",
      assessment: "valid",
      plan: "valid",
    });
    expect(result.success).toBe(false);
  });

  test("tool_call_id regex is ^[a-zA-Z0-9_-]{8,32}$", () => {
    const tooShort = DoseCardEmittedSchema.safeParse({
      tool_call_id: "abc", // 3 chars — must fail
      drug: "dex",
      route: "PO",
      severity_row: "moderate",
      assessment: "valid",
      plan: "valid",
    });
    expect(tooShort.success).toBe(false);

    const withSpace = DoseCardEmittedSchema.safeParse({
      tool_call_id: "calc abc12", // space — must fail
      drug: "dex",
      route: "PO",
      severity_row: "moderate",
      assessment: "valid",
      plan: "valid",
    });
    expect(withSpace.success).toBe(false);
  });

  test("AnyRefusalKind covers every kind asserted in cases.jsonl", () => {
    // Exhaustiveness canary: every refusal_kind string the fixtures
    // assert must be a member of AnyRefusalKind. If a future refresh
    // adds a new refusal_kind in cases.jsonl without bumping the enum
    // in validate_dose_card.ts, the per-case test catches it — this
    // test is the aggregate signal.
    const asserted = new Set(
      cases
        .map((c) => c.expected_output_shape.refusal_kind)
        .filter((k): k is string => typeof k === "string"),
    );
    for (const kind of asserted) {
      const r = AnyRefusalKind.safeParse(kind);
      expect(r.success, `refusal_kind '${kind}' not in AnyRefusalKind`).toBe(
        true,
      );
    }
  });

  test("ReassessmentCardEmittedSchema requires watch_for_summary + next_steps_summary", () => {
    // Phase 5 invariant: the reassessment block carries the model's
    // qualitative framing; numbers/branches come from the tool result.
    // If a refresh drops either summary field, the model has nowhere
    // to put its prose hand-off and this test fires.
    const missingNext = ReassessmentCardEmittedSchema.safeParse({
      tool_call_id: "reas_xyz789",
      watch_for_summary: "Worsening stridor.",
    });
    expect(missingNext.success).toBe(false);

    const allPresent = ReassessmentCardEmittedSchema.safeParse({
      tool_call_id: "reas_xyz789",
      watch_for_summary: "Worsening stridor.",
      next_steps_summary: "Escalate if worse, continue obs if improving.",
    });
    expect(allPresent.success).toBe(true);
  });
});
