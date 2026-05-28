// tools/ask_user.ts
//
// STRUCTURED SLOT TOOL — the skill calls this when a clinically-required
// piece of information is missing from the note (weight, severity, region).
// The tool emits a typed request via its CALL ARGUMENTS (kind + prompt +
// optional context); the harness UI surfaces an inline form keyed by `kind`;
// the clinician's answer flows back through the SDK's tool-result loop as
// `{ answer: string }`, which the next assistant turn reads.
//
// Per D3, ask_user has no refusal kinds: it can ALWAYS legitimately ask. The
// thing that CAN fail is the clinician's response, but that's a UI-side
// concern (validate the answer shape) rather than a tool-side refusal.
//
// Why the return type is `{ answer: string }` and not the request shape:
//   - From the MODEL's perspective, a tool call is "I'm asking; what came
//     back?". The thing that comes back is the answer string.
//   - From the HARNESS's perspective, the request shape lives in the SDK's
//     tool-call record (`call.args`) — that's what the UI dispatcher reads
//     to pick the form variant.
//   - This file synthesises a placeholder return so the type contract is
//     legible in isolation; the harness wires the real answer in onFinish.

import { z } from "zod";

// ---------------------------------------------------------------------------
// Slot kind enum — closed set, exhaustive per UI dispatcher.
// ---------------------------------------------------------------------------

/**
 * The closed set of slot kinds the skill is permitted to ask for. Each kind
 * corresponds to a specific UI form variant in the harness:
 *   - weight_kg: numeric input + "kg" suffix; rejects pounds via UI validator
 *   - severity:  enum select with the loaded guideline's severity_rows labels
 *   - region:    NZ / AU radio
 *   - confirm:   yes/no (e.g. "Is this weight in kg, not pounds?")
 *   - free_text: open-ended; used sparingly (e.g. "Describe the airway exam.")
 *
 * Adding a new slot kind requires a matching UI dispatch branch in the
 * harness's <ask-user-form>; the harness will fail the typecheck on the
 * exhaustive switch if a new kind lands without UI support.
 */
export const AskUserKind = z.enum([
  "weight_kg",
  "severity",
  "region",
  "confirm",
  "free_text",
]);
export type AskUserKind = z.infer<typeof AskUserKind>;

// ---------------------------------------------------------------------------
// Call args + return shape.
// ---------------------------------------------------------------------------

/**
 * The arguments the skill passes when it calls `ask_user`. The harness's
 * AI-SDK tool registration uses this Zod schema as the tool's input schema,
 * which is what the model sees in its tool-call contract.
 */
export const AskUserArgsSchema = z.object({
  kind: AskUserKind,
  prompt: z.string().trim().min(1),
  context: z.string().trim().min(1).optional(),
});
export type AskUserArgs = z.infer<typeof AskUserArgsSchema>;

/** The harness surfaces the clinician's reply through this shape. */
export type AskUserResult = {
  /** The clinician's answer text. Always present even if empty; UI enforces non-empty. */
  answer: string;
};

// ---------------------------------------------------------------------------
// The tool — defines the contract; the harness's onFinish/tool-result loop
// is where the actual answer string gets populated.
// ---------------------------------------------------------------------------

/**
 * Emit a structured request for one missing slot.
 *
 * Returns `{ answer: string }` — the SHAPE the harness will fill in once
 * the clinician submits the inline form. In a pure unit-test context this
 * function returns an empty answer placeholder; the harness's tool-binding
 * wraps it to insert the real form-submit value before passing it back to
 * the model as the tool result.
 *
 * Why this isn't async: the SDK's tool-call mechanism handles the
 * roundtrip; from this function's perspective there's no I/O. The args
 * validation IS the contract — if the model fabricates a kind, the parse
 * throws and the SDK surfaces a typed tool error.
 */
export function ask_user(args: AskUserArgs): AskUserResult {
  AskUserArgsSchema.parse(args);
  return { answer: "" };
}
