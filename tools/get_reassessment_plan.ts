// tools/get_reassessment_plan.ts
//
// PHASE 5 — REASSESSMENT TOOL. Returns the longitudinal "what to do next,
// when, and what to watch for" plan keyed by (guideline_id, initial_severity,
// dose_rule_id). The AI Care Partner shape — Heidi's longitudinal product
// pattern made literal.
//
// The Starship croup flowchart (and the RCH AU equivalent) is a state
// machine, not a single-shot calculation: treat → reassess at 2 h (mild/mod)
// or 4 h (severe) → re-classify → re-route. This tool surfaces the relevant
// slice of that state machine to the clinician via a structured handoff card.
//
// Same retrieval posture as load_guideline: the TOOL owns lookup, the LLM
// never authors `reassess_in_minutes`, a branch, or a watch-for sign. Refusals
// are typed-return values (never thrown). The 6-step selection logic is
// verbatim from skills/dose-calculator/HARNESS-BRIEF-get_reassessment_plan.md.
//
// Per D3 + the harness brief, the closed refusal set is:
//   invalid_guideline_id    — unknown guideline_id (step 1)
//   rule_not_verified       — freshness check failed (step 2)
//   invalid_dose_rule_id    — dose_rule_id not in this guideline's rules
//   invalid_severity_label  — initial_severity not in severity_rows (step 4)
//   no_reassessment_required — valid clinical state (step 5): one-shot drug,
//                               no follow-up modelled — NOT an error
//   out_of_scope            — guideline exists but has zero reassessment_plans

import { nanoid } from "nanoid";
import {
  getGuideline,
  type ReassessmentPlan,
  type WatchForItem,
  type ReassessmentBranch,
} from "@/registry/guidelines";
import { GetReassessmentPlanRefusalKind } from "./types";
import type { z } from "zod";

// ---------------------------------------------------------------------------
// Result shapes — discriminated union on `status`.
// ---------------------------------------------------------------------------

/**
 * The successful plan retrieval. Mirrors HARNESS-BRIEF lines 44-56: the
 * harness validator pulls these fields and renders the reassessment card.
 * The skill emits a reassessment-card JSON block referencing tool_call_id;
 * the validator looks it up and merges the structured fields.
 */
export type ReassessmentPlanOk = {
  status: "ok";
  tool_call_id: string;
  guideline_id: string;
  initial_severity: string;
  /** e.g. 120 (mild/mod) or 240 (severe) for croup; the registry's number, not the LLM's. */
  reassess_in_minutes: number;
  watch_for: WatchForItem[];
  next_branches: ReassessmentBranch[];
  universal_rails: string[];
  /** Mirrors load_guideline's citation chip — one source, no competing citations. */
  source_version: string;
  source_url: string;
  /** Human-readable derivation: "Starship 2020 croup — moderate-on-initial → 120 min reassess". */
  trace: string;
};

export type ReassessmentPlanRefusal = {
  status: "refusal";
  reason: z.infer<typeof GetReassessmentPlanRefusalKind>;
  message: string;
};

export type ReassessmentPlanResult =
  | ReassessmentPlanOk
  | ReassessmentPlanRefusal;

/** Type guard so callers can `if (isRefusal(r)) return r;` cleanly. */
export function isReassessmentRefusal(
  r: ReassessmentPlanResult,
): r is ReassessmentPlanRefusal {
  return r.status === "refusal";
}

// ---------------------------------------------------------------------------
// Freshness check — derived from publication_date + review_period_months.
// A guideline whose review window has elapsed is "stale" and the tool refuses
// rather than serve potentially-outdated reassessment timings. This is the
// same `rule_not_verified` lever calculate_dose uses on `human_verified`.
// ---------------------------------------------------------------------------

/**
 * Returns true if the guideline is within its review window from publication.
 * Date math: publication_date + review_period_months ≥ now → fresh.
 * Pure function; no side effects; caller can stub `now` in tests if needed.
 */
function isFresh(
  publicationDate: string,
  reviewPeriodMonths: number,
  now: Date = new Date(),
): boolean {
  const pub = new Date(publicationDate);
  if (Number.isNaN(pub.getTime())) return false; // malformed date → treat as stale
  const expiry = new Date(pub);
  expiry.setMonth(expiry.getMonth() + reviewPeriodMonths);
  return now <= expiry;
}

// ---------------------------------------------------------------------------
// The tool — six-step selection per HARNESS-BRIEF lines 184-194.
// ---------------------------------------------------------------------------

/**
 * Find the reassessment plan for (guideline_id, initial_severity, dose_rule_id).
 *
 * Step order MATTERS — each step screens out a distinct failure mode, and
 * misordering would let one failure mask another. The order is verbatim
 * from the harness brief; do not flip without re-reading the brief.
 *
 *   1. Unknown guideline_id          → invalid_guideline_id
 *   2. Stale guideline               → rule_not_verified
 *   3. Unknown dose_rule_id in this  → invalid_dose_rule_id
 *      guideline's dose_rules
 *   4. initial_severity not in       → invalid_severity_label
 *      severity_rows[].label
 *   5. No plan matches the (severity, → no_reassessment_required (VALID
 *      rule) tuple                      clinical state, not an error)
 *   6. Guideline exists but has zero → out_of_scope
 *      reassessment_plans entries
 *   ─ otherwise: return the matched plan in the success shape.
 */
export function get_reassessment_plan(
  guideline_id: string,
  initial_severity: string,
  dose_rule_id: string,
): ReassessmentPlanResult {
  // Step 1 — unknown guideline_id.
  const guideline = getGuideline(guideline_id);
  if (guideline === null) {
    return {
      status: "refusal",
      reason: "invalid_guideline_id",
      message: `No guideline "${guideline_id}" in the registry. I will not guess a guideline.`,
    };
  }

  // Step 2 — freshness check.
  if (!isFresh(guideline.publication_date, guideline.review_period_months)) {
    return {
      status: "refusal",
      reason: "rule_not_verified",
      message: `Guideline "${guideline_id}" is past its review window (published ${guideline.publication_date}, review every ${guideline.review_period_months} months). I will not serve a stale reassessment plan.`,
    };
  }

  // Step 3 — dose_rule_id must exist in this guideline.
  const ruleExists = guideline.dose_rules.some(
    (r) => r.dose_rule_id === dose_rule_id,
  );
  if (!ruleExists) {
    return {
      status: "refusal",
      reason: "invalid_dose_rule_id",
      message: `No dose rule "${dose_rule_id}" in guideline "${guideline_id}". I will not match a reassessment plan to a rule I cannot find.`,
    };
  }

  // Step 4 — initial_severity must be a known severity_row label.
  const severityExists = guideline.severity_rows.some(
    (s) => s.label === initial_severity,
  );
  if (!severityExists) {
    return {
      status: "refusal",
      reason: "invalid_severity_label",
      message: `"${initial_severity}" is not a known severity for guideline "${guideline_id}". Valid labels: ${guideline.severity_rows.map((s) => s.label).join(", ")}.`,
    };
  }

  // Step 6 (re-ordered before 5 because empty-list means the GUIDELINE has
  // no plans modelled at all, which is a structural out_of_scope condition —
  // distinct from "this specific (severity, rule) tuple isn't planned").
  if (guideline.reassessment_plans.length === 0) {
    return {
      status: "refusal",
      reason: "out_of_scope",
      message: `Guideline "${guideline_id}" has no reassessment plans modelled. v3.1 covers croup only; other conditions will come later via the same pattern.`,
    };
  }

  // Step 5 — find the matching plan.
  const plan: ReassessmentPlan | undefined = guideline.reassessment_plans.find(
    (p) =>
      p.applies_to_initial_severity.includes(initial_severity) &&
      p.applies_to_dose_rule_id.includes(dose_rule_id),
  );
  if (plan === undefined) {
    // Valid clinical state per the brief — a one-shot drug with no follow-up
    // is a legitimate case, NOT an error. The skill surfaces this as
    // "no reassessment scheduled" in prose, no reassessment-card emitted.
    return {
      status: "refusal",
      reason: "no_reassessment_required",
      message: `No reassessment plan modelled for severity "${initial_severity}" + rule "${dose_rule_id}" in guideline "${guideline_id}". This is a valid clinical state — a one-shot intervention with no follow-up modelled.`,
    };
  }

  // Citation chip mirrors load_guideline — one source, no competing citations.
  const cite = guideline.dose_rules.find(
    (r) => r.dose_rule_id === dose_rule_id,
  )!;
  return {
    status: "ok",
    tool_call_id: nanoid(),
    guideline_id,
    initial_severity,
    reassess_in_minutes: plan.reassess_in_minutes,
    watch_for: plan.watch_for,
    next_branches: plan.next_branches,
    universal_rails: plan.universal_rails,
    source_version: cite.source_version,
    source_url: cite.source_url,
    trace: `${cite.source_version} — initial ${initial_severity} (rule ${dose_rule_id}) → reassess at ${plan.reassess_in_minutes} min via plan "${plan.id}"`,
  };
}
