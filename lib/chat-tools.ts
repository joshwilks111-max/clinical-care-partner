// lib/chat-tools.ts
//
// HARNESS TOOL FACTORY — the 4 AI SDK tool definitions extracted from
// app/api/chat/route.ts so eval harnesses can substitute mock tool returns
// without touching the live route or the real implementations.
//
// DESIGN:
//   createChatTools({ region, overrides? }) returns a plain object whose
//   shape is identical to the `tools:` argument streamText expects. The route
//   calls it with no overrides; an eval harness passes a `mock_tool_returns`
//   map so it can drive the tool loop deterministically without hitting the
//   real registry or the fs.
//
//   Override semantics: if `overrides[toolName]` is present its function is
//   called INSTEAD OF the real execute body. The override receives the same
//   input the real execute would receive and must return a compatible value
//   (the harness contract; TypeScript enforces input shape only).
//
// SAFETY SPINE (preserved verbatim from the route):
//   - The LLM NEVER authors a number. tools/calculate_dose.ts owns every dose
//     value; the tool call arguments (guideline_id, dose_rule_id, weight_kg)
//     are all LLM-authored but the numeric output is deterministic registry math.
//   - Refusals are STRUCTURED RETURNS from all 4 tools (never thrown).
//   - The cookie region is AUTHORITATIVE for load_guideline (F-1 fix): the
//     model's toolRegion is ignored; `region` from the factory arg wins.

import { z } from "zod";
import { calculate_dose } from "@/tools/calculate_dose";
import { load_guideline } from "@/tools/load_guideline";
import { get_reassessment_plan } from "@/tools/get_reassessment_plan";
import { ask_user } from "@/tools/ask_user";
import { getDoseRule, getGuideline } from "@/registry/guidelines";
import type { Region } from "@/lib/region";

// ---------------------------------------------------------------------------
// The 4 tool names as a literal union — used to key the overrides map.
// ---------------------------------------------------------------------------

export type ToolName =
  | "load_guideline"
  | "calculate_dose"
  | "get_reassessment_plan"
  | "ask_user";

// ---------------------------------------------------------------------------
// Factory arg shape.
// ---------------------------------------------------------------------------

export interface CreateChatToolsOptions {
  /** The authoritative session region (resolved from the region cookie). */
  region: Region;
  /**
   * Per-tool execute overrides. When a key is present its function replaces
   * the real execute body. Intended for eval harnesses injecting
   * `mock_tool_returns` so the tool loop runs deterministically.
   *
   * The override receives the same typed input the real execute would receive
   * and must return a value compatible with the tool's normal output shape.
   *
   * The route itself passes no overrides.
   */
  overrides?: Partial<Record<ToolName, (input: unknown) => unknown>>;
}

// ---------------------------------------------------------------------------
// Factory.
// ---------------------------------------------------------------------------

/**
 * Build the 4 harness tools (load_guideline, calculate_dose,
 * get_reassessment_plan, ask_user) ready to pass as `tools:` to streamText.
 *
 * @example
 * // Route (no overrides):
 * const tools = createChatTools({ region });
 * streamText({ ..., tools });
 *
 * @example
 * // Eval harness (mock returns):
 * const tools = createChatTools({
 *   region: "NZ",
 *   overrides: { calculate_dose: () => mockReturn },
 * });
 */
export function createChatTools({
  region,
  overrides = {},
}: CreateChatToolsOptions) {
  return {
    // ── load_guideline ─────────────────────────────────────────────────────
    // Retrieval: (condition, region) → typed guideline payload. The tool
    // owns lookup; the LLM passes only the string keys.
    load_guideline: {
      description:
        "Retrieve the clinical guideline payload for a (condition, region) pair. Returns severity_rows, dose_rules, differential_check, and reassessment_plans. Call this first for any new patient presentation.",
      inputSchema: z.object({
        condition: z
          .string()
          .describe("The clinical condition to look up (e.g. 'croup')."),
        region: z
          .enum(["NZ", "AU"])
          .optional()
          .describe(
            "Jurisdiction (NZ or AU). Defaults to the session region if omitted.",
          ),
      }),
      execute: async (
        input: { condition: string; region?: "NZ" | "AU" },
        { toolCallId }: { toolCallId: string },
      ) => {
        if (overrides.load_guideline) {
          return overrides.load_guideline(input);
        }
        // F-1 fix: the cookie region is AUTHORITATIVE. Previously this was
        // `toolRegion ?? region`, which let the model's guessed region win
        // over the UI toggle — so toggling to AU with a free-typed note
        // still served NZ (the model defaults to NZ). The toggle is the
        // single source of truth for jurisdiction, so the server value
        // wins. We only honour the model's toolRegion when it AGREES with
        // the session, or when the model names a region the session didn't
        // set (defensive — the session always sets one via the cookie
        // default, so in practice `region` always wins). Same posture as
        // the dose spine: the server owns the fact, the model cannot
        // override it. If a future feature needs per-message region
        // override, it should flow through a new cookie/UI control, not a
        // model guess.
        const effectiveRegion = region;
        const result = load_guideline(input.condition, effectiveRegion);
        return { ...result, tool_call_id: toolCallId };
      },
    },

    // ── calculate_dose ─────────────────────────────────────────────────────
    // THE SAFETY SPINE — the LLM passes only string ids + a numeric
    // weight. The tool looks up the rule itself and owns all math.
    // See tools/calculate_dose.ts → INVARIANT block.
    calculate_dose: {
      description:
        "Calculate the exact weight-based dose for a given guideline rule. The LLM MUST pass guideline_id and dose_rule_id exactly as returned by load_guideline. The tool owns all arithmetic — never compute a dose number yourself.",
      inputSchema: z.object({
        guideline_id: z
          .string()
          .describe("Guideline id from load_guideline result."),
        dose_rule_id: z
          .string()
          .describe("Dose rule id from load_guideline.dose_rules."),
        weight_kg: z
          .number()
          .describe(
            "Patient weight in kilograms (must be numeric, not a string).",
          ),
      }),
      execute: async (
        input: {
          guideline_id: string;
          dose_rule_id: string;
          weight_kg: number;
        },
        { toolCallId }: { toolCallId: string },
      ) => {
        if (overrides.calculate_dose) {
          return overrides.calculate_dose(input);
        }
        const result = calculate_dose(
          input.guideline_id,
          input.dose_rule_id,
          input.weight_kg,
        );

        // On a successful dose, project the registry fields the DoseCard
        // needs (severity_row label, max_mg cap, source_version + url) onto
        // the result. This keeps the SAFETY SPINE intact — numbers still
        // come from the deterministic tool, the model never authors them —
        // while giving the client one self-contained payload to render.
        //
        // We look up max_mg / source_version / source_url from the dose
        // rule itself, and the severity_row label by reverse-mapping the
        // severity_rows[] array against the rule id (a row's
        // applies_to_dose_rule_id points at the rule it dose-routes to).
        // If two rows share the same rule (mild + moderate both → croup-
        // dex-moderate), we surface the higher-acuity label so the audit
        // trail records the row that triggered escalation criteria.
        if (result.kind === "dose") {
          const rule = getDoseRule(input.guideline_id, input.dose_rule_id);
          const guideline = getGuideline(input.guideline_id);
          const severityRow =
            guideline?.severity_rows
              .filter((r) => r.applies_to_dose_rule_id === input.dose_rule_id)
              .map((r) => r.label)
              .sort()
              .reverse()[0] ?? "unspecified";
          return {
            ...result,
            tool_call_id: toolCallId,
            // Card-facing fields — projected from the registry rule, NOT
            // model-authored. The DoseCardProps shape expects these.
            severity_row: severityRow,
            max_mg: rule?.max_mg ?? null,
            source_version: rule?.source_version ?? "",
            source_url: rule?.source_url ?? null,
          };
        }
        // Refusal path — pass through unchanged; the refusal renderer
        // reads {kind:"refusal", reason, message}.
        return { ...result, tool_call_id: toolCallId };
      },
    },

    // ── get_reassessment_plan ───────────────────────────────────────────────
    // Phase 5 state machine: when to reassess, what to watch for, next
    // branches. Returns the structured plan or a typed refusal. The tool
    // owns lookup; the LLM passes only string/label keys.
    get_reassessment_plan: {
      description:
        "Retrieve the reassessment timing and watch-for signs for a given guideline, dose rule, and initial severity. Call this after calculate_dose succeeds to complete the longitudinal handoff card.",
      inputSchema: z.object({
        guideline_id: z
          .string()
          .describe("Guideline id from load_guideline result."),
        dose_rule_id: z.string().describe("Dose rule id used for dosing."),
        initial_severity: z
          .string()
          .describe(
            "The severity label that drove dose selection (must match a severity_row label from load_guideline).",
          ),
      }),
      execute: async (
        input: {
          guideline_id: string;
          dose_rule_id: string;
          initial_severity: string;
        },
        { toolCallId }: { toolCallId: string },
      ) => {
        if (overrides.get_reassessment_plan) {
          return overrides.get_reassessment_plan(input);
        }
        const result = get_reassessment_plan(
          input.guideline_id,
          input.initial_severity,
          input.dose_rule_id,
        );

        // On a successful plan, project the registry shapes onto the card
        // shape:
        //   watch_for: WatchForItem[] {sign, severity_implication}
        //     → string[] ("sign — severity_implication") so the amber chips
        //     carry both the sign and what it implies clinically (the chip
        //     row would otherwise drop severity_implication entirely).
        //   next_branches: registry shape {if_severity_at_reassessment,
        //     action, setting, escalate_to, notes}
        //     → card shape {if_severity_at_reassessment, then, escalate?}
        //     where `then` is action + (escalate_to suffix when present),
        //     and `escalate` is true when the branch routes to ICU or has
        //     a non-null escalate_to (the amber-bordered "if worse" path).
        //   watch_for_summary + next_steps_summary are computed (the
        //     registry doesn't ship them; we synthesise from the plan).
        if (result.status === "ok") {
          const watchForStrings = result.watch_for.map(
            (w) => `${w.sign} — ${w.severity_implication}`,
          );
          const nextBranches = result.next_branches.map((b) => ({
            if_severity_at_reassessment: b.if_severity_at_reassessment,
            then: b.escalate_to ? `${b.action} · ${b.escalate_to}` : b.action,
            escalate:
              b.escalate_to !== null ||
              b.setting === "icu" ||
              b.setting === "continue_current",
          }));
          return {
            ...result,
            tool_call_id: toolCallId,
            // Card-facing fields (project from registry shapes).
            watch_for: watchForStrings,
            next_branches: nextBranches,
            watch_for_summary: `${watchForStrings.length} watch-for signs · ${nextBranches.length} branch options`,
            next_steps_summary: `Reassess at ${result.reassess_in_minutes} min`,
          };
        }
        // Refusal path — pass through unchanged.
        return { ...result, tool_call_id: toolCallId };
      },
    },

    // ── ask_user ────────────────────────────────────────────────────────────
    // Structured slot tool. The skill calls this when a clinically-
    // required piece of information is missing (weight, severity, region).
    // The harness UI surfaces an inline form keyed by `kind`; the
    // clinician's answer flows back via the SDK's addToolOutput path.
    ask_user: {
      description:
        "Request a missing piece of clinical information from the clinician via a structured inline form. Use when the note lacks weight, severity, or other required data. The clinician's answer is returned as `answer` in the next step.",
      inputSchema: z.object({
        kind: z
          .enum(["weight_kg", "severity", "region", "confirm", "free_text"])
          .describe(
            "The type of slot to fill. Drives which UI form variant is rendered.",
          ),
        question: z
          .string()
          .describe(
            "The question to display to the clinician (plain English, one sentence).",
          ),
      }),
      execute: async (input: {
        kind: "weight_kg" | "severity" | "region" | "confirm" | "free_text";
        question: string;
      }) => {
        if (overrides.ask_user) {
          return overrides.ask_user(input);
        }
        // The AskUserArgsSchema in tools/ask_user.ts uses `prompt` not
        // `question`. We adapt here: the harness input schema uses
        // `question` (clearer for the LLM) and calls ask_user with the
        // right shape. The empty-answer placeholder is replaced when
        // the clinician's typed reply arrives as the NEXT user turn.
        const result = ask_user({ kind: input.kind, prompt: input.question });
        // CRITICAL: project kind + question onto the tool output so the
        // chat-panel's AskUserForm renders with the right input shape +
        // the right prompt text. Without this, part.output is
        // {answer:""}, which makes chat-panel fall through to its
        // "free_text" / "Please provide more info." fallbacks — the
        // smoke-2026-05-28 bug.
        return { ...result, kind: input.kind, question: input.question };
      },
    },
  };
}
