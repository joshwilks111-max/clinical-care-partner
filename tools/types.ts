// tools/types.ts
//
// THE TYPE LOCK — the single source of truth the harness-side tools and lib
// modules import from. Created in Phase 1 (P1.5) of the v3.1 build plan so
// the 5 parallel Phase 2 lanes (B/C/D/F/E-prep) all encode against the same
// names and shapes. If this file changes mid-build, every lane drifts —
// don't re-author except by a fresh planning pass.
//
// ─── What lives here ───────────────────────────────────────────────────────
// The four RefusalKind unions — the closed sets every refusal-emitting
//    tool MUST pick from. Per D3 (split refusal surface, ceo-review 2026-05-28):
//      - calculate_dose             → CalculateDoseRefusalKind          (4 vals)
//      - load_guideline             → LoadGuidelineRefusalKind          (2 vals)
//      - get_reassessment_plan      → GetReassessmentPlanRefusalKind    (6 vals)
//      - skill direct prose abstain → SkillDirectRefusalKind            (1 val)
//
// ─── Naming-collision note (deliberate split) ─────────────────────────────
// The upstream skill's validate_dose_card.ts ALSO exports a
// `CalculateDoseRefusalKind` Zod enum — but with 7 values (the trunk's 4
// plus airway_emergency, unresolved_dangers, out_of_scope). Per D3 the
// HARNESS contract is the 4-value union (matching what tools/calculate_dose.ts
// can legitimately return); the extras are split: out_of_scope/region_unknown
// go to load_guideline; unresolved_dangers becomes a SKILL-side direct prose
// refusal (no tool call); airway_emergency is the skill's runtime abort
// that calls no tool at all. We DO NOT re-export the skill's enum here to
// avoid the duplicate-identifier collision; the harness owns its own contract.

import { z } from "zod";

// ─── 1a. calculate_dose refusal kinds (4 values, harness contract) ────────
// Mirrors the four reasons the deterministic dose tool can return today
// (see tools/calculate_dose.ts → RefusalReason). Each one corresponds to
// a guard the tool enforces; adding a new kind requires a matching guard
// AND a UI refusal-card variant in Lane F.
export const CalculateDoseRefusalKind = z.enum([
  "weight_missing", // GUARD-1: null/absent/NaN weight from extraction
  "implausible_weight", // GUARD-7: <=0, >200, non-finite
  "invalid_dose_rule_id", // unknown guideline_id or dose_rule_id
  "rule_not_verified", // human_verified === false on the rule
]);
export type CalculateDoseRefusalKind = z.infer<typeof CalculateDoseRefusalKind>;

// ─── 1b. load_guideline refusal kinds (2 values, retrieval-side) ──────────
// Per D3: "no guideline" is a retrieval concern, not a clinical-judgment
// abstention. The clinical-judgment abstention ("differential too wide")
// lives on the SKILL side as SkillDirectRefusalKind.
export const LoadGuidelineRefusalKind = z.enum([
  "out_of_scope", // condition has no guideline modelled for this region
  "region_unknown", // requested region is neither NZ nor AU
]);
export type LoadGuidelineRefusalKind = z.infer<typeof LoadGuidelineRefusalKind>;

// ─── 1c. get_reassessment_plan refusal kinds (6 values, per HARNESS-BRIEF) ┐
// Source: skills/dose-calculator/HARNESS-BRIEF-get_reassessment_plan.md     │
// (the "if not found / freshness check / no plan modelled" spec at lines   │
// 188-199). A reassessment plan can legitimately be "not required" for a   │
// one-shot drug, which is why no_reassessment_required is a refusal kind   │
// (a valid clinical state, not an error — see the brief's note).           │
export const GetReassessmentPlanRefusalKind = z.enum([
  "invalid_guideline_id", // unknown guideline_id
  "invalid_dose_rule_id", // unknown dose_rule_id within an otherwise-valid guideline
  "invalid_severity_label", // initial_severity not in this guideline's severity_rows
  "rule_not_verified", // guideline freshness check failed (publication date stale)
  "out_of_scope", // condition has no reassessment plan modelled yet
  "no_reassessment_required", // one-shot drug; legitimate clinical state, not an error
]);
export type GetReassessmentPlanRefusalKind = z.infer<
  typeof GetReassessmentPlanRefusalKind
>;

// ─── 1d. Skill-direct refusal kinds (1 value, model-side prose abstention) ─
// Per D3: when the model judges the differential is too wide to safely pick
// a guideline, it abstains in PROSE — no tool call, no dose-card. The lane-C
// validator surfaces this as a refusal-card with this single kind. Adding
// another value here is a contract change that affects Lane F's refusal-card
// component and the skill's SKILL.md instruction block.
export const SkillDirectRefusalKind = z.enum(["unresolved_dangers"]);
export type SkillDirectRefusalKind = z.infer<typeof SkillDirectRefusalKind>;

// ─── 2. The unified refusal-kind union (for UI dispatch) ──────────────────
// Lane F's refusal-card component switches on this discriminator to pick
// which copy + which "what to do next" hint to render. Exhaustive switches
// against this union will fail the typecheck if a new kind ever lands in
// one of the four constituents without updating the UI.
export const AnyRefusalKind = z.union([
  CalculateDoseRefusalKind,
  LoadGuidelineRefusalKind,
  GetReassessmentPlanRefusalKind,
  SkillDirectRefusalKind,
]);
export type AnyRefusalKind = z.infer<typeof AnyRefusalKind>;
