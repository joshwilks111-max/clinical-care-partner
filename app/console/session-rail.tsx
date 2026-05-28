// app/console/session-rail.tsx
//
// LEFT column of the Heidi-grammar 3-column console (D4). 220px wide at
// ≥1500px; collapses to 200/180 at smaller breakpoints (Phase 3 wires
// the grid).
//
// In v1 the session list is STUBBED — the 5 demo cases from
// app/console/fixtures.ts (which Phase 3 deletes) live here as static
// Today/Yesterday entries (D15). Clicking a session fires onLoadCase
// with that case's note; the parent (console.tsx, in Phase 3) routes
// the note into note-pane.tsx.
//
// What this rail is NOT in v1: a real persistence layer. There's no
// IndexedDB / no localStorage / no server-side session list. Five
// demo entries, hardcoded, deterministic for the reviewer to click.
//
// Visual contract — lifted from variant-A-heidi-grammar.html .rail:
//   - Brand block: claret 28x28 H logo + "Care Partner" wordmark
//   - "+ New session" claret primary CTA
//   - Nav row: Scribe (active) / Evidence / Tasks (Lucide icons, ghost buttons)
//   - "Today" group header (uppercase muted) + active session entries
//   - "Yesterday" group header + older entries
//   - Active session: cream-2 bg + 2px claret left-border

"use client";

import { BookOpen, FileText, ListTodo } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/lib/utils";

export interface DemoSession {
  /** Stable id so React keys + active-state comparison are deterministic. */
  id: string;
  /** Patient name + condition shorthand, e.g. "Jack T · croup". */
  name: string;
  /** Timestamp + optional flag, e.g. "2:14 PM · NZ". */
  timestamp: string;
  /** "Today" or "Yesterday" — the group header above this entry. */
  group: "Today" | "Yesterday";
  /** The clinical note to load into the centre column on click. */
  note: string;
}

/**
 * The 5 demo cases (D15). These are the same notes shipped today in
 * app/console/fixtures.ts; re-homed here as session-rail entries because
 * the chat-panel empty-state owns "suggested prompts" (the trinity of
 * "What dose? / What to watch for? / Differential?") and the rail owns
 * "what cases to try" (the bench of pre-loaded transcripts).
 *
 * IDs follow the kebab-case convention; Phase 3 fan-in can swap these
 * for a stored fixtures import without changing the rail's shape.
 */
const DEMO_SESSIONS: DemoSession[] = [
  {
    id: "jack-t-nz-croup",
    name: "Jack T · croup (NZ)",
    timestamp: "2:14 PM · NZ",
    group: "Today",
    note: `Jack T, 3yo, 14.2 kg.
Barky cough overnight, intermittent at first, now near-constant.
Stridor at rest on exam. Mild suprasternal recession.
No drooling, no tripod, no toxic appearance.
Temp 37.9, HR 130, RR 32, SpO2 98% RA.
URTI symptoms x 2 days. No prior dexamethasone.

?croup — moderate. Dose?`,
  },
  {
    id: "jack-t-au-croup",
    name: "Jack T · croup (AU)",
    timestamp: "2:18 PM · AU",
    group: "Today",
    note: `Jack T, 3yo, 14.2 kg.
Barky cough overnight, intermittent at first, now near-constant.
Stridor at rest on exam. Mild suprasternal recession.
No drooling, no tripod, no toxic appearance.
Temp 37.9, HR 130, RR 32, SpO2 98% RA.
URTI symptoms x 2 days. No prior dexamethasone.

?croup — moderate. Dose? (AU guideline)`,
  },
  {
    id: "mia-r-epiglottitis",
    name: "Mia R · ?epiglottitis",
    timestamp: "11:30 AM",
    group: "Today",
    note: `Mia R, 4yo, 16 kg.
Acute onset 6 hours. Drooling, tripod posture, toxic-appearing.
High fever 39.4. Muffled voice, no barky cough.
Stridor inspiratory. Refusing to lie flat.

?epiglottitis vs severe croup. Plan?`,
  },
  {
    id: "weightless-transcript",
    name: "Weightless transcript",
    timestamp: "Yesterday · 4:08 PM",
    group: "Yesterday",
    note: `Toddler ~3yo. Barky cough 2 days, stridor at rest tonight.
No drooling, no tripod. Looks moderately unwell but engaged.
Mum can't recall weight; not weighed today.

Croup? Dexamethasone dose?`,
  },
  {
    id: "asthma-5yo",
    name: "Asthma 5yo (out_of_scope)",
    timestamp: "Yesterday · 9:50 AM",
    group: "Yesterday",
    note: `Lucy K, 5yo, 18 kg. Known asthmatic.
Wheeze x 6 hours, work of breathing increased, SpO2 94%.
Salbutamol given x 2 puffers MDI at home, partial response.

Asthma exacerbation, moderate. Dose plan?`,
  },
];

export interface SessionRailProps {
  /** Id of the currently active session, for the cream-2 + claret-border styling. */
  activeSessionId?: string;
  /**
   * Fired when a session row is clicked. Receives the full DemoSession
   * record (id + note) so the parent can choose what to do — for v1 it
   * loads the note into note-pane.tsx and clears the chat thread.
   */
  onLoadCase: (session: DemoSession) => void;
  /** Fired on "+ New session" — clears centre + chat in v1. */
  onNewSession?: () => void;
}

export function SessionRail({
  activeSessionId,
  onLoadCase,
  onNewSession,
}: SessionRailProps) {
  // Group sessions in render order; we keep a fixed ordering (Today first,
  // then Yesterday) rather than sorting by timestamp — the 5 cases are
  // hand-authored fixtures and the order is part of the demo's narrative.
  const today = DEMO_SESSIONS.filter((s) => s.group === "Today");
  const yesterday = DEMO_SESSIONS.filter((s) => s.group === "Yesterday");

  return (
    <aside
      role="complementary"
      aria-label="Sessions"
      className="flex h-full flex-col gap-3.5 border-r border-[var(--cream-2)] bg-[var(--cream)] p-3 text-[13px]"
    >
      {/* Brand block — H logo + wordmark + bottom hairline */}
      <div className="flex items-center gap-2 border-b border-[var(--cream-2)] pb-2">
        <div
          aria-hidden="true"
          className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--claret)] text-[13px] font-bold text-[var(--claret-ink)]"
          style={{ fontFamily: "var(--serif)" }}
        >
          H
        </div>
        <div className="text-[14px] font-semibold">Care Partner</div>
      </div>

      {/* + New session — claret primary CTA */}
      <Button
        type="button"
        onClick={onNewSession}
        className="justify-start gap-1.5 bg-[var(--claret)] text-[var(--claret-ink)] hover:bg-[var(--claret)]/90"
      >
        <span aria-hidden="true">+</span>
        New session
      </Button>

      {/* Nav — Scribe (active) / Evidence / Tasks. Ghost buttons w/ Lucide icons. */}
      <nav className="flex flex-col gap-0.5" aria-label="Primary navigation">
        <Button
          variant="ghost"
          className="justify-start gap-2 bg-[var(--cream-2)] font-semibold"
        >
          <FileText className="h-4 w-4 text-[var(--claret)]" />
          Scribe
        </Button>
        <Button variant="ghost" className="justify-start gap-2 font-medium">
          <BookOpen className="h-4 w-4 opacity-70" />
          Evidence
        </Button>
        <Button variant="ghost" className="justify-start gap-2 font-medium">
          <ListTodo className="h-4 w-4 opacity-70" />
          Tasks
        </Button>
      </nav>

      {/* Today group */}
      {today.length > 0 && (
        <div className="flex flex-col gap-0.5">
          <div className="border-t border-[var(--cream-2)] px-1.5 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            Today
          </div>
          {today.map((s) => (
            <SessionRow
              key={s.id}
              session={s}
              active={s.id === activeSessionId}
              onClick={() => onLoadCase(s)}
            />
          ))}
        </div>
      )}

      {/* Yesterday group */}
      {yesterday.length > 0 && (
        <div className="flex flex-col gap-0.5">
          <div className="border-t border-[var(--cream-2)] px-1.5 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            Yesterday
          </div>
          {yesterday.map((s) => (
            <SessionRow
              key={s.id}
              session={s}
              active={s.id === activeSessionId}
              onClick={() => onLoadCase(s)}
            />
          ))}
        </div>
      )}
    </aside>
  );
}

function SessionRow({
  session,
  active,
  onClick,
}: {
  session: DemoSession;
  active: boolean;
  onClick: () => void;
}) {
  // We use a <button> rather than <div role="button"> so keyboard
  // navigation (Tab + Enter) works without extra wiring. The "active"
  // styling adds the 2px claret left-border and pulls left-padding in
  // by 2px so the text doesn't shift on selection.
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      className={cn(
        "rounded-md px-2 py-1.5 text-left text-[12.5px] transition-colors hover:bg-[var(--cream-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--claret)] focus-visible:ring-offset-1",
        active &&
          "border-l-2 border-[var(--claret)] bg-[var(--cream-2)] pl-1.5",
      )}
    >
      <div className="font-semibold text-foreground">{session.name}</div>
      <div className="text-[11px] text-muted-foreground">
        {session.timestamp}
      </div>
    </button>
  );
}

/**
 * Export the demo set so tests can assert against the same source of
 * truth the component renders. Phase 3 may delete this re-export if it
 * migrates fixtures to a shared module — the rail itself owns the data
 * in v1.
 */
export { DEMO_SESSIONS };
