// app/console/turn1-view.tsx
//
// TURN 1 (the JUDGMENT half) rendered as a card. Implements the DESIGN.md UI
// contract for the differential + the "your turn" affordance:
//
//   D1  state grammar: status → primary result → why/working → next action.
//       The differential ranked list is first-thing-visible, MUST-NOT-MISS FIRST.
//   D3  "your turn": when turn 1 completes, the candidate-guideline buttons are
//       the visually dominant element under "Select the guideline to apply →".
//   D5  negative evidence under "Findings absent / not documented:" as muted
//       pills, secondary to positive evidence.
//   D6  provenance: the differential is badged `LLM differential`; the buttons
//       are the `clinician-selected` seam.
//
// Pure presentational + a callback: it renders a Turn1Success fixture and calls
// onSelectGuideline when the clinician picks. (Refusal/error states are rendered
// by the console shell as amber/red Alerts, not here.)

"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/components/lib/utils";

import { ProvenanceBadge } from "./provenance-badge";
import type { Turn1Success } from "./fixtures";
import type { DifferentialCondition } from "@/lib/schemas";
import { getGuideline } from "@/registry/guidelines";

/** must-not-miss FIRST, then likely, then possible (DESIGN.md D1). */
const LIKELIHOOD_ORDER: Record<DifferentialCondition["likelihood"], number> = {
  "must-not-miss": 0,
  likely: 1,
  possible: 2,
};

function rankConditions(
  conditions: DifferentialCondition[],
): DifferentialCondition[] {
  // Stable sort by likelihood band — must-not-miss surfaces to the top even when
  // the model returned it lower (the fixture deliberately lists it second).
  return [...conditions].sort(
    (a, b) => LIKELIHOOD_ORDER[a.likelihood] - LIKELIHOOD_ORDER[b.likelihood],
  );
}

function LikelihoodTag({
  likelihood,
}: {
  likelihood: DifferentialCondition["likelihood"];
}) {
  const isMnm = likelihood === "must-not-miss";
  return (
    <span
      data-likelihood={likelihood}
      className={cn(
        "rounded-full px-2 py-0.5 text-[10px] font-semibold",
        isMnm
          ? "bg-safety text-safety-foreground"
          : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200",
      )}
    >
      {likelihood}
    </span>
  );
}

function ConditionRow({ condition }: { condition: DifferentialCondition }) {
  return (
    <div
      data-condition={condition.name}
      className="grid grid-cols-1 gap-2 border-b py-3 last:border-b-0 sm:grid-cols-2"
    >
      <div className="col-span-full flex items-center gap-2 font-semibold">
        {condition.name}
        <LikelihoodTag likelihood={condition.likelihood} />
      </div>

      {/* Positive evidence — the primary supporting column. */}
      <div>
        <div className="text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">
          Supports
        </div>
        <div className="mt-1 text-[13px] text-emerald-700 dark:text-emerald-300">
          {condition.positive_evidence.length > 0
            ? condition.positive_evidence.join(" · ")
            : "—"}
        </div>
      </div>

      {/* D5 — NEGATIVE EVIDENCE: muted pills, secondary to positive. The moat. */}
      <div>
        <div className="text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">
          Findings absent / not documented
        </div>
        <div className="mt-1 flex flex-wrap gap-1">
          {condition.negative_evidence.length > 0 ? (
            condition.negative_evidence.map((finding) => (
              <span
                key={finding}
                data-negative-evidence
                className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
              >
                {finding}
              </span>
            ))
          ) : (
            <span className="text-[12px] text-muted-foreground">—</span>
          )}
        </div>
      </div>
    </div>
  );
}

export type Turn1ViewProps = {
  turn1: Turn1Success;
  /** Called when the clinician picks a guideline (the "your turn" affordance). */
  onSelectGuideline: (guidelineId: string, condition: string) => void;
  /** True once the weight has been confirmed (gates the guideline buttons). */
  weightConfirmed: boolean;
  /** Disable buttons while turn 2 is in flight. */
  busy?: boolean;
};

export function Turn1View({
  turn1,
  onSelectGuideline,
  weightConfirmed,
  busy = false,
}: Turn1ViewProps) {
  const ranked = rankConditions(turn1.differential.conditions);
  const candidates = turn1.candidateGuidelines;

  // FIX 1 (P0) — each guideline button must carry ITS OWN guideline's condition,
  // NOT a single shared condition_hints[0]. On a note with two candidate
  // conditions, a shared condition could make "Apply Croup" send the anaphylaxis
  // condition (or vice-versa). We look the clicked guideline up in the registry
  // and pass its REGISTERED condition, so the click's condition always MATCHES
  // the guideline — keeping the turn-2 audit consistent (and catching a true
  // mismatch instead of producing a tautology). Falls back to condition_hints[0]
  // only if a candidate id isn't in the registry (defensive).
  const conditionForGuideline = (guidelineId: string): string =>
    getGuideline(guidelineId)?.condition ??
    turn1.extractedFacts.condition_hints[0] ??
    ranked[0]?.name.toLowerCase() ??
    "";

  return (
    <section data-testid="turn1-view" className="space-y-3">
      {/* Step header with the JUDGMENT provenance badge. */}
      <div className="flex items-center gap-2">
        <span className="flex size-6 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground">
          1
        </span>
        <span className="text-sm font-semibold">Differential</span>
        <ProvenanceBadge kind="llm-differential" />
      </div>

      {/* D1 — the ranked list is first-thing-visible, must-not-miss first. */}
      <Card>
        <CardHeader className="pb-0">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Weighted differential
          </div>
        </CardHeader>
        <CardContent>
          {ranked.map((condition) => (
            <ConditionRow key={condition.name} condition={condition} />
          ))}
        </CardContent>
      </Card>

      {/* D3 — "your turn": the dominant guideline buttons. Buttons appearing IS
          the affordance (replaces any spinner). Gated on weight confirmation so
          the human owns the safety-critical input before dosing. */}
      <div
        data-testid="your-turn"
        className="rounded-lg border border-dashed border-primary/60 bg-primary/5 p-3"
      >
        <div className="mb-2 flex items-center gap-2">
          <p className="text-sm font-semibold text-primary">
            → Your turn: select the guideline to apply
          </p>
          <ProvenanceBadge kind="clinician-selected" />
        </div>

        {!weightConfirmed && (
          <p
            data-testid="confirm-weight-first"
            className="mb-2 text-[12px] text-muted-foreground"
          >
            Confirm the weight (left panel) before applying a guideline.
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {candidates.map((g) => (
            <Button
              key={g.guideline_id}
              data-guideline-id={g.guideline_id}
              disabled={!weightConfirmed || busy}
              onClick={() =>
                onSelectGuideline(
                  g.guideline_id,
                  conditionForGuideline(g.guideline_id),
                )
              }
            >
              Apply {g.label}
            </Button>
          ))}
        </div>
      </div>
    </section>
  );
}
