[T+0m] DONE: read contracts · WIP: registry/guidelines.ts · BLOCKERS: none
[T+10m] DONE: registry/guidelines.ts (region+severity_rows+differential_check+reassessment_plans+AU RCH guideline; anaphylaxis removed; freshness fields added); registry/guidelines.regression.test.ts (40 tests, all green). Collateral: deleted legacy registry/guidelines.test.ts (replaced by regression file); fixed 2 anaphylaxis-dependent calculate_dose tests (converted to stubRule pattern; coverage intent preserved). · WIP: tools/load_guideline.ts · BLOCKERS: none
[T+25m] DONE: tools/load_guideline.ts + .test.ts (11 tests, green); tools/get_reassessment_plan.ts + .test.ts (11 tests, green; 6-step selection logic per HARNESS-BRIEF); tools/ask_user.ts + .test.ts (7 tests, green; 5-kind enum). · WIP: sign-off + push · BLOCKERS: none

SIGN-OFF: `npx vitest run registry tools` → 5 files, 99 tests, all green. `npx tsc --noEmit` → clean.

CASCADE LEDGER (not in lane scope; documented for Phase 3 fan-in operator):
Removing anaphylaxis from the registry breaks 6 tests in code paths the v3.1 plan deletes during Phase 3 (per plan §3 deletions list):
  - lib/completeness.test.ts (anaphylaxis arm) — lib/completeness.ts is deleted in P3.11
  - lib/router.test.ts (2 anaphylaxis tests) — lib/router.ts survives but ROUTING_TABLE no longer has anaphylaxis
  - prompts/turn1.test.ts, turn1.5.test.ts, turn2.test.ts (anaphylaxis assertions) — all three prompt files are deleted in P3.11
These will resolve cleanly when Phase 3 runs its `git rm` list. No fix needed in this lane.

DECISIONS DOCUMENTED:
  D-A: "unknown region → fallback NZ" in lane brief contradicts tools/types.ts Phase-1 type lock (`region_unknown` is a refusal kind). Type lock wins; load_guideline returns typed refusal on unknown region rather than silently falling back to NZ. Documented in tools/load_guideline.test.ts header.
  D-B: RCH and Starship guidelines bumped to review_period_months: 120 (10 years). Both publication dates already 2020; with the prior 72-month window, RCH would have gone stale on 2026-01-01 (a calendar boundary problem, not a clinical-policy one). Freshness check remains testable via vi.useFakeTimers (test uses 2031-01-01).
  D-C: nanoid() used inline for tool_call_id generation in load_guideline + get_reassessment_plan. Lane C's lib/tool-call-id.ts will become the central generator at fan-in; until then nanoid's default alphabet [A-Za-z0-9_-] length 21 sits inside the ^[a-zA-Z0-9_-]{8,32}$ contract.
