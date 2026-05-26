/**
 * Measure Turn 1.5 prompt size against the handoff token budget.
 * Usage: npx tsx scripts/measure-prompt-tokens.ts
 *
 * Uses Anthropic count_tokens when ANTHROPIC_API_KEY is set; otherwise
 * reports character counts and estimated tokens (~4 chars/token).
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { CASE_COLLAPSE_CROUP } from "@/tests/evals/fixtures";
import {
  buildTurn15SystemPrompt,
  buildTurn15UserPrompt,
} from "@/prompts/turn1.5";

function loadEnvLocal(): void {
  if (process.env.ANTHROPIC_API_KEY?.trim()) return;
  try {
    const text = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      const current = process.env[key];
      if (key && (current === undefined || current.trim().length === 0)) {
        process.env[key] = value;
      }
    }
  } catch {
    // ignore
  }
}

async function countWithAnthropic(
  system: string,
  user: string,
): Promise<number | null> {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) return null;

  const res = await fetch("https://api.anthropic.com/v1/messages/count_tokens", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-opus-4-7",
      system,
      messages: [{ role: "user", content: user }],
    }),
  });

  if (!res.ok) {
    console.warn(`count_tokens HTTP ${res.status} — using estimate`);
    return null;
  }

  const data = (await res.json()) as { input_tokens?: number };
  return data.input_tokens ?? null;
}

async function main() {
  loadEnvLocal();

  const differential = CASE_COLLAPSE_CROUP.differential;
  const facts = CASE_COLLAPSE_CROUP.extracted_facts;
  const system = buildTurn15SystemPrompt(differential);
  const user = buildTurn15UserPrompt(differential, {
    age: facts.age,
    weight_kg: facts.weight_kg,
    severity: facts.severity,
    confidence: "medium",
  });

  const systemChars = system.length;
  const userChars = user.length;
  const totalChars = systemChars + userChars;
  const estimatedTokens = Math.ceil(totalChars / 4);

  const inputTokens = await countWithAnthropic(system, user);
  const totalTokens = inputTokens ?? estimatedTokens;

  const budgetOk = totalTokens <= 8000;
  const prefix1024Aligned = systemChars >= 1024;

  console.log("Turn 1.5 prompt measurement (representative fixture: collapse croup)");
  console.log(`  system chars: ${systemChars}`);
  console.log(`  user chars:   ${userChars}`);
  console.log(`  total chars:  ${totalChars}`);
  if (inputTokens != null) {
    console.log(`  input tokens: ${inputTokens} (Anthropic count_tokens)`);
  } else {
    console.log(`  input tokens: ~${estimatedTokens} (estimated, no API count)`);
  }
  console.log(`  ≤ 8k budget:  ${budgetOk ? "PASS" : "FAIL"}`);
  console.log(`  system ≥1024: ${prefix1024Aligned ? "PASS" : "FAIL"}`);

  if (!budgetOk || !prefix1024Aligned) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
