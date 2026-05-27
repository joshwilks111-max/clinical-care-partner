// lib/response-validator.test.ts
//
// 14 contract tests for the response validator. Each test constructs a
// minimal OnFinishLike fixture and asserts a single property of the
// validator's discriminated union. Together they pin every documented
// failure path the harness needs to surface as red (D14).
//
// Naming convention:
//   - "no_fence_…"             happy path with no structured blocks
//   - "valid_…_filled_from_tool_result"   merge correctness
//   - "malformed_…", "schema_…", "orphan_…", "card_on_refused_tool"
//                                          all 4 blocked variants
//   - "both_cards_…", "walks_steps_…"      multi-step / multi-card
//   - "tool_result_mutation_…"             prose-vs-tool isolation
//   - "whitespace_…", "fence_inside_…"     extractor robustness

import { describe, expect, it } from "vitest";

import {
  OnFinishLike,
  StepLike,
  ToolResultLike,
  validateResponse,
} from "./response-validator";

// ─── Fixture helpers ─────────────────────────────────────────────────────────

const VALID_ID_A = "abc123XYZ_-1"; // 12 chars, matches ^[a-zA-Z0-9_-]{8,32}$
const VALID_ID_B = "qrs789POI_42"; // 12 chars

function step(text: string, toolResults: ToolResultLike[] = []): StepLike {
  return { text, toolResults };
}

function event(steps: StepLike[]): OnFinishLike {
  return { steps };
}

function doseToolResult(
  id: string,
  output: Record<string, unknown> = {},
): ToolResultLike {
  return {
    toolCallId: id,
    toolName: "calculate_dose",
    output: {
      kind: "dose",
      dose_mg: 2.13,
      dose_ml: 2.13,
      drug: "dexamethasone",
      route: "oral",
      frequency: "single dose",
      calculation_trace: "14.2 kg × 0.15 mg/kg = 2.13 mg (under 12 mg cap)",
      capped: false,
      binding_limit: null,
      data_gaps: [],
      max_mg: 12,
      source_version: "v1.0.0",
      source_url: "https://starship.org.nz/croup",
      ...output,
    },
  };
}

function refusalToolResult(
  id: string,
  reason: string,
  message: string,
  toolName = "calculate_dose",
): ToolResultLike {
  return {
    toolCallId: id,
    toolName,
    output: { kind: "refusal", reason, message },
  };
}

function reassessToolResult(id: string): ToolResultLike {
  return {
    toolCallId: id,
    toolName: "get_reassessment_plan",
    output: {
      kind: "reassessment",
      reassess_in_minutes: 240,
      watch_for: ["stridor at rest", "increased work of breathing"],
      next_branches: [],
      universal_rails: "If worse, escalate.",
    },
  };
}

function doseFence(
  id: string,
  overrides: Partial<Record<string, unknown>> = {},
): string {
  const body = {
    tool_call_id: id,
    drug: "dexamethasone",
    route: "oral",
    severity_row: "moderate",
    assessment: "Moderate croup with stridor at rest.",
    plan: "Single oral dexamethasone; reassess in 4 hours.",
    ...overrides,
  };
  return "```dose-card\n" + JSON.stringify(body, null, 2) + "\n```";
}

function reassessFence(id: string): string {
  const body = {
    tool_call_id: id,
    watch_for_summary:
      "Watch for stridor at rest and increased work of breathing.",
    next_steps_summary:
      "If worse, escalate; if improving, continue observation.",
  };
  return "```reassessment-card\n" + JSON.stringify(body, null, 2) + "\n```";
}

// ─── 14 tests, one per documented failure path ───────────────────────────────

describe("validateResponse", () => {
  // 1.
  it("no fence → both cards null and no blocked state", () => {
    const r = validateResponse(
      event([step("Just prose, no structured blocks here.")]),
    );
    expect(r.dose_card).toBeNull();
    expect(r.reassessment_card).toBeNull();
    expect(r.refusal).toBeNull();
    expect(r.blocked).toBeUndefined();
    expect(r.text).toContain("Just prose");
  });

  // 2.
  it("valid dose-card → filled from matching tool result", () => {
    const r = validateResponse(
      event([
        step("Assessment prose...\n\n" + doseFence(VALID_ID_A), [
          doseToolResult(VALID_ID_A),
        ]),
      ]),
    );
    expect(r.blocked).toBeUndefined();
    expect(r.dose_card).not.toBeNull();
    // Qualitative fields from the fence (model-authored)
    expect(r.dose_card!.tool_call_id).toBe(VALID_ID_A);
    expect(r.dose_card!.severity_row).toBe("moderate");
    // Numeric fields merged from the tool result
    expect(r.dose_card!.tool_result.dose_mg).toBe(2.13);
    expect(r.dose_card!.tool_result.source_url).toBe(
      "https://starship.org.nz/croup",
    );
  });

  // 3.
  it("valid reassessment-card → filled from matching tool result", () => {
    const r = validateResponse(
      event([
        step("Reassessment prose...\n\n" + reassessFence(VALID_ID_B), [
          reassessToolResult(VALID_ID_B),
        ]),
      ]),
    );
    expect(r.blocked).toBeUndefined();
    expect(r.reassessment_card).not.toBeNull();
    expect(r.reassessment_card!.watch_for_summary).toMatch(/stridor/);
    expect(r.reassessment_card!.tool_result.reassess_in_minutes).toBe(240);
  });

  // 4.
  it("malformed JSON inside the fence → blocked with malformed_json", () => {
    const broken = "```dose-card\n{ not valid json, \n```";
    const r = validateResponse(
      event([step(broken, [doseToolResult(VALID_ID_A)])]),
    );
    expect(r.dose_card).toBeNull();
    expect(r.blocked).toBeDefined();
    expect(r.blocked!.reason).toBe("malformed_json");
    expect(r.blocked!.card_kind).toBe("dose-card");
  });

  // 5.
  it("schema mismatch (missing field) → blocked with schema_violation", () => {
    // Missing the required `plan` field
    const fence = doseFence(VALID_ID_A, { plan: undefined });
    // Re-serialise without `plan` (the `undefined` above doesn't survive
    // JSON.stringify, so this is the simplest path to a missing field)
    const r = validateResponse(
      event([step(fence, [doseToolResult(VALID_ID_A)])]),
    );
    expect(r.dose_card).toBeNull();
    expect(r.blocked!.reason).toBe("schema_violation");
    expect(r.blocked!.detail).toMatch(/plan/);
  });

  // 6.
  it("orphan tool_call_id → blocked with orphan_tool_call_id", () => {
    // Fence cites VALID_ID_A but the tool result is keyed on VALID_ID_B.
    const r = validateResponse(
      event([step(doseFence(VALID_ID_A), [doseToolResult(VALID_ID_B)])]),
    );
    expect(r.dose_card).toBeNull();
    expect(r.blocked!.reason).toBe("orphan_tool_call_id");
    expect(r.blocked!.detail).toContain(VALID_ID_A);
  });

  // 7.
  it("card on a refused tool result → blocked with card_on_refused_tool", () => {
    // Tool refused (weight_missing), but the model emitted a successful
    // dose-card anyway. This is the model-claims-success-tool-denied case;
    // it MUST be caught and surfaced as red.
    const r = validateResponse(
      event([
        step(doseFence(VALID_ID_A), [
          refusalToolResult(
            VALID_ID_A,
            "weight_missing",
            "Weight not provided in the note.",
          ),
        ]),
      ]),
    );
    expect(r.dose_card).toBeNull();
    expect(r.blocked!.reason).toBe("card_on_refused_tool");
    expect(r.blocked!.detail).toContain("weight_missing");
  });

  // 8.
  it("both cards present in one message → both render", () => {
    const text =
      "Assessment...\n\n" +
      doseFence(VALID_ID_A) +
      "\n\nReassess in 4 hours.\n\n" +
      reassessFence(VALID_ID_B);
    const r = validateResponse(
      event([
        step(text, [
          doseToolResult(VALID_ID_A),
          reassessToolResult(VALID_ID_B),
        ]),
      ]),
    );
    expect(r.blocked).toBeUndefined();
    expect(r.dose_card).not.toBeNull();
    expect(r.reassessment_card).not.toBeNull();
  });

  // 9.
  it("walks event.steps[] across a multi-step loop (D2 lock)", () => {
    // Step 1 has load_guideline; step 2 has the dose-call. The dose-card
    // fence is in step 2's text. The validator MUST see the dose tool
    // result on step 2's toolResults — if it only inspected step 1, this
    // would orphan-block.
    const r = validateResponse(
      event([
        step("Loading the croup guideline...", [
          {
            toolCallId: "loadguideline1",
            toolName: "load_guideline",
            output: { kind: "guideline", id: "nz-croup-v1" },
          },
        ]),
        step("Dose calc done.\n\n" + doseFence(VALID_ID_A), [
          doseToolResult(VALID_ID_A),
        ]),
      ]),
    );
    expect(r.blocked).toBeUndefined();
    expect(r.dose_card).not.toBeNull();
    expect(r.dose_card!.tool_call_id).toBe(VALID_ID_A);
  });

  // 10.
  it("model-authored prose number does not leak into tool_result", () => {
    // The model writes "2.13 mg" in prose; the tool returned 4.20 mg in
    // its output. The merged card MUST reflect the TOOL's value — never
    // the model's. (.strict() on the fence already blocks smuggled
    // numeric keys; this test pins the prose-can't-override-tool side.)
    const r = validateResponse(
      event([
        step("Calculated dose: 2.13 mg.\n\n" + doseFence(VALID_ID_A), [
          doseToolResult(VALID_ID_A, { dose_mg: 4.2 }),
        ]),
      ]),
    );
    expect(r.blocked).toBeUndefined();
    expect(r.dose_card!.tool_result.dose_mg).toBe(4.2);
  });

  // 11.
  it("tolerates trailing whitespace on the opening fence tag", () => {
    // Models sometimes emit ` ```dose-card  \n{...} ` with stray spaces;
    // the regex's `\s*\n` should absorb them.
    const fence =
      "```dose-card   \n" +
      JSON.stringify({
        tool_call_id: VALID_ID_A,
        drug: "dexamethasone",
        route: "oral",
        severity_row: "moderate",
        assessment: "Moderate croup.",
        plan: "Reassess in 4 hours.",
      }) +
      "\n```";
    const r = validateResponse(
      event([step(fence, [doseToolResult(VALID_ID_A)])]),
    );
    expect(r.blocked).toBeUndefined();
    expect(r.dose_card).not.toBeNull();
  });

  // 12.
  it("fence embedded after surrounding markdown → still extracted", () => {
    // The fence appears after a heading and a list — common shape for
    // structured documents. Extractor must not get confused by leading
    // markdown.
    const text = [
      "# Assessment",
      "- Moderate croup",
      "- Weight 14.2 kg",
      "",
      doseFence(VALID_ID_A),
    ].join("\n");
    const r = validateResponse(
      event([step(text, [doseToolResult(VALID_ID_A)])]),
    );
    expect(r.blocked).toBeUndefined();
    expect(r.dose_card).not.toBeNull();
  });

  // 13.
  it(".strict() rejects extra keys (smuggled numerics)", () => {
    // The contract: model emits qualitative keys only. A smuggled
    // dose_mg: 999 in the fence is an attempt to author a number from
    // prose — invariant 5 says no. .strict() must catch this here, NOT
    // at render time.
    const fenceWithSmuggle =
      "```dose-card\n" +
      JSON.stringify({
        tool_call_id: VALID_ID_A,
        drug: "dexamethasone",
        route: "oral",
        severity_row: "moderate",
        assessment: "Moderate croup.",
        plan: "Reassess in 4 hours.",
        dose_mg: 999, // ← extra key (numeric, deliberate)
      }) +
      "\n```";
    const r = validateResponse(
      event([step(fenceWithSmuggle, [doseToolResult(VALID_ID_A)])]),
    );
    expect(r.blocked).toBeDefined();
    expect(r.blocked!.reason).toBe("schema_violation");
    expect(r.blocked!.detail).toMatch(/dose_mg|unrecognized|extra/i);
  });

  // 14.
  it("multi-step: load_guideline in step 1, calculate_dose in step 2 → both cards merge", () => {
    // The headline integration test: full multi-step happy path. Step 1
    // does load_guideline; step 2 does calculate_dose + get_reassessment_plan
    // and emits BOTH fences. Validates that aggregation across steps gives
    // BOTH cards correctly merged.
    const step2Text =
      "Dose computed. Reassessing in 4h.\n\n" +
      doseFence(VALID_ID_A) +
      "\n\n" +
      reassessFence(VALID_ID_B);
    const r = validateResponse(
      event([
        step("Loading guideline...", [
          {
            toolCallId: "loadg-001",
            toolName: "load_guideline",
            output: { kind: "guideline", id: "nz-croup-v1" },
          },
        ]),
        step(step2Text, [
          doseToolResult(VALID_ID_A),
          reassessToolResult(VALID_ID_B),
        ]),
      ]),
    );
    expect(r.blocked).toBeUndefined();
    expect(r.dose_card).not.toBeNull();
    expect(r.reassessment_card).not.toBeNull();
    expect(r.dose_card!.tool_result.dose_mg).toBe(2.13);
    expect(r.reassessment_card!.tool_result.reassess_in_minutes).toBe(240);
  });

  // Bonus: refusal-surfacing path (not in the 14-min spec but worth
  // pinning — Lane F switches on `refusal.kind`).
  it("tool refusal with no card emitted → refusal surfaced (not blocked)", () => {
    const r = validateResponse(
      event([
        step("I cannot compute a dose without a weight.", [
          refusalToolResult(
            "refusal-001",
            "weight_missing",
            "Weight not provided in the note.",
          ),
        ]),
      ]),
    );
    expect(r.blocked).toBeUndefined();
    expect(r.dose_card).toBeNull();
    expect(r.refusal).not.toBeNull();
    expect(r.refusal!.kind).toBe("weight_missing");
    expect(r.refusal!.toolName).toBe("calculate_dose");
  });
});
