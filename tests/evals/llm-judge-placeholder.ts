// tests/evals/llm-judge-placeholder.ts
//
// ┌─────────────────────────────────────────────────────────────────────────┐
// │  DEFERRED — Layer 2: LLM-AS-JUDGE (clinically-framed APPLICABILITY rubric) │
// │  THIS FILE IS A NON-GATING PLACEHOLDER. IT IS NOT WIRED INTO promptfoo.yaml.│
// └─────────────────────────────────────────────────────────────────────────┘
//
// WHY DEFERRED (DESIGN.md "Deliberately deferred" + an explicit user decision):
//   The TRUE gate is the deterministic Layer-1 suite (promptfoo.yaml): exact
//   assertions on structured tool output (dose.dose_mg === 2.13, capped === true,
//   status === "incomplete", routed guideline_id, severity row). Those are
//   reproducible, cheap, and cannot drift.
//
//   Layer 2 would add a clinically-framed LLM judge for APPLICABILITY —
//   faithfulness's blind spot: "is this plan the RIGHT plan for THIS patient,
//   beyond being faithfully quoted from the guideline?" That is genuinely useful
//   but (a) needs a domain-framed judge prompt or it inherits the NICE paper's
//   ~4% misclassification rate (research/papers.md), and (b) must be
//   INFORMATIONAL ONLY — never gating — so a judge miss can't fail a clinically
//   correct plan or pass an unsafe one. Building it well is out of scope for a
//   4-day take-home; the deterministic gate is sufficient and honest.
//
// THE HOOK (what to build when this is un-deferred):
//   * A promptfoo `llm-rubric` (or `g-eval`) assert appended to the dose cases,
//     judged by claude-opus-4-7 with a clinically-framed rubric, e.g.:
//
//       rubric: |
//         You are a senior emergency paediatrician auditing a decision-support
//         plan. The dose arithmetic is ALREADY verified deterministically — do
//         NOT re-grade numbers. Judge APPLICABILITY only:
//           1. Is the chosen guideline appropriate for the confirmed condition?
//           2. Does the severity classification match the documented findings?
//           3. Are the escalation + disposition steps clinically adequate for
//              this severity, or is something a senior clinician would expect
//              MISSING (an omission the structured completeness gate can't see)?
//         Score 1 (applicable + safe) to 5 (inapplicable / unsafe). Output JSON
//         { score, reasoning }. This is ADVISORY — it never gates the suite.
//
//   * Wire it as `type: llm-rubric` with `threshold` UNSET (or weight 0) so it
//     is reported but cannot fail the run. Keep the deterministic asserts as the
//     pass/fail gate.
//
// Until then: this placeholder documents the deferral so it is DEMONSTRATED, not
// absent — a reviewer sees the considered hand-off, and the deterministic Layer-1
// suite remains the sole gate.

export const LLM_JUDGE_DEFERRED = true;

/**
 * Intentionally unused. Returns the deferral rationale so a future maintainer (or
 * a reviewer grepping the suite) finds the un-defer plan in code, not just prose.
 */
export function llmJudgeDeferralNote(): string {
  return [
    "Layer-2 LLM-as-judge (applicability rubric) is DEFERRED and NON-GATING.",
    "The deterministic Layer-1 suite (promptfoo.yaml) is the true gate.",
    "Un-defer by adding an advisory `llm-rubric` assert (threshold unset) judged",
    "by claude-opus-4-7 with the clinically-framed rubric in this file's header.",
  ].join(" ");
}
