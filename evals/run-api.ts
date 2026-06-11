// evals/run-api.ts
//
// API-fidelity eval harness.
//
// POSTs each eval case to the real /api/chat route of a locally running dev
// server, parses the streamed UIMessage response, grades it, and writes
// results + a Markdown report to evals/results/.
//
// Usage:
//   npx tsx evals/run-api.ts [options]
//
// Options:
//   --base-url  <url>       Base URL of the running dev server (default: http://localhost:3000)
//   --models    <a,b,...>   Comma-separated model labels for transcript attribution.
//                           These are LABELS ONLY — the server's CHAT_MODEL env var
//                           controls which model actually runs. (default: from
//                           CHAT_MODEL env var, or "unknown")
//   --passes    <N>         Number of passes per case (default: 1)
//   --cases     <id1,id2>   Comma-separated case IDs to run (default: all)
//
// Cases with mock_tool_returns cannot be faithfully exercised through the real
// route (the route calls the real tool implementations, not mocks). Those cases
// are not skipped entirely — they ARE sent to the server — but every
// mock-dependent assertion (dose_card_fields, dose_card_omits, emits_dose_card,
// reassessment_card_fields) is marked "skip" in the GradeResult because the
// actual tool returns will differ from the mock values in the case definition.
// The harness records the real transcript and grades only the assertions that
// don't depend on specific mocked values (prose_contains, prose_does_not_contain,
// expected_tools, refusal, refusal_kind, must_not_call_tools, emits_reassessment_card).
//
// Multi-turn Follow-up cases (group: "Follow-up"):
// Case-11 and case-12 reference a prior conversation in their prompts. We send
// them as single-turn requests: the prompt text already embeds the full clinical
// context ("I just gave the dexamethasone you suggested to Jack…"), so the
// route's system-context injection provides sufficient context. The route injects
// originalNote context on turn 2+ but we send turn-1-only here — the skill is
// designed to handle these follow-up-phrased prompts without needing explicit
// prior tool outputs in the message history.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EVAL_CASES } from "../lib/eval-cases";
import type { EvalCase } from "../lib/eval-cases";
import { applyMockSkips } from "./mock-skips";
import type { EvalTranscript, GradeResult, EvalResultsFile } from "./types";
import { grade } from "./grade";
import { parseUIStream } from "./ui-stream";
import { REGION_COOKIE } from "../lib/region";

// ─── CLI arg parsing ──────────────────────────────────────────────────────────

function parseArgs(argv: string[]): {
  baseUrl: string;
  modelLabel: string;
  passes: number;
  caseIds: string[] | null;
} {
  let baseUrl = "http://localhost:3000";
  let modelLabel = process.env.CHAT_MODEL ?? "unknown";
  let passes = 1;
  let caseIds: string[] | null = null;

  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--base-url":
        baseUrl = argv[++i] ?? baseUrl;
        break;
      case "--models":
        // First label is used; multiple labels are not iterated — the server's
        // CHAT_MODEL env var controls which model runs.
        modelLabel = (argv[++i] ?? modelLabel).split(",")[0];
        break;
      case "--label":
        modelLabel = argv[++i] ?? modelLabel;
        break;
      case "--passes":
        passes = parseInt(argv[++i] ?? "1", 10) || 1;
        break;
      case "--cases":
        caseIds = (argv[++i] ?? "").split(",").filter(Boolean);
        break;
    }
  }

  return { baseUrl, modelLabel, passes, caseIds };
}

// Mock-dependent assertion skipping lives in ./mock-skips (shared with
// regrade.ts so stored API transcripts can be re-scored offline). It fixes
// a key-spelling bug the local copy had: the grader emits SINGULAR detail
// keys (dose_card_field:, reassessment_card_field:), so the plural prefixes
// here never matched and mock-bound assertions were graded instead of
// skipped.

// ─── Request construction ─────────────────────────────────────────────────────

interface UIMessagePart {
  type: "text";
  text: string;
}

interface UIMessage {
  id: string;
  role: "user" | "assistant";
  parts: UIMessagePart[];
}

function makeUserMessage(text: string, id = "msg_user_1"): UIMessage {
  return { id, role: "user", parts: [{ type: "text", text }] };
}

/** Build the Cookie header value for the given region. */
function regionCookie(region: string): string {
  return `${REGION_COOKIE}=${region}`;
}

// ─── Server reachability check ────────────────────────────────────────────────

async function checkServer(baseUrl: string): Promise<void> {
  try {
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Empty body to get a fast 400 — proves the server is up.
      body: JSON.stringify({ messages: [] }),
      signal: AbortSignal.timeout(5000),
    });
    // A 400 means the route is live (it validated and rejected the empty body).
    // Any other status is also fine — we just need a response.
    void res;
  } catch {
    console.error(
      `\nERROR: Dev server unreachable at ${baseUrl}\n` +
        "Start it with:  npm run dev\n" +
        "Then re-run the harness.\n",
    );
    process.exit(1);
  }
}

// ─── Single-case runner ───────────────────────────────────────────────────────

async function runCase(
  evalCase: EvalCase,
  pass: number,
  modelLabel: string,
  baseUrl: string,
): Promise<{ transcript: EvalTranscript; gradeResult: GradeResult }> {
  const messages: UIMessage[] = [makeUserMessage(evalCase.prompt)];

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: regionCookie(evalCase.region),
      },
      body: JSON.stringify({ messages }),
      // 5-minute timeout matches the route's maxDuration.
      signal: AbortSignal.timeout(300_000),
    });
  } catch (fetchErr) {
    const error =
      fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
    const transcript: EvalTranscript = {
      caseId: evalCase.id,
      model: modelLabel,
      pass,
      prose: "",
      toolCalls: [],
      error: `fetch failed: ${error}`,
    };
    return { transcript, gradeResult: grade(transcript, evalCase) };
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "(unreadable)");
    const transcript: EvalTranscript = {
      caseId: evalCase.id,
      model: modelLabel,
      pass,
      prose: "",
      toolCalls: [],
      error: `HTTP ${response.status}: ${body}`,
    };
    return { transcript, gradeResult: grade(transcript, evalCase) };
  }

  let parsed: Awaited<ReturnType<typeof parseUIStream>>;
  try {
    parsed = await parseUIStream(response);
  } catch (parseErr) {
    const error =
      parseErr instanceof Error ? parseErr.message : String(parseErr);
    const transcript: EvalTranscript = {
      caseId: evalCase.id,
      model: modelLabel,
      pass,
      prose: "",
      toolCalls: [],
      error: `stream parse failed: ${error}`,
    };
    return { transcript, gradeResult: grade(transcript, evalCase) };
  }

  const transcript: EvalTranscript = {
    caseId: evalCase.id,
    model: modelLabel,
    pass,
    prose: parsed.prose,
    toolCalls: parsed.toolCalls,
    ...(parsed.error !== undefined ? { error: parsed.error } : {}),
  };

  let gradeResult = grade(transcript, evalCase);

  // Apply mock-skips for cases that have mock_tool_returns: the real route
  // returns real tool values, so assertions pinned to mock values are skipped.
  if (evalCase.mock_tool_returns !== undefined) {
    gradeResult = applyMockSkips(gradeResult);
  }

  return { transcript, gradeResult };
}

// ─── Report builder ───────────────────────────────────────────────────────────

function buildReport(
  runs: GradeResult[],
  transcripts: EvalTranscript[],
  modelLabel: string,
  skippedMockCaseIds: string[],
): string {
  const total = runs.length;
  const passed = runs.filter((r) => r.ok).length;
  const hardFailRuns = runs.filter((r) => r.hardFails.length > 0);

  const lines: string[] = [
    "# API eval harness — results",
    "",
    `Model: **${modelLabel}**  `,
    `Pass rate: **${passed}/${total}**`,
    "",
  ];

  // Pass-rate table
  lines.push("## Per-case results", "");
  lines.push("| Case ID | Pass | Hard fails | Soft fails |");
  lines.push("|---|---|---|---|");
  for (const r of runs) {
    const passIcon = r.ok ? "✓" : "✗";
    lines.push(
      `| ${r.caseId} | ${passIcon} | ${r.hardFails.join("; ") || "—"} | ${r.softFails.slice(0, 3).join("; ") || "—"} |`,
    );
  }
  lines.push("");

  // Hard fails list
  if (hardFailRuns.length > 0) {
    lines.push("## Hard fails", "");
    for (const r of hardFailRuns) {
      lines.push(`- **${r.caseId}** (pass ${r.pass}):`);
      for (const hf of r.hardFails) {
        lines.push(`  - ${hf}`);
      }
    }
    lines.push("");
  }

  // Skipped mock-dependent cases note
  if (skippedMockCaseIds.length > 0) {
    lines.push("## Skipped (mock-dependent assertions)");
    lines.push("");
    lines.push(
      "The following cases have `mock_tool_returns`. The real route uses real tool",
      "implementations, so `dose_card_fields`, `dose_card_omits`, and",
      "`reassessment_card_fields` assertions are force-skipped (marked `skip` in",
      "details). The cases are still run and all other assertions are graded normally.",
    );
    lines.push("");
    for (const id of skippedMockCaseIds) {
      lines.push(`- ${id}`);
    }
    lines.push("");
  }

  // Transcript prose snippets (first 200 chars) for quick review
  lines.push("## Transcript excerpts", "");
  for (const t of transcripts) {
    const excerpt = t.prose.slice(0, 200).replace(/\n/g, " ");
    lines.push(`### ${t.caseId} (pass ${t.pass})`);
    if (t.error) lines.push(`**Error:** ${t.error}`);
    lines.push(`> ${excerpt || "(empty prose)"}`);
    lines.push("");
  }

  return lines.join("\n");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { baseUrl, modelLabel, passes, caseIds } = args;

  const cases = caseIds
    ? EVAL_CASES.filter((c) => caseIds.includes(c.id))
    : EVAL_CASES;

  if (cases.length === 0) {
    console.error("No matching cases found. Check --cases argument.");
    process.exit(1);
  }

  console.log(`API eval harness`);
  console.log(`  base URL : ${baseUrl}`);
  console.log(`  model    : ${modelLabel}`);
  console.log(`  cases    : ${cases.length}`);
  console.log(`  passes   : ${passes}`);
  console.log("");

  // Verify server is reachable before starting.
  await checkServer(baseUrl);

  const allRuns: GradeResult[] = [];
  const allTranscripts: EvalTranscript[] = [];
  const mockCaseIds = cases
    .filter((c) => c.mock_tool_returns !== undefined)
    .map((c) => c.id);

  let runIndex = 0;
  const totalRuns = cases.length * passes;

  for (const evalCase of cases) {
    for (let pass = 1; pass <= passes; pass++) {
      runIndex++;
      process.stdout.write(
        `[${runIndex}/${totalRuns}] ${evalCase.id} pass ${pass} ... `,
      );

      const { transcript, gradeResult } = await runCase(
        evalCase,
        pass,
        modelLabel,
        baseUrl,
      );

      allRuns.push(gradeResult);
      allTranscripts.push(transcript);

      const status = gradeResult.ok
        ? "PASS"
        : gradeResult.hardFails.length > 0
          ? "HARD FAIL"
          : "FAIL";
      console.log(status);

      if (!gradeResult.ok) {
        for (const hf of gradeResult.hardFails) {
          console.log(`    HARD: ${hf}`);
        }
        for (const sf of gradeResult.softFails.slice(0, 3)) {
          console.log(`    soft: ${sf}`);
        }
        if (gradeResult.softFails.length > 3) {
          console.log(`    ... and ${gradeResult.softFails.length - 3} more`);
        }
      }
    }
  }

  // Write results.
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  // fileURLToPath (NOT URL.pathname) — on Windows .pathname yields "/C:/…",
  // which path.join mangles into "C:\C:\…".
  const resultsDir = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "results",
  );
  fs.mkdirSync(resultsDir, { recursive: true });

  const jsonPath = path.join(resultsDir, `${timestamp}-api.json`);
  const mdPath = path.join(resultsDir, `${timestamp}-api-report.md`);

  const resultsFile: EvalResultsFile = {
    harness: "api",
    runs: allRuns,
    transcripts: allTranscripts,
  };

  fs.writeFileSync(jsonPath, JSON.stringify(resultsFile, null, 2));

  const report = buildReport(allRuns, allTranscripts, modelLabel, mockCaseIds);
  fs.writeFileSync(mdPath, report);

  const passed = allRuns.filter((r) => r.ok).length;
  const hardFails = allRuns.filter((r) => r.hardFails.length > 0).length;

  console.log("");
  console.log(
    `Results: ${passed}/${allRuns.length} passed, ${hardFails} hard-fail run(s)`,
  );
  console.log(`JSON  → ${jsonPath}`);
  console.log(`Report → ${mdPath}`);

  if (hardFails > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal harness error:", err);
  process.exit(1);
});
