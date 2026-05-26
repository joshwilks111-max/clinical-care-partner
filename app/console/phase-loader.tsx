// app/console/phase-loader.tsx
//
// STREAMING PHASE LABELS (DESIGN.md D6) — never a spinner-only state. Each
// request lifecycle shows WHICH phase is running, in clinician-readable words:
//   Turn 1 → "Building differential…"
//   Turn 2 → "Retrieving guideline…" / "Calculating dose…" / "Checking completeness…"
// The routes are not token-streamed, so the label is driven off the request
// lifecycle (the console sets `phase` while awaiting). We use the Shimmer leaf
// (AI Elements) for the moving label rather than a bare spinner.

"use client";

import { Shimmer } from "@/components/ai-elements/shimmer";

/** The phases the console can be in while a request is in flight. */
export type Phase =
  | "building-differential"
  | "checking-safety"
  | "retrieving-guideline"
  | "calculating-dose"
  | "checking-completeness";

const PHASE_LABEL: Record<Phase, string> = {
  "building-differential": "Building differential…",
  // Turn 1.5 (the collapse decider): the only phase that may call the model is
  // "ask", where it PHRASES one discriminating question. The label is honest —
  // we are checking the must-not-miss before any guideline can be applied.
  "checking-safety": "Checking for must-not-miss conditions…",
  "retrieving-guideline": "Retrieving guideline…",
  "calculating-dose": "Calculating dose…",
  "checking-completeness": "Checking completeness…",
};

export type PhaseLoaderProps = { phase: Phase };

/**
 * A single moving phase label. `data-phase` carries the key so tests can assert
 * the right phase shows without depending on the exact copy.
 */
export function PhaseLoader({ phase }: PhaseLoaderProps) {
  return (
    <div
      data-phase={phase}
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 py-2 text-sm"
    >
      <Shimmer className="text-sm font-medium" duration={1.6}>
        {PHASE_LABEL[phase]}
      </Shimmer>
    </div>
  );
}
