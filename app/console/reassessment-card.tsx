// app/console/reassessment-card.tsx
//
// Phase 5 reassessment surface — EMBEDDED INSIDE the assistant message
// bubble (same anti-slop rule as DoseCard, D14). Renders the structured
// "what to watch / when to come back / what to do at each branch" plan
// the skill computed via the get_reassessment_plan tool.
//
// Visual contract — lifted from variant-A-heidi-grammar.html .reass-card:
//
//   ┌────────────────────────────────────────────────────┐
//   │ [⏱]  Reassess at 16:14 (in 2h)                     │  header: clock badge
//   │      Watch-for signs · two branches                 │           + serif title
//   │                                                     │           + muted sub
//   │  [stridor at rest] [WOB] [agitation → lethargy]    │  amber chip row
//   │                                                     │
//   │  ┌─────────────────┐  ┌─────────────────┐          │
//   │  │ IF WORSE        │  │ IF IMPROVING    │          │  branch grid (2-col)
//   │  │ Escalate · adr  │  │ Continue obs    │          │  "If worse" is amber
//   │  └─────────────────┘  └─────────────────┘          │
//   │  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─    │  dashed top border
//   │  Universal: <rails copy here>                       │  muted footer
//   └────────────────────────────────────────────────────┘
//
// Two special states:
//   - `no_reassessment_required` (legitimate clinical state for one-shot
//     drugs, see tools/types.ts GetReassessmentPlanRefusalKind): the
//     CARD does NOT render. The bubble instead shows ONE muted line:
//     "No structured reassessment for this drug." Pass `reassess_in_minutes`
//     as null to trigger this branch.
//   - `rule_not_verified` (freshness check failed): the CARD does NOT
//     render; instead an amber chip below the dose-card carries the
//     refusal kind verbatim + next-action. That branch is handled by
//     the parent (chat-panel.tsx); this component just declines to render.

"use client";

import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export interface ReassessmentBranch {
  /** Severity label tied to this branch, e.g. "worse", "improving". */
  if_severity_at_reassessment: string;
  /** Action label, e.g. "Escalate · adrenaline neb". */
  then: string;
  /**
   * When the branch represents an escalation/red-flag path, set escalate:true
   * — the button renders with an amber-bordered variant to read as urgent
   * without using --destructive (which is reserved for technical failure
   * per D14).
   */
  escalate?: boolean;
}

export interface ReassessmentCardProps {
  /**
   * The qualitative summary the skill authored (from
   * ReassessmentCardEmittedSchema.watch_for_summary). Surfaced as muted
   * text under the title, NOT as the title itself — the title is the
   * "Reassess at HH:MM (in Nh)" temporal anchor.
   */
  watch_for_summary: string;
  /** Likewise, the skill's next-steps summary string. Used for the section header above the card by the parent. */
  next_steps_summary: string;
  /**
   * Minutes until reassessment, deterministic from the tool. When null,
   * we render the no_reassessment_required muted line instead of the
   * full card.
   */
  reassess_in_minutes: number | null;
  /** Watch-for signs to render as amber chips. From the tool result. */
  watch_for: string[];
  /** Branch grid — typically two entries (worse / improving). From the tool. */
  next_branches: ReassessmentBranch[];
  /** Universal rails (e.g. "any red-flag → senior airway support"). */
  universal_rails: string[];
  /** Citation. */
  source_version: string;
  source_url?: string;
}

function formatReassessTime(now: Date, minutes: number): string {
  const t = new Date(now.getTime() + minutes * 60_000);
  const hh = String(t.getHours()).padStart(2, "0");
  const mm = String(t.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function ReassessmentCard({
  watch_for_summary,
  reassess_in_minutes,
  watch_for,
  next_branches,
  universal_rails,
  source_version,
  source_url,
}: ReassessmentCardProps) {
  // Variant: no_reassessment_required → single muted line, NOT a card.
  // Caller passes reassess_in_minutes:null when the tool refused with
  // no_reassessment_required (a legitimate clinical state for one-shot drugs).
  if (reassess_in_minutes === null) {
    return (
      <p
        aria-label="No structured reassessment for this drug"
        className="mt-2 text-[12px] italic text-muted-foreground"
      >
        No structured reassessment for this drug.
      </p>
    );
  }

  // HYDRATION-SAFE clock: server-rendered HTML cannot include `new Date()`
  // because the server's wall-clock differs from the client's, which causes
  // React error #418 (hydration mismatch). We render an em-dash placeholder
  // on the server + first client render, then compute the real time in
  // useEffect — runs only on the client, after hydration is complete.
  const [reassessAt, setReassessAt] = useState<string>("—:—");
  useEffect(() => {
    setReassessAt(formatReassessTime(new Date(), reassess_in_minutes));
  }, [reassess_in_minutes]);
  const duration = formatDuration(reassess_in_minutes);

  return (
    <section
      aria-label={`Reassess in ${duration}, ${watch_for.length} watch-for signs, ${next_branches.length} branch options`}
      className="mt-2 rounded-[9px] border border-[var(--cream-2)] bg-[#fbf8f1] p-3"
    >
      {/* Header — clock badge + serif title + muted sub */}
      <header className="mb-1.5 flex items-center gap-2">
        <div
          aria-hidden="true"
          className="flex h-[26px] w-[26px] flex-none items-center justify-center rounded-full bg-[var(--cream-2)] text-foreground"
        >
          <Clock className="h-3.5 w-3.5" strokeWidth={2} />
        </div>
        <div className="min-w-0">
          <div
            className="text-[14.5px] font-bold leading-tight"
            style={{ fontFamily: "var(--serif)" }}
          >
            Reassess at {reassessAt} (in {duration})
          </div>
          <div className="text-[11.5px] text-muted-foreground">
            {watch_for_summary}
          </div>
        </div>
      </header>

      {/* Watch chips — amber, one per watch_for[] entry */}
      {watch_for.length > 0 && (
        <div className="mb-2 mt-1.5 flex flex-wrap gap-1">
          {watch_for.map((w) => (
            <Badge
              key={w}
              variant="outline"
              className="border-safety-border bg-safety px-2 py-0 text-[11.5px] font-medium text-safety-foreground"
            >
              {w}
            </Badge>
          ))}
        </div>
      )}

      {/* Branch grid — 2 columns; "If worse" branches render amber-bordered */}
      {next_branches.length > 0 && (
        <div className="grid grid-cols-2 gap-1.5">
          {next_branches.map((b) => (
            <Button
              key={b.if_severity_at_reassessment}
              variant="outline"
              className={
                b.escalate
                  ? "h-auto flex-col items-start justify-start gap-0.5 rounded-md border-safety-border bg-safety px-2.5 py-2 text-left hover:bg-safety/80"
                  : "h-auto flex-col items-start justify-start gap-0.5 rounded-md border-[var(--cream-2)] bg-white px-2.5 py-2 text-left hover:bg-[var(--cream)]"
              }
            >
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
                If {b.if_severity_at_reassessment}
              </span>
              <span
                className={
                  b.escalate
                    ? "text-[12px] font-semibold text-safety-foreground"
                    : "text-[12px] font-semibold text-foreground"
                }
              >
                {b.then}
              </span>
            </Button>
          ))}
        </div>
      )}

      {/* Universal rails — dashed top border, muted text */}
      {universal_rails.length > 0 && (
        <div className="mt-2 border-t border-dashed border-[var(--cream-2)] pt-1.5 text-[11px] text-muted-foreground">
          <span className="font-semibold text-foreground">Universal:</span>{" "}
          {universal_rails.join(" · ")}
        </div>
      )}

      {/* Source row */}
      <div className="mt-1.5 text-[11px] text-muted-foreground">
        Source:{" "}
        {source_url ? (
          <a
            href={source_url}
            target="_blank"
            rel="noreferrer"
            aria-label={`Source: ${source_version}`}
            className="font-semibold text-[#1d7a8c] hover:underline"
          >
            {source_version}
          </a>
        ) : (
          <span className="font-semibold text-foreground">
            {source_version}
          </span>
        )}
      </div>
    </section>
  );
}
