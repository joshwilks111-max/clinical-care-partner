# TODOS — Heidi Take-Home (deliberately deferred, with build triggers)

Each is real and named on purpose — the deferred list IS the senior signal for a 4-day take-home.
Blast radius = a take-home demo, not a deployed clinical system. None is in v1 scope.

## Delivered (formerly deferred — shipped on this branch)

| # | Delivered item | Status |
|---|---|---|
| 1 | **Wrong-guideline auto-abstain guard** | **DONE** — both halves: the audit (routed `guideline_id` matches confirmed condition) AND the auto-abstain behaviour, with a distinct `wrong_guideline` reason (separate from `no_matching_guideline`). |
| 4 | **Differential-collapse loop** (ambiguous note → discriminating question → narrow dx) | **DONE (advisory rewrite)** — Turn 1.5 is diagnostic-completeness assist (`ask`/`ok`/`recorded`/`error`; no Turn 1.5 abstention). Model recommends one high-impact question + treatable guideline pair; `applyAnswer` still flips evidence on answer/skip. Turn 2 alone abstains when must-not-miss persists (`collapseRoundForGate`). Eval case9 (rule-out→dose 2.13) + case10 (must-not-miss confirmed→Turn 2 abstain). `decideCollapse` retained in `lib/collapse.ts` for Turn 2 defense-in-depth only. |

## Still deferred (with build triggers)

| # | Deferred item | Trigger to build | Effort (human/CC) | Priority |
|---|---|---|---|---|
| 2 | **Model-tier routing** (big model judgment / light model execution) | Real traffic + a cost signal | M / S | P3 |
| 3 | **Deterministic severity mapping** (encode severity criteria as typed rules) | Regulatory hardening / scale beyond demo | L / M | P2 (next-sharpest beat) |
| 5 | **LLM-as-judge eval (Layer 2)** clinically-framed applicability rubric | When faithfulness's blind spot needs measuring | M / S | P3 (hook left in tests/evals/; never gating) |
| 6 | **Live-consult transcription + multi-round real-time collapse** (the multi-round version of the one-round collapse loop shipped in #4) | The 6-month product, not a 4-day build | XL / L | P3 |
| 7 | **3rd guideline / non-dose skill** (e.g. interaction-check) | Proving the registry beyond dose calculators | S / S | P3 (registry proven; data-entry work) |
| 8 | **Scale retrieval** (live guideline service / data partnership / agentic retrieval over a large medical knowledge space; cf. KnowGuard's systematic knowledge-graph exploration, arXiv:2509.24816) | Corpus outgrows the context window | L / M | P3 |
| 9 | **Production privacy** (on-prem / no-PHI; GDPR/HIPAA) | Real patient data instead of synthetic notes | L / M | P3 (noted as a limitation) |
| 10 | **Mild "watch / observe" croup arm** (no-steroid management) — every croup path currently routes to a dose; the mild arm is observation/discharge with no drug. Needs a *disposition-only* plan shape (`drug`/`dose` nullable) + a completeness-gate exception for the observation arm. | Adding a non-dosing management arm to any guideline | M / S | P2 (clinician-flagged) |

## Softened safety posture (calibration debt — F-016/F-018, 2026-05-27)

Live QA found the canonical Croup demo button (`Croup (14.2 kg moderate) → 2.13 mg`)
returning a wrong-copy abstention instead of dosing. Root cause: the eval
fixture was a hand-crafted 2-condition differential, but the live Turn 1 model
returned 3+ must-not-miss conditions for the same note (defensible breadth),
and the gate's "any unresolved must-not-miss → abstain" posture forced an
abstain on cases that should dose.

Choice made: **A+D path** — tighten Turn 1's must-not-miss output, soften the
gate's must-not-miss interpretation, ship the dose paths. The alternative
(harden the gate, keep broad must-not-miss output) was a longer build.

| # | Softening | File | Why | Risk | Trigger to revisit |
|---|---|---|---|---|---|
| S1 | Turn 1 prompt: "at most one must-not-miss when one treatable clearly leads on ≥2 specific findings" — secondary red flags go under `possible` instead. | `prompts/turn1.ts` MUST-NOT-MISS DISCIPLINE section | Limits must-not-miss overproduction that the one-round Turn 1.5 ask can't disambiguate. | Model could under-flag a genuine red flag if it misclassifies the leader. Mitigated by the explicit "diffuse picture → keep breadth" carve-out and the in-prompt examples. | Add a 2nd-round Turn 1.5 ask; or replace must-not-miss with a per-finding red-flag schema. |
| S2 | Turn 1 prompt: "use exact registry condition name" — no "Severe croup" / "Croup (laryngotracheobronchitis)" / "Anaphylaxis with airway involvement". | `prompts/turn1.ts` CONDITION NAMING section | The router/collapse lookup is case+parenthetical-stripped but not adjective-stripped — prefix descriptors silently failed to route. | Model could use a registry-canonical name where the descriptor mattered clinically. The descriptor still lands in evidence/severity per the prompt. | Add server-side fuzzy registry resolution (token-set match against registry conditions). |
| S3 | Turn 1 prompt: "canonical finding strings — same words across conditions" — e.g. "stridor at rest" identically on every condition that supports it. | `prompts/turn1.ts` FINDING-STRING DISCIPLINE section | The `demoteSharedFindings` exact-set match needs identical strings to recognise shared findings; cross-condition phrasing drift defeats it. | Loses some nuance (per-condition qualifiers like "in a toddler"). Worth it: the demote is load-bearing. | Token-set match in `demoteSharedFindings` instead. |
| S4 | `decideCollapse` accepts an optional `askable` set of normalized condition keys with registry discriminators. Unresolved must-not-miss conditions NOT in that set are excluded from the rules — they appear in the UI but don't block dosing. Default (askable=undefined) preserves legacy behaviour for existing tests. | `lib/collapse.ts` decideCollapse + AskableConditionSet | An unresolved must-not-miss with no registry discriminators is unanswerable; gating on it forces abstain that the system cannot resolve. | If a future must-not-miss SHOULD block but doesn't have discriminators registered yet, it'd be silently let through. Mitigated by: positive must-not-miss (Rule 2) still abstains; the clinician sees the condition in the differential and decides. | Add discriminators to every clinically-real must-not-miss in `registry/guidelines.ts`. |
| S5 | `demoteSharedFindings` uses normalized substring containment (`findingShared`) instead of exact set membership. Catches "stridor at rest" ⊂ "stridor at rest in a toddler". | `lib/collapse.ts` demoteSharedFindings + normFinding + findingShared | Cross-condition phrasing drift (even with S3) defeats exact match. | False demotes ("rash" ⊂ "purpuric rash"). Mitigated: benign-anchor filter (only treatable conditions contribute), and the audit trail records the demote with a `[shared / non-discriminating]:` prefix. | Token-set match (intersection-of-words) instead of substring. |
| S6 | `decideCollapse` Rule 3b: when multiple treatables match the map, prefer a single `likely` over `possible` alternatives (the Turn 1 prompt commonly produces "one likely + possible alternatives" now). Genuine ties (multiple `likely`) still abstain. | `lib/collapse.ts` decideCollapse Rule 3b | Without this, the new prompt's "leading treatable + possible alternatives" shape triggered no_treatable abstain even when one diagnosis was clearly leading. | Could pick wrong if the model mis-labels the leader. Mitigated: the clinician's selected_guideline_id is the source of truth at Turn 2; the collapse decision is only the *gate*, not the routing. | Require ≥2 specific positive findings on the "likely" before preferring it. |
| S7 | Turn 1.5 schema: `mustNotMissTargets` now returns ANY condition with registry discriminators (was: must-not-miss only). Reflects the prompt change (secondary red flags now sit at `possible`). | `prompts/turn1.5.ts` mustNotMissTargets + validateTurn15Output | Without this, the Turn 1.5 ask flow couldn't pick clinically-useful targets like Epiglottitis when the prompt demoted them to `possible`. | The function name now misleads (kept for diff-friendliness — documented in the docblock). | Rename to `askableTargets`, update call sites. |

### What survived the softening (load-bearing safety guards still firing)

- **Pre-LLM weight gate** (route.ts STEP 1) — Refusal-no-weight and Transcript-no-weight refuse in <10 ms with zero model calls. Verified live.
- **`isPositiveMustNotMiss` Rule 2** — case10 hand-crafted POST (engaged epiglottitis drooling+tripod) abstains with reason=unresolved_dangers. Verified live.
- **Wrong-guideline audit** (route.ts STEP 2 — Item #1, delivered) — registered guideline-id condition vs confirmed condition mismatch still abstains with reason=wrong_guideline.
- **Tool-owned numbers** — every dose came from `calculate_dose()`; Cap fixture's `25 × 0.6 = 15 → 12 mg cap` proves the deterministic path is intact.
- **Citation verification + URL pinning** — verbatim guideline quotes still substring-checked; source_url stamped from registry.

### Trigger conditions for revisiting

These softenings are appropriate for a 4-day take-home demo where the registry has 2 doseable conditions and the model + prompt are well-known. They are **not** appropriate for production, where: (a) the registry grows beyond 3 conditions, (b) the model changes, (c) the input population shifts, or (d) any real PHI is in play.

The first thing to do at any of those triggers: re-run a calibration QA pass against the full demo fixture set + a held-out sample, measure how often each softening fires, and either re-tighten the prompt (preferred) or harden the gate (if prompt drift is unrecoverable).

## Notes
- Items 1 & 4 were the strongest "if I had another day" beats — and they were BUILT (the strongest *delivered* beats: 1 = the nastier-failure safety guard with a distinct `wrong_guideline` reason; 4 = the real care-partner collapse loop, one round, eval-proven). The remaining deferred set leads with #10 (mild no-drug arm), #3 (deterministic severity), #6 (live-consult / multi-round collapse), #8 (KG-scale retrieval).
- **Item 10 (mild watch arm)** is independent clinician validation: an urgent-care doc (review, 2026-05-25) reconstructed the severity→treatment-arm ladder from the outside and named "watch, low-dose steroid, high-dose steroid, neb adrenaline + secondary care." The build already models the steroid-dose arms (moderate/severe) + escalation/disposition; only the mild *no-drug* arm is deferred (it needs a disposition-only plan shape, a different output *kind* from the dose arms). Deferred to hold v1 scope, not because it was missed.
- **Independent corroboration:** KnowGuard (Harvard Medical School / Zitnik lab, arXiv:2509.24816, under
  review) reached the same *investigate-before-abstain* paradigm this PoC was built around — and which v1
  now ships as a **one-round** collapse loop (#4, delivered). Its knowledge-graph mechanism is precisely
  the deferred *multi-round* version: items 8 (scale retrieval) and 6 (multi-round real-time collapse) —
  i.e. the frontier paper is the deferred *scale* roadmap, while the one-round paradigm is built. We
  arrived here independently; the citation lives in `research/papers.md`. Note their absolute interaction
  figure differs from the abstract's *reduction* of 7.27 turns — cite only the abstract's verbatim
  "−7.27 turns on average."
- The wrong-guideline guard ships in full in v1: the AUDIT assertion (routed `guideline_id` matches confirmed
  condition) AND the auto-abstain *behaviour* with a distinct `wrong_guideline` reason. Delivered, not just noticed.
- Full WHY for each is in `DESIGN.md` → "Delivered since the brief" / "Deliberately deferred" and the decision
  record (`~/.claude/plans/async-twirling-pebble.md`).
