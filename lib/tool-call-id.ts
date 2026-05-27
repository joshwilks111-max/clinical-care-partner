// lib/tool-call-id.ts
//
// THE TOOL-CALL ID GENERATOR — one number, one contract.
//
// The skill emits `tool_call_id` in every fenced JSON block (`dose-card`,
// `reassessment-card`); the harness validator (lib/response-validator.ts) uses
// that id to look up the matching tool result in `event.steps[].toolResults`.
// The id is the join key between PROSE (LLM-authored) and STRUCTURED FIELDS
// (deterministic tool output). If a card cites an id the harness didn't issue,
// the validator BLOCKS the message — that's the "orphan tool_call_id" failure
// path, and it surfaces as a red technical-failure card to the clinician.
//
// THE REGEX CONTRACT:
//   ^[a-zA-Z0-9_-]{8,32}$
//
// Same shape Zod enforces inside DoseCardEmittedSchema and
// ReassessmentCardEmittedSchema (skills/dose-calculator/scripts/
// validate_dose_card.ts). Keeping the generator and the validator pinned to
// the same regex closes the drift seam — if anyone ever tightens or loosens
// the schema, the generator's tests fail before the runtime does.
//
// WHY nanoid (not crypto.randomUUID):
//   * randomUUID is 36 chars with hyphens (`8-4-4-4-12`) — too long, and the
//     hyphen placement is fixed so it's needlessly bulky in tool-call
//     contexts where ids appear in every emitted block.
//   * nanoid's default alphabet is exactly URL-safe (`A-Za-z0-9_-`) which
//     matches our regex by construction — no character-class translation
//     needed.
//   * Length 12 yields ~71 bits of entropy — far beyond what we need for an
//     in-process tool-call identifier (collisions across a single multi-step
//     loop are effectively impossible; the namespace resets per request).
//   * NOT a cryptographic identity claim — these ids are NOT auth tokens; the
//     harness server-side maps them. nanoid's PRNG is sufficient here.
//
// USAGE:
//   import { newToolCallId } from "@/lib/tool-call-id";
//   const id = newToolCallId();   // → e.g. "V1StGXR8_Z5j"

import { nanoid } from "nanoid";

/**
 * The contract the skill's Zod schemas enforce on emitted `tool_call_id`
 * values. Exported so tests can assert that the generator's output conforms
 * to it; the harness validator uses the Zod schema (which embeds the same
 * literal) rather than this regex directly.
 */
export const TOOL_CALL_ID_REGEX = /^[a-zA-Z0-9_-]{8,32}$/;

/**
 * Fixed length for generated ids. 12 chars sits comfortably in the regex's
 * [8,32] band and keeps emitted blocks compact. If we ever need more entropy
 * the choice is independent of the schema contract — change the constant,
 * re-run the regex-conformance test, ship.
 */
const TOOL_CALL_ID_LENGTH = 12;

/**
 * Generate a fresh tool_call_id that is GUARANTEED to satisfy the
 * skill-side Zod regex. Pure function; no side effects.
 */
export function newToolCallId(): string {
  return nanoid(TOOL_CALL_ID_LENGTH);
}
