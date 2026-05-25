# research/last30days.md — agentic / lexical retrieval vs vector-RAG (field synthesis)

A one-page synthesis of where retrieval is heading, and **why whole-document retrieval — no vector
DB, no chunking — is the correct choice for this corpus.** Verified via `/last30days` (2026-05-25)
and grounded in the four papers cross-walked in `papers.md`. Field context, verbatim where possible.

---

## The shift: from "chunk-and-embed" to "let the model search"

The default RAG pipeline of the last few years — chunk every document, embed the chunks, store in a
vector DB, retrieve top-k by cosine similarity — is being challenged from two directions in recent
work:

1. **Agentic / lexical retrieval at scale.** Rather than a single embedding lookup, the model runs a
   search loop (often lexical/grep-style) and reads what it finds. PwC's work (**2605.15184**) shows
   that **"with inline delivery, lexical search is uniformly stronger than dense retrieval … for
   every harness–model pair"** (Exp 1). The mechanism is the point for us: lexical search **surfaces
   verbatim strings without an embedding bottleneck** — exactly what verbatim guideline citation
   needs. (Caveat preserved: this is the *inline* result; vector wins 5/10 in the programmatic
   setting — not a blanket verdict.)

2. **Retrieval without a vector database.** Amazon (**2602.23368**) reaches **"above 88% average
   attainment across all three metrics without … a vector database"** (Results, p.4) using a
   regex-search-loop. The embedding store is not load-bearing for high attainment.

Both are evidence that the vector DB is **optional infrastructure**, not a requirement — and at large
corpus scale, agentic retrieval (DCI, **2605.05242**, smallest corpus tested = 50,220 docs) is the
direction. That large-corpus path is the **deferred** option here, cited with its scale caveat.

---

## Why whole-document retrieval is correct for THIS corpus

The real reason is the **token budget**, not the papers:

- The corpus is **2 documents, ~5K tokens each ≈ 10K tokens total.** That fits the context window
  with room to spare. **Retrieval is unnecessary** — there is nothing to retrieve *from* that the
  model can't hold in full.
- **A dose, its cap, and its severity threshold must stay co-present.** Chunking risks splitting a
  dose from its cap — a safety hazard with no upside on a corpus this small. Whole-document retrieval
  guarantees they travel together.
- **No embedding bottleneck, no chunk-boundary loss, no similarity-threshold tuning** — three failure
  modes removed, zero cost incurred, on a corpus where retrieval buys nothing.

So the papers are cited **consistent-with**, not load-bearing: even if every retrieval finding above
were overturned tomorrow, the whole-document choice still holds, because it rests on the token budget.
That is the honest framing — the evidence supports the decision; it does not *make* the decision.

---

## When this flips (the deferred path)

Whole-document retrieval is correct **until the corpus outgrows the context window.** At that point
the design switches to **agentic retrieval over a large corpus** (a live guideline service / data
partnership) — the DCI-style regime, where the scale caveat stops applying because the corpus is now
large. This is captured in `TODOS.md` (item 8, "Scale retrieval") and named in the Loom's deferred
beat. The trigger is explicit: **corpus > context window**, not "someday."

**Bottom line:** for a 2-document, ~10K-token clinical corpus, the senior move is to *not* build a
retrieval system — load the whole document, keep dose+cap+threshold co-present, and spend the saved
complexity on the judgment layer (the differential) and the safety spine (the deterministic dose
tool + completeness gate). The recent literature is consistent with that; the token budget compels it.
