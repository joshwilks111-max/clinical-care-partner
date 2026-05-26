// app/console/provenance-badge.tsx
//
// THE PROVENANCE SEAM (DESIGN.md D6/X6) — the design's whole point made visible.
// Every output section is badged with WHO produced it: the LLM (judgment), the
// clinician (the one safety-critical confirmation), or deterministic code
// (registry lookup / dose tool / guideline citation / completeness gate). The
// judgment→execution boundary is SHOWN, not asserted.
//
// Two visual families encode the boundary at a glance:
//   - LLM judgment  → "judgment" tint (above the line).
//   - everything deterministic / clinician-owned → "execution" tint (below).
// The amber safety accent is a SEPARATE concern (Alert variant="safety"); these
// badges label provenance, not safety events.

import { Badge } from "@/components/ui/badge";
import { cn } from "@/components/lib/utils";

/** The fixed provenance vocabulary (DESIGN.md D6 — these exact labels). */
export type ProvenanceKind =
  | "llm-differential" // LLM differential (judgment)
  | "clinician-selected" // clinician's confirmation / selection
  | "registry-lookup" // deterministic registry lookup (routing)
  | "dose-tool" // deterministic dose tool (the math)
  | "guideline-citation" // verbatim guideline citation
  | "completeness-gate"; // deterministic completeness gate

const LABELS: Record<ProvenanceKind, string> = {
  "llm-differential": "LLM differential",
  "clinician-selected": "clinician-selected",
  "registry-lookup": "deterministic registry lookup",
  "dose-tool": "deterministic dose tool",
  "guideline-citation": "guideline citation",
  "completeness-gate": "completeness gate",
};

// "judgment" vs "execution" tint — the visible seam. LLM = judgment (violet);
// all deterministic/clinician kinds = execution (slate/teal). Kept as plain
// utility classes so the tint reads in light + dark without new tokens.
const JUDGMENT =
  "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200";
const EXECUTION =
  "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200";

const TINT: Record<ProvenanceKind, string> = {
  "llm-differential": JUDGMENT,
  "clinician-selected": EXECUTION,
  "registry-lookup": EXECUTION,
  "dose-tool": EXECUTION,
  "guideline-citation": EXECUTION,
  "completeness-gate": EXECUTION,
};

export type ProvenanceBadgeProps = {
  kind: ProvenanceKind;
  className?: string;
};

/**
 * A single provenance chip. `data-provenance` carries the kind so tests can
 * assert the seam is present without depending on the visible copy.
 */
export function ProvenanceBadge({ kind, className }: ProvenanceBadgeProps) {
  return (
    <Badge
      data-provenance={kind}
      className={cn(
        "font-mono text-[11px] font-medium tracking-tight",
        TINT[kind],
        className,
      )}
    >
      {LABELS[kind]}
    </Badge>
  );
}
