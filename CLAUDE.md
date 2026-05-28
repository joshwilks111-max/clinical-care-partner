# Heidi Interview Assignment

Take-home assignment for a role at Heidi Health. Solo, private repo. Worked on this machine.

## Tech stack

Next.js 16 (App Router, Node runtime) + Vercel AI SDK 6 (`ai@6` + `@ai-sdk/anthropic@3`) on `claude-opus-4-7`. Tailwind v4 + shadcn/ui + Vercel AI Elements leaf components. Vitest is the test gate; behavioural evals are a 16-case set (`lib/eval-cases.ts`) run by an external harness — the in-repo Promptfoo suite was removed in v1.6.0.0. Deployed on Vercel. Node 22 (`.nvmrc`), npm (committed `package-lock.json`). Full rationale: [`DESIGN.md`](DESIGN.md) → "Stack — RESOLVED".

## Commands

| Action | Command |
|---|---|
| Install | `npm install` |
| Run / dev | `npm run dev` (http://localhost:3000) |
| Test | `npx vitest run` (305 tests) · behavioural evals: 16-case set in `lib/eval-cases.ts`, run via external harness (no in-repo runner) |
| Typecheck | `npx tsc --noEmit` |
| Build | `npm run build` |
| Deploy | auto on push to `main` (Vercel native git integration). Manual: `vercel deploy --prod` (live: https://clinical-care-partner.vercel.app). See README §4 for the full pipeline. |

## Conventions

- Default branch `main`. Feature work on `feat/*` branches; keep `main` buildable.
- Conventional commits (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`). One coherent change per commit.
- This is interview-graded work: prioritise correctness, clear naming, and a reviewer's first-read experience. Tests + a tight README matter as much as the feature.
- The safety spine is deterministic: the LLM never authors a number. `tools/calculate_dose.ts` owns every dose value; the clinical note is untrusted data (wrapped in `prompts/turn1.ts` delimiters), never instructions.

## Danger zones — ask before editing

| Path | Why |
|---|---|
| The assignment brief / prompt file | Source spec. Don't edit, summarise, or commit it without explicit OK — it may be confidential to Heidi. |
| Any provided sample / patient / clinical data | Likely sensitive. Never commit, log, or paste into chat. Keep in a gitignored dir. |
| `.env` / env-var files | Secrets — never log, commit, or embed. Use `.env.example` for names only. |
| `.git/hooks/` | Pre-commit secret scanner. Don't disable; don't `--no-verify` without reading the diff. |
| Repo visibility | Stays **private**. Do not push public or create a public remote without an explicit manual review pass. |

## Notes

- `.env.example` ships with the one var name (`ANTHROPIC_API_KEY`, no value). The real key lives in `.env.local` (gitignored). See README §4 "Environment gotchas" for the env-shadow / BOM pitfalls.
- Global gitignore (`~/.config/git/ignore`) already covers secrets, OS noise, node, python, build, deploy, logs. The per-repo `.gitignore` only adds what's specific to this assignment.
- Live URL: https://clinical-care-partner.vercel.app · repo stays **private**. Deferred work + build triggers: [`TODOS.md`](TODOS.md).
