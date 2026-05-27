// lib/skill-loader.test.ts
//
// Skill-loader contract tests. Three load-bearing properties:
//   1. Dev mode hits the disk every call (no stale prompt after a save).
//   2. Prod mode caches after the first call (no FS hop per request).
//   3. A missing skill file surfaces a clear, debuggable error.

import { promises as fs } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetSkillCacheForTests, getSystemPrompt } from "./skill-loader";

const SKILL_PATH = path.join(process.cwd(), "skills/dose-calculator/SKILL.md");

describe("getSystemPrompt", () => {
  beforeEach(() => {
    __resetSkillCacheForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // The "dev iteration loop is tight" promise. Save SKILL.md, get the
  // updated prompt on the next request — no restart. The test simulates
  // a save by spying on fs.readFile and returning different bodies on
  // each call; if the loader caches in dev, the second call sees a stale
  // string.
  it("dev mode re-reads SKILL.md on every call", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const spy = vi
      .spyOn(fs, "readFile")
      .mockResolvedValueOnce("first body")
      .mockResolvedValueOnce("second body");

    expect(await getSystemPrompt()).toBe("first body");
    expect(await getSystemPrompt()).toBe("second body");
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenCalledWith(SKILL_PATH, "utf8");
  });

  // The "prod is fast" promise. After the first call paid the FS hop,
  // subsequent calls hit the in-memory cache. This matters for prompt-
  // cache hit rates: every request shares the same prefix bytes.
  it("prod mode caches the prompt after the first call", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const spy = vi
      .spyOn(fs, "readFile")
      // If the cache leaks, the second call returns the second mock and
      // the assertion below catches it. We only expect ONE read.
      .mockResolvedValueOnce("baked body");

    expect(await getSystemPrompt()).toBe("baked body");
    expect(await getSystemPrompt()).toBe("baked body");
    expect(await getSystemPrompt()).toBe("baked body");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  // Missing-file errors must NAME the file and the cwd. A bare ENOENT
  // string in a Vercel log is brutal to debug; with the path embedded,
  // grepping the deploy is trivial.
  it("surfaces a debuggable error when SKILL.md cannot be read", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.spyOn(fs, "readFile").mockRejectedValueOnce(
      new Error("ENOENT: no such file or directory"),
    );

    await expect(getSystemPrompt()).rejects.toThrowError(
      /lib\/skill-loader.*SKILL\.md.*cwd=/,
    );
  });
});
