// lib/case-state.ts
//
// CaseState — the SERVER-OWNED object that carries turn-1's outputs verbatim
// into turn 2. This is the human-in-the-loop contract made literal.
//
// INVARIANT (DESIGN.md "Two-turn HITL"): TURN 2 DOES ZERO RE-EXTRACTION.
//   Turn 1 produces the facts + differential ONCE; CaseState freezes them, plus
//   the clinician's confirmations (selected condition / guideline / severity).
//   Turn 2 consumes this state — it never re-reads the untrusted note, never
//   re-runs extraction. The ONLY thing that crosses the turn boundary is this
//   object, so each turn is independently reproducible and the clinician's
//   confirmation is the sole state that moves judgment → execution.
//
// note_hash is a SHA-256 of the raw note: it pins WHICH note these outputs came
// from (so turn 2 can detect a swapped note) WITHOUT carrying the untrusted text
// itself across the boundary. The note never re-enters the model after turn 1.

import { createHash } from "node:crypto";
import type { ExtractedFacts, Differential } from "@/lib/schemas";

/**
 * The frozen turn-1 result + the clinician's confirmations. Server-owned:
 * constructed on the server from turn-1's validated output; the selected_* slots
 * are filled by the clinician's UI selections before turn 2 runs.
 */
export type CaseState = {
  /** SHA-256 hex of the raw note — pins provenance without carrying the text. */
  note_hash: string;
  /** Turn-1 extracted facts, verbatim (turn 2 must NOT re-extract). */
  extracted_facts: ExtractedFacts;
  /** Turn-1 differential, verbatim. */
  differential: Differential;
  /** Clinician-confirmed condition (null until the UI selection). */
  selected_condition: string | null;
  /** Clinician-selected guideline_id (null until the UI selection). */
  selected_guideline_id: string | null;
  /** Clinician-confirmed severity row (null until confirmed). */
  selected_severity: string | null;
};

/**
 * SHA-256 hex digest of the raw note. Deterministic, dependency-light
 * (node:crypto) — pins provenance so turn 2 can verify it is acting on the same
 * note turn 1 saw, without ever re-sending the untrusted text to the model.
 */
export function hashNote(note: string): string {
  return createHash("sha256").update(note, "utf8").digest("hex");
}

/**
 * Build the server-owned CaseState from turn-1's outputs. Called AFTER turn 1's
 * structured output is validated. selected_* default to null — they carry the
 * clinician's confirmations, which arrive from the UI between the two turns; a
 * caller may seed them here if a selection is already known.
 *
 * Pure + synchronous (hashing only) — no model, no network. Turn 2 will consume
 * the returned object verbatim and re-extract NOTHING.
 */
export function buildCaseState(args: {
  note: string;
  extractedFacts: ExtractedFacts;
  differential: Differential;
  selectedCondition?: string | null;
  selectedGuidelineId?: string | null;
  selectedSeverity?: string | null;
}): CaseState {
  return {
    note_hash: hashNote(args.note),
    extracted_facts: args.extractedFacts,
    differential: args.differential,
    selected_condition: args.selectedCondition ?? null,
    selected_guideline_id: args.selectedGuidelineId ?? null,
    selected_severity: args.selectedSeverity ?? null,
  };
}
