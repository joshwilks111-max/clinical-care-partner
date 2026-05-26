// app/console/safety-check-card.tsx
//
// THE TURN-1.5 SAFETY-CHECK CARD (Beat 4 — the differential-collapse loop made
// visible). It renders the `ask` terminal of /api/turn1.5: a must-not-miss
// condition is unresolved, so BEFORE the dose-enabling guideline buttons may
// appear, the clinician must answer ONE discriminating question.
//
// THE FAIL-CLOSED ROLE (read with console.tsx): this card IS the visible
// interruption between the differential and the guideline buttons. While it is on
// screen, the guideline buttons are NOT in the DOM (console.tsx only renders them
// on a turn1.5 status:"ok"). Answering routes back through the SERVER decider
// (phase "answer") — the client never runs applyAnswer/decideCollapse; it only
// renders what the server returns.
//
// DESIGN (DESIGN.md D1/D3/D6): a VARIANT of the dashed "your-turn" panel with an
// amber accent — not a new card pattern, not a solid box. Three-tier hierarchy:
//   1. amber condition eyebrow  — RULE OUT · <TARGET>      (deterministic)
//   2. bold question            — the model's phrasing      (ESCAPED text)
//   3. muted one-line rationale — why we're asking          (deterministic)
// The answer options are THREE buttons of EQUAL visual weight: a filled "No"
// would bias toward the dose-enabling answer, so all three are outline buttons.

"use client";

import { Button } from "@/components/ui/button";

import { ProvenanceBadge } from "./provenance-badge";
import type { DiscriminatorAnswer } from "@/app/api/turn1.5/route";

export type SafetyCheckCardProps = {
  /** The must-not-miss condition the question discriminates (deterministic). */
  target: string;
  /** The model-PHRASED question. Rendered as ESCAPED text (React default) —
   *  NEVER via dangerouslySetInnerHTML. Mirrors the source_url XSS guard. */
  question: string;
  /** Called with the clinician's closed-enum answer → POST turn1.5 phase "answer". */
  onAnswer: (answer: DiscriminatorAnswer) => void;
  /** Disable the answer buttons while the answer is in flight (turn1.5/turn2). */
  busy?: boolean;
};

/** One discriminator answer option. ALL three share the same outline style so no
 *  single answer is visually privileged (a filled "No" would nudge toward the
 *  dose-enabling answer). The label + the closed enum value are paired here. */
const ANSWER_OPTIONS: ReadonlyArray<{
  value: DiscriminatorAnswer;
  label: string;
}> = [
  { value: "absent", label: "No, not present" },
  { value: "present", label: "Yes, present" },
  // not_assessed maps to present:true server-side (fail closed) — the clinician
  // who hasn't looked is treated identically to "might be there".
  { value: "not_assessed", label: "Not assessed" },
];

/** Deterministic rationale line (NOT model-authored): explains WHY the question
 *  is being asked, in terms of the turn-1 differential. */
function rationaleFor(target: string): string {
  return (
    `Turn 1 found ${target.toLowerCase()} as a must-not-miss condition with key ` +
    `findings not documented. It must be ruled out before a guideline can be applied.`
  );
}

export function SafetyCheckCard({
  target,
  question,
  onAnswer,
  busy = false,
}: SafetyCheckCardProps) {
  return (
    <section
      data-testid="safety-check-card"
      // A VARIANT of the dashed your-turn panel (turn1-view.tsx) tinted amber:
      // the safety accent reads as a deliberate interruption, not a new pattern.
      className="rounded-lg border border-dashed border-safety-border bg-safety/40 p-3"
    >
      {/* Tier 1 — the deterministic condition eyebrow. */}
      <div className="mb-2 flex items-center gap-2">
        <span
          data-testid="safety-check-eyebrow"
          className="font-mono text-[10px] font-semibold uppercase tracking-wide text-safety-foreground"
        >
          RULE OUT · {target.toUpperCase()}
        </span>
        {/* The real provenance seam — the clinician owns this answer. */}
        <ProvenanceBadge kind="clinician-selected" />
      </div>

      {/* Tier 2 — the model's question. ESCAPED text: rendered as a text child so
          React escapes it; we NEVER use dangerouslySetInnerHTML here. */}
      <p
        data-testid="safety-check-question"
        className="text-[14px] font-semibold text-safety-foreground"
      >
        {question}
      </p>

      {/* Tier 3 — the deterministic muted rationale. */}
      <p className="mt-1 text-[12px] text-muted-foreground">
        {rationaleFor(target)}
      </p>

      {/* THREE answer buttons of EQUAL visual weight (all outline). */}
      <div className="mt-3 flex flex-wrap gap-2">
        {ANSWER_OPTIONS.map((opt) => (
          <Button
            key={opt.value}
            variant="outline"
            data-answer={opt.value}
            disabled={busy}
            onClick={() => onAnswer(opt.value)}
          >
            {opt.label}
          </Button>
        ))}
      </div>
    </section>
  );
}
