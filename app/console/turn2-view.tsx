// app/console/turn2-view.tsx
//
// TURN 2 (the EXECUTION half) — the keystone view. It switches EXHAUSTIVELY on
// the imported Turn2Response `status` union so a new member can't be silently
// dropped. Each branch implements the DESIGN.md state grammar:
//
//   status:"ok"          → dose + drug + route as ONE bold headline (D1), the
//                          fixed dose trace (D4, CAPPED segment in the amber
//                          accent), labeled citation quote blocks with clickable
//                          source_url (D7), and the green completeness-OK card.
//   status:"incomplete"  → THE MONEY-SHOT. The missing field NAME is the amber
//                          headline under a COMPLETENESS CHECK intent label.
//   status:"abstention"  → the abstention sentence as the amber headline under a
//                          DELIBERATE ABSTENTION intent label.
//   status:"error"       → RED (the ONLY red state) — a genuine technical error.
//
// Amber (Alert variant="safety") for ALL deliberate safety events; RED
// (variant="destructive") ONLY for status:"error". This is the locked contract.

"use client";

import {
  ShieldAlert,
  OctagonX,
  CheckCircle2,
  TriangleAlert,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/components/lib/utils";
import { Source } from "@/components/ai-elements/sources";

import { ProvenanceBadge } from "./provenance-badge";
import type { Turn2Response } from "@/app/api/turn2/route";
import type {
  PlanOutput,
  PlanRecommendation as PlanRecommendationType,
} from "@/lib/plan-schema";

// ---------------------------------------------------------------------------
// Shared sub-renderers.
// ---------------------------------------------------------------------------

/**
 * The fixed dose trace (DESIGN.md D4). When capped, the "→ CAPPED to N mg"
 * segment is split out and rendered in the amber accent so the cap reads at a
 * glance on camera. Otherwise the whole trace renders mono on a dark slab.
 */
function DoseTrace({ trace }: { trace: string }) {
  const CAP_MARKER = "→ CAPPED";
  const capIdx = trace.indexOf(CAP_MARKER);
  return (
    <pre
      data-testid="dose-trace"
      className="overflow-x-auto rounded-lg bg-slate-900 px-3 py-2.5 font-mono text-[12px] leading-relaxed text-slate-200"
    >
      {capIdx === -1 ? (
        trace
      ) : (
        <>
          {trace.slice(0, capIdx)}
          <span data-testid="cap-segment" className="font-bold text-amber-400">
            {trace.slice(capIdx)}
          </span>
        </>
      )}
    </pre>
  );
}

/** One recommendation as a labeled quote block with a clickable source_url (D7). */
function RecommendationBlock({ rec }: { rec: PlanRecommendationType }) {
  // FIX 3 (ADV-4) — only render the verbatim blockquote when the server VERIFIED
  // the quote against the guideline text (an unverifiable quote is blanked to ""
  // upstream). Never show empty quote marks as if a citation existed.
  const hasVerifiedQuote = rec.quote.length > 0;
  // FIX 2 (SEC-1, XSS) — defensive scheme guard. source_url is registry-stamped
  // server-side, but render the clickable link ONLY for an https:// URL so a
  // javascript:/data: value could never reach an anchor href.
  const safeSourceUrl = rec.source_url.startsWith("https://")
    ? rec.source_url
    : null;
  return (
    <div className="space-y-1.5">
      <p className="text-[13px]">{rec.text}</p>
      {hasVerifiedQuote && (
        <blockquote className="border-l-2 border-primary/50 pl-3 text-[12px] italic text-muted-foreground">
          “{rec.quote}”
          <div className="mt-1 text-[11px] not-italic">
            <span className="font-medium">{rec.source_section}</span>
            <span className="text-muted-foreground">
              {" "}
              · {rec.source_version}
            </span>
          </div>
        </blockquote>
      )}
      {/* source_url is the resolved registry citation URL — rendered verbatim.
          The Source link is clickable and ALWAYS visible (D7: every claim's
          source is one glance away, not hidden behind a collapse toggle).
          Guarded to https:// only (FIX 2). Uses the AI Elements `Source` leaf. */}
      {safeSourceUrl && <Source href={safeSourceUrl} title={safeSourceUrl} />}
    </div>
  );
}

/** The completeness-gate card. Green when complete; amber when it fired. */
function CompletenessCard({
  plan,
  missing,
}: {
  plan: PlanOutput;
  missing?: string[];
}) {
  const fields = Object.keys(plan.required_fields);
  const fired = missing !== undefined && missing.length > 0;

  if (fired) {
    return (
      <Alert
        variant="safety"
        data-testid="completeness-card"
        data-complete="false"
      >
        <TriangleAlert />
        <AlertTitle className="flex items-center gap-2">
          <span className="font-mono text-[11px] tracking-wide">
            COMPLETENESS CHECK
          </span>
          <ProvenanceBadge kind="completeness-gate" />
        </AlertTitle>
        <AlertDescription>
          Required field(s) missing:{" "}
          <span className="font-semibold">{missing.join(", ")}</span>. The plan
          cites correctly but is incomplete — a faithful-but-unsafe omission.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert
      data-testid="completeness-card"
      data-complete="true"
      className="border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"
    >
      <CheckCircle2 className="text-emerald-600" />
      <AlertTitle className="flex items-center gap-2">
        <span className="font-mono text-[11px] tracking-wide">
          COMPLETENESS CHECK
        </span>
        <ProvenanceBadge kind="completeness-gate" />
      </AlertTitle>
      <AlertDescription className="text-emerald-800 dark:text-emerald-200">
        Plan complete — all required fields present:{" "}
        {fields.map((f) => `${f} ✓`).join(" · ")}
      </AlertDescription>
    </Alert>
  );
}

/** The provenance seam line shown on every plan-bearing state (ok/incomplete). */
function ProvenanceSeam({
  provenance,
}: {
  provenance: { routed_guideline_id: string; severity_row: string };
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
      <ProvenanceBadge kind="registry-lookup" />
      <span>
        routed →{" "}
        <span className="font-mono">{provenance.routed_guideline_id}</span>
      </span>
      <span>· severity row:</span>
      <span className="font-mono">{provenance.severity_row}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Branch renderers.
// ---------------------------------------------------------------------------

function StepHeader() {
  return (
    <div className="flex items-center gap-2">
      <span className="flex size-6 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground">
        2
      </span>
      <span className="text-sm font-semibold">Apply</span>
      <span className="font-mono text-[11px] text-muted-foreground">
        deterministic / constrained
      </span>
    </div>
  );
}

function OkView({ res }: { res: Extract<Turn2Response, { status: "ok" }> }) {
  const { dose, plan, provenance } = res;
  const ml = dose.dose_ml !== null ? ` · ${dose.dose_ml} mL` : "";
  return (
    <section data-testid="turn2-ok" className="space-y-3">
      <StepHeader />

      {/* D1 — dose + drug + route as ONE bold headline, first-thing-visible. */}
      <Card>
        <CardContent className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Dose
            </div>
            <ProvenanceBadge kind="dose-tool" />
          </div>
          <div data-testid="dose-headline" className="text-lg font-bold">
            {dose.dose_mg} mg {dose.drug}
            <span className="ml-1 text-[13px] font-normal text-muted-foreground">
              {dose.route}
              {ml}
            </span>
          </div>
          <DoseTrace trace={dose.calculation_trace} />
          {dose.data_gaps.length > 0 && (
            <ul className="list-disc pl-5 text-[12px] text-muted-foreground">
              {dose.data_gaps.map((g) => (
                <li key={g}>{g}</li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* D7 — recommendations as labeled quote blocks with clickable sources. */}
      <Card>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Plan & citations
            </div>
            <ProvenanceBadge kind="guideline-citation" />
          </div>
          {plan.recommendations.map((rec, i) => (
            <RecommendationBlock key={i} rec={rec} />
          ))}
        </CardContent>
      </Card>

      <CompletenessCard plan={plan} />
      <ProvenanceSeam provenance={provenance} />
    </section>
  );
}

function IncompleteView({
  res,
}: {
  res: Extract<Turn2Response, { status: "incomplete" }>;
}) {
  return (
    <section data-testid="turn2-incomplete" className="space-y-3">
      <StepHeader />

      {/* THE MONEY-SHOT — the missing field NAME is the amber headline. */}
      <Alert variant="safety" data-testid="incomplete-headline">
        <ShieldAlert />
        <AlertTitle className="flex items-center gap-2">
          <span className="font-mono text-[11px] tracking-wide">
            COMPLETENESS CHECK
          </span>
        </AlertTitle>
        <AlertDescription className="text-[13px] font-semibold text-safety-foreground">
          Missing required field: {res.missing.join(", ")}
        </AlertDescription>
      </Alert>

      {/* The plan still renders (shown with the gap flagged), so the reviewer
          sees the "faithful but incomplete" plan, not a blank screen. */}
      <Card>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Plan & citations (incomplete)
            </div>
            <ProvenanceBadge kind="guideline-citation" />
          </div>
          {res.plan.recommendations.map((rec, i) => (
            <RecommendationBlock key={i} rec={rec} />
          ))}
        </CardContent>
      </Card>

      <CompletenessCard plan={res.plan} missing={res.missing} />
      <ProvenanceSeam provenance={res.provenance} />
    </section>
  );
}

function AbstentionView({
  res,
}: {
  res: Extract<Turn2Response, { status: "abstention" }>;
}) {
  return (
    <section data-testid="turn2-abstention" className="space-y-3">
      <StepHeader />
      <Alert variant="safety" data-testid="abstention-headline">
        <ShieldAlert />
        <AlertTitle className="flex items-center gap-2">
          <span className="font-mono text-[11px] tracking-wide">
            DELIBERATE ABSTENTION
          </span>
        </AlertTitle>
        <AlertDescription className="text-[13px] font-semibold text-safety-foreground">
          {res.headline}
        </AlertDescription>
      </Alert>
      {res.detail && (
        <p className="text-[12px] text-muted-foreground">{res.detail}</p>
      )}
    </section>
  );
}

function ErrorView({
  res,
}: {
  res: Extract<Turn2Response, { status: "error" }>;
}) {
  // RED — the ONLY red state. A genuine technical error, never a clinical event.
  return (
    <section data-testid="turn2-error" className="space-y-3">
      <StepHeader />
      <Alert variant="destructive" data-testid="error-headline">
        <OctagonX />
        <AlertTitle>Technical error</AlertTitle>
        <AlertDescription>{res.message}</AlertDescription>
      </Alert>
    </section>
  );
}

// ---------------------------------------------------------------------------
// The exhaustive switch.
// ---------------------------------------------------------------------------

export type Turn2ViewProps = { result: Turn2Response };

export function Turn2View({ result }: Turn2ViewProps) {
  switch (result.status) {
    case "ok":
      return <OkView res={result} />;
    case "incomplete":
      return <IncompleteView res={result} />;
    case "abstention":
      return <AbstentionView res={result} />;
    case "error":
      return <ErrorView res={result} />;
    default: {
      // Exhaustiveness guard: a new `status` member makes this a compile error.
      const _exhaustive: never = result;
      return _exhaustive;
    }
  }
}
