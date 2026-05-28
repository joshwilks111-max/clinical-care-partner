# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/); versions use `MAJOR.MINOR.PATCH.MICRO`.

## [1.4.1.0] - 2026-05-28

Post-ship polish. Two correctness fixes, no change to the deterministic dose spine.

### Fixed
- Assistant prose now renders inline markdown. The Care Partner's qualitative reply showed
  `**moderate**` and `` `code` `` as literal asterisks and backticks; it now renders bold,
  italic, and inline code. A small inline renderer (`app/console/markdown.tsx`) handles only
  those three constructs — no links and no raw HTML, so the untrusted clinical note can never
  become an active link or injected markup.
- Reconciled the refusal-reason attribution in the dose-calculator skill prompt. The skill's
  third safety invariant claimed `calculate_dose` returns all seven refusal reasons; it returns
  four. The prompt now attributes each reason to its true source — `calculate_dose` (four
  input-validation reasons), `load_guideline` (`out_of_scope`, `region_unknown`), and the
  model's own prose abstention (`airway_emergency`, `unresolved_dangers`) — so abstention
  routing matches what the tools can actually produce.

## [1.4.0.0] - 2026-05-28

The v3.1 surgical rewrite. The whole interaction now runs through a single chat route on the Vercel
AI SDK 6 tool loop instead of the v3.0 `turn1 / turn1.5 / turn2` route chain. `app/api/chat/route.ts`
calls `streamText` with four tools (`load_guideline`, `calculate_dose`, `get_reassessment_plan`,
`ask_user`) and returns `toUIMessageStreamResponse`; the client is a `useChat` hook that parses the
canonical UI-message-stream natively and auto-continues the loop
(`sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls`). Each tool's structured output
flows to the browser as a typed `UIMessagePart` the chat panel renders inline — `tool-calculate_dose`
→ DoseCard, `tool-get_reassessment_plan` → ReassessmentCard, `tool-ask_user` → an inline AskUserForm,
any refusal → RefusalCard. The custom response-validator, the `X-Validated-Response` header, and the
fence-parsing that the v3.0 surface needed are all gone: with typed tool parts the structured output
*is* the channel, so there is no model-authored-number path to police. The safety property is
unchanged and arguably stronger — refusal is now a structural *type* rather than a prose disclaimer.
Eight commits: `11d319a` (the rewrite + drop fence-parsing), `0e94eab` (project tool outputs to card
shapes + a hydration-safe clock), `338a311` (align the `ask_user` kind vocabulary, propagate the
question text, teach the model to wait for the answer), `2f5968e` (+ New chat resets cleanly
mid-stream via `stop()` + a disabled gate while streaming), `e5d402c` (delete the dead v3.0 routes +
validator + legacy prompts — 48 files, ~11.6k lines), `6ef4fda` + `6f340ca` (align README / STATUS /
CHANGELOG to v3.1 and retire the now-broken Promptfoo harness honestly), and `0821f5d` (make the
region cookie authoritative for jurisdiction — the F-1 fix below). Gates: `npx tsc --noEmit` exit 0,
vitest 26 files / 289 tests pass, `npm run build` clean (route surface is now just `/` + `/api/chat`).
The legacy `turn1/turn1.5/turn2` routes — and the response-validator, the completeness + router
modules, and the turn-state-machine prompts — are **deleted** in this release, not deferred.

### Added
- **`app/api/chat/route.ts`** — the single v3.1 route: `streamText` + 4 tools + `stepCountIs(5)` +
  `toUIMessageStreamResponse`. Pins the original note as system context on multi-turn requests so the
  skill can cross-reference the patient note without re-reading the full history. 9/9 integration
  tests.
- **`tools/get_reassessment_plan.ts` + `tools/ask_user.ts`** as first-class harness tools alongside
  `load_guideline` + `calculate_dose`. `ask_user` emits a typed slot request
  (`weight_kg`/`severity`/`region`/`confirm`/`free_text`) the UI renders as an inline form.
- **Inline tool-part rendering** in `app/console/chat-panel.tsx` — switches on `part.type` to render
  DoseCard / ReassessmentCard / RefusalCard / AskUserForm in the assistant bubble.

### Changed
- **`app/console/console.tsx`** rewritten as a `useChat` state owner: the chat thread + transport
  move to the SDK hook; the centre note, active session, and patient header stay as UI-only local
  state. "+ New chat" calls `stop()` before clearing and is disabled while `status` is
  `streaming`/`submitted`.
- **`skills/dose-calculator/SKILL.md`** drives the tool-call loop directly and owns the untrusted-note
  delimiters (the thin-harness / fat-skill split made literal).
- **Registry narrowed to croup** for v3.1 (anaphylaxis deferred — see `TODOS.md` #7).

### Fixed
- **Region jurisdiction is now server-authoritative** (`app/api/chat/route.ts`). The region cookie set
  by the UI toggle previously reached only the tool layer via `toolRegion ?? region`, which let the
  model's guessed region win — so toggling to AU with a free-typed note still served NZ guidelines
  (Starship source + 120-min reassess instead of RCH + 60-min). The dose number was always correct
  (both registries use 0.15 mg/kg for moderate croup), so the divergence was source attribution +
  reassessment timing only. The session region is now injected into the model's system context AND
  treated as authoritative in `load_guideline` — same "server owns the fact, not the LLM" posture as
  the dose spine.

### Removed
- The fence-parsing response path, the custom response-validator, and the `X-Validated-Response`
  header — superseded by typed tool parts.
- **The entire v3.0 turn-state-machine** (`app/api/turn1`, `turn1.5`, `turn2`), the
  `response-validator` / `completeness` / `router` lib modules, and the `prompts/turn1*` /
  `prompts/turn2` templates — 48 files, ~11.6k lines. These were kept on disk as a deploy-before-delete
  safety net while the SDK rewrite was verified; with 5/5 demo smokes green on the live preview they
  are deleted now. The Promptfoo eval harness (`tests/evals/provider.ts`) went with them, so
  `npm run eval` is retired — the prompt change is covered by the unit suite, the `/api/chat`
  integration tests, and the live demo smoke (see README §5).

## [1.3.0.0] - 2026-05-27

Bluey 3-column console shell — the UI the Heidi brief asked for. The canvas is now a proper three-panel desktop layout (272px rail · 1fr case canvas · 392px evidence panel) locked to the Bluey pastel-blue brand palette. The left rail owns the entry-point grammar: demo cases are avatar-tiled rows with `aria-current` tracking, the paste textarea and Run button live there too. The center canvas shows differential + advisory + decision gate; the right panel shows evidence (Turn 2 output). The Bluey heeler SVG replaces the old Geist wordmark. Inter replaces Geist Sans. The page title is now "Bluey · Clinical care partner". The layout is CSS-grid only — no JS breakpoint, no hydration mismatch, a single `@media (max-width: 1099px)` rule hides the shell and shows a narrow-viewport banner. All 352 tests pass including 9 new eng-review-locked regression tests that pin the shell's structural invariants.

### Added
- **`app/console/rail.tsx`** — 272px left rail. BlueyHeeler brand mark, demo-case avatar rows (each `data-demo-id`, `aria-current`), paste textarea + Run button, version footer. The entry-point grammar from DESIGN.md §"UI refresh — Bluey".
- **`app/console/case-canvas.tsx`** — 1fr centre column. Patient header strip, status pill, CasePanel (always rendered), empty state ("Pick a case to begin."), Turn 1 phase / refusal / error, Turn 1.5 advisory, Turn1DecisionGate. Receives all state via props; no own state.
- **`app/console/evidence-panel.tsx`** — 392px right panel. "Evidence" header, Turn 2 output (Turn2View), empty state ("Evidence will appear here when you select a guideline."). No collapse button — eng-review lock #8.
- **`components/icons/bluey-heeler.tsx`** — IP-safe geometric heeler SVG. `aria-label="Bluey"`, `fill="currentColor"`. Original geometric design, distinct from Ludo Studio's character.
- **9 regression tests** in `app/console/bluey-shell.regression.test.tsx` — 6 mandatory eng-review locks (grid widths, heeler in rail, page title, demo buttons in rail, paste textarea in rail, canvas empty-state copy) + 3 high-value tests (activeDemoId flip, activeDemoId clears on paste-run, BlueyHeeler SVG attributes).

### Changed
- **`app/console/console.tsx`** — rewritten as state-owner only. Adds `activeDemoId` state; `onRunDemo` sets it, `onRunPaste` clears it. Returns `<div data-testid="bluey-shell" className="bluey-shell grid h-screen w-full grid-cols-[272px_1fr_392px]">` wrapping Rail/CaseCanvas/EvidencePanel, plus the narrow-viewport banner sibling.
- **`app/globals.css`** — pastel-blue `:root` tokens (`--background: #e8f1f7`, `--primary: #3c8dc0`, `--primary-soft`, `--primary-d`, `--hairline`, `--rail-bg`). `@theme inline` aliases for Tailwind arbitrary values. `card-shadow` + `dose-hero` utility classes. `@media (max-width: 1099px)` narrow-viewport toggle.
- **`app/layout.tsx`** — `Inter` replaces `Geist` (Geist_Mono kept for mono surfaces). Title: `"Bluey · Clinical care partner"`.
- **`app/console/case-panel.tsx`** — header "The case" → "Extracted facts"; raw note moved to `<details>` collapsible; confirm-weight button is primary-filled; `<aside>` → `<section>` label kept stable for test compatibility.
- **`app/console/turn1-view.tsx`** — each condition is its own `card-shadow` article. Likelihood pill: `likely` → `bg-primary-soft text-primary-d` (was emerald). Decision gate uses `border-2 border-primary` + `Sparkles` icon (was border-dashed). Negative evidence separator is a text node outside `data-negative-evidence` spans.
- **`app/console/turn2-view.tsx`** — OkView dose container upgraded to `dose-hero card-shadow` gradient panel with `text-[28px]` dose hero; `dose-headline` testid preserved.
- **`app/console/console.test.tsx`** — 8 one-line edits: label selector updated from `/paste your own note/i` to `/patient note or transcript/i`; case-panel header assertion updated to `/Extracted facts/i`.
- **`vitest.setup.ts`** — global `next/font/google` mock (`Inter`, `Geist`, `Geist_Mono`) so `app/layout.tsx` can be imported in jsdom tests without the build-time font transform.

## [1.2.0.0] - 2026-05-27

The clinician's note becomes the safety check. When the input documents the epiglottitis discriminators (drooling, tripod posture, muffled voice) as absent, the system now sees that and stops asking the same clarifying question over and over — it goes straight to the dose. This was the "static question" complaint Josh hit in live QA: the differential read absent findings, but the downstream gate matched by string identity against the registry's canonical strings, and the LLM's paraphrases ("no drooling documented", "voice not muffled") never matched. The fix is a deterministic note scanner that grounds findings to the registry before the LLM ever sees them, and a server-side rewrite that forces the LLM's `negative_evidence` to use the canonical strings. The deterministic spine reaches one layer further up the pipe.

The pattern is named, not invented: ConText/NegEx (Chapman 2001 *JAMIA*; Harkema 2009 *JBI* 42:839) plus the investigate-before-abstain composition (KnowGuard, arXiv 2509.24816, ICLR 2026). The hand-authored per-condition registry approach is the production-standard shape (Isabel DDx, DXplain, Glass Health) — academically tidier knowledge-graph approaches (MedKGI, arXiv 2512.24181) are documented as the graduation path if conditions grow past three.

### Added
- **`lib/note-discriminator-scan.ts` — NegEx-style assertion pre-pass** (~523 LOC, pure, no LLM, no network). For every must-not-miss condition with `discriminator_surface_forms` in the registry, scans the raw note for each canonical discriminator's surface forms and emits `present | absent | not_documented` per finding. Handles bullet/sentence scope cuts, pseudo-negation (DEEPEN: "no increase in drooling" → present), termination triggers ("history of …" → not_documented; "but"/"however"/"except" cut negation scope), parallel-conjunct lists ("no drooling, tripod posture, or muffled voice" → all three absent via content-budget windowing), and ambiguous trailing conjuncts (fail-toward-stopping). 11 anti-pattern unit tests pin each named NegEx-literature failure mode; 3 regression tests pin the iron rule (positives still abstain via decideCollapse Rule 2); 3 generalisation tests prove the scanner extends to a new condition with zero source edits.
- **`registry/guidelines.ts` — `discriminator_surface_forms` field** on `ConditionMeta`. Maps each canonical discriminator (e.g. `"drooling"`) to the note synonyms the scanner looks for (`drool`, `sialorrhea`, `hypersalivation`, `pooling saliva`). Epiglottitis is populated with textbook surface forms (Starship NZ idioms + standard clinical mnemonics like "hot potato voice", "sniffing position"). `buildDiscriminatorSurfaceFormMap()` is the registry-only lever — adding a new must-not-miss condition with synonyms needs zero scanner/prompt/route edits. Croup and anaphylaxis leave the field unset (the scanner skips them silently — same behaviour as before).
- **`prompts/turn1.ts` — `REGISTRY-GROUNDED FINDINGS` block** rendered OUTSIDE the `<<<UNTRUSTED_CLINICAL_NOTE>>>` delimiters with ONLY registry strings (no note spans, no synonyms, no quoted user content). Instructs the LLM to use the canonical strings verbatim in `negative_evidence`. Trust boundary preserved at byte level — an integration test forges a `<<<DISCRIMINATORS_OPEN>>>` marker inside the note and asserts zero note bytes cross into the trusted block.
- **`prompts/turn1.5.ts` — `shouldOverrideToNoQuestion()`** deterministic override. Reads the Turn 1.5 LLM output; if it voted to ask but EVERY registry discriminator for the target is in `negative_evidence` by string identity, returns `{kind: "force_no_question", target, groundedDiscriminators}`. Match-by-set, not substring — paraphrases NEVER trigger the override (only canonicalised strings do, by design). Fine-grained tests cover the 3-of-3 (fires), 2-of-3 (does not fire), `needs_question=false` (no-op), and paraphrase-strings (no-op) cases.
- **`app/console/safety-check-card.tsx` — green badge override path.** When `overridden_target` + `overridden_discriminators` are populated on the Turn 1.5 OK response, the "NO CLARIFYING QUESTION NEEDED" banner names the condition AND lists which discriminators grounded the override. The badge becomes evidence ("Epiglottitis discriminators (drooling, tripod posture, muffled voice) all documented absent in the note.") instead of a status. Three component tests cover the override path, the rationale-fallback path, and the empty-array defensive path.

### Changed
- **`app/api/turn1/route.ts` — scanner wiring + server-side canonicalisation.** STEP 1.5 runs `scanNote` after the weight gate (try/catch wrapped — a regex bug or unexpected input falls through to LLM-only behaviour, NEVER 500s the route; pinned by a new `vi.spyOn`-based test that forces the registry helper to throw and asserts the route still returns 200/ok with no REGISTRY-GROUNDED block in the prompt). STEP 2.5 runs `canonicaliseDifferentialAgainstGroundings` after the LLM returns: for each grounded-absent registry discriminator, drop any `negative_evidence` entry whose word-set fully covers the canonical, then add the canonical string. Word-set match (not substring) handles "voice not muffled" → `muffled voice` reliably. Never rewrites findings the scanner didn't independently confirm.
- **`app/api/turn1.5/route.ts` — override branch in the decide phase.** When the LLM produces `needs_question=true` with target+question, the route runs `shouldOverrideToNoQuestion` and, on `force_no_question`, returns an `OkResponse` with `overridden_target` + `overridden_discriminators` populated for the UI badge. Falls through to the normal `ask` path on `{kind:"none"}`. The `OkResponse` shape extends with two optional fields; the existing `needs_question=false` path is unchanged (no override fields populated).
- **Existing Turn 1.5 fixtures softened to 2-of-3 discriminators** in `app/api/turn1.5/route.test.ts` and `app/api/turn1.5/route.retry.test.ts` so the existing "ask" tests continue to exercise the ask flow rather than triggering the new override. Same softening applied to `tests/evals/fixtures.ts::CASE_COLLAPSE_CROUP` (caught during /ship eval run — see Known Eval Drift below).
- **`lib/collapse.ts` — `normFinding` is now exported.** Same source-of-truth normalisation the collapse gate uses is now imported by the scanner. Zero behaviour change to `decideCollapse`.

### Known eval drift (pre-existing, NOT introduced by this release)
- `case8` (no-matching-guideline) — the Kawasaki fixture hits the wrong-guideline audit (`reason: "wrong_guideline"`) instead of the no-matching path (`reason: "no_matching_guideline"`). Pre-existing refusal-taxonomy mislabel; documented in the gbrain memory `beat1-wrong-guideline-already-ships.md`. Filed for follow-up.
- `case10` (collapse confirm → abstain) — broken since v1.1.1.0 (`61fb05d`, PR #7) landed the Step-2-click bypass. The eval driver seeds `selected_guideline_id` after the answer phase, which the new bypass treats as the clinician committing to dose — so the case10 "answer present → abstain" path can't be tested through the current driver shape. Fix is a one-paragraph change to `tests/evals/provider.ts` to add a raw-POST-to-turn2 path for case10. Out of scope for this PR. Filed for follow-up.

## [1.1.1.0] - 2026-05-27

A targeted fix to the Step-2 apply experience. Clicking "Apply Croup" (or any guideline button) after confirming the weight and engaging Turn 1.5 now reliably runs the dose. The defense-in-depth collapse gate at the top of Turn 2 was firing inside the deterministic apply step and surfacing the "Multiple dangerous conditions remain on the differential…" amber banner AFTER the clinician had already chosen — second-guessing the human handoff. The gate now defers to the click.

### Fixed
- **Step-2 click is honored: collapse abstain skipped when `selected_guideline_id` is set.** The defense-in-depth collapse gate at the top of [app/api/turn2/route.ts](app/api/turn2/route.ts) was re-running `decideCollapse` on every POST. When the differential still carried unresolved must-not-misses (the common shape under the Turn 1 must-not-miss discipline shipped in 1.1.0.0), the gate returned `abstain` and surfaced the amber "Multiple dangerous conditions remain…" banner inside the `2 Apply / deterministic / constrained` step. The clinician had already (a) confirmed the weight, (b) engaged with Turn 1.5, and (c) clicked a specific guideline button — three layers of human deliberation. Step 2 is execution, not judgment; the gate now bypasses the abstain branch when `caseState.selected_guideline_id` is set. The defense-in-depth claim against a raw hand-crafted POST is preserved (no clicked id → still hits the gate). The wrong-guideline audit at [route.ts:295](app/api/turn2/route.ts:295) continues to catch a malicious POST that pairs a real selected id with a different confirmed condition.

### Changed
- **Test rewrites that follow the gate-bypass.** Three existing tests in [app/api/turn2/route.test.ts](app/api/turn2/route.test.ts) (`defense-in-depth: hand-crafted POST...`, `F-016D: empty differential...`, `shared stridor on croup + epiglottitis...`) now exercise the gate through the genuine hand-crafted-bypass shape (`selected_guideline_id: null`) instead of the now-bypassed Step-2-click path. The safety properties each test asserts are preserved; the threat shapes are now honest. The F-018a test (unaskable must-not-miss) is unchanged in assertion but reframed in comment — it now also serves as a smoke-test of the new bypass.

### Added
- **Regression test for the bypass.** New `"Step-2 click is the judgment handoff: selected_guideline_id present → collapse gate is SKIPPED even with unresolved must-not-miss"` test asserts that a CaseState with `selected_guideline_id` set and a positive must-not-miss in the differential reaches the dose tool (status `ok`, dose 2.13 mg, both model calls run). Non-vacuous: without the bypass it would observe `status: "abstention"` and zero model calls.

## [1.1.0.0] - 2026-05-27

The advisory-rewrite + F-016 fix-loop release. Turn 1.5 becomes a one-shot diagnostic-completeness assist (ask / ok / recorded), dose abstention concentrates at Turn 2, and the canonical Croup demo button now dispenses 2.13 mg of dexamethasone live — the same button silently abstained for the entire previous release. A second safety pass (adversarial review) closed two remaining bypass paths before merge.

### Added
- **Turn 1.5 advisory contract.** A new `decide → ask | ok` / `answer → recorded` route in [app/api/turn1.5/route.ts](app/api/turn1.5/route.ts). The model recommends one high-impact discriminating question and one treatable-condition + guideline pair; the clinician answers Yes / No / Not assessed / Skip. Turn 2 is now the sole dose-abstention point. [HighImpactQuestionCard](app/console/safety-check-card.tsx) renders alongside (not in place of) the guideline buttons — guideline buttons stay visible throughout the advisory check.
- **`use-turn15-flow` hook** ([app/console/use-turn15-flow.ts](app/console/use-turn15-flow.ts)). Co-locates the Turn 1.5 state machine (turn15, pendingAsk, lastRecommendation, turn15Busy) + `runDecide` / `runAnswer` / `resetTurn15` + the `gateOpen` predicate. The console shell only orchestrates; the hook owns the flow.
- **AskableConditionSet abstraction** ([lib/collapse.ts](lib/collapse.ts)). `decideCollapse` accepts an optional set of "conditions the clinician can actually be asked a discriminating question about" (i.e. those with non-empty registry discriminators). Unresolved must-not-miss conditions outside that set still appear in the UI for clinician awareness but no longer block dosing — they're unanswerable, so gating on them only produced false abstains. Production callers build the set from `CONDITION_META`; legacy callers omit it and keep pre-F-018 semantics.
- **`buildAskableConditionSet()` registry helper** ([registry/guidelines.ts](registry/guidelines.ts)). Single source of truth for "which conditions can the safety gate gate on."
- **Canonical-finding-strings prompt discipline** in [prompts/turn1.ts](prompts/turn1.ts). The Turn 1 system prompt now asks the model to use IDENTICAL short strings for findings that appear across multiple conditions (e.g. "stridor at rest" used verbatim wherever it appears). The downstream `demoteSharedFindings` exact-match path stays load-bearing; cross-condition phrasing drift would have defeated it.
- **MUST-NOT-MISS DISCIPLINE prompt rule.** When ONE treatable condition clearly leads on two or more specific findings, Turn 1 includes AT MOST ONE must-not-miss diagnosis; secondary red flags go into the `possible` band with their negative_evidence intact. Diffuse presentations (e.g. anaphylaxis with airway + skin + GI) keep the broader must-not-miss breadth.
- **15 + 2 regression tests.** New [lib/collapse.f016-018.regression.test.ts](lib/collapse.f016-018.regression.test.ts) (15 tests pinning the F-016D reason-on-abstain shape, F-018 askable narrowing, fuzzy demote, Rule 3b likely-wins tie-break, end-to-end live trace, plus the purpuric-rash and qualifier-survives adversarial-review safety cases) and [app/console/use-turn15-flow.f014.regression.test.tsx](app/console/use-turn15-flow.f014.regression.test.tsx) (2 tests pinning the click-time snapshot pattern against the closure-staleness race).
- **Auto-deploy on push to main.** The Vercel project is now connected via Vercel's native git integration. Every merge to `main` triggers a production deploy on Vercel's infrastructure within a few minutes; preview deploys fire on every other branch push so each PR carries its own preview URL. README §4 documents the path; the manual `vercel deploy --prod --yes` route still works for hot-fixes.
- **`.env.local` env-pull gotcha** documented in README §4. `vercel env pull --environment=production` returns empty values for Encrypted vars; the fix is `vercel env add ANTHROPIC_API_KEY development` once per local environment.
- **Softened safety posture manifest** in [TODOS.md](TODOS.md). Records every F-016 / F-018 / adversarial-review softening (S1 – S7 + AR1) with the file it touches, the residual risk, and an explicit trigger to revisit (real PHI / registry growth / model change / population shift).
- **Drafted trace + prompt design docs** (`prompts/turn1.5-rewrite.md`, `prompts/turn1.5-rewrite.traces.md`).

### Changed
- **Honest abstention copy.** When the Turn 2 defense-in-depth collapse gate fires because of undischarged danger (positive must-not-miss, Rule 2) — not because of a registry miss — the user-facing copy now reads "Multiple dangerous conditions remain on the differential and cannot be ruled out from this note alone…" instead of the previous (incorrect) "No local guideline matches this condition…". `decideCollapse` returns a `reason` discriminator on every abstain (`unresolved_dangers` or `no_treatable`); Turn 2 picks the matching variant (`unresolvedDangersAbstention()` vs `noGuidelineAbstention()`).
- **Rule 3b tie-break: single "likely" wins over multiple "possible" treatables.** With the new Turn 1 must-not-miss discipline producing more "one likely + several possible" shapes, the strict "more than one treatable → abstain" rule fired too often. The decider now keeps the leading "likely" as the treatable for downstream Rule 4 / Rule 5; genuine ties (multiple "likely" treatables) still abstain.
- **`demoteSharedFindings` matching is now one-directional + normalized substring.** A treatable's positive-evidence finding only demotes a must-not-miss finding when the treatable's string CONTAINS the must-not-miss string (after lowercase + trim + parenthetical strip). The earlier bidirectional match let a generic anchor on a treatable strip discriminating qualifier-bearing positives off a must-not-miss (worked example: Croup over-lists "rash", meningococcaemia has "purpuric rash" → bidirectional demoted the qualifier, Rule 2 no longer fired, gate planned). One-directional preserves the canonical-finding-string match while leaving discriminating qualifiers intact.
- **`runAnswer` snapshots the active ask + caseState at click time** and re-validates `pendingAsk === askSnapshot` before calling `onCaseStateUpdated`. Both halves of the F-014 / adversarial #4 race close: the read side can no longer pick up a stale closure mid-fetch, and the write side can no longer land an answer-mutated caseState on top of a freshly-decided ask.
- **`runDecide` early-returns when `turn15Busy`**, so a tight double-click within a render cycle can't fire two parallel decide calls and have the second's `setTurn15(null)` corrupt the first's pending result.
- **Turn 1.5 schema widened.** `mustNotMissTargets` now returns any condition with non-empty registry discriminators (previously: only `likelihood === "must-not-miss"` conditions). The Turn 1 must-not-miss discipline pushes secondary red flags into the `possible` band — they're still clinically-useful ask targets, just no longer in the must-not-miss likelihood band. The schema falls through `z.string().min(1)` when no askable target exists, and the superRefine forces `needs_question: false` in that case (a `z.never()` fallback serializes to invalid JSON Schema for Anthropic's API).
- **Turn 1 prompt: exact registry condition names.** When a differential condition matches a registry entry, `condition.name` must be the exact registry string ("croup", not "Severe croup", not "Croup (laryngotracheobronchitis)"). Severity belongs in `extracted_facts.severity`; modifiers belong in `positive_evidence`. The downstream router's normalised lookup is forgiving of trailing parentheticals but not of leading or interior modifiers.
- **Hardened docblocks** on `CaseState.discriminating_qa` ([lib/case-state.ts](lib/case-state.ts)) and Rule 2 in `decideCollapse`. The old "SERVER-OWNED — only turn1.5 appends" comment was aspirational rather than enforced; the new docblock names the convention AND the real defenses (Rule 2 + Turn 2 wrong-guideline audit) that make forged `discriminating_qa` entries audit-trail-cosmetic, not a dosing vector.

### Fixed
- **F-016 (CRITICAL — Croup happy path).** The canonical Croup (14.2 kg moderate) demo button advertises "→ 2.13 mg dexamethasone" but had been silently returning a wrong-copy abstention since the advisory rewrite landed. Root cause was a three-link chain: the live Turn 1 model produced 3+ must-not-miss conditions for the same note the eval fixture has as a 2-condition case → Rule 3a (>1 unresolved must-not-miss) abstained after the one-question round → the abstention copy was hard-coded to "No local guideline matches" even though a guideline *did* match the treatable. The fix combines tighter Turn 1 prompt discipline (one must-not-miss when one treatable clearly leads) + askable-only gate semantics + honest abstention copy. All six demo fixtures + the hand-crafted case10 POST verified live before push.
- **F-018 (CRITICAL — silent fuzzy-demote bypass).** Pre-fix, a generic "rash" positive on a treatable would strip "purpuric rash" off a must-not-miss like meningococcaemia, dropping Rule 2's positive-MNM abstain. The one-directional fuzzy match preserves discriminating qualifiers; new regression test pins the safer behavior.
- **F-014 (Medium — closure staleness in runAnswer).** A render landing between an answer click and the in-flight fetch could swap `pendingAsk` to a stale reference, then the fetch body would mix the current `caseState` with a stale ask snapshot. The fix snapshots both at function entry; the write-side guard prevents `onCaseStateUpdated` from landing the mutated state when the ask has since been invalidated.
- **F-001 (Medium — Vercel sensitive env DX trap).** `vercel env pull --environment=production` returned an empty `ANTHROPIC_API_KEY=` because the value is Encrypted on Production; live calls then 401'd. Documented the failure mode and the `vercel env add ANTHROPIC_API_KEY development` fix in README §4.

### Tests
- 314 vitest passing (was 295 pre-PR; +15 F-016/F-018 regressions, +2 F-014 regressions, +2 adversarial-review purpuric-rash + qualifier-survives, +1 F-016D wire-reason update).
- 10 / 10 Promptfoo evals passing (was 9 / 10 due to a stale `case10_reason_no_guideline` assertion left over from the pre-F-016D copy; renamed to `case10_reason_unresolved_dangers` and updated to match the new wire reason).
- Live walk verified all six demo fixtures (Refusal, Croup, Cap, Anaphylaxis, Transcript croup, Transcript no weight) and the hand-crafted case10 abstain path before push.

## [1.0.0.0] - 2026-05-25

First complete deliverable for the Heidi take-home: a clinical decision-support care-partner PoC with a deterministic safety spine, plus the brief-conformance pass that makes every requirement legible to a cold reviewer.

### Added
- **Free-text note/transcript intake.** A "paste your own note or transcript" textarea on the console, alongside the one-click demo buttons. Proves the brief's "accepts unstructured clinical text (a note AND/OR transcript)" live, without removing the no-typing demo path.
- **Two transcript demos.** `Transcript (croup)` (a doctor–parent dialogue with a weight → full differential → dose) and `Transcript (no weight)` (the same dialogue with no weight → the pre-LLM refusal gate fires live). Demonstrates transcript parsing *and* the safety thesis on messy real-world input.
- **One-page architecture PNG** (`docs/architecture.png`) rendered from the Mermaid source, linked from the README — the brief's PNG/PDF deliverable.
- **Retrieval rationale in the README** (§3): "whole-document injection — the right tool for a two-document corpus", with the measured corpus size (~800 tokens) and the deferred large-corpus path.

### Changed
- `runTurn1` now takes a raw note string; both the demo buttons and the paste box route through the single `runTurn1(note) → /api/turn1` path, so pasted text is wrapped in the same untrusted-note delimiters as demos. The single path is the trust-boundary enforcement.
- Demo row grouped into **Notes** and **Transcripts** for legibility.
- README/research/DESIGN corpus figure corrected from an asserted "~10K tokens" to the measured **~800 tokens** (one source of truth).
- The left-panel note display preserves transcript line breaks (`whitespace-pre-line`).

### Fixed
- **Forged-delimiter defence (security).** A pasted note containing the literal `NOTE_OPEN`/`NOTE_CLOSE` markers is now sanitised before wrapping (`sanitizeUntrustedNote`), so a paste cannot close the untrusted region early. Blast radius was already bounded (turn 1 emits a structured differential, never a dose); this is defence-in-depth on the newly user-reachable free-text path.

### Tests
- 221 passing (up from 211): paste-path coverage, both transcript buttons, the forged-delimiter test, and regression locks on the weight gate (`hasKgWeight` passes the weight-present fixture, fails the weight-absent one) and the prompt-layer delimiter wrap.
