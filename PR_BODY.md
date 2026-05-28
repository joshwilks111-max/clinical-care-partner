# v3.1 — thin harness, fat skill

Heidi take-home, rewrite pass. Replaces the v1.0 prompt-pipeline (turn 1 → turn 1.5 → turn 2) with a single `streamText` chat route, a deterministic dose-tool boundary, and an SDK-loaded skill workspace. The new shape is one chat surface, four tools, one validator — and the safety spine is the same property the prior version had: the LLM never authors a number.

## What's in the diff

42 files changed, +6976 / −1060 since the v3.1 foundation commit (Phase 1). Of that, 37 files are TS/TSX (new tools, new validator, new UI components, integration tests) and 4 are markdown (DESIGN, architecture, papers, iteration-trace). One CSS file carries the Heidi-grammar design tokens.

The work landed in 5 parallel lanes — see [docs/iteration-trace/v3.1.md](docs/iteration-trace/v3.1.md) for the per-lane plan-and-build trace. Bisectable per-lane via `git log --grep "lane [BCDFE]"`.

| Lane | What it owns | Test count |
|---|---|---|
| **B** — registry + tools | `registry/guidelines.ts` extension (region + reassessment_plans + differential_check + precise severity descriptions; AU RCH Melbourne 2020 added; anaphylaxis removed); 3 new tools (`load_guideline`, `get_reassessment_plan`, `ask_user`) | 69 new |
| **C** — validator + lib | `lib/response-validator.ts` (walks `event.steps[].toolResults` per SDK 6); `lib/skill-loader.ts`; `lib/region.ts`; `lib/tool-call-id.ts` | 26 new |
| **D** — skill sync | `skills/dose-calculator/` workspace refresh + `contract.test.ts` (5 structural canaries + 17 per-case + 5 schema-invariant) | 27 new |
| **F** — UI | Heidi-grammar 3-column shell — `chat-panel.tsx`, `dose-card.tsx`, `reassessment-card.tsx`, `refusal-card.tsx`, `ask-user-form.tsx`, `region-toggle.tsx`, `session-rail.tsx`, `note-pane.tsx` | (counted in app/console suite) |
| **E-prep** — docs | DESIGN.md rewrite (14 beats), docs/architecture.md (3-layer mermaid + 4 refusal layers + trust boundary), iteration-trace v3.1 | n/a |
| **Phase 3** — fan-in | `app/api/chat/route.ts` (streamText loop), integration tests (7 mocked-LLM cases), `app/console/console.tsx` wiring | 7 new |

## The architectural change in one paragraph

The v1.0 architecture used three sequential prompt phases (`turn1` extracted, `turn1.5` collapsed to a single guideline, `turn2` planned). Each phase was a separate API route, each had its own validator, and the seams between phases carried risk — collapse logic running client-side, refusal-gate placement deciding behaviour rather than retrieval, prompt drift between routes. v3.1 collapses that into one `streamText` call with four typed tools registered. The model picks tools by ID; the tools own all clinical numbers and citations. The seam between "judgement" and "execution" is the tool boundary — literal, mechanical, type-checked.

## Why this shape

Three decisions worth surfacing to the reviewer:

1. **Tool boundary, not prompt chain.** The model picks `dose_rule_id` by reading the loaded guideline; the `calculate_dose` tool — a TS function, not an SDK tool route — looks the rule up itself from the committed registry and does all math. This means the model can be lied to about what a rule says (via an injected note); it cannot lie about what `calculate_dose` returns. The safety property is structural, not prompt-engineered.
2. **Skill workspace, not prose embedded in the route.** The skill (`skills/dose-calculator/`) is a refreshable package with its own SKILL.md, evals/cases.jsonl, and Zod emit-schemas. The harness re-exports those schemas via `tools/types.ts` so the same `.strict()` Zod object validates what the model emits AND what the cards render. Single source of truth across the air-gap.
3. **Split refusal surface.** `load_guideline` owns `out_of_scope` + `region_unknown` (retrieval). `calculate_dose` owns `weight_missing | implausible_weight | invalid_dose_rule_id | rule_not_verified` (guards). The skill owns `unresolved_dangers` (direct prose abstention when the differential is too wide). `get_reassessment_plan` owns its own 6-value union including the legitimate-not-error case `no_reassessment_required`. Each refusal answers a different question — clinical honesty over uniform shape.

## How the safety properties hold

Two layers (laid out in DESIGN.md §3):

- **Primary — deterministic tool boundary.** `tools/calculate_dose.ts` is a pure TS function. The LLM cannot author a number into it: the schema accepts only `(guideline_id, dose_rule_id, weight_kg)`. The tool reads `mg_per_kg`, caps, rounding, drug, route from the registry; it does the math; it returns a refusal or a result. The property holds with or without the validator.
- **Secondary — JSON-block validator (defense-in-depth).** The model emits a `\`\`\`dose-card` fenced JSON block keyed by `tool_call_id`. `lib/response-validator.ts` walks `event.steps[].toolResults`, finds the matching `calculate_dose` call by id, and merges the tool result into the card. `.strict()` Zod rejects any extra key — including any numeric the model tries to slip in.

The two layers fail independently. If the validator is bypassed entirely, the dose number on screen is still whatever `calculate_dose` returned, not whatever the model wrote.

## Region handling (NZ + AU)

Two-region support per D5. Default NZ (Starship Children's Hospital 2020). AU uses Royal Children's Hospital Melbourne 2020 — the Melbourne-fit citation. Region is cookie-driven (`care-partner-region`), toggleable in the UI, propagates through `load_guideline(condition, region)`. Lane B's registry regression test asserts both regions return the documented guideline shape.

## What's tested

- **Skill contract**: `skills/dose-calculator/contract.test.ts` — 27 tests. 5 structural canaries (no clinical numbers in SKILL.md, etc.), 17 per-case eval rows from `evals/cases.jsonl`, 5 schema-invariant checks on each row's declared shape.
- **Registry + tools**: 99 tests across `registry/guidelines.regression.test.ts` (40), `tools/load_guideline.test.ts` (11), `tools/get_reassessment_plan.test.ts` (11), `tools/ask_user.test.ts` (7), plus the existing `tools/calculate_dose.test.ts` (30, two of which Lane B refactored to a stubRule pattern after the anaphylaxis removal).
- **Lib (validator + helpers)**: 26 tests across `lib/response-validator.test.ts` (15), `lib/skill-loader.test.ts` (3), `lib/region.test.ts` (5), `lib/tool-call-id.test.ts` (3).
- **UI**: app/console suite — 16 files, 93 tests, includes pre-existing console plus all 8 new Lane F components.
- **Route integration**: `app/api/chat/route.test.ts` — 7 tests with mocked LLM. Jack T NZ happy path → both cards present; Jack T AU happy path → different dose + different reassess window; missing weight → ask_user fires; epiglottitis → `unresolved_dangers` direct refusal (no calculate_dose in trace); asthma → `out_of_scope`; multi-turn `originalNote` pinning; region toggle changes dose.

Total: 44 files / 430 tests pass on the trunk after fan-in.

## What's deferred (transitional state in this PR)

This PR uses the **deploy-before-delete** pattern from `/plan-ceo-review`: the new code ships alongside the legacy v1.0 routes, the preview deploy is smoked end-to-end against the live Vercel runtime, and **only then** does a separate commit `git rm` the ~22 legacy files (`app/api/turn{1,1.5,2}/`, `prompts/turn{1,1.5,2}.ts`, `lib/{collapse,case-state,completeness,refusal-gate,plan-schema,note-discriminator-scan,router}.ts`, the old console views). A failed preview would otherwise leave the branch with no working surface.

Until that delete commit lands, `vitest.config.ts` carries 5 transitional `exclude` entries (`lib/{completeness,router}.test.ts`, `prompts/turn{1,1.5,2}.test.ts`) — the legacy tests are anaphylaxis-aware and break against Lane B's clean registry. The exclude is documented inline with the planned removal date. Drop the excludes in the same commit that deletes the legacy code.

## Smoke results

(To be filled by the preview deploy step.)

- Manual 5-case smoke on Vercel preview: …
- Scripted curl smoke (3 cases against `$PREVIEW_URL/api/chat`):
  - Jack T NZ → `dose_card.dose_mg === 2.13` and `drug === "dexamethasone"` — …
  - Mia epiglottitis → `refusal.kind === "unresolved_dangers"` — …
  - Asthma 5yo → `refusal.kind === "out_of_scope"` — …

## How to review

1. Read [DESIGN.md](DESIGN.md) for the 14-beat architecture narrative.
2. Read [docs/architecture.md](docs/architecture.md) for the 3-layer mermaid + 4 refusal layers + trust boundary diagram.
3. Skim [docs/iteration-trace/v3.1.md](docs/iteration-trace/v3.1.md) for the build-process trace (4 plan-review passes + 4 cleanup passes + Sen et al verification).
4. The 5 lane commits are bisectable by `git log --grep "v3.1 lane"`. The fan-in housekeeping commits (`chore(v3.1 fan-in)`) are the operator's adjustments — transitional excludes, PROGRESS.md cleanup.
5. **Don't merge until the delete-phase commit lands and the second preview smoke passes.** Until then the legacy pipeline is still in tree and tests are partially excluded.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
