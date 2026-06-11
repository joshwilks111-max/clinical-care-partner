// evals/run-subscription.ts
//
// SUBSCRIPTION EVAL HARNESS — replays the 16 behavioural eval cases
// (lib/eval-cases.ts) against any Claude model via @anthropic-ai/claude-agent-sdk,
// which authenticates with the local Claude Code login (Claude Max subscription,
// NO API key). The orchestrator uses this to run a 3-model × 16-case × 3-pass
// matrix and compare claude-sonnet-4-6 / claude-haiku-4-5 against the
// claude-opus-4-7 baseline for behavioural-contract preservation.
//
// HOW A GENERATION WORKS (one case × model × pass):
//   1. Build the app's 4 real tools via lib/chat-tools.createChatTools(), with
//      the case's mock_tool_returns injected as execute overrides. Each tool is
//      re-wrapped as an Agent SDK MCP tool: the wrapper calls the real/mocked
//      execute, RECORDS {name, input, output} into the in-flight transcript
//      (outputs are captured here in the wrapper — never parsed from the
//      stream), then returns the JSON-stringified output to the model.
//   2. query() with the exact same system prompt the live route sends
//      (skills/dose-calculator/SKILL.md via lib/skill-loader + the route's
//      region system line — see buildSystemPrompt), built-in tools disabled,
//      the in-process MCP server, bypassPermissions, settingSources: [] (so
//      the operator's filesystem CLAUDE.md/settings can't pollute the eval).
//   3. Prose = concatenation of all assistant text blocks across turns.
//   4. grade() (evals/grade.ts) scores the transcript against the case.
//
// MULTI-TURN "Follow-up" CASES (case-11, case-12):
//   Both prompts literally reference "Jack ... from earlier" — i.e. they
//   continue the case-1-jack-nz conversation. We mirror a REAL chat
//   continuation, not a synthetic paraphrase:
//     * The query uses the SDK's streaming-input mode (prompt as an
//       AsyncIterable<SDKUserMessage>) so both turns share ONE session: the
//       model sees its own turn-1 response and tool calls, exactly like the
//       live app's useChat history.
//     * Turn 1 sends the case-1 note and runs against the REAL tool executes
//       (no mocks) — the same thing the production route would have done.
//     * After turn 1's result message, we flip the recorder on and send the
//       follow-up prompt; only THIS turn's tool calls + prose are recorded,
//       because the grade asserts on the follow-up behaviour (e.g. case-11's
//       emits_dose_card:false would be polluted by turn 1's legitimate dose
//       card). The follow-up turn runs against the MOCKED tools per the case.
//     * The route also pins the original note as a system message on turn 2+
//       ("The patient under discussion: <note>", app/api/chat/route.ts step 5);
//       we replicate that by appending the same line to the system prompt
//       (the Agent SDK takes one system string per session).
//
// AUTH: ANTHROPIC_API_KEY is deleted from process.env at startup so the SDK
// subprocess (which inherits our env) falls back to the stored Claude Code
// OAuth credentials — subscription auth, $0 total_cost_usd expected.
//
// CLI:
//   npm run eval:sub -- [--models a,b,c] [--passes N] [--cases id1,id2]
//   Defaults: all three models, 3 passes, all 16 cases. Progress is printed
//   per generation so a background runner's log is readable.
//
// OUTPUT: evals/results/<timestamp>-subscription.json   (EvalResultsFile)
//         evals/results/<timestamp>-subscription-report.md

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createSdkMcpServer,
  query,
  tool,
} from "@anthropic-ai/claude-agent-sdk";
import type {
  Options,
  SDKMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { EVAL_CASES, type EvalCase } from "../lib/eval-cases";
import { createChatTools, type ToolName } from "../lib/chat-tools";
import { getSystemPrompt } from "../lib/skill-loader";
import { grade } from "./grade";
import type {
  EvalResultsFile,
  EvalToolCall,
  EvalTranscript,
  GradeResult,
} from "./types";

// ─── Constants ───────────────────────────────────────────────────────────────

const ALL_MODELS = [
  "claude-opus-4-7",
  "claude-sonnet-4-6",
  "claude-haiku-4-5",
] as const;

const DEFAULT_PASSES = 3;

/** In-process MCP server name; tools arrive as mcp__evals__<toolName>. */
const MCP_SERVER_NAME = "evals";

const TOOL_NAMES: ToolName[] = [
  "load_guideline",
  "calculate_dose",
  "get_reassessment_plan",
  "ask_user",
];

// maxTurns: the route stops its loop at MAX_STEPS = 5 (app/api/chat/route.ts) —
// 5 LLM calls cover load_guideline → (ask_user?) → calculate_dose →
// get_reassessment_plan → final prose. One Agent SDK "turn" is the same unit
// (one assistant API call), but the SDK sometimes splits a text-only turn
// around a tool batch, so we add a +3 buffer: 8 for single-turn cases.
// Follow-up sessions chain TWO user turns (seed + follow-up) in one session,
// so they get double the budget.
const MAX_TURNS_SINGLE = 8;
const MAX_TURNS_FOLLOW_UP = 16;

/**
 * Per-generation watchdog. A wedged SDK subprocess (auth prompt, network
 * stall, or a turn-completion signal we never receive) must fail ONE matrix
 * cell, not hang the whole run. 10 minutes is ~5× a slow opus generation.
 */
const GENERATION_TIMEOUT_MS = 10 * 60_000;

/**
 * The conversation both Follow-up cases continue: case-1's full Jack note
 * ("the 3-year-old, 14.2 kg, moderate croup from earlier").
 */
const SEED_CASE_ID = "case-1-jack-nz";

// ─── Small helpers ───────────────────────────────────────────────────────────

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

function createDeferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/**
 * Transcript recorder shared between the MCP tool wrappers and the stream
 * consumer. `recording` is false during a Follow-up case's seed turn and true
 * for the graded turn (always true for single-turn cases).
 */
interface Recorder {
  recording: boolean;
  calls: EvalToolCall[];
}

/** Replicates the route's region system line verbatim (route.ts step 5b). */
function regionSystemLine(region: string): string {
  return `Active clinical jurisdiction for this session: ${region}. Use this region for all guideline lookups unless the clinician explicitly names a different one. Do not infer the region from the note.`;
}

/**
 * Assemble the session system prompt in the same effective order the route
 * produces on the wire: SKILL.md body (streamText's `system`) → region system
 * message → (turn-2+ only) pinned original note. The Anthropic provider
 * concatenates the route's system-role messages after the system param in
 * array order, so this single string is byte-equivalent context.
 */
function buildSystemPrompt(
  skillPrompt: string,
  region: string,
  seedNote: string | null,
): string {
  let prompt = `${skillPrompt}\n\n${regionSystemLine(region)}`;
  if (seedNote !== null) {
    prompt += `\n\nThe patient under discussion: ${seedNote}`;
  }
  return prompt;
}

// ─── Tool wrapping ───────────────────────────────────────────────────────────

/**
 * All four chat-tool executes are compatible with this signature: ask_user
 * declares only (input); the others declare (input, {toolCallId}). Calling
 * with both args is safe for all of them.
 */
type AnyExecute = (
  input: unknown,
  ctx: { toolCallId: string },
) => Promise<unknown> | unknown;

/**
 * Build the 4 Agent SDK MCP tools for one generation.
 *
 * Two createChatTools instances back the wrappers:
 *   - `mocked`  — the case's mock_tool_returns injected as execute overrides
 *                 (each override ignores input and returns the canned value,
 *                 per the harness contract in lib/chat-tools.ts).
 *   - `real`    — no overrides; used ONLY during a Follow-up case's seed turn
 *                 so the seeded conversation matches what production would
 *                 actually have produced.
 * The wrapper dispatches on recorder.recording, records the call when
 * recording, and returns the output to the model as a JSON text block.
 */
function buildSdkTools(evalCase: EvalCase, recorder: Recorder) {
  const region = evalCase.region ?? "NZ";

  const overrides: Partial<Record<ToolName, (input: unknown) => unknown>> = {};
  for (const [name, value] of Object.entries(
    evalCase.mock_tool_returns ?? {},
  )) {
    overrides[name as ToolName] = () => value;
  }

  const mocked = createChatTools({ region, overrides });
  const real = createChatTools({ region });

  // Synthetic toolCallId counter — the real executes echo it back as
  // tool_call_id, but the mocks (which own every graded tool_call_id, e.g.
  // "calc_abc123") replace the output wholesale, so this never reaches grading.
  let callSeq = 0;

  return TOOL_NAMES.map((name) => {
    const def = mocked[name];
    return tool(
      name,
      def.description,
      // Agent SDK tool() takes a Zod RAW SHAPE; createChatTools exposes
      // z.object schemas, so unwrap with .shape (descriptions ride along on
      // the individual fields).
      def.inputSchema.shape,
      async (args: Record<string, unknown>) => {
        const active = recorder.recording ? mocked : real;
        const execute = active[name].execute as unknown as AnyExecute;
        let output: unknown;
        try {
          output = await execute(args, {
            toolCallId: `evalcall_${++callSeq}`,
          });
        } catch (err) {
          // The app's tools never throw (refusals are structured returns);
          // surface an unexpected throw as data so the loop can continue.
          output = {
            status: "error",
            message: `tool threw: ${(err as Error).message}`,
          };
        }
        if (recorder.recording) {
          recorder.calls.push({ name, input: args, output });
        }
        return {
          content: [{ type: "text" as const, text: JSON.stringify(output) }],
        };
      },
    );
  });
}

// ─── severity_row backfill ───────────────────────────────────────────────────

/**
 * Inject `severity_row` into mocked calculate_dose ok-outputs.
 *
 * WHY THE HARNESS DOES THIS: the case files' mock_tool_returns for
 * calculate_dose deliberately omit severity_row, yet dose_card_fields asserts
 * it (e.g. case-1 expects "moderate", case-10 expects "mild"). evals/
 * grade.test.ts:66-67 pins the contract: "severity_row is included because
 * dose_card_fields for case-1 asserts it; in real transcripts THE HARNESS
 * INJECTS THIS FIELD into the tool output."
 *
 * WHY THE SOURCE IS get_reassessment_plan.initial_severity: the model's
 * calculate_dose input carries no severity (only guideline_id, dose_rule_id,
 * weight_kg), and reverse-mapping the registry can't distinguish mild from
 * moderate — both rows share the croup-dex-moderate rule, and the real
 * execute's projection always surfaces the higher-acuity label, which would
 * make case-10/17's expected "mild" unreachable. The ONE place the model
 * authors its severity routing is the `initial_severity` argument it passes
 * to get_reassessment_plan — exactly the behavioural signal dose_card_fields
 * wants to assert. So after the generation completes we copy that
 * model-authored label onto the dose output. If the model never called
 * get_reassessment_plan, severity_row stays undefined and the dose_card_field
 * check fails — correctly, since the reassessment step was missed too.
 *
 * Mutates recorded outputs only (never what the model saw — the reassessment
 * call happens after calculate_dose, so model-visible injection is impossible
 * by construction).
 */
function backfillSeverityRow(calls: EvalToolCall[]): void {
  const reassess = calls.find((c) => c.name === "get_reassessment_plan");
  const initialSeverity = (
    reassess?.input as { initial_severity?: unknown } | undefined
  )?.initial_severity;
  if (typeof initialSeverity !== "string") return;

  for (const call of calls) {
    if (call.name !== "calculate_dose") continue;
    const output = call.output as Record<string, unknown> | null;
    if (
      output &&
      typeof output === "object" &&
      output.status === "ok" &&
      output.severity_row === undefined
    ) {
      output.severity_row = initialSeverity;
    }
  }
}

// ─── One generation (case × model × pass) ────────────────────────────────────

interface GenerationOutcome {
  transcript: EvalTranscript;
  costUsd: number;
  wallMs: number;
  numTurns: number;
  /** From the SDK init message — 'oauth' means subscription auth was used. */
  apiKeySource: string | null;
}

async function runGeneration(
  evalCase: EvalCase,
  model: string,
  passNumber: number,
  skillPrompt: string,
  seedPrompt: string,
): Promise<GenerationOutcome> {
  const started = Date.now();
  const isFollowUp = evalCase.group === "Follow-up";
  const seedNote = isFollowUp ? seedPrompt : null;

  const recorder: Recorder = { recording: !isFollowUp, calls: [] };
  const sdkTools = buildSdkTools(evalCase, recorder);
  const server = createSdkMcpServer({
    name: MCP_SERVER_NAME,
    tools: sdkTools,
  });

  const turns = isFollowUp ? [seedPrompt, evalCase.prompt] : [evalCase.prompt];
  const abort = new AbortController();
  const stderrTail: string[] = [];

  const options: Options = {
    model,
    systemPrompt: buildSystemPrompt(
      skillPrompt,
      evalCase.region ?? "NZ",
      seedNote,
    ),
    maxTurns: isFollowUp ? MAX_TURNS_FOLLOW_UP : MAX_TURNS_SINGLE,
    // [] disables ALL built-in tools — the model gets only our MCP server.
    tools: [],
    mcpServers: { [MCP_SERVER_NAME]: server },
    allowedTools: TOOL_NAMES.map((n) => `mcp__${MCP_SERVER_NAME}__${n}`),
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    // CRITICAL: no filesystem settings — the operator's CLAUDE.md / managed
    // settings must not leak into the eval system prompt or tool policy.
    settingSources: [],
    cwd: process.cwd(),
    abortController: abort,
    stderr: (data: string) => {
      stderrTail.push(data);
      if (stderrTail.length > 20) stderrTail.shift();
    },
  };

  // Streaming-input generator for Follow-up sessions. Each yielded user
  // message triggers one turn; the SDK emits a `result` message when that
  // turn completes, which resolves the matching deferred and releases the
  // next yield. The recorder flips on right before the FINAL (graded) turn.
  const turnDone: Deferred[] = turns.map(() => createDeferred());

  async function* userTurns(): AsyncGenerator<SDKUserMessage, void> {
    for (let i = 0; i < turns.length; i++) {
      if (i === turns.length - 1) recorder.recording = true;
      yield {
        type: "user",
        message: { role: "user", content: turns[i] },
        parent_tool_use_id: null,
      } as SDKUserMessage;
      await turnDone[i].promise;
    }
  }

  let prose = "";
  let error: string | undefined;
  let costUsd = 0;
  let numTurns = 0;
  let resultsSeen = 0;
  let apiKeySource: string | null = null;

  const watchdog = setTimeout(() => {
    error = `generation timed out after ${GENERATION_TIMEOUT_MS / 1000}s`;
    abort.abort();
  }, GENERATION_TIMEOUT_MS);

  try {
    const q = query({
      prompt: isFollowUp ? userTurns() : evalCase.prompt,
      options,
    });

    for await (const msg of q as AsyncIterable<SDKMessage>) {
      if (msg.type === "system" && msg.subtype === "init") {
        // 'oauth' = Claude Code subscription login; anything else means an
        // API key leaked into the subprocess env — surfaced in the report.
        apiKeySource = msg.apiKeySource;
      } else if (msg.type === "assistant") {
        if (msg.error) {
          error = `assistant error: ${msg.error}`;
        }
        if (recorder.recording) {
          for (const block of msg.message.content) {
            if (block.type === "text" && block.text) {
              prose += (prose ? "\n\n" : "") + block.text;
            }
          }
        }
      } else if (msg.type === "result") {
        resultsSeen++;
        // total_cost_usd is cumulative for the session; keep the latest.
        costUsd = msg.total_cost_usd;
        numTurns = msg.num_turns;
        if (msg.subtype !== "success") {
          const detail =
            "errors" in msg && Array.isArray(msg.errors)
              ? msg.errors.join("; ")
              : "";
          error = `result ${msg.subtype}${detail ? `: ${detail}` : ""}`;
        }
        turnDone[resultsSeen - 1]?.resolve();
        if (resultsSeen >= turns.length) break; // session done
      }
    }

    if (resultsSeen < turns.length && !error) {
      error = `session ended after ${resultsSeen}/${turns.length} turns`;
    }
  } catch (err) {
    const tail = stderrTail.join("").trim().slice(-300);
    error =
      error ??
      `transport error: ${(err as Error).message}${tail ? ` | stderr: ${tail}` : ""}`;
  } finally {
    clearTimeout(watchdog);
    // Unblock the input generator if it is still parked on a deferred.
    for (const d of turnDone) d.resolve();
  }

  backfillSeverityRow(recorder.calls);

  return {
    transcript: {
      caseId: evalCase.id,
      model,
      pass: passNumber,
      prose,
      toolCalls: recorder.calls,
      ...(error ? { error } : {}),
    },
    costUsd,
    wallMs: Date.now() - started,
    numTurns,
    apiKeySource,
  };
}

// ─── CLI parsing ─────────────────────────────────────────────────────────────

interface CliConfig {
  models: string[];
  passes: number;
  caseIds: string[];
}

function parseCli(argv: string[]): CliConfig {
  const cfg: CliConfig = {
    models: [...ALL_MODELS],
    passes: DEFAULT_PASSES,
    caseIds: EVAL_CASES.map((c) => c.id),
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = (flag: string): string | null => {
      if (arg === flag) return argv[++i] ?? "";
      if (arg.startsWith(`${flag}=`)) return arg.slice(flag.length + 1);
      return null;
    };

    const models = value("--models");
    if (models !== null) {
      cfg.models = models
        .split(",")
        .map((m) => m.trim())
        .filter(Boolean);
      continue;
    }
    const passes = value("--passes");
    if (passes !== null) {
      cfg.passes = Number.parseInt(passes, 10);
      continue;
    }
    const cases = value("--cases");
    if (cases !== null) {
      cfg.caseIds = cases
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean);
      continue;
    }
    throw new Error(
      `Unknown argument: ${arg}. Usage: eval:sub [--models a,b] [--passes N] [--cases id1,id2]`,
    );
  }

  if (!Number.isInteger(cfg.passes) || cfg.passes < 1) {
    throw new Error(`--passes must be a positive integer, got "${cfg.passes}"`);
  }
  if (cfg.models.length === 0)
    throw new Error("--models resolved to an empty list");

  const known = new Set(EVAL_CASES.map((c) => c.id));
  const unknown = cfg.caseIds.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown case id(s): ${unknown.join(", ")}.\nValid ids:\n  ${[...known].join("\n  ")}`,
    );
  }

  return cfg;
}

// ─── Report rendering ────────────────────────────────────────────────────────

function pct(n: number, d: number): string {
  return d === 0 ? "n/a" : `${((n / d) * 100).toFixed(0)}%`;
}

function buildReport(
  cfg: CliConfig,
  runs: GradeResult[],
  transcripts: EvalTranscript[],
  totalCostUsd: number,
  wallMs: number,
  authSources: Set<string>,
): string {
  const lines: string[] = [];
  const stamp = new Date().toISOString();

  lines.push(`# Subscription eval report — ${stamp}`);
  lines.push("");
  lines.push(
    `Harness: **subscription** (Claude Agent SDK on Claude Max — no API key)`,
  );
  lines.push(
    `Matrix: ${cfg.models.length} model(s) × ${cfg.caseIds.length} case(s) × ${cfg.passes} pass(es) = ${runs.length} generations`,
  );
  lines.push(
    `Cumulative \`total_cost_usd\`: $${totalCostUsd.toFixed(4)} (token-priced estimate; not billed on subscription) · wall time ${(wallMs / 60000).toFixed(1)} min`,
  );
  lines.push(
    `Auth: \`apiKeySource\` observed = ${[...authSources].join(", ") || "(none reported)"} ('none'/'oauth' = subscription login, no API key)`,
  );
  lines.push("");

  // ── Per-model pass-rate table ──
  lines.push(`## Per-model pass rate`);
  lines.push("");
  lines.push(`| Model | ok | soft fail | HARD fail | Pass rate |`);
  lines.push(`|---|---|---|---|---|`);
  for (const model of cfg.models) {
    const rs = runs.filter((r) => r.model === model);
    const ok = rs.filter((r) => r.ok).length;
    const hard = rs.filter((r) => r.hardFails.length > 0).length;
    const soft = rs.filter((r) => !r.ok && r.hardFails.length === 0).length;
    lines.push(
      `| ${model} | ${ok} | ${soft} | ${hard} | ${pct(ok, rs.length)} |`,
    );
  }
  lines.push("");

  // ── Case × model matrix (pass counts like 3/3) ──
  lines.push(`## Case × model matrix (passes ok / total)`);
  lines.push("");
  lines.push(`| Case | ${cfg.models.join(" | ")} |`);
  lines.push(`|---|${cfg.models.map(() => "---").join("|")}|`);
  for (const caseId of cfg.caseIds) {
    const cells = cfg.models.map((model) => {
      const rs = runs.filter((r) => r.caseId === caseId && r.model === model);
      const ok = rs.filter((r) => r.ok).length;
      const hard = rs.filter((r) => r.hardFails.length > 0).length;
      return `${ok}/${rs.length}${hard > 0 ? " ⛔" : ""}`;
    });
    lines.push(`| ${caseId} | ${cells.join(" | ")} |`);
  }
  lines.push("");
  lines.push(`⛔ = at least one HARD fail (safety-invariant violation).`);
  lines.push("");

  // ── Hard-fail list ──
  lines.push(`## Hard fails`);
  lines.push("");
  const hardRuns = runs.filter((r) => r.hardFails.length > 0);
  if (hardRuns.length === 0) {
    lines.push(`None. The safety invariants held on every generation.`);
  } else {
    for (const r of hardRuns) {
      for (const msg of r.hardFails) {
        lines.push(`- **${r.caseId}** · ${r.model} · pass ${r.pass}: ${msg}`);
      }
    }
  }
  lines.push("");

  // ── Harness errors (transport failures, distinct from grade fails) ──
  const errored = transcripts.filter((t) => t.error);
  if (errored.length > 0) {
    lines.push(`## Harness errors`);
    lines.push("");
    for (const t of errored) {
      lines.push(`- **${t.caseId}** · ${t.model} · pass ${t.pass}: ${t.error}`);
    }
    lines.push("");
  }

  // ── Sample prose per model ──
  lines.push(`## Sample prose excerpts`);
  lines.push("");
  for (const model of cfg.models) {
    lines.push(`### ${model}`);
    lines.push("");
    // Prefer passing transcripts (representative of contract-conforming
    // output); fall back to whatever exists for the model.
    const okIds = new Set(
      runs
        .filter((r) => r.model === model && r.ok)
        .map((r) => `${r.caseId}#${r.pass}`),
    );
    const candidates = transcripts.filter(
      (t) => t.model === model && t.prose.trim().length > 0,
    );
    const preferred = candidates.filter((t) =>
      okIds.has(`${t.caseId}#${t.pass}`),
    );
    const samples = (preferred.length > 0 ? preferred : candidates).slice(0, 2);
    if (samples.length === 0) {
      lines.push(`_No prose captured for this model._`);
    }
    for (const s of samples) {
      const excerpt = s.prose.replace(/\s+/g, " ").trim().slice(0, 400);
      lines.push(`**${s.caseId} · pass ${s.pass}:**`);
      lines.push("");
      lines.push(`> ${excerpt}${s.prose.length > 400 ? " …" : ""}`);
      lines.push("");
    }
  }

  return lines.join("\n") + "\n";
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // AUTH — subscription only. The SDK subprocess inherits process.env; with
  // the key gone it authenticates via the stored Claude Code OAuth login.
  delete process.env.ANTHROPIC_API_KEY;
  console.log(
    "[auth] deleted ANTHROPIC_API_KEY from env — using subscription auth (Claude Max)",
  );

  const cfg = parseCli(process.argv.slice(2));
  const cases = cfg.caseIds.map(
    (id) => EVAL_CASES.find((c) => c.id === id) as EvalCase,
  );
  const seedPrompt = EVAL_CASES.find((c) => c.id === SEED_CASE_ID)?.prompt;
  if (!seedPrompt) {
    throw new Error(
      `Seed case ${SEED_CASE_ID} not found in EVAL_CASES — Follow-up cases cannot be seeded`,
    );
  }

  // Same loader call the route makes (app/api/chat/route.ts step 6).
  const skillPrompt = await getSystemPrompt();

  console.log(
    `[run] models=${cfg.models.join(",")} cases=${cases.length} passes=${cfg.passes}`,
  );

  const transcripts: EvalTranscript[] = [];
  const runs: GradeResult[] = [];
  const authSources = new Set<string>();
  let totalCostUsd = 0;
  let generation = 0;
  const totalGenerations = cfg.models.length * cases.length * cfg.passes;
  const runStarted = Date.now();

  for (const model of cfg.models) {
    for (const evalCase of cases) {
      for (let p = 1; p <= cfg.passes; p++) {
        generation++;
        let outcome: GenerationOutcome;
        try {
          outcome = await runGeneration(
            evalCase,
            model,
            p,
            skillPrompt,
            seedPrompt,
          );
        } catch (err) {
          // Hard backstop: a harness bug must fail one cell, not the matrix.
          outcome = {
            transcript: {
              caseId: evalCase.id,
              model,
              pass: p,
              prose: "",
              toolCalls: [],
              error: `harness exception: ${(err as Error).message}`,
            },
            costUsd: 0,
            wallMs: 0,
            numTurns: 0,
            apiKeySource: null,
          };
        }

        const result = grade(outcome.transcript, evalCase);
        transcripts.push(outcome.transcript);
        runs.push(result);
        totalCostUsd += outcome.costUsd;
        if (outcome.apiKeySource) authSources.add(outcome.apiKeySource);

        const status =
          result.hardFails.length > 0
            ? "HARDFAIL"
            : result.ok
              ? "ok"
              : "softfail";
        const errSuffix = outcome.transcript.error
          ? ` · error: ${outcome.transcript.error}`
          : "";
        console.log(
          `[${generation}/${totalGenerations}] ${evalCase.id} · ${model} · pass ${p} → ${status} ` +
            `(${(outcome.wallMs / 1000).toFixed(1)}s, ${outcome.numTurns} turns, cost $${outcome.costUsd.toFixed(4)}, ` +
            `cumulative $${totalCostUsd.toFixed(4)})${errSuffix}`,
        );
        if (status !== "ok") {
          for (const f of result.hardFails) console.log(`    HARD: ${f}`);
          for (const f of result.softFails) console.log(`    soft: ${f}`);
        }
      }
    }
  }

  const wallMs = Date.now() - runStarted;
  console.log(
    `[done] ${runs.length} generations in ${(wallMs / 60000).toFixed(1)} min · ` +
      `cumulative total_cost_usd $${totalCostUsd.toFixed(4)} (expected $0 on subscription)`,
  );
  console.log(
    `[auth] apiKeySource observed: ${[...authSources].join(", ") || "(none reported)"} — 'none'/'oauth' = subscription login, no API key`,
  );

  // ── Write results ──
  const resultsDir = path.join(process.cwd(), "evals", "results");
  await mkdir(resultsDir, { recursive: true });
  // ISO timestamp with ':' is not a legal Windows filename — swap for '-'.
  const stamp = new Date()
    .toISOString()
    .replace(/:/g, "-")
    .replace(/\.\d+Z$/, "Z");

  const resultsFile: EvalResultsFile = {
    harness: "subscription",
    runs,
    transcripts,
  };
  const jsonPath = path.join(resultsDir, `${stamp}-subscription.json`);
  await writeFile(jsonPath, JSON.stringify(resultsFile, null, 2), "utf8");

  const reportPath = path.join(resultsDir, `${stamp}-subscription-report.md`);
  await writeFile(
    reportPath,
    buildReport(cfg, runs, transcripts, totalCostUsd, wallMs, authSources),
    "utf8",
  );

  console.log(`[out] results: ${jsonPath}`);
  console.log(`[out] report:  ${reportPath}`);
}

main().catch((err) => {
  console.error(`[fatal] ${(err as Error).stack ?? err}`);
  process.exit(1);
});
