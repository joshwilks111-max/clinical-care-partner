// lib/response-validator.ts
//
// THE HARNESS-SIDE STRUCTURED-RESPONSE VALIDATOR — the runtime equivalent of
// the skill's `scripts/lint_skill_output.ts` + `scripts/validate_dose_card.ts`.
// Same Zod schemas (imported via tools/types — see D10), same regex guard,
// same closed refusal-kind unions. The skill workspace is the source of
// truth; this file is its mechanical enforcer at request time.
//
// WHAT IT DOES (D1/D2 contract):
//   1. Walks `event.steps[].toolResults` to build a tool-call-id → result
//      index. (D2 lock: the AI SDK 6 OnFinishEvent extends StepResult with
//      `steps: StepResult[]`, and EACH step carries its own toolResults.
//      A multi-step loop with load_guideline in step 1 + calculate_dose in
//      step 2 yields the dose-result on step 2's toolResults, NOT on
//      event.toolResults. Aggregate across all steps.)
//   2. Aggregates the assistant's prose across ALL steps' .text (the model
//      may interleave prose across multiple steps before the final fence).
//   3. Extracts ```dose-card and ```reassessment-card fenced JSON blocks
//      from the aggregated prose. Same regex shape as the skill's lint
//      script.
//   4. Zod-validates each block via DoseCardEmittedSchema /
//      ReassessmentCardEmittedSchema (.strict() — extra keys, including
//      smuggled-in numerics, fail validation; that's invariant 5 made
//      mechanical).
//   5. Looks up the block's tool_call_id in the index. Orphan id → block.
//   6. Merges the tool result's `output` fields (dose_mg, dose_ml, max_mg,
//      capped, source_version, source_url, …) into the validated card.
//      The model authored zero numbers; the validator carries them through.
//   7. Card-on-refusal: if a card cites a tool_call_id whose tool returned
//      `kind: "refusal"`, the model claims success the tool denied — BLOCK.
//
// RETURN SHAPE — discriminated by which fields are populated:
//   { text, dose_card, reassessment_card, refusal, blocked? }
//     text             always present (aggregated prose, fences kept inline)
//     dose_card        present iff a valid dose-card fence + matching tool ok
//     reassessment_card present iff a valid reassess fence + matching tool ok
//     refusal          present iff a tool returned a refusal AND no card was
//                      cited (or the skill emitted only a prose refusal —
//                      see "SkillDirectRefusalKind" below)
//     blocked          present iff a validation failure occurred. When set,
//                      the harness MUST surface a red technical-failure
//                      card to the clinician (D14) — never fall back to
//                      displaying the raw text.
//
// WHY .strict() ON THE EMITTED SCHEMA MATTERS:
//   The skill's contract says the model emits only qualitative keys
//   (drug, route, severity_row, assessment, plan, tool_call_id) — never
//   dose_mg, mg_per_kg, etc. .strict() rejects ANY extra key, so a model
//   regression that smuggles "dose_mg": 999 into the fence is blocked here
//   rather than rendered to the clinician.

import { z } from "zod";

import {
  DoseCardEmittedSchema,
  ReassessmentCardEmittedSchema,
  type DoseCardEmitted,
  type ReassessmentCardEmitted,
} from "@skills/dose-calculator/scripts/validate_dose_card";

// ─── Public types ────────────────────────────────────────────────────────────

/**
 * The minimal "OnFinishEvent-shaped" input we need. Defined structurally
 * (not imported from `ai`) so:
 *   - tests don't need to construct a full SDK OnFinishEvent
 *   - this file is decoupled from the SDK generic noise
 *   - swapping providers (e.g. plain `generateText` test fixtures) Just Works
 * Anything Next/AI-SDK gives us in onFinish satisfies this shape.
 */
export type OnFinishLike = {
  /**
   * Every step in the multi-step loop. PER D2, the validator MUST walk
   * this array — NOT the top-level `event.toolResults`. Each step has
   * its own text contribution and its own toolResults.
   */
  steps: ReadonlyArray<StepLike>;
};

export type StepLike = {
  /** Prose for this step. May be empty (e.g. a tool-only step). */
  text: string;
  /** Tool results returned at this step. May be empty (e.g. a text-only step). */
  toolResults: ReadonlyArray<ToolResultLike>;
};

export type ToolResultLike = {
  /** Matches a fence's `tool_call_id`. */
  toolCallId: string;
  toolName: string;
  /** Whatever the tool returned. Discriminated by `output.kind` per our tool
   *  conventions (calculate_dose returns `{ kind: "dose" | "refusal" }`). */
  output: unknown;
};

/**
 * The validator's output. Any non-null card is a renderable management
 * view; `blocked` is the technical-failure surface (red, D14) that the
 * harness MUST honour over the prose.
 */
export type ValidatedResponse = {
  /** The aggregated assistant prose, fences and all. */
  text: string;
  /**
   * Validated dose-card (qualitative fields from the model + numeric fields
   * merged from the matching tool result). `null` if no valid dose-card
   * fence was present, or the card was blocked (`blocked` populated).
   */
  dose_card: MergedDoseCard | null;
  /**
   * Validated reassessment-card. Same null semantics as `dose_card`.
   */
  reassessment_card: MergedReassessmentCard | null;
  /**
   * Tool-side refusal surfaced as a structured object the UI can render
   * via <RefusalCard>. Present iff (a) a tool returned `kind: "refusal"`
   * AND (b) the model did NOT emit a successful card citing that call.
   * (If the model DID emit a card citing a refused tool, that's `blocked`,
   * not `refusal` — see "card_on_refused_tool" below.)
   */
  refusal: ToolRefusal | null;
  /** Validator-blocked state. Set means the harness must render red. */
  blocked?: ValidatorBlock;
};

/**
 * The shape we hand Lane F's <DoseCard>. Qualitative fields come from the
 * model-emitted block (validated); everything else is spread from the
 * tool's output. We deliberately type the tool-result spread as a permissive
 * record because Lane B owns calculate_dose's exact output shape — coupling
 * here would make every Lane B field-rename a Lane C type bump.
 */
export type MergedDoseCard = DoseCardEmitted & {
  /** The full tool output (calculate_dose's `DoseResult`), merged in flat
   *  so Lane F can pull dose_mg, dose_ml, capped, source_version, etc. */
  tool_result: Record<string, unknown>;
};

export type MergedReassessmentCard = ReassessmentCardEmitted & {
  tool_result: Record<string, unknown>;
};

/**
 * Surfaced to <RefusalCard> when a tool refused and the model did NOT cover
 * the refusal with a card claim. Kind is preserved verbatim from the tool;
 * Lane F's switch on kind picks the right copy + next-action chip.
 */
export type ToolRefusal = {
  toolName: string;
  /** Whatever the tool put in `output.reason` / `output.kind` etc. */
  kind: string;
  message: string;
};

/** The closed set of validator-block reasons. Lane F switches on this. */
export type ValidatorBlockReason =
  | "malformed_json"
  | "schema_violation"
  | "orphan_tool_call_id"
  | "card_on_refused_tool";

export type ValidatorBlock = {
  reason: ValidatorBlockReason;
  /** Human-readable detail with file/field context — surface as the red-card body. */
  detail: string;
  /** Which card kind triggered the block (for routing in the UI). */
  card_kind: "dose-card" | "reassessment-card";
};

// ─── Block extraction ────────────────────────────────────────────────────────

/**
 * Same fence shape the skill's lint script uses. The leading ` ``` ` is
 * absorbed by the literal kind; we tolerate optional inline whitespace
 * after the kind tag (some markdown editors add it). The `[\s\S]*?` body
 * is non-greedy so multiple blocks in one message extract independently.
 *
 * Whitespace tolerance: `\\s*\\n` allows a trailing space before the
 * newline, which surfaces in the wild when models emit ` ```dose-card  \n`.
 * The closing fence `\n\`\`\`` requires the fence at column 0 of its own
 * line — same as CommonMark.
 */
function makeFenceRegex(kind: "dose-card" | "reassessment-card"): RegExp {
  return new RegExp("```" + kind + "\\s*\\n([\\s\\S]*?)\\n```", "g");
}

function extractBlocks(
  text: string,
  kind: "dose-card" | "reassessment-card",
): string[] {
  const re = makeFenceRegex(kind);
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push(m[1]);
  return out;
}

// ─── Tool-result lookup ──────────────────────────────────────────────────────

type ToolResultIndex = Map<string, ToolResultLike>;

/**
 * Build the tool-call-id → result index by walking EVERY step's
 * toolResults (D2). If the same id appears twice (which would be a model/
 * SDK bug), the later wins — but we never expect that in practice.
 */
function indexToolResults(steps: ReadonlyArray<StepLike>): ToolResultIndex {
  const idx: ToolResultIndex = new Map();
  for (const step of steps) {
    for (const tr of step.toolResults) {
      idx.set(tr.toolCallId, tr);
    }
  }
  return idx;
}

/** Best-effort detection of a refusal-shaped tool output.
 *
 *  The harness has two refusal-wrapper conventions in production:
 *    - `{ kind: "refusal", reason, message }` — calculate_dose (legacy, the
 *      original safety-spine tool; `kind` discriminator was natural because
 *      the success case is `{ kind: "dose", … }`).
 *    - `{ status: "refusal", reason, message }` — load_guideline and
 *      get_reassessment_plan (v3.1 Lane B, retrieval-style tools where
 *      `status` reads more naturally because the success case is
 *      `{ status: "ok", … }`).
 *
 *  Both shapes are equally valid; the discriminator name is the tool author's
 *  call. Widening the validator to accept either keeps Lane B's retrieval
 *  refusals (out_of_scope, invalid_guideline_id, no_reassessment_required, …)
 *  flowing through `validated.refusal` to the RefusalCard UI. Without this
 *  widening the asthma-out-of-scope smoke case is silently broken — the
 *  refusal is dropped on the floor and the UI renders no card.
 *
 *  Both shapes carry `reason: string` and `message: string`; callers only
 *  read those two fields, so the union return type is safe. */
function isRefusalOutput(
  output: unknown,
): output is { reason: string; message: string } {
  if (typeof output !== "object" || output === null) return false;
  const o = output as { kind?: unknown; status?: unknown };
  return o.kind === "refusal" || o.status === "refusal";
}

// ─── The validator entry point ───────────────────────────────────────────────

/**
 * Parse + validate the model's on-finish event into a renderable
 * ValidatedResponse. Pure function; no I/O.
 */
export function validateResponse(event: OnFinishLike): ValidatedResponse {
  // 1) Aggregate prose across every step (D2). Empty-text steps contribute
  //    nothing; we don't collapse blank lines so the original fence layout
  //    survives for the UI's <Streamdown> renderer.
  const text = event.steps.map((s) => s.text).join("\n");

  // 2) Build the id → tool-result lookup. Same walk D2 mandates.
  const toolIndex = indexToolResults(event.steps);

  // 3) Parse fences. Both kinds, in one pass each.
  const doseRaw = extractBlocks(text, "dose-card");
  const reassessRaw = extractBlocks(text, "reassessment-card");

  // 4) Validate dose-card first; if it blocks, return early — a blocked
  //    response NEVER shows partial structured data.
  let dose_card: MergedDoseCard | null = null;
  if (doseRaw.length > 0) {
    const result = validateCardFence(
      doseRaw[0]!,
      DoseCardEmittedSchema,
      "dose-card",
      toolIndex,
    );
    if (!result.ok) return blockedResponse(text, result.block);
    dose_card = result.card as MergedDoseCard;
  }

  // 5) Same for reassessment-card.
  let reassessment_card: MergedReassessmentCard | null = null;
  if (reassessRaw.length > 0) {
    const result = validateCardFence(
      reassessRaw[0]!,
      ReassessmentCardEmittedSchema,
      "reassessment-card",
      toolIndex,
    );
    if (!result.ok) return blockedResponse(text, result.block);
    reassessment_card = result.card as MergedReassessmentCard;
  }

  // 6) Refusal surfacing: if a calculate_dose tool refused AND we have no
  //    dose-card to show, the UI should render a RefusalCard. We pick the
  //    FIRST refusal-shaped tool result found — multi-refusal in one turn
  //    isn't a modelled state and would itself be a model bug.
  let refusal: ToolRefusal | null = null;
  if (dose_card === null && reassessment_card === null) {
    for (const tr of toolIndex.values()) {
      if (isRefusalOutput(tr.output)) {
        refusal = {
          toolName: tr.toolName,
          kind: tr.output.reason,
          message: tr.output.message,
        };
        break;
      }
    }
  }

  return { text, dose_card, reassessment_card, refusal };
}

// ─── Per-block validation (the inner loop) ───────────────────────────────────

type CardValidationResult =
  | {
      ok: true;
      // The success card is the validated emitted shape PLUS the merged
      // tool_result spread. Widening the return type here (rather than at
      // the call site cast) keeps the discriminated-union narrowing honest.
      card: MergedDoseCard | MergedReassessmentCard;
    }
  | { ok: false; block: ValidatorBlock };

function validateCardFence(
  raw: string,
  schema: z.ZodTypeAny,
  kind: "dose-card" | "reassessment-card",
  toolIndex: ToolResultIndex,
): CardValidationResult {
  // 4a) Parse JSON. A typo (missing comma, smart quote, …) → blocked.
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return {
      ok: false,
      block: {
        reason: "malformed_json",
        detail: `${kind}: JSON.parse failed — ${(e as Error).message}`,
        card_kind: kind,
      },
    };
  }

  // 4b) Strict-schema validate. Catches extra keys (smuggled numerics),
  //     missing required fields, whitespace-only strings (nonEmpty trim),
  //     bad tool_call_id regex.
  const result = schema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    return {
      ok: false,
      block: {
        reason: "schema_violation",
        detail: `${kind}: ${issues}`,
        card_kind: kind,
      },
    };
  }
  const validated = result.data as DoseCardEmitted | ReassessmentCardEmitted;

  // 4c) Look up the tool result by id. Orphan → blocked.
  const tr = toolIndex.get(validated.tool_call_id);
  if (!tr) {
    return {
      ok: false,
      block: {
        reason: "orphan_tool_call_id",
        detail: `${kind}: tool_call_id ${JSON.stringify(validated.tool_call_id)} not found in event.steps[].toolResults`,
        card_kind: kind,
      },
    };
  }

  // 4d) If the matching tool result was itself a refusal, the model is
  //     claiming success the tool denied — BLOCK. Surface as a red
  //     technical-failure card. Tested under "card on refused tool result
  //     → blocked".
  if (isRefusalOutput(tr.output)) {
    return {
      ok: false,
      block: {
        reason: "card_on_refused_tool",
        detail: `${kind}: cited tool_call_id ${validated.tool_call_id} (${tr.toolName}) refused with reason=${tr.output.reason}; model must not emit a success card for a refused tool`,
        card_kind: kind,
      },
    };
  }

  // 4e) Merge the tool result's output fields into the validated card.
  //     We type the tool_result as a permissive record so a Lane B
  //     schema bump doesn't cascade into Lane C. Lane F's UI does the
  //     final shape-check against its own DoseResult contract.
  const tool_result =
    typeof tr.output === "object" && tr.output !== null
      ? (tr.output as Record<string, unknown>)
      : {};

  // Cast to the merged-card union: TS doesn't distribute spreads over the
  // emitted-schema union cleanly, so we satisfy the wider CardValidationResult
  // shape explicitly here. The runtime value is identical.
  const merged = { ...validated, tool_result } as
    | MergedDoseCard
    | MergedReassessmentCard;
  return { ok: true, card: merged };
}

function blockedResponse(
  text: string,
  block: ValidatorBlock,
): ValidatedResponse {
  // When blocked, we still return the prose (the route logs it for triage)
  // BUT both cards are null — the UI must NEVER fall back to rendering raw
  // text in lieu of a structured card. D14: red = technical failure; UI
  // shows the block reason verbatim with a retry CTA.
  return {
    text,
    dose_card: null,
    reassessment_card: null,
    refusal: null,
    blocked: block,
  };
}
