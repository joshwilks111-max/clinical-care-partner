// app/console/case-panel.tsx
//
// THE LEFT PANEL = the case (DESIGN.md UI states). It is persistent: the note,
// the extracted facts, and the one-click [Confirm weight] affordance stay on
// screen through turn 2 so the safety spine never scrolls away.
//
// The CONFIRM-WEIGHT step is the trust boundary made literal: the LLM-extracted
// weight is surfaced for the clinician to confirm before ANY dose runs — the
// human owns the one safety-critical input (DESIGN.md "Trust boundary", D3).

"use client";

import { CheckCircle2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/components/lib/utils";

import type { ExtractedFacts } from "@/lib/schemas";

// 4-column dl-cell — matches variant-B-balanced's "Extracted facts" grid
// (Weight / Age / Severity / Setting). Each cell carries its own dt+dd so
// screen readers + keyboard nav read the pair naturally.
function FactCell({
  k,
  v,
  mono = false,
}: {
  k: string;
  v: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-[11px] text-muted-foreground">{k}</dt>
      <dd className={cn("text-[15px] font-semibold", mono && "font-mono")}>
        {v}
      </dd>
    </div>
  );
}

export type CasePanelProps = {
  /** The raw note text (display only — never re-sent to the model after turn 1). */
  note: string;
  /** The turn-1 extracted facts to surface. Null before turn 1 runs. */
  facts: ExtractedFacts | null;
  /** True once the clinician has confirmed the weight. */
  weightConfirmed: boolean;
  /** Confirm the surfaced weight (the one-click safety-critical affordance). */
  onConfirmWeight: () => void;
};

export function CasePanel({
  note,
  facts,
  weightConfirmed,
  onConfirmWeight,
}: CasePanelProps) {
  const weight = facts?.weight_kg ?? null;

  // The note still renders here (the case-panel test asserts it does — the
  // note is "the case"). In the 3-column shell it's a muted secondary block,
  // not the primary surface, because the rail textarea is the live input.
  // It's hidden entirely before turn 1 to avoid a leftover empty-state block.
  const hasNote = note.trim().length > 0;

  return (
    <aside
      data-testid="case-panel"
      className="card-shadow rounded-xl border border-hairline bg-white"
    >
      <div className="flex items-center justify-between border-b border-hairline bg-white px-4 py-2.5">
        <h3 className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
          Extracted facts
        </h3>
        {facts && (
          <span className="rounded bg-primary-soft px-1.5 py-0.5 font-mono text-[10px] text-primary-d">
            LLM extraction
          </span>
        )}
      </div>
      <div className="space-y-3 p-4">
        {/* Extracted facts — 4-column grid mirroring variant-B-balanced. */}
        {facts && (
          <dl
            data-testid="extracted-facts"
            className="grid grid-cols-2 gap-x-4 gap-y-3 text-[13px] sm:grid-cols-4"
          >
            {weight !== null && <FactCell k="Weight" v={`${weight} kg`} mono />}
            {facts.age && <FactCell k="Age" v={facts.age} />}
            {facts.severity && <FactCell k="Severity" v={facts.severity} />}
            {facts.condition_hints[0] && (
              <FactCell k="Condition" v={facts.condition_hints[0]} />
            )}
          </dl>
        )}

        {/* CONFIRM-WEIGHT — the human owns the safety-critical input. Now a
            primary-filled button when pending (matches variant), and emerald
            confirmation strip when done. */}
        {facts && weight !== null && (
          <div data-testid="confirm-weight">
            {weightConfirmed ? (
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12.5px] font-medium",
                  "border-emerald-300 bg-emerald-50 text-emerald-900",
                  "dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
                )}
              >
                <CheckCircle2 className="size-4 text-emerald-600" />
                Weight confirmed: {weight} kg
              </span>
            ) : (
              <Button
                size="sm"
                className="gap-1.5 rounded-lg"
                data-testid="confirm-weight-button"
                onClick={onConfirmWeight}
              >
                <CheckCircle2 className="size-3.5" aria-hidden />
                Confirm {weight} kg
              </Button>
            )}
          </div>
        )}

        {/* The note still renders (the case-panel test asserts it), but de-
            emphasized: it's a secondary surface in the 3-column shell because
            the rail textarea is the live input. */}
        {hasNote && (
          <details className="rounded-lg border border-hairline bg-muted/30">
            <summary className="cursor-pointer select-none px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
              View raw note
            </summary>
            <div className="whitespace-pre-line border-t border-hairline px-3 py-2.5 text-[12.5px] text-foreground/80">
              {note}
            </div>
          </details>
        )}
      </div>
    </aside>
  );
}
