/**
 * Stack spike — throwaway wiring proof (Task 5).
 *
 * Question: does claude-opus-4-7 do tool-call + structured output (Output.object)
 * + stopWhen cleanly on the Vercel AI SDK (ai@6 + @ai-sdk/anthropic)?
 *
 * This is NOT the real turn-2 pipeline. It is the minimum wiring that exercises
 * all three features at once, plus the error path, so we can pick the SDK.
 *
 * Run:  node --env-file=.env.local spike/turn2-shape.ts
 * (--env-file keeps ANTHROPIC_API_KEY off the command line; .env.local is gitignored.)
 *
 * COST GUARD: exactly two live model calls, maxOutputTokens 512 on each.
 *
 * API names verified against the installed packages (ai@6.0.191), NOT training memory:
 *   - tool({ inputSchema })           (NOT `parameters`)
 *   - stopWhen: stepCountIs(n)         (NOT `maxSteps`)
 *   - experimental_output: Output.object({ schema })   (export is `Output`, NOT `experimental_output`)
 */

import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText, tool, stepCountIs, Output } from "ai";
import { z } from "zod";

const MODEL = "claude-opus-4-7";

// --- env plumbing hardening (diagnosed during the spike) ---
// 1. .env.local was saved with a UTF-8 BOM, so Node exposes the key under the
//    name "﻿ANTHROPIC_API_KEY" and leaves a clean ANTHROPIC_API_KEY empty.
//    Fall back to the BOM-prefixed name so the SDK actually sees the key.
// 2. An ambient ANTHROPIC_BASE_URL points at the host root ("/") with no /v1,
//    which makes the provider build .../messages → 404. Pin /v1 explicitly.
const apiKey =
  process.env.ANTHROPIC_API_KEY || process.env["﻿ANTHROPIC_API_KEY"];
const anthropic = createAnthropic({
  apiKey,
  baseURL: "https://api.anthropic.com/v1",
});

// Structured-output shape we want the model to return after calling the tool.
const resultSchema = z.object({
  dose_mg: z.number(),
  severity: z.string(),
});

// ---- Call 1: clean turn-2 shape (tool + structured output + stopWhen) ----
async function cleanCall() {
  let toolFired = false;

  const calculateDose = tool({
    description:
      "Calculate a weight-based medication dose from a guideline dose rule.",
    inputSchema: z.object({
      guideline_id: z.string(),
      dose_rule_id: z.string(),
      weight_kg: z.number(),
    }),
    // No real logic — wiring test. Returns a fixed structured result.
    execute: async (args) => {
      toolFired = true;
      return { dose_mg: 2.13, args };
    },
  });

  const res = await generateText({
    model: anthropic(MODEL),
    // NOTE: opus-4-7 does NOT support `temperature` — the SDK warns and ignores
    // it. Omitted here; the model is deterministic enough for this wiring test.
    maxOutputTokens: 512,
    stopWhen: stepCountIs(5),
    tools: { calculate_dose: calculateDose },
    experimental_output: Output.object({ schema: resultSchema }),
    prompt:
      "Given weight 14.2kg and rule croup-dex-moderate (guideline croup-2024), " +
      "call the calculate_dose tool, then return the structured result with " +
      'dose_mg from the tool and severity "moderate".',
  });

  return { res, toolFired };
}

// ---- Call 2: error path (tool.execute throws) must be CATCHABLE ----
// Validates Task 7 can render a red technical-error state instead of crashing.
async function errorPathCall() {
  const explodingTool = tool({
    description: "A dose tool whose execution deliberately throws.",
    inputSchema: z.object({
      guideline_id: z.string(),
      weight_kg: z.number(),
    }),
    execute: async () => {
      throw new Error(
        "SPIKE_FORCED_TOOL_FAILURE: simulated downstream failure",
      );
    },
  });

  // ai@6 surfaces tool-execution errors as tool-error parts rather than throwing
  // out of generateText, so we inspect the steps; we ALSO wrap in try/catch to
  // prove no unhandled crash either way.
  try {
    const res = await generateText({
      model: anthropic(MODEL),
      // temperature omitted — unsupported by opus-4-7 (see note in cleanCall).
      maxOutputTokens: 512,
      stopWhen: stepCountIs(2),
      tools: { calculate_dose: explodingTool },
      prompt:
        "Call the calculate_dose tool with weight 14.2kg and guideline croup-2024.",
    });

    // Look for a tool-error content part across all steps.
    const parts = res.steps.flatMap((s) => s.content);
    const toolError = parts.find((p: any) => p.type === "tool-error");
    return {
      caught: !!toolError,
      via: toolError ? "tool-error part" : "no-error-part",
      detail: toolError ? String((toolError as any).error) : "(none)",
      usage: res.usage,
    };
  } catch (err) {
    // Thrown path — also a clean, catchable handle (not a process crash).
    return {
      caught: true,
      via: "thrown exception",
      detail: err instanceof Error ? err.message : String(err),
      usage: undefined,
    };
  }
}

async function main() {
  console.log(
    "=== SPIKE: opus-4-7 on Vercel AI SDK (ai@6 + @ai-sdk/anthropic) ===\n",
  );

  // --- Call 1 ---
  console.log(
    "[Call 1] clean turn-2 shape (tool + Output.object + stopWhen)...",
  );
  const { res, toolFired } = await cleanCall();
  let parsedOk = false;
  try {
    resultSchema.parse(res.experimental_output);
    parsedOk = true;
  } catch {
    parsedOk = false;
  }
  console.log("  tool fired:          ", toolFired);
  console.log("  finishReason:        ", res.finishReason);
  console.log("  steps:               ", res.steps.length);
  console.log(
    "  structured output:   ",
    JSON.stringify(res.experimental_output),
  );
  console.log("  structured parsed OK:", parsedOk);
  console.log("  usage:               ", JSON.stringify(res.usage));
  console.log();

  // --- Call 2 ---
  console.log(
    "[Call 2] error path (tool.execute throws, must be catchable)...",
  );
  const errResult = await errorPathCall();
  console.log("  error caught:        ", errResult.caught);
  console.log("  caught via:          ", errResult.via);
  console.log("  error detail:        ", errResult.detail);
  console.log("  usage:               ", JSON.stringify(errResult.usage));
  console.log();

  // --- Verdict ---
  const clean = toolFired && parsedOk && errResult.caught;
  console.log(
    "=== VERDICT:",
    clean ? "CLEAN (keep Vercel AI SDK)" : "FRICTION (fall back to direct SDK)",
    "===",
  );
  console.log(
    "  tool_fired=" + toolFired,
    "structured_parsed=" + parsedOk,
    "error_catchable=" + errResult.caught,
  );
}

main().catch((e) => {
  console.error("SPIKE CRASHED (unhandled):", e);
  process.exit(1);
});
