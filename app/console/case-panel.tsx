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

function FactRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between border-b py-1.5 text-[13px] last:border-b-0">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-semibold">{v}</span>
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

  return (
    <aside data-testid="case-panel" className="rounded-xl border bg-card">
      <div className="border-b bg-muted/40 px-3.5 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Extracted facts
      </div>
      <div className="space-y-3 p-3.5">
        {/* The note (display). whitespace-pre-line keeps transcript line breaks
            (the dialogue fixtures join with \n) instead of collapsing them. */}
        <div className="whitespace-pre-line rounded-lg border bg-muted/30 px-3 py-2.5 text-[13px] text-foreground/80">
          {note.trim().length > 0 ? note : "No note loaded yet."}
        </div>

        {/* Extracted facts. */}
        {facts && (
          <div data-testid="extracted-facts">
            {facts.condition_hints[0] && (
              <FactRow k="Condition" v={facts.condition_hints[0]} />
            )}
            {facts.severity && <FactRow k="Severity" v={facts.severity} />}
            {facts.age && <FactRow k="Age" v={facts.age} />}
            {weight !== null && <FactRow k="Weight" v={`${weight} kg`} />}
          </div>
        )}

        {/* CONFIRM-WEIGHT — the human owns the safety-critical input. Amber-tinted
            so it reads as a deliberate safety step, not decoration. */}
        {facts && weight !== null && (
          <div
            data-testid="confirm-weight"
            className={cn(
              "rounded-lg border px-3 py-2.5 text-[12.5px]",
              weightConfirmed
                ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"
                : "border-safety-border bg-safety text-safety-foreground",
            )}
          >
            {weightConfirmed ? (
              <span className="flex items-center gap-1.5 font-medium">
                <CheckCircle2 className="size-4 text-emerald-600" />
                Weight confirmed: {weight} kg
              </span>
            ) : (
              <>
                <p>
                  <span className="font-semibold">Confirm weight</span> before
                  dosing — the human owns the safety-critical input.
                </p>
                <Button
                  size="sm"
                  className="mt-2"
                  data-testid="confirm-weight-button"
                  onClick={onConfirmWeight}
                >
                  ✓ Confirm {weight} kg
                </Button>
              </>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
