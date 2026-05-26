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
// note_hash is a SHA-256 of the raw note: it pins provenance for audit and future
// verification WITHOUT carrying the untrusted text itself across the boundary. The
// note never re-enters the model after turn 1. Active swapped-note detection is
// deferred (it would HMAC-sign the CaseState server-side and verify in turn 2);
// turn 2 does not currently compare the hash, it only string-validates its shape.

import { createHash } from "node:crypto";
import type {
  ExtractedFacts,
  Differential,
  DiscriminatorAnswer,
} from "@/lib/schemas";

const DISCRIMINATOR_ANSWERS: readonly DiscriminatorAnswer[] = [
  "present",
  "absent",
  "not_assessed",
];

/** One advisory discriminating Q&A entry (Turn 1.5 answer or skip). */
export type DiscriminatingQaEntry = {
  target: string;
  question: string;
  answer: DiscriminatorAnswer | "skipped";
  /** false when the clinician skipped without engaging. */
  engaged: boolean;
  /** ISO timestamp when the server recorded the entry. */
  recorded_at: string;
};

/**
 * The frozen turn-1 result + the clinician's confirmations. Server-owned:
 * constructed on the server from turn-1's validated output; the selected_* slots
 * are filled by the clinician's UI selections before turn 2 runs.
 *
 * SERVER-OWNED fields (turn1.5 writes; turn2 reads but NEVER mutates):
 *   - discriminating_qa: advisory Q&A from Turn 1.5. Turn1.5 is the sole writer;
 *     turn2 may read for context but must not append.
 */
export type CaseState = {
  /** SHA-256 hex of the raw note — pins provenance without carrying the text. */
  note_hash: string;
  /** Turn-1 extracted facts, verbatim (turn 2 must NOT re-extract). */
  extracted_facts: ExtractedFacts;
  /** Turn-1 differential, verbatim (may be updated by applyAnswer after answer). */
  differential: Differential;
  /** Clinician-confirmed condition (null until the UI selection). */
  selected_condition: string | null;
  /** Clinician-selected guideline_id (null until the UI selection). */
  selected_guideline_id: string | null;
  /** Clinician-confirmed severity row (null until confirmed). */
  selected_severity: string | null;
  /**
   * Advisory discriminating Q&A from Turn 1.5.
   *
   * CONVENTION (not enforced at the wire): Turn 1.5's answer phase is the only
   * code path that appends; Turn 2 reads but never mutates. The wire validator
   * accepts client-supplied entries (necessary so Turn 2 can resume mid-flow
   * after a page reload). A forged entry cannot dose past safety: Rule 2
   * (positive must-not-miss) abstains regardless of audit-trail state, and
   * Turn 2's wrong-guideline audit checks the clinician-confirmed condition
   * against the routed guideline. The forged-entry attack surface is purely
   * audit-trail cosmetic.
   */
  discriminating_qa: DiscriminatingQaEntry[];
};

/** Validate a single discriminating_qa wire entry. */
export function isDiscriminatingQaEntryLike(v: unknown): boolean {
  if (typeof v !== "object" || v === null) return false;
  const e = v as Record<string, unknown>;
  const answerOk =
    e.answer === "skipped" ||
    (typeof e.answer === "string" &&
      DISCRIMINATOR_ANSWERS.includes(e.answer as DiscriminatorAnswer));
  return (
    typeof e.target === "string" &&
    typeof e.question === "string" &&
    answerOk &&
    typeof e.engaged === "boolean" &&
    typeof e.recorded_at === "string"
  );
}

/**
 * Narrow + validate an unknown value as a CaseState enough to drive both route
 * handlers (turn1.5 + turn2). `discriminating_qa` is optional — a pre-turn1.5
 * POST may omit it; callers normalise with withDefaultedDiscriminatingQa.
 */
export function isCaseStateLike(v: unknown): v is CaseState {
  if (typeof v !== "object" || v === null) return false;
  const c = v as Record<string, unknown>;
  const facts = c.extracted_facts;
  if (typeof facts !== "object" || facts === null) return false;
  const f = facts as Record<string, unknown>;
  const weightOk = f.weight_kg === null || typeof f.weight_kg === "number";
  const differentialOk =
    typeof c.differential === "object" &&
    c.differential !== null &&
    Array.isArray((c.differential as Record<string, unknown>).conditions);
  const qa = c.discriminating_qa;
  const qaOk =
    qa === undefined ||
    (Array.isArray(qa) && qa.every(isDiscriminatingQaEntryLike));
  return (
    typeof c.note_hash === "string" &&
    weightOk &&
    differentialOk &&
    qaOk &&
    (c.selected_condition === null ||
      typeof c.selected_condition === "string") &&
    (c.selected_guideline_id === null ||
      typeof c.selected_guideline_id === "string")
  );
}

/**
 * SHA-256 hex digest of the raw note. Deterministic, dependency-light
 * (node:crypto) — pins provenance so turn 2 can verify it is acting on the same
 * note turn 1 saw, without ever re-sending the untrusted text to the model.
 */
export function hashNote(note: string): string {
  return createHash("sha256").update(note, "utf8").digest("hex");
}

/** Default discriminating_qa to [] when omitted from the wire shape. */
export function withDefaultedDiscriminatingQa(c: CaseState): CaseState {
  return {
    ...c,
    discriminating_qa: Array.isArray(c.discriminating_qa)
      ? c.discriminating_qa
      : [],
  };
}

/**
 * Collapse round for Turn 2's defense-in-depth gate: one advisory question
 * answered (engaged) counts as round 1; skip-only or no Q&A stays at 0.
 */
export function collapseRoundForGate(caseState: CaseState): number {
  return caseState.discriminating_qa.some((q) => q.engaged) ? 1 : 0;
}

/**
 * Build the server-owned CaseState from turn-1's outputs. Called AFTER turn 1's
 * structured output is validated. selected_* default to null — they carry the
 * clinician's confirmations, which arrive from the UI between the two turns.
 */
export function buildCaseState(args: {
  note: string;
  extractedFacts: ExtractedFacts;
  differential: Differential;
  selectedCondition?: string | null;
  selectedGuidelineId?: string | null;
  selectedSeverity?: string | null;
  discriminatingQa?: DiscriminatingQaEntry[];
}): CaseState {
  return {
    note_hash: hashNote(args.note),
    extracted_facts: args.extractedFacts,
    differential: args.differential,
    selected_condition: args.selectedCondition ?? null,
    selected_guideline_id: args.selectedGuidelineId ?? null,
    selected_severity: args.selectedSeverity ?? null,
    discriminating_qa: args.discriminatingQa ?? [],
  };
}
