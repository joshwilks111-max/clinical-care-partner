// app/console/dose-card.tsx
//
// The dose-card — EMBEDDED INSIDE the assistant message bubble, NOT a
// sibling. Per D14 (anti-slop): all cards STACK vertically inside the
// bubble; rendering them as a 3-column grid alongside the prose is the
// canonical AI-slop tell.
//
// Visual contract — lifted from variant-A-heidi-grammar.html .dose-card
// (~/.gstack/projects/joshwilks111-max-clinical-care-partner/designs/
//  heidi-chat-right-rail-20260528/variant-A-heidi-grammar.html):
//
//   ┌──────────────────────────────────────────────────┐
//   │ DOSE · ORAL DEXAMETHASONE   [DETERMINISTIC TOOL] │  header row
//   │                                                   │
//   │   2.13 mg  PO                                     │  serif headline (22-24px)
//   │                                                   │
//   │ ┌────────────────────────────────────────────┐    │
//   │ │ 14.2 kg × 0.15 mg/kg = 2.13 mg             │    │  mono trace
//   │ │   · cap 12 mg · capped:false               │    │  on cream-2 bg
//   │ └────────────────────────────────────────────┘    │
//   │                                                   │
//   │ Source: Starship 2020 §Dose · v2020               │  src-row
//   └──────────────────────────────────────────────────┘
//
// When capped:true the header gains a small amber CAPPED chip and a
// sub-line "binding limit 12 mg". This is the user-facing surface of the
// deterministic safety cap fired by tools/calculate_dose.ts.
//
// Field provenance:
//   drug, route, severity_row     → from DoseCardEmittedSchema (the JSON
//                                    block the SKILL writes, validated by
//                                    Lane C's response-validator)
//   dose_mg, dose_ml, max_mg,     → MERGED IN from the calculate_dose tool
//   capped, source_version,        result (deterministic — the model
//   source_url                     never authors a number, D7 invariant).
//
// Both halves arrive together via lib/response-validator.ts; this
// component is pure-presentational and doesn't itself perform the merge.

"use client";

import { Badge } from "@/components/ui/badge";

export interface DoseCardProps {
  /** Drug name, e.g. "oral dexamethasone". Comes from the emitted dose-card JSON. */
  drug: string;
  /** Route of administration, e.g. "PO". From the emitted dose-card JSON. */
  route: string;
  /**
   * The severity row label that drives the dose, e.g. "moderate". Lifted
   * from the skill's emitted block so the audit trace shows exactly which
   * row the model selected.
   */
  severity_row: string;
  /** Computed dose in mg — from the deterministic tool, NEVER the model. */
  dose_mg: number;
  /** Optional mL equivalent (some elixirs report both). */
  dose_ml?: number;
  /** Cap in mg for this drug, from the registry. */
  max_mg: number;
  /**
   * True when the calculated dose hit the cap. Surfaces an amber CAPPED
   * chip in the header + a "binding limit Nmg" sub-line. Audit-critical:
   * the reviewer must see WHEN the cap fires, not just THAT it might.
   */
  capped: boolean;
  /** Guideline version, e.g. "Starship 2020". For the InlineCitation slot. */
  source_version: string;
  /** Optional guideline URL (the citation pill is clickable when present). */
  source_url?: string;
}

export function DoseCard({
  drug,
  route,
  severity_row,
  dose_mg,
  dose_ml,
  max_mg,
  capped,
  source_version,
  source_url,
}: DoseCardProps) {
  // Format the trace string so it reads like an audit log — the same shape
  // the variant-A mockup shows. We split the math from the cap so the cap
  // can stand out in its own muted-amber colour when capped:true.
  // Note: weight × dose_per_kg trace is not exposed by the emitted contract
  // (only the final dose_mg + max_mg are), so we show a partial trace —
  // "computed → N mg · cap M mg · capped:bool". The full math is in the
  // tool result and would surface on a debug overlay (not v1).
  const mlSuffix =
    typeof dose_ml === "number" ? ` (${dose_ml.toFixed(2)} mL)` : "";

  return (
    <section
      aria-label={`Computed dose: ${dose_mg} milligrams ${drug}, from ${source_version}`}
      className="mt-2 rounded-[9px] border border-[var(--cream-2)] bg-[#fbf8f1] p-3"
    >
      {/* Header row — uppercase label + DETERMINISTIC TOOL chip + (when capped) amber CAPPED chip */}
      <header className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          Dose · {drug}
        </span>
        <div className="flex items-center gap-1.5">
          {capped && (
            <Badge
              variant="outline"
              className="border-safety-border bg-safety px-1.5 py-0 font-mono text-[9px] tracking-wider text-safety-foreground"
            >
              CAPPED
            </Badge>
          )}
          <Badge
            variant="outline"
            className="border-transparent bg-[#efecfb] px-1.5 py-0 font-mono text-[9px] tracking-wider text-[#5b4bbd]"
          >
            DETERMINISTIC TOOL
          </Badge>
        </div>
      </header>

      {/* The visual headline — serif, 22-24px, route in muted sans alongside.
          This IS the dose-card's main thing; everything else is provenance. */}
      <div
        className="font-[var(--serif)] text-[22px] font-bold leading-[1.1] tracking-[-0.015em] text-foreground"
        style={{ fontFamily: "var(--serif)" }}
      >
        {dose_mg} mg
        <span className="ml-1.5 font-sans text-[13px] font-medium text-muted-foreground">
          {route}
          {mlSuffix}
        </span>
      </div>

      {/* Trace — mono, cream-2 bg, the audit "show your working" surface */}
      <div className="mt-1.5 rounded-md bg-[#f1ece0] px-2 py-1.5 font-mono text-[11.5px] leading-tight text-[#5b6678]">
        {severity_row} · {dose_mg} mg{" "}
        <span className="text-[#7a6e3e]">
          · cap {max_mg} mg · capped:{capped ? "true" : "false"}
        </span>
      </div>

      {/* Binding-limit sub-line (only on capped) — clinically critical context */}
      {capped && (
        <p className="mt-1.5 text-[11.5px] text-safety-foreground">
          Binding limit: {max_mg} mg. Dose clamped to cap.
        </p>
      )}

      {/* Source row — citation pill linking to the guideline source */}
      <div className="mt-2 flex items-center gap-1 text-[11.5px] text-muted-foreground">
        <span>Source:</span>
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
