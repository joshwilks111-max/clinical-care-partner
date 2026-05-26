/**
 * Live Turn 1.5 advisory traces — four fixtures from the handoff spec.
 * Usage: npx tsx scripts/draft-turn15-trace.ts
 * Requires ANTHROPIC_API_KEY in .env.local (never logged).
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText, Output, stepCountIs } from "ai";

import { buildCaseState, type CaseState } from "@/lib/case-state";
import type { Differential, ExtractedFacts } from "@/lib/schemas";
import {
  buildTurn15OutputSchema,
  buildTurn15SystemPrompt,
  buildTurn15UserPrompt,
  validateTurn15Output,
} from "@/prompts/turn1.5";
import { CASE_COLLAPSE_CROUP } from "@/tests/evals/fixtures";

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
    // fall through
  }
}

const MODEL = "claude-opus-4-7";
const MAX_OUTPUT = 800;

type Fixture = {
  id: string;
  label: string;
  caseState: CaseState;
  confidence: "low" | "medium" | "high";
};

function jackFacts(severity: string): ExtractedFacts {
  return {
    condition_hints: ["croup"],
    severity,
    weight_kg: 14.2,
    age: "3yo",
    profession: null,
    setting: null,
  };
}

function capFacts(): ExtractedFacts {
  return {
    condition_hints: ["croup"],
    severity: "severe",
    weight_kg: 25,
    age: "8yo",
    profession: null,
    setting: null,
  };
}

function ambiguousCroupDifferential(): Differential {
  return CASE_COLLAPSE_CROUP.differential;
}

function cleanCroupDifferential(): Differential {
  return {
    conditions: [
      {
        name: "Croup",
        likelihood: "likely",
        positive_evidence: ["barky cough", "stridor at rest", "age 3"],
        negative_evidence: ["drooling", "tripod posture", "muffled voice"],
      },
      {
        name: "Epiglottitis",
        likelihood: "must-not-miss",
        positive_evidence: [],
        negative_evidence: [
          "drooling",
          "tripod posture",
          "muffled voice",
          "toxic appearance",
        ],
      },
    ],
    candidate_guidelines: [
      { guideline_id: "starship-croup-2020", label: "Starship croup (NZ)" },
    ],
  };
}

function makeCaseState(
  note: string,
  facts: ExtractedFacts,
  differential: Differential,
): CaseState {
  return buildCaseState({
    note,
    extractedFacts: facts,
    differential,
    selectedCondition: null,
    selectedGuidelineId: null,
    selectedSeverity: facts.severity,
    discriminatingQa: [],
  });
}

const FIXTURES: Fixture[] = [
  {
    id: "a",
    label: "Canonical Jack T. croup (14.2 kg moderate)",
    caseState: makeCaseState(
      "Jack T., 3yo, 14.2 kg. Barking cough, stridor at rest, mild chest-wall recession, no cyanosis, alert. Moderate croup.",
      jackFacts("moderate"),
      ambiguousCroupDifferential(),
    ),
    confidence: "high",
  },
  {
    id: "b",
    label: "Session croup note (collapse eval shape)",
    caseState: CASE_COLLAPSE_CROUP,
    confidence: "medium",
  },
  {
    id: "c",
    label: "Cap demo — 25 kg severe croup",
    caseState: makeCaseState(
      "Child, 25 kg. Persistent stridor at rest, marked respiratory distress, exhaustion and cyanosis. Severe croup.",
      capFacts(),
      {
        conditions: [
          {
            name: "Croup",
            likelihood: "likely",
            positive_evidence: [
              "stridor at rest",
              "marked respiratory distress",
              "exhaustion",
            ],
            negative_evidence: ["drooling", "tripod posture"],
          },
          {
            name: "Epiglottitis",
            likelihood: "must-not-miss",
            positive_evidence: [],
            negative_evidence: ["drooling", "tripod posture", "muffled voice"],
          },
        ],
        candidate_guidelines: [
          { guideline_id: "starship-croup-2020", label: "Starship croup (NZ)" },
        ],
      },
    ),
    confidence: "high",
  },
  {
    id: "d",
    label: "Clean differential — must-not-miss ruled out (expect needs_question: false)",
    caseState: makeCaseState(
      "Jack T., 3yo, 14.2 kg. Barky cough, stridor at rest. No drooling, no tripod, voice normal. Moderate croup.",
      jackFacts("moderate"),
      cleanCroupDifferential(),
    ),
    confidence: "high",
  },
];

async function runFixture(fixture: Fixture) {
  const { differential, extracted_facts: facts } = fixture.caseState;
  const schema = buildTurn15OutputSchema(differential);
  const system = buildTurn15SystemPrompt(differential);
  const prompt = buildTurn15UserPrompt(differential, {
    age: facts.age,
    weight_kg: facts.weight_kg,
    severity: facts.severity,
    confidence: fixture.confidence,
  });

  const anthropic = createAnthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseURL: "https://api.anthropic.com/v1",
  });

  const result = await generateText({
    model: anthropic(MODEL),
    maxOutputTokens: MAX_OUTPUT,
    stopWhen: stepCountIs(1),
    system,
    prompt,
    experimental_output: Output.object({ schema }),
  });

  const parsed = schema.safeParse(result.experimental_output);
  const validation =
    parsed.success ? validateTurn15Output(parsed.data, differential) : "parse_failure";

  return {
    systemChars: system.length,
    userChars: prompt.length,
    usage: result.usage,
    output: result.experimental_output,
    parseOk: parsed.success,
    validation,
  };
}

async function main() {
  loadEnvLocal();
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    console.error("ANTHROPIC_API_KEY missing — add to .env.local and re-run.");
    process.exit(1);
  }

  const sections: string[] = [
    "# Turn 1.5 rewrite — live traces",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
  ];

  for (const fixture of FIXTURES) {
    console.log(`Running fixture ${fixture.id}: ${fixture.label}…`);
    const r = await runFixture(fixture);
    sections.push(`## Fixture ${fixture.id} — ${fixture.label}`);
    sections.push("");
    sections.push(`- parse_ok: ${r.parseOk}`);
    sections.push(`- validation: ${r.validation ?? "ok"}`);
    sections.push(
      `- usage: input=${r.usage?.inputTokens ?? "?"} output=${r.usage?.outputTokens ?? "?"}`,
    );
    sections.push("");
    sections.push("```json");
    sections.push(JSON.stringify(r.output, null, 2));
    sections.push("```");
    sections.push("");
  }

  const outPath = resolve(process.cwd(), "prompts/turn1.5-rewrite.traces.md");
  writeFileSync(outPath, sections.join("\n"), "utf8");
  console.log(`Wrote ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
