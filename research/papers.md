# research/papers.md — 4-paper cross-walk + citation reference card

The WHY behind the architecture. Each entry below is a **verbatim line + location + caveat**.
The caveats are deliberate: they are the senior signal — they say what each paper does *not*
license us to claim. The README's evidence map deep-links specific claims here.

A note on rigour: every headline number is paired with the constraint that bounds it. A clinical
RAG paper's "99.5% faithful" is meaningless without "vs its own 0.348 no-RAG baseline, on an
LLM-judge metric, on a different model." We cite the line, then the leash.

---

## Cross-walk — how the four papers (plus npj) map to design decisions

| Decision | Paper | What it licenses | What it does NOT license |
|---|---|---|---|
| Completeness check (the omission guard) | 2510.02967 (NICE) | "faithful ≠ safe" — faithfulness can be near-perfect and still unsafe via omission | A specific faithfulness number for *our* model (different model, LLM-judge metric) |
| No vector DB, no chunking | 2602.23368 (Amazon) | Retrieval can hit high attainment without a vector database | The abstract's ">90%" headline (cite the body line); not our primary reason (token budget is) |
| Whole-document / lexical surfacing | 2605.15184 (PwC grep) | Lexical search surfaces verbatim strings without an embedding bottleneck | A blanket "lexical > vector" claim (vector wins 5/10 programmatic; inline-only result) |
| Large-corpus retrieval is the deferred path | 2605.05242 (DCI) | Agentic retrieval is the answer *at large corpus scale* | Anything about a 2-doc corpus (smallest tested = 50,220 docs) |
| Deterministic dose tool (LLM never does math) | npj Digital Medicine | Tool-based calc = 5.5–13× fewer incorrect responses vs in-context arithmetic | (headline; the strongest single evidence line for the safety spine) |
| Abstention-as-safety / investigate-before-abstain (whole thesis) | 2509.24816 (KnowGuard) | The *paradigm* — abstain on insufficient evidence; check knowledge boundaries against **external** medical evidence, not model self-assessment | Their *mechanism* (systematic knowledge-graph exploration over a large medical space) — that is our **deferred** large-corpus path, not the v1 whole-doc build |

The token-budget argument is the *load-bearing* reason for whole-document retrieval (2 guidelines,
~800 tokens total — measured from `registry/guidelines.ts` — fit the window many times over). The retrieval papers are cited **consistent-with**, not
as the justification. This distinction matters: if a reviewer pulls the papers and finds a caveat,
the design still stands because the real reason never depended on them.

---

## Citation reference card

### 2510.02967 — NICE faithfulness (clinical RAG)
- **Verbatim:** "Faithfulness… was increased by 64.7 percentage points to 99.5% for the RAG-enhanced
  O4-Mini model"
- **Location:** Abstract.
- **Caveat:** That 99.5% is O4-Mini measured against its *own* no-RAG baseline of 0.348, on the RAGAS
  **LLM-judge** faithfulness metric (human-graded accuracy was 98.7% / 96.6% — a different axis). Our
  model differs, so the *number* doesn't transfer.
- **Headline lesson (the one that drives a build decision):** **faithful ≠ safe.** The unsafe cases
  in this work were **omissions** — answers that were faithful to the source yet dropped a clinically
  required element. **This is why we built the completeness check** (a structured-slot gate, scored on
  a completeness axis *separate* from faithfulness). "0% hallucination" does NOT imply "0% clinical
  risk."

### 2602.23368 — Amazon (retrieval without a vector database)
- **Verbatim:** "above 88% average attainment across all three metrics without … a vector database"
- **Location:** Results, p.4.
- **Caveat:** Cite the **body line (88%)**, NOT the abstract's ">90%" — the abstract rounds up. The
  method is a **regex-search-loop at larger scale**. We cite it **consistent-with** our no-vector-DB
  choice; our actual reason is the **token budget** (a 2-document, ~800-token corpus needs no
  retrieval at all).

### 2605.15184 — PwC (lexical / grep retrieval)
- **Verbatim:** "With inline delivery, lexical search is uniformly stronger than dense retrieval …
  for every harness–model pair"
- **Location:** Experiment 1.
- **Caveat:** This is the **inline-delivery** result only; in the **programmatic** setting **vector
  wins 5/10**, so this is NOT a blanket "lexical beats vector." Cite the **MECHANISM** — lexical
  search **surfaces verbatim strings without an embedding bottleneck** — which is exactly what
  verbatim guideline citation needs. Drop the paper's "noise" framing (irrelevant to a clean
  2-document corpus).

### 2605.05242 — DCI (large-corpus document retrieval)
- **Verbatim:** large-corpus retrieval result (smallest corpus tested = **50,220 documents**).
- **Location:** Results (corpus-scale tables).
- **Caveat:** This is a **large-corpus** finding only — the smallest corpus they test is 50,220
  documents **vs our 2**. Cite **only with an explicit scale caveat** (it justifies the *deferred*
  agentic-retrieval path for when the corpus outgrows the window), **or not at all** for the v1
  whole-document decision.

### npj Digital Medicine — tool-based clinical calculation
- **Source:** npj Digital Medicine, `nature.com/articles/s41746-025-01475-8`.
  *(URL per DESIGN.md; confirm the live link resolves at build before it ships in the README.)*
- **Verbatim / headline:** task-specific calculation **tools** produced **5.5–13× fewer incorrect
  responses** than the same model doing the arithmetic in-context.
- **Location:** Results (headline finding).
- **Caveat:** None load-bearing — this is the **single strongest evidence line for the deterministic
  dose tool** (the LLM is structurally blocked from generating a dose; it picks the rule by id, the
  tool owns every number and does the math).

### 2509.24816 — KnowGuard (independent corroboration of the whole thesis)
- **Source:** Dang, Chen, Su, Noori, Arango, Vittor, Long, Du, **Zitnik**, Heng —
  "KnowGuard: Knowledge-Driven Abstention for Multi-Round Clinical Reasoning,"
  arXiv:2509.24816 (submitted 29 Sep 2025; under review). CUHK + Harvard Medical School.
- **Verbatim:** "physicians refrain from making decisions when patient information is insufficient.
  This behavior, known as abstention, is a critical safety mechanism preventing potentially harmful
  misdiagnoses." And: "existing LLMs … frequently provid[e] overconfident responses despite incomplete
  information … conventional abstention methods rel[y] solely on model self-assessments, which lack
  systematic strategies to identify knowledge boundaries with external medical evidences."
- **Headline result:** "KnowGuard outperforms state-of-the-art abstention approaches, improving
  diagnostic accuracy by 3.93% while reducing unnecessary interaction by 7.27 turns on average."
- **Why it's here (and why it's *corroboration*, not a design-decision paper):** This is independent
  validation — from a Harvard Medical School / Zitnik-lab group, under review — of the exact paradigm
  this PoC was designed around, **arrived at independently**: (1) **abstention is the safety mechanism**
  (our pre-LLM refusal gate + no-matching-guideline abstain — "the dangerous failure is the quiet one");
  (2) **investigate *before* abstain** — don't trust model self-assessment; check against **external**
  evidence (our differential reasons over positive **and absent** evidence, and abstention fires on
  *empty* retrieved context, not a confidence vibe); (3) **knowledge boundaries come from external
  medical evidence** (our committed guideline registry is that external authority — the LLM never
  self-certifies a dose).
- **Caveat (the boundary — same discipline as every card above):** KnowGuard's *implementation* is
  **systematic knowledge-graph exploration** with ranked evidence evaluation over a large medical
  knowledge space. We deliberately do **not** build that — at a **2-document corpus** it is
  over-engineering; whole-document retrieval is correct (token budget, see above). KnowGuard is
  therefore cited as the academic reference for **two deliberately-deferred items**: *Scale retrieval*
  (their graph exploration is what our deferred large-corpus path becomes) and the
  *differential-collapse loop* (their multi-round *investigate*-before-abstain is the active-gathering
  version of our v1, which abstains on absent evidence but does not yet loop to gather it). Naming the
  frontier paper as the destination for our deferred items **is** the take-home's thesis — judgment
  about what *not* to build in 4 days — made concrete.

---

## Why Opus 4.7 for v1, Gemini as an eval challenger

The turn-2 flow does **tools + structured output together**. On the Vercel AI SDK that combination
works only on the **Gemini 3 series** — non-3 Gemini models throw a mime-type error, and it is
**unconfirmed** whether GA `gemini-3.5-flash` (GA 2026-05-19; Flash only, 3.5 Pro not released) is
covered. **Opus 4.7 does tools + structured output clean today.** So v1 is one model — `claude-opus-4-7`,
`temperature: 0` for demo reproducibility — and **Gemini stays an EVAL challenger** (build
provider-flexible; let the data decide). Re-verify SDK + model facts at build — this area moves weekly.
