// app/console/session-rail.tsx
//
// LEFT column of the Heidi-grammar 3-column console (D4). 220px wide.
//
// The rail is the bench of EVAL CASES (lib/eval-cases.ts): one clickable row
// per case, grouped (Doses / Refusals & asks / Follow-up). Clicking a row fires
// onLoadCase with that case's note (the case prompt); the parent (console.tsx)
// routes it into note-pane.tsx and resets the chat. This is a demo affordance,
// not a persistence layer — the cases are the same ones the external eval
// harness drives, so clicking a row demos exactly what that case exercises.
//
// Visual contract — lifted from variant-A-heidi-grammar.html .rail:
//   - Brand block: claret 28x28 H logo + "Care Partner" wordmark
//   - "+ New session" claret primary CTA
//   - Nav row: Scribe (active) / Evidence / Tasks (Lucide icons, ghost buttons)
//   - One uppercase-muted group header per distinct group, in first-seen order
//   - Active session: cream-2 bg + 2px claret left-border

"use client";

import { BookOpen, FileText, ListTodo } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/lib/utils";
import { EVAL_SESSIONS, type RailCase } from "@/lib/eval-cases";

/**
 * The rail row shape. `group` is a free string (the eval bench groups —
 * "Doses" / "Refusals & asks" / "Follow-up") so adding a group needs no type
 * change and the generic group renderer picks it up automatically.
 */
export type DemoSession = RailCase;

/** The rail's data: the eval cases, projected to row shape (lib/eval-cases.ts). */
const DEMO_SESSIONS: DemoSession[] = EVAL_SESSIONS;

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
  // Distinct group headers in first-seen order (the case ordering in
  // lib/eval-cases.ts IS the demo narrative — Doses, then Refusals, then
  // Follow-up). Rendered generically so adding a group needs no code change.
  const groups: string[] = [];
  for (const s of DEMO_SESSIONS) {
    if (!groups.includes(s.group)) groups.push(s.group);
  }

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

      {/* One group block per distinct group, in first-seen order. The list
          scrolls if it overflows the rail height (16 cases > viewport). */}
      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto">
        {groups.map((group) => (
          <div key={group} className="flex flex-col gap-0.5">
            <div className="border-t border-[var(--cream-2)] px-1.5 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
              {group}
            </div>
            {DEMO_SESSIONS.filter((s) => s.group === group).map((s) => (
              <SessionRow
                key={s.id}
                session={s}
                active={s.id === activeSessionId}
                onClick={() => onLoadCase(s)}
              />
            ))}
          </div>
        ))}
      </div>
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
 * Re-export the rendered data so tests assert against the same source of
 * truth the component renders. The data itself lives in lib/eval-cases.ts
 * (EVAL_SESSIONS); the rail just projects it.
 */
export { DEMO_SESSIONS };
