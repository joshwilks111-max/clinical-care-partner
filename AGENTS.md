# AGENTS.md

## Cursor Cloud specific instructions

### Overview

Clinical Care-Partner is a single Next.js 16 application (App Router, Node runtime) with no database, Docker, or external services other than the Anthropic API. All commands are in `CLAUDE.md` → "Commands" table.

### Services

| Service | How to run | Notes |
|---|---|---|
| Next.js dev server | `npm run dev` → http://localhost:3000 | Only service to run. Deterministic demo buttons ("Refusal", "Transcript (no weight)") work **without** an API key. |

### Environment

- **Node 22** is required (pinned in `.nvmrc`). The VM has it pre-installed via nvm.
- **`ANTHROPIC_API_KEY`** is the only secret. Set it in `.env.local` (copy from `.env.example`). LLM-dependent features (Croup dose, Anaphylaxis dose, Transcript with weight) require it; the refusal demos do not.
- **ENV-SHADOW gotcha**: if an empty `ANTHROPIC_API_KEY` exists in the ambient shell environment, it shadows `.env.local` and LLM calls silently fail. Ensure no empty ambient key: `unset ANTHROPIC_API_KEY` before starting the dev server if needed.

### Testing & checks

- `npx vitest run` — 329 deterministic unit tests (no API key needed)
- `npx tsc --noEmit` — typecheck
- `npm run build` — production build
- `npm run eval` — Promptfoo LLM evals (requires `ANTHROPIC_API_KEY`, ~2–3 min)
