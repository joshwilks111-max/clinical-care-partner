// lib/skill-loader.ts
//
// SKILL.md LOADER — the system prompt source-of-truth, dev-vs-prod aware.
//
// THE PROBLEM:
//   The Anthropic SDK's `streamText({ system, ... })` needs a string. Our
//   system prompt IS skills/dose-calculator/SKILL.md (the "fat skill" half
//   of the thin-harness/fat-skill architecture per D1/D10). We want two
//   behaviours from one helper:
//
//     * DEV   — read SKILL.md fresh on every harness call so editing the
//               skill is a live reload. No restart, no rebuild, just save
//               and re-prompt. Iteration loop stays tight.
//     * PROD  — bake the skill prompt at first call and serve from memory
//               on every subsequent request. Eliminates the per-request
//               filesystem hop and gives a stable system prompt for the
//               whole deploy (which matters for Anthropic prompt-cache hit
//               rates — every request shares the same SHA-able prefix).
//
// THE SEAM:
//   `process.env.NODE_ENV` — "development" / "test" → fs.readFile every
//   call; anything else → cache after the first call. Next sets this for
//   us (next dev → development; next build → production). Vitest runs the
//   tests under `NODE_ENV=test`, which falls in the fs-every-call branch
//   by design (the cache-bust test below relies on it).
//
// WHY NOT TOP-LEVEL READFILE-SYNC:
//   Doing `const PROMPT = readFileSync(...)` at module load would lock the
//   prompt at import-time, which is the WORST of both worlds — no live
//   reload in dev (saves don't take effect until restart) AND the read
//   happens before NODE_ENV is settled. Function-scoping the read defers
//   it until the first call, which is when we know the runtime mode.

import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Project-relative path to the skill's system prompt. Centralised here so
 * a future rename (e.g. dose-calculator → care-partner) is one edit.
 */
const SKILL_MD_PATH = "skills/dose-calculator/SKILL.md";

/**
 * Per-process cache of the prompt string. Populated by the first prod-mode
 * call to `getSystemPrompt`; never mutated thereafter. Module-level state
 * is fine here because each Next server-component / route handler runs in
 * the same process; in serverless cold starts the cache rebuilds on first
 * hit (same correctness, slightly higher first-request latency).
 */
let cached: string | null = null;

/**
 * True iff we should re-read SKILL.md on every call. We treat "development"
 * AND "test" as fs-every-call modes — test mode benefits from cache-bust
 * for the same reason dev does (the loader's test below changes the file
 * between calls).
 */
function isFreshReadMode(): boolean {
  const env = process.env.NODE_ENV;
  return env === "development" || env === "test";
}

/**
 * Resolve the on-disk path to SKILL.md. `process.cwd()` is the project root
 * in Next server contexts and in Vitest — both run the process from the
 * repo root. We don't use `__dirname`/`import.meta.url` because those
 * resolve to .next/server/... in built mode, breaking the relative path.
 */
function resolveSkillPath(): string {
  return path.join(process.cwd(), SKILL_MD_PATH);
}

/**
 * Return the SKILL.md contents as the system-prompt string for streamText.
 *
 * Dev/test: reads fresh from disk on every call. Save → reload → next
 *   request picks up the change.
 * Prod:     reads once on first call, caches forever (per process).
 *
 * Throws a legible Error if the file can't be read — the harness is
 * unsafe-to-serve without a system prompt; failing fast at startup is
 * better than silently sending an empty prompt.
 */
export async function getSystemPrompt(): Promise<string> {
  if (!isFreshReadMode() && cached !== null) {
    return cached;
  }
  const fullPath = resolveSkillPath();
  let raw: string;
  try {
    raw = await fs.readFile(fullPath, "utf8");
  } catch (err) {
    // Wrap the underlying ENOENT/EACCES with a message that names the file
    // and the cwd — debugging a deploy where the skill never copied across
    // is much faster with this context than with a bare "ENOENT".
    throw new Error(
      `lib/skill-loader: failed to read system prompt at ${fullPath} ` +
        `(cwd=${process.cwd()}): ${(err as Error).message}`,
    );
  }
  if (!isFreshReadMode()) cached = raw;
  return raw;
}

/**
 * Test-only: clear the cache so the next call re-reads from disk. Exposed
 * because the cache-bust test below switches NODE_ENV and asserts the
 * cached state independently. Production callers MUST NOT use this — the
 * cache is a deliberate latency win.
 */
export function __resetSkillCacheForTests(): void {
  cached = null;
}
