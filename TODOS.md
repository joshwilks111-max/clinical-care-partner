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
