// app/console/rail.tsx
//
// The LEFT RAIL of the Bluey 3-column shell (272px). The rail IS the entry
// point — it owns the brand block, the note-paste textarea, the 6 demo cases
// (session-list grammar — avatar tile + label + caption), and the version
// footer. Console (the state owner) passes everything down as plain props
// (eng-review lock #3: no context, no custom hooks).
//
// The note-paste textarea lives INSIDE the rail by design (DESIGN.md § "UI
// refresh — Bluey · Layout") — that's a deliberate departure from Heidi
// (which puts the note in the canvas) so the rail mirrors Heidi's session-
// list pattern at the entry point.

"use client";

import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/components/lib/utils";

import { BlueyHeeler } from "@/components/icons/bluey-heeler";
import { DEMO_NOTES } from "./fixtures";

export type RailProps = {
  /** Draft text in the paste textarea. */
  draft: string;
  onDraftChange: (next: string) => void;
  /** Run turn-1 on the trimmed draft. */
  onRun: (rawNote: string) => void;
  /** Run turn-1 on a demo case (pre-filled note). */
  onRunDemo: (id: string, note: string) => void;
  /** Locks all inputs while any turn is in flight (turn-1, turn-1.5, turn-2). */
  busy: boolean;
  /** Highlights the demo row whose id matches (eng-review lock #9, activeDemoId). */
  activeDemoId: string | null;
};

// Two-letter avatar initials per demo (layout-refinement #1 — mirrors Heidi's
// session-list avatar tile). Map demo id → initials.
const DEMO_INITIALS: Record<string, string> = {
  croup: "Cr",
  refusal: "Rf",
  capfire: "Cp",
  anaphylaxis: "Ax",
  completeness: "Cm",
  injection: "In",
  "transcript-croup": "Tc",
  "transcript-noweight": "Tn",
};

function avatarInitials(id: string): string {
  return DEMO_INITIALS[id] ?? id.slice(0, 2).toUpperCase();
}

export function Rail({
  draft,
  onDraftChange,
  onRun,
  onRunDemo,
  busy,
  activeDemoId,
}: RailProps) {
  const canRun = !busy && draft.trim().length > 0;

  return (
    <aside
      data-testid="rail"
      className="flex flex-col border-r border-hairline bg-rail-bg"
    >
      {/* BRAND BLOCK — heeler tile + Bluey wordmark + caption. */}
      <div className="flex items-center gap-2.5 border-b border-hairline px-5 py-4">
        <div className="flex size-9 items-center justify-center rounded-xl bg-primary-soft text-primary">
          <BlueyHeeler className="size-6" />
        </div>
        <div className="leading-tight">
          <div className="font-semibold text-[16px] tracking-tight">Bluey</div>
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Clinical care partner
          </div>
        </div>
      </div>

      {/* NOTE PASTE — lives inside the rail (the entry point) by design. */}
      <div
        data-testid="paste-own"
        className="border-b border-hairline px-4 py-4"
      >
        <label
          htmlFor="paste-note"
          className="mb-1.5 block text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground"
        >
          Patient note or transcript
        </label>
        <Textarea
          id="paste-note"
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              if (draft.trim() && !busy) onRun(draft);
            }
          }}
          disabled={busy}
          rows={6}
          aria-describedby="paste-help"
          placeholder="Paste a free-text clinical note or doctor–patient transcript. Cmd/Ctrl+Enter to run."
          className="resize-none rounded-lg border-hairline bg-white px-3 py-2.5 text-[13px] leading-snug placeholder:text-slate-400 focus-visible:ring-primary"
        />
        <Button
          data-testid="paste-run"
          disabled={!canRun}
          onClick={() => onRun(draft)}
          className="mt-2.5 w-full justify-center gap-1.5 rounded-lg text-[13px]"
        >
          Build differential <ArrowRight className="size-3.5" />
        </Button>
        <p
          id="paste-help"
          className="mt-1.5 text-[10.5px] text-muted-foreground"
        >
          Same engine as the demos · ⌘/Ctrl+Enter to run
        </p>
      </div>

      {/* DEMO CASES — session-list grammar (avatar tile + label + caption). */}
      <div data-testid="demo-buttons" className="flex-1 overflow-y-auto py-3">
        <div className="mb-2 flex items-center justify-between px-4 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
          <span>Demo cases</span>
          <span className="text-[10px]">{DEMO_NOTES.length}</span>
        </div>
        <div role="list">
          {DEMO_NOTES.map((demo) => {
            const isActive = demo.id === activeDemoId;
            return (
              <button
                key={demo.id}
                type="button"
                role="listitem"
                data-demo-id={demo.id}
                aria-current={isActive ? "true" : "false"}
                disabled={busy}
                onClick={() => onRunDemo(demo.id, demo.note)}
                className={cn(
                  "flex w-full items-start gap-2.5 px-4 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                  isActive ? "bg-primary-soft" : "hover:bg-secondary",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-md text-[10.5px] font-semibold uppercase",
                    isActive
                      ? "bg-primary text-white"
                      : "bg-primary-soft text-primary-d",
                  )}
                  aria-hidden
                >
                  {avatarInitials(demo.id)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold text-foreground">
                    {demo.label}
                  </span>
                  <span className="block text-[11px] text-muted-foreground">
                    {demo.caption}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* FOOTER — version + model. Mirrors the variant. */}
      <div className="flex items-center justify-between border-t border-hairline px-5 py-3 text-[10.5px] text-muted-foreground">
        <span>v1.2.0</span>
        <span className="font-mono">claude-opus-4-7</span>
      </div>
    </aside>
  );
}
