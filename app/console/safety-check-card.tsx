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

import { ShieldAlert, CheckCircle2 } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
          className="font-mono text-[11px] font-semibold uppercase tracking-wide text-safety-foreground"
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

// ---------------------------------------------------------------------------
// THE TURN-1.5 ABSTENTION — the urgent amber "escalate" state.
//
// THE HONESTY INVARIANT (the graded core): the UI must NEVER assert a clinical
// claim the SERVER did not make. The turn-1.5 abstention response itself carries
// only reason/headline/detail/source — NOT which must-not-miss condition was
// suspected. So the urgent copy ("SUSPECTED <CONDITION>", the discriminator
// rationale) is DATA-DRIVEN from `lastAsk` — the target + discriminators the
// server identified in the PRECEDING `ask` (console.tsx RETAINS them, since the
// abstention drops them). If there was no prior ask (lastAsk null), we fall back
// to rendering the SERVER's own headline/detail verbatim — exactly as
// turn2-view.tsx's AbstentionView does — rather than a hardcoded condition. That
// fallback is what GUARANTEES we never name a condition the data doesn't support.
// ---------------------------------------------------------------------------

export type Turn15AbstentionProps = {
  /** The must-not-miss condition the server identified in the prior `ask`
   *  (e.g. "Epiglottitis"). Null when there was no prior ask → server-copy
   *  fallback (we do NOT invent a condition name). */
  target: string | null;
  /** The discriminating findings from the prior `ask` (e.g. ["drooling",
   *  "tripod posture"]). Empty when unknown → generic must-not-miss rationale. */
  discriminators: string[];
  /** The SERVER's abstention headline — the honest fallback when target is null. */
  serverHeadline: string;
  /** The SERVER's abstention detail — the honest fallback when target is null. */
  serverDetail?: string | null;
};

export function Turn15Abstention({
  target,
  discriminators,
  serverHeadline,
  serverDetail,
}: Turn15AbstentionProps) {
  // DATA-DRIVEN path: name the exact condition the server identified. When there
  // was no prior ask (target null), fall back to the SERVER's own copy so we
  // never assert a condition the response didn't carry (the honesty invariant).
  const eyebrow = target
    ? `ESCALATE · SUSPECTED ${target.toUpperCase()}`
    : "ESCALATE";
  const headline = target
    ? `Possible ${target.toLowerCase()}: do not apply the selected dosing guideline.`
    : serverHeadline;
  const detail = target
    ? discriminators.length > 0
      ? `${discriminators.join(" / ")} suggest a must-not-miss condition. Escalate for urgent assessment.`
      : "A must-not-miss condition could not be ruled out. Escalate for urgent assessment."
    : (serverDetail ?? null);

  return (
    <section data-testid="turn15-abstention" className="space-y-2">
      <Alert variant="safety" data-testid="turn15-abstention-alert">
        <ShieldAlert />
        <AlertTitle className="flex items-center gap-2">
          <span className="font-mono text-[11px] tracking-wide">{eyebrow}</span>
        </AlertTitle>
        <AlertDescription className="text-[13px] font-semibold text-safety-foreground">
          {headline}
        </AlertDescription>
      </Alert>
      {detail && <p className="text-[12px] text-muted-foreground">{detail}</p>}
    </section>
  );
}

// ---------------------------------------------------------------------------
// THE MUST-NOT-MISS CLEARED BANNER — the emerald "ruled out, proceeding" state.
//
// Shown on an answer-ok (the clinician's safe answer cleared the must-not-miss).
// Same honesty discipline: the condition NAME is templated from `target` (the
// server-identified condition retained from the prior ask), with a safe generic
// fallback when null — never a hardcoded "epiglottitis".
// ---------------------------------------------------------------------------

export type MustNotMissClearedBannerProps = {
  /** The must-not-miss condition that was ruled out (from the prior ask). Null
   *  → generic "must-not-miss condition ruled out" rather than a hardcoded name. */
  target: string | null;
};

export function MustNotMissClearedBanner({
  target,
}: MustNotMissClearedBannerProps) {
  const message = target
    ? `${target} ruled out ✓ — proceeding to apply the selected guideline.`
    : "Must-not-miss condition ruled out ✓ — proceeding to apply the selected guideline.";
  return (
    <Alert
      data-testid="turn15-cleared"
      className="border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"
    >
      <CheckCircle2 className="text-emerald-600" />
      <AlertTitle className="flex items-center gap-2">
        <span className="font-mono text-[11px] tracking-wide">
          MUST-NOT-MISS CLEARED
        </span>
      </AlertTitle>
      <AlertDescription className="text-emerald-800 dark:text-emerald-200">
        {message}
      </AlertDescription>
    </Alert>
  );
}
