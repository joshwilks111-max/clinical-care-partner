// evals/regrade.ts
//
// Offline re-grader: re-scores the stored transcripts of one or more results
// JSON files with the CURRENT evals/grade.ts, writing <stem>-regraded.json +
// <stem>-regraded-report.md alongside the originals.
//
// WHY THIS EXISTS: generation is expensive (model calls); grading is a pure
// function over frozen transcripts. When a grader bug is found mid-experiment
// (e.g. the case-13 "ignore"-narration false hard-fail), the fix is applied
// retroactively to every stored run without re-running any model.
//
// Usage: npx tsx evals/regrade.ts evals/results/<file>.json [more.json ...]

import { readFileSync, writeFileSync } from "node:fs";
import { grade } from "./grade";
import { applyMockSkips } from "./mock-skips";
import { EVAL_CASES } from "../lib/eval-cases";
import type { EvalResultsFile, GradeResult } from "./types";

function buildReport(data: EvalResultsFile, source: string): string {
  const models = [...new Set(data.runs.map((r) => r.model))];
  const caseIds = [...new Set(data.runs.map((r) => r.caseId))];

  const lines: string[] = [];
  lines.push(`# Re-graded eval report — ${new Date().toISOString()}`);
  lines.push("");
  lines.push(
    `Source run: \`${source}\` (transcripts unchanged; re-scored with current evals/grade.ts)`,
  );
  lines.push("");
  lines.push("## Per-model pass rate");
  lines.push("");
  lines.push("| Model | ok | soft fail | HARD fail | Pass rate |");
  lines.push("|---|---|---|---|---|");
  for (const m of models) {
    const runs = data.runs.filter((r) => r.model === m);
    const ok = runs.filter((r) => r.ok).length;
    const hard = runs.filter((r) => r.hardFails.length > 0).length;
    const soft = runs.filter((r) => !r.ok && r.hardFails.length === 0).length;
    lines.push(
      `| ${m} | ${ok} | ${soft} | ${hard} | ${Math.round((ok / runs.length) * 100)}% |`,
    );
  }
  lines.push("");
  lines.push("## Case × model matrix (passes ok / total)");
  lines.push("");
  lines.push(`| Case | ${models.join(" | ")} |`);
  lines.push(`|---|${models.map(() => "---").join("|")}|`);
  for (const c of caseIds) {
    const cells = models.map((m) => {
      const runs = data.runs.filter((r) => r.model === m && r.caseId === c);
      const ok = runs.filter((r) => r.ok).length;
      const hard = runs.some((r) => r.hardFails.length > 0);
      return `${ok}/${runs.length}${hard ? " ⛔" : ""}`;
    });
    lines.push(`| ${c} | ${cells.join(" | ")} |`);
  }
  lines.push("");
  lines.push("⛔ = at least one HARD fail (safety-invariant violation).");
  lines.push("");
  lines.push("## Hard fails");
  lines.push("");
  const hardRuns = data.runs.filter((r) => r.hardFails.length > 0);
  if (hardRuns.length === 0) lines.push("(none)");
  for (const r of hardRuns) {
    for (const f of r.hardFails) {
      lines.push(`- **${r.caseId}** · ${r.model} · pass ${r.pass}: ${f}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: npx tsx evals/regrade.ts <results.json> [...]");
  process.exit(1);
}

for (const file of files) {
  const data = JSON.parse(readFileSync(file, "utf8")) as EvalResultsFile;
  const regraded: GradeResult[] = data.transcripts.map((t) => {
    const evalCase = EVAL_CASES.find((c) => c.id === t.caseId);
    if (!evalCase)
      throw new Error(`unknown case id in transcripts: ${t.caseId}`);
    const result = grade(t, evalCase);
    // API-harness transcripts ran against the REAL route — assertions pinned
    // to mock values can't pass there and are force-skipped (same logic the
    // live harness applies).
    return data.harness === "api" && evalCase.mock_tool_returns !== undefined
      ? applyMockSkips(result)
      : result;
  });
  const out: EvalResultsFile = { ...data, runs: regraded };
  const stem = file.replace(/\.json$/, "");
  writeFileSync(`${stem}-regraded.json`, JSON.stringify(out, null, 2));
  writeFileSync(`${stem}-regraded-report.md`, buildReport(out, file));

  const ok = regraded.filter((r) => r.ok).length;
  const hard = regraded.filter((r) => r.hardFails.length > 0).length;
  console.log(
    `${file}: ${ok}/${regraded.length} ok, ${hard} hard-fail generations → ${stem}-regraded.{json,md}`,
  );
}
