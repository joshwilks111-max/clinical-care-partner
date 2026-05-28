// app/console/note-pane.tsx
//
// CENTRE column of the 3-column shell (D4). minmax(0,1fr) — takes the space
// left after the 220px rail and the ≥1/3-viewport chat column (chat widened
// from a fixed 520px so the Care Partner is always ≥1/3 of the screen; see
// console.tsx grid + DESIGN.md §11).
// Replaces today's stepped Turn 1 / Turn 2 view with a single
// utilitarian note pane — "big enough to paste into, no more" (locked
// in approved.json: "Centre is utilitarian — note paste area, not a
// feature").
//
// Composition (from variant-A-heidi-grammar.html .centre):
//   1. Case header: claret avatar circle (32x32, patient initials in
//      serif) + serif patient name + muted "Paediatric · presenting <date>"
//      sub-line.
//   2. Meta strip: Lucide <Calendar /> date · <Clock /> session-elapsed ·
//      "Region: NZ" muted, with a bottom hairline. Icons are lucide-react —
//      NEVER emoji (D14 anti-slop, T7).
//   3. Action bar: "+ Create plan" (claret primary) + "Resume" (ghost).
//      Both are no-ops in v1 — they exist as visual affordances. Wiring
//      them to anything functional is deferred (TODO).
//   4. Tabs: Note (active) / Transcript / Templates. Only Note is wired;
//      the other two render placeholder copy when clicked.
//   5. The note itself: read-only paste area when a session is loaded,
//      editable <Textarea> when blank. Utilitarian, not a hero.
//   6. Collapsed <Accordion> "Extracted facts" — today's CasePanel
//      facts table demoted to secondary information. Phase 3 deletes
//      the standalone CasePanel; this is its new home.

"use client";

import { useMemo, useState } from "react";
import { Calendar, Clock, FilePlus } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/components/lib/utils";

export interface ExtractedFacts {
  /** Patient name, e.g. "Jack T". May be empty when the model hasn't extracted yet. */
  name?: string;
  /** Age in years. */
  age_years?: number;
  /** Weight in kg. The audit-critical field — everything dose-related keys off this. */
  weight_kg?: number;
  /** Condition shorthand, e.g. "croup". */
  condition?: string;
  /** Severity label, e.g. "moderate". */
  severity?: string;
}

export interface NotePaneProps {
  /** The pasted/typed clinical note. */
  note: string;
  /** Setter (controlled component). */
  onNoteChange: (next: string) => void;
  /**
   * Patient name to drive the case-header avatar + heading. When absent,
   * the case-header still renders with placeholder copy ("New case").
   */
  patientName?: string;
  /** Age + presenting line ("3yo · presenting 2026-05-28"). */
  patientSubLine?: string;
  /** Optional extracted-facts payload for the collapsed accordion. */
  facts?: ExtractedFacts;
  /** Region label for the meta strip. Defaults "NZ". */
  region?: "NZ" | "AU";
  /** Optional date label, e.g. "28/05/2026 · 14:14". */
  dateLabel?: string;
  /** Optional elapsed timer label, e.g. "04:21". */
  elapsedLabel?: string;
}

type Tab = "note" | "transcript" | "templates";

/**
 * Two-letter initials for the case-header avatar. "Jack T" → "JT",
 * "Mia R" → "MR". Falls back to "—" when name is missing.
 */
function initialsOf(name: string | undefined): string {
  if (!name) return "—";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "—";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function NotePane({
  note,
  onNoteChange,
  patientName,
  patientSubLine,
  facts,
  region = "NZ",
  dateLabel,
  elapsedLabel,
}: NotePaneProps) {
  const [tab, setTab] = useState<Tab>("note");
  const initials = useMemo(() => initialsOf(patientName), [patientName]);

  return (
    <main
      role="main"
      aria-label="Patient note"
      className="flex h-full flex-col gap-2 overflow-auto bg-[var(--cream)] px-6 py-4"
    >
      {/* Case header — T6: empty state uses Lucide FilePlus in cream-2 circle
          (a clearer "start a case" affordance than a generic dash); when a
          case is loaded, the avatar becomes patient initials in claret. */}
      <div className="flex items-center gap-2.5">
        {patientName ? (
          <div
            aria-hidden="true"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--claret)] text-[13px] font-bold text-[var(--claret-ink)]"
            style={{ fontFamily: "var(--serif)" }}
          >
            {initials}
          </div>
        ) : (
          <div
            aria-hidden="true"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--cream-2)] text-[var(--ink)]"
          >
            <FilePlus className="h-4 w-4" />
          </div>
        )}
        <div className="min-w-0">
          <div
            className="text-[15.5px] font-semibold leading-tight"
            style={{ fontFamily: "var(--serif)" }}
          >
            {patientName ?? "New case"}
          </div>
          <div className="text-[12px] text-muted-foreground">
            {patientSubLine ?? "Paste a clinical note below to start"}
          </div>
        </div>
      </div>

      {/* Meta strip — T7: Lucide <Calendar /> + <Clock /> icons, NOT emoji
          (D14 anti-slop: emoji-as-icons is the #1 AI-slop tell). T5: the
          region label is plain muted text — the canonical region toggle
          lives in the right-rail footer (see RegionToggle), so this is
          read-only context, not an affordance. */}
      <div className="flex items-center gap-3.5 border-b border-[var(--cream-2)] py-1.5 text-[12px] text-muted-foreground">
        {dateLabel && (
          <span className="inline-flex items-center gap-1">
            <Calendar aria-hidden="true" className="h-3.5 w-3.5" />
            {dateLabel}
          </span>
        )}
        {elapsedLabel && (
          <span className="inline-flex items-center gap-1">
            <Clock aria-hidden="true" className="h-3.5 w-3.5" />
            {elapsedLabel}
          </span>
        )}
        <span>
          <span className="font-semibold text-foreground">Region:</span>{" "}
          {region}
        </span>
      </div>

      {/* Action bar — visual affordances; wiring deferred */}
      <div className="flex gap-2">
        <Button
          type="button"
          className="bg-[var(--claret)] text-[var(--claret-ink)] hover:bg-[var(--claret)]/90"
        >
          + Create plan
        </Button>
        <Button
          type="button"
          variant="outline"
          className="border-[var(--cream-2)] bg-[var(--cream-2)] hover:bg-[var(--cream-2)]/80"
        >
          Resume
        </Button>
      </div>

      {/* Tabs */}
      <div
        role="tablist"
        aria-label="Note views"
        className="flex gap-4 border-b border-[var(--cream-2)] text-[13px] text-muted-foreground"
      >
        <TabButton current={tab} value="note" onClick={setTab}>
          Note
        </TabButton>
        <TabButton current={tab} value="transcript" onClick={setTab}>
          Transcript
        </TabButton>
        <TabButton current={tab} value="templates" onClick={setTab}>
          Templates
        </TabButton>
      </div>

      {/* Tab body */}
      {tab === "note" && (
        <Textarea
          value={note}
          onChange={(e) => onNoteChange(e.target.value)}
          placeholder="Paste a clinical note here…"
          aria-label="Clinical note"
          className="min-h-[260px] flex-1 resize-y whitespace-pre-line rounded-lg border-[var(--cream-2)] bg-white p-4 text-[13.5px] leading-relaxed text-[#3a312b]"
        />
      )}
      {tab === "transcript" && (
        <div className="rounded-lg border border-[var(--cream-2)] bg-white p-4 text-[13px] text-muted-foreground">
          Transcript view is not wired in this build. Use the Note tab.
        </div>
      )}
      {tab === "templates" && (
        <div className="rounded-lg border border-[var(--cream-2)] bg-white p-4 text-[13px] text-muted-foreground">
          Templates are not wired in this build. Use the Note tab.
        </div>
      )}

      {/* Collapsed extracted-facts accordion */}
      {facts && (
        <Accordion type="single" collapsible className="mt-1">
          <AccordionItem value="facts" className="border-[var(--cream-2)]">
            <AccordionTrigger className="text-[12px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
              Extracted facts
            </AccordionTrigger>
            <AccordionContent>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12.5px]">
                <FactRow label="Condition" value={facts.condition} />
                <FactRow label="Severity" value={facts.severity} />
                <FactRow
                  label="Age"
                  value={
                    typeof facts.age_years === "number"
                      ? `${facts.age_years}y`
                      : undefined
                  }
                />
                <FactRow
                  label="Weight"
                  value={
                    typeof facts.weight_kg === "number"
                      ? `${facts.weight_kg} kg`
                      : undefined
                  }
                />
              </dl>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      )}
    </main>
  );
}

function TabButton({
  current,
  value,
  onClick,
  children,
}: {
  current: Tab;
  value: Tab;
  onClick: (next: Tab) => void;
  children: React.ReactNode;
}) {
  const active = current === value;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={() => onClick(value)}
      className={cn(
        "-mb-px cursor-pointer py-1.5 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--claret)] focus-visible:ring-offset-2",
        active
          ? "border-b-2 border-foreground font-semibold text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function FactRow({ label, value }: { label: string; value?: string }) {
  return (
    <>
      <dt className="font-semibold text-muted-foreground">{label}</dt>
      <dd className="text-foreground">{value ?? "—"}</dd>
    </>
  );
}
