// tools/load_guideline.ts
//
// THE RETRIEVAL TOOL — the layer that turns (condition, region) into the
// typed guideline payload the skill reads to do severity matching, dose
// selection, differential check, and reassessment planning.
//
// Per D3 (split refusal surface): retrieval has NARROW failure modes — either
// the requested (condition, region) pair has no guideline modelled
// (`out_of_scope`) or the region itself is not in the known set (`region_unknown`).
// Both are typed-refusal returns; the tool NEVER throws. The skill surfaces
// the refusal kind verbatim in a refusal card.
//
// Architectural posture:
//   - The TOOL owns lookup. The LLM passes (condition, region); the tool
//     looks up the guideline and returns the typed payload OR a typed refusal.
//   - The skill never authors the severity_rows[], dose_rules[], reassessment
//     plans, or differential check — those flow from THIS function's return
//     shape, sourced from the committed registry.
//   - The return shape includes `differential_check` (per the harness brief
//     "Companion contract addition") so Phase 2 of the skill knows which
//     must-not-miss conditions to scan the note for. The four croup
//     differentials with `hazard_level: "must_not_miss"` come straight from
//     the registry — the skill never authors them.
//   - `severity_rows[].description` is the source of truth for severity
//     matching. The skill reads `description` and matches against the note.

import { z } from "zod";
import { nanoid } from "nanoid";
import {
  getGuidelineByConditionAndRegion,
  type DoseRule,
  type SeverityRow,
  type DifferentialItem,
  type ReassessmentPlan,
} from "@/registry/guidelines";
import { LoadGuidelineRefusalKind } from "./types";

// ---------------------------------------------------------------------------
// Region — closed Zod enum so an unknown region string yields region_unknown
// rather than a TS-level type lie or a silent NZ fallback.
// ---------------------------------------------------------------------------

const RegionSchema = z.enum(["NZ", "AU"]);
/** Canonical region union — exported for callers that want the type. */
export type Region = z.infer<typeof RegionSchema>;

// ---------------------------------------------------------------------------
// Result shapes — discriminated union on `status`.
// ---------------------------------------------------------------------------

/**
 * The successful retrieval. Mirrors the registry payload, plus a
 * harness-generated `tool_call_id` the skill threads into the dose-card and
 * reassessment-card JSON blocks. Returns ENOUGH to drive the next phases
 * (severity matching, differential check, dose selection, reassessment) and
 * NOTHING the harness validator wouldn't already trust.
 */
export type LoadGuidelineOk = {
  status: "ok";
  /** Harness-generated nanoid; ^[a-zA-Z0-9_-]{8,32}$ per the tool-call-id regex. */
  tool_call_id: string;
  guideline_id: string;
  condition: string;
  region: Region;
  source_section: string;
  source_version: string;
  source_url: string;
  /**
   * Typed severity table — source of truth for severity matching. The skill
   * reads `description` and matches the note against it. Each row also
   * surfaces its `applies_to_dose_rule_id` so Phase 4 can select the dose
   * rule without re-judging severity.
   */
  severity_rows: SeverityRow[];
  /** The dose rules the skill picks BY id (and the dose tool looks values up from). */
  dose_rules: DoseRule[];
  /**
   * Must-not-miss differentials (per HARNESS-BRIEF "Companion contract
   * addition — `differential_check`"). The skill scans the note for these
   * features in Phase 2; two-or-more matches with `hazard_level:
   * "must_not_miss"` triggers airway_emergency / unresolved_dangers.
   */
  differential_check: DifferentialItem[];
  /** Phase 5 state machine: when to reassess, what to watch for, branches. */
  reassessment_plans: ReassessmentPlan[];
};

/**
 * Typed refusal — closed set of two kinds per D3. The tool never throws;
 * the skill surfaces `reason` verbatim in a refusal card so the clinician
 * sees an honest "I have no guideline for X" message rather than a guess.
 */
export type LoadGuidelineRefusal = {
  status: "refusal";
  reason: z.infer<typeof LoadGuidelineRefusalKind>;
  message: string;
};

export type LoadGuidelineResult = LoadGuidelineOk | LoadGuidelineRefusal;

/** Type guard: did the tool refuse? Lets callers `if (isRefusal(r)) return r;` cleanly. */
export function isLoadGuidelineRefusal(
  r: LoadGuidelineResult,
): r is LoadGuidelineRefusal {
  return r.status === "refusal";
}

// ---------------------------------------------------------------------------
// The tool — small, deterministic, no side effects.
// ---------------------------------------------------------------------------

/**
 * Retrieve a guideline payload for the (condition, region) pair.
 *
 * Refusal kinds (closed set, exhaustive):
 *   - `region_unknown` — region is not "NZ" or "AU". Returned BEFORE the
 *     condition lookup so the skill can ask the clinician to clarify region
 *     rather than guess at NZ.
 *   - `out_of_scope`  — the registry has no guideline for this (condition,
 *     region) pair. v3.1 only models croup; asthma/anaphylaxis/etc. → here.
 *
 * The success payload returns ALL the fields the skill needs to advance
 * to Phase 2 (differential check), Phase 3 (severity matching), Phase 4
 * (calculate_dose selection by id), and Phase 5 (get_reassessment_plan).
 */
export function load_guideline(
  condition: string,
  region: string,
): LoadGuidelineResult {
  // Region check FIRST — a malformed region is a different failure mode than
  // an unknown condition, and the clinician needs to see that distinction.
  const regionParsed = RegionSchema.safeParse(region);
  if (!regionParsed.success) {
    return {
      status: "refusal",
      reason: "region_unknown",
      message: `Region "${region}" is not in the known set (NZ, AU). I will not guess a region.`,
    };
  }

  const guideline = getGuidelineByConditionAndRegion(
    condition,
    regionParsed.data,
  );
  if (guideline === null) {
    return {
      status: "refusal",
      reason: "out_of_scope",
      message: `No guideline modelled for "${condition}" in ${regionParsed.data}. v3.1 covers croup only — other conditions are deferred.`,
    };
  }

  // The dose_rules are returned BY REFERENCE — the dose tool reads them via
  // getDoseRule(guidelineId, doseRuleId) from the registry on each call, so
  // the skill can't mutate them client-side and have that affect the math.
  // The trust boundary is the registry, not this return value.
  return {
    status: "ok",
    // nanoid default alphabet is URL-safe ([A-Za-z0-9_-]), length 21 — sits
    // inside the ^[a-zA-Z0-9_-]{8,32}$ contract on tool_call_id. Lane C's
    // lib/tool-call-id.ts will become the central generator at fan-in; until
    // then this matches the same regex.
    tool_call_id: nanoid(),
    guideline_id: guideline.guideline_id,
    condition: guideline.condition,
    region: guideline.region,
    source_section: guideline.dose_rules[0]?.source_section ?? "",
    source_version: guideline.dose_rules[0]?.source_version ?? "",
    source_url: guideline.dose_rules[0]?.source_url ?? "",
    severity_rows: guideline.severity_rows,
    dose_rules: guideline.dose_rules,
    differential_check: guideline.differential_check,
    reassessment_plans: guideline.reassessment_plans,
  };
}
