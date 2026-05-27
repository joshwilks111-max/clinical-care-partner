// app/console/evidence-panel.tsx
//
// The RIGHT COLUMN of the Bluey 3-column shell (392px). Renders Turn 2 —
// the EXECUTION half (dose + plan + completeness gate + provenance + verbatim
// citation). Mirrors Heidi's right-side "Consultation Prep" pop-up.
//
// The collapse-icon button from the variant mock is INTENTIONALLY OMITTED
// (eng-review lock #8 — half-done chrome is worse than no chrome; reinstate
// only when the behaviour is actually wired).
//
// Empty state: "Evidence will appear here when you select a guideline."

"use client";

import { BookOpen } from "lucide-react";

import { Turn2View } from "./turn2-view";
import { PhaseLoader, type Phase } from "./phase-loader";
import type { Turn2Response } from "@/app/api/turn2/route";

export type EvidencePanelProps = {
  /** Turn-2 result (or null before it runs). */
  turn2: Turn2Response | null;
  /** Turn-2 in flight — render the phase loader. */
  turn2Busy: Phase | null;
};

export function EvidencePanel({ turn2, turn2Busy }: EvidencePanelProps) {
  const empty = turn2 === null && turn2Busy === null;

  return (
    <aside
      data-testid="evidence-panel"
      className="overflow-y-auto border-l border-hairline bg-card p-5"
    >
      {/* HEADER — title + Turn 2 mono badge. Eng-review lock #8: NO collapse
          icon. The header is exactly these two elements, nothing else. */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-[14px] font-semibold tracking-tight">
          <BookOpen className="size-4 text-primary" aria-hidden />
          Evidence
        </h2>
        <span className="rounded bg-primary-soft px-1.5 py-0.5 font-mono text-[10.5px] text-primary-d">
          Turn 2
        </span>
      </div>

      {empty && (
        <div
          data-testid="evidence-empty"
          className="rounded-xl border border-hairline bg-white p-6 text-center"
        >
          <p className="text-[12.5px] text-muted-foreground">
            Evidence will appear here when you select a guideline.
          </p>
        </div>
      )}

      {turn2Busy && <PhaseLoader phase={turn2Busy} />}

      {turn2 && <Turn2View result={turn2} />}
    </aside>
  );
}
