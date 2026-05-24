# Heidi Interview Assignment

Take-home assignment for a role at Heidi Health. Solo, private repo. Worked on this machine.

## Tech stack

TBD — set once the assignment dictates / is chosen. Update this line and the Commands section below before first real code.

## Commands

| Action | Command |
|---|---|
| Install | _TBD once stack chosen_ |
| Run / dev | _TBD_ |
| Test | _TBD_ |
| Lint / format | _TBD_ |

## Conventions

- Default branch `main`. Feature work on `feat/*` branches; keep `main` buildable.
- Conventional commits (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`). One coherent change per commit.
- This is interview-graded work: prioritise correctness, clear naming, and a reviewer's first-read experience. Tests + a tight README matter as much as the feature.
- When the stack lands, fill in Tech stack + Commands above and tighten `.gitignore` with stack specifics.

## Danger zones — ask before editing

| Path | Why |
|---|---|
| The assignment brief / prompt file | Source spec. Don't edit, summarise, or commit it without explicit OK — it may be confidential to Heidi. |
| Any provided sample / patient / clinical data | Likely sensitive. Never commit, log, or paste into chat. Keep in a gitignored dir. |
| `.env` / env-var files | Secrets — never log, commit, or embed. Use `.env.example` for names only. |
| `.git/hooks/` | Pre-commit secret scanner. Don't disable; don't `--no-verify` without reading the diff. |
| Repo visibility | Stays **private**. Do not push public or create a public remote without an explicit manual review pass. |

## Notes

- `.env.example` not created yet — add it (names only, no values) if/when the project needs env vars.
- Global gitignore (`~/.config/git/ignore`) already covers secrets, OS noise, node, python, build, deploy, logs. The per-repo `.gitignore` only adds what's specific to this assignment.
