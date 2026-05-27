// app/console/refusal-card.tsx
//
// Refusal surface for the chat. Renders inside the assistant message
// bubble (like DoseCard / ReassessmentCard) when ANY of the four
// refusal-emitting layers returns a typed refusal:
//
//   - load_guideline             (out_of_scope, region_unknown)
//   - calculate_dose             (weight_missing, implausible_weight,
//                                 invalid_dose_rule_id, rule_not_verified)
//   - get_reassessment_plan      (6 kinds — see tools/types.ts)
//   - skill-direct prose abstain (unresolved_dangers — model abstained
//                                 in prose without calling a tool)
//
// CRITICAL VISUAL CONTRACT (D14):
//   - <Alert variant="safety"> — AMBER, never red.
//   - Red (<Alert variant="destructive">) is reserved for TECHNICAL FAILURE
//     (Zod parse fail, model unreachable). Validator-blocked errors use
//     red — the parent dispatches to a different surface for those.
//   - The RefusalKind is rendered VERBATIM in mono small-caps as the
//     header — the audit-grade signal that the SKILL chose to refuse and
//     which closed-set value was returned. This is the contract surface
//     a reviewer will inspect.
//
// aria-live="polite" — refusals are deliberate, not urgent. The validator
// blocked-state alert uses aria-live="assertive"; that lives elsewhere.

"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import type { AnyRefusalKind } from "@/tools/types";

export interface RefusalCardProps {
  /**
   * One of the four RefusalKind unions from tools/types.ts. The component
   * does not enumerate over them — it just renders the string verbatim
   * in mono small-caps. Adding a new RefusalKind in the type lock should
   * NOT require a refusal-card change (that's the whole point of the
   * structural-handoff pattern).
   */
  kind: AnyRefusalKind;
  /**
   * One-line plain-English gloss authored by the skill or the tool. e.g.
   * "Weight is required to compute a paediatric dose."
   */
  message: string;
  /**
   * Next-action hint — what the clinician should do now. e.g.
   * "Provide a weight in kilograms." Renders as a chip in the footer.
   */
  next_action?: string;
}

export function RefusalCard({ kind, message, next_action }: RefusalCardProps) {
  return (
    <Alert
      variant="safety"
      aria-live="polite"
      className="mt-2 flex flex-col gap-1.5"
    >
      {/* Header — RefusalKind verbatim, mono, small-caps. The audit signal. */}
      <AlertTitle className="font-mono text-[11px] font-semibold uppercase tracking-[0.08em]">
        {kind}
      </AlertTitle>
      {/* Body — the plain-English gloss. */}
      <AlertDescription className="text-[12.5px] leading-snug">
        {message}
      </AlertDescription>
      {/* Footer — next-action hint as a chip. Optional. */}
      {next_action && (
        <div className="mt-0.5">
          <Badge
            variant="outline"
            className="border-safety-border bg-white/60 px-2 py-0.5 text-[11px] font-medium text-safety-foreground"
          >
            Next: {next_action}
          </Badge>
        </div>
      )}
    </Alert>
  );
}
