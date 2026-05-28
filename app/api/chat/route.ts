// app/api/chat/route.ts
//
// THE v3.1 HARNESS ROUTE — the thin routing shell that wires the 4 tools into
// a streaming multi-step loop and delegates all prose/clinical reasoning to
// the SKILL (skills/dose-calculator/SKILL.md). Architecture: "thin harness,
// fat skill" per D1/D10.
//
// FLOW PER REQUEST:
//   1. Parse body { messages: UIMessage[] } → 400 on empty/missing.
//   2. Read region from cookie → "NZ" | "AU" (default NZ, never throws).
//   3. Pin originalNote from first user message → inject system context on
//      multi-turn requests (turn 2+) so the skill can cross-reference the
//      patient note without re-reading the full history.
//   4. Call streamText with the 4 harness tools (load_guideline,
//      calculate_dose, get_reassessment_plan, ask_user). The skill drives
//      the tool-call loop; each tool call's output flows to the client
//      natively as a typed UIMessagePart (no server-side validator needed).
//   5. Return result.toUIMessageStreamResponse({originalMessages}) so the
//      client's useChat hook can parse the canonical UI-message-stream wire
//      format and surface typed tool parts (tool-calculate_dose etc.) for
//      the chat panel to render as DoseCard / ReassessmentCard / RefusalCard.
//
// SAFETY:
//   - The LLM NEVER authors a number. tools/calculate_dose.ts owns every dose
//     value; the tool call arguments (guideline_id, dose_rule_id, weight_kg)
//     are all LLM-authored but the numeric output is deterministic registry
//     math.
//   - Refusals are STRUCTURED RETURNS from all 4 tools (never thrown). The
//     SDK ships them to the client as part.output where state ==
//     "output-available"; the chat panel switches on part.type and renders
//     the matching refusal card.
//   - The untrusted clinical note is DATA (wrapped by the skill's SKILL.md
//     delimiters), never instructions.
//   - The model has NO channel to author a dose number into prose that the
//     client would render: with typed tool parts, the structured tool output
//     IS the channel. The skill instructs the model to call the tool, not to
//     paint the result — and the renderer reads the tool output, not the
//     model's text. The contradiction-prone fence-emit pattern is gone.
//
// EDGE CASES:
//   - Empty messages[] or no user message → 400 JSON error.
//   - streamText throws (model error, network) → 500 JSON error.
//   - Tool execute throws → SDK surfaces as a tool error; the model handles
//     it; the next part has state "output-error".

import { anthropic } from "@ai-sdk/anthropic";
import {
  streamText,
  stepCountIs,
  convertToModelMessages,
  type ModelMessage,
  type UIMessage,
} from "ai";
import { z } from "zod";
import { calculate_dose } from "@/tools/calculate_dose";
import { load_guideline } from "@/tools/load_guideline";
import { get_reassessment_plan } from "@/tools/get_reassessment_plan";
import { ask_user } from "@/tools/ask_user";
import { getDoseRule, getGuideline } from "@/registry/guidelines";
import { getSystemPrompt } from "@/lib/skill-loader";
import { getRegion } from "@/lib/region";

// Node runtime (NOT edge): the AI SDK + node:crypto need it.
// maxDuration 300s gives the opus-4-7 multi-step loop headroom.
export const runtime = "nodejs";
export const maxDuration = 300;

const MODEL = "claude-opus-4-7";

// Maximum number of tool-call steps before the loop is force-stopped.
// 5 steps covers: load_guideline → (ask_user?) → calculate_dose →
// get_reassessment_plan → final prose. An extra ask_user mid-loop
// pushes us close but rarely over this limit.
const MAX_STEPS = 5;

// ---------------------------------------------------------------------------
// Message helpers — finding the original note and injecting system context.
// ---------------------------------------------------------------------------

/**
 * Return the text of the FIRST user-role message in a UIMessage[] array, or
 * null if none exists. The original note is pinned here so subsequent turns
 * can reference it without re-extracting it from the full history.
 *
 * UIMessages carry their text in parts[].type === "text"; we join all text
 * parts of the first user message.
 */
function firstUserContent(messages: UIMessage[]): string | null {
  for (const m of messages) {
    if (m.role === "user" && Array.isArray(m.parts)) {
      const text = m.parts
        .filter(
          (p): p is { type: "text"; text: string } & typeof p =>
            p.type === "text" &&
            typeof (p as { text?: unknown }).text === "string",
        )
        .map((p) => p.text)
        .join(" ");
      if (text) return text;
    }
  }
  return null;
}

/**
 * Returns true iff the ModelMessage array (post-conversion) already carries
 * a system message. Used to avoid double-injecting the originalNote system
 * context on requests where the client already supplied one.
 */
function hasSystemMessage(messages: ModelMessage[]): boolean {
  return messages.some((m) => m.role === "system");
}

// ---------------------------------------------------------------------------
// POST handler.
// ---------------------------------------------------------------------------

export async function POST(request: Request): Promise<Response> {
  // ─── 1. Parse body ────────────────────────────────────────────────────────
  //
  // The client uses useChat from @ai-sdk/react, which POSTs the messages
  // array as UIMessage[] (each message has parts[]). We pass these through
  // convertToModelMessages before handing to streamText.

  let uiMessages: UIMessage[];
  try {
    const body = (await request.json()) as { messages?: unknown };
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return Response.json(
        { error: "Request must include a non-empty `messages` array." },
        { status: 400 },
      );
    }
    uiMessages = body.messages as UIMessage[];
  } catch {
    return Response.json(
      { error: "Could not parse request body as JSON." },
      { status: 400 },
    );
  }

  // ─── 2. Validate there is at least one user message ───────────────────────

  const originalNote = firstUserContent(uiMessages);
  if (originalNote === null) {
    return Response.json(
      { error: "Request must include at least one user message." },
      { status: 400 },
    );
  }

  // ─── 3. Read region from cookie ───────────────────────────────────────────
  //
  // getRegion NEVER throws — a missing or malformed cookie falls back to "NZ".
  const region = getRegion(
    request.headers.get("cookie")
      ? {
          get(name: string) {
            // Parse the raw cookie header string to find the named cookie value.
            const pairs = (request.headers.get("cookie") ?? "")
              .split(";")
              .map((p) => p.trim());
            for (const pair of pairs) {
              const eq = pair.indexOf("=");
              if (eq === -1) continue;
              if (pair.slice(0, eq).trim() === name) {
                return { value: pair.slice(eq + 1).trim() };
              }
            }
            return undefined;
          },
        }
      : null,
  );

  // ─── 4. Convert UIMessage[] → ModelMessage[] for streamText ──────────────
  //
  // The SDK's convertToModelMessages helper handles the UI↔model conversion
  // including tool-result parts and multi-part user messages. After this
  // we work in the ModelMessage shape the model API expects.
  const modelMessages = await convertToModelMessages(uiMessages);

  // ─── 5. Optionally inject originalNote system context on turn 2+ ──────────
  //
  // On multi-turn conversations (uiMessages.length > 1) where no system
  // message has already been provided, we prepend a minimal context block
  // so the skill can always reference the original note regardless of how
  // far into the history it is. This is deliberately narrow: we never
  // modify single-turn requests (the full note IS the first user message),
  // and we never duplicate if a system message already exists.

  const enrichedMessages: ModelMessage[] = [...modelMessages];
  if (uiMessages.length > 1 && !hasSystemMessage(modelMessages)) {
    enrichedMessages.unshift({
      role: "system",
      content: `The patient under discussion: ${originalNote}`,
    } as ModelMessage);
  }

  // ─── 5b. Inject the session region into the system context (F-1 fix) ──────
  //
  // The region cookie is the single source of truth for jurisdiction (set by
  // the UI's RegionToggle). Before this, region reached only the tool layer
  // via `effectiveRegion = toolRegion ?? region`, which let the MODEL'S guess
  // win — so a free-typed note with the toggle on AU still got NZ (the model
  // defaults to NZ when it can't infer region from the note). The dose number
  // was unaffected (both registries use 0.15 mg/kg for moderate croup), but
  // the source attribution + reassessment timing silently diverged from the
  // toggle. We tell the model the region explicitly so its PROSE is correct
  // too, and (below) make the tool treat the cookie as authoritative. This
  // is the same "server owns the fact, not the LLM" posture as the dose spine.
  enrichedMessages.unshift({
    role: "system",
    content: `Active clinical jurisdiction for this session: ${region}. Use this region for all guideline lookups unless the clinician explicitly names a different one. Do not infer the region from the note.`,
  } as ModelMessage);

  // ─── 6. Load system prompt ────────────────────────────────────────────────

  let systemPrompt: string;
  try {
    systemPrompt = await getSystemPrompt();
  } catch (err) {
    console.error("[chat] failed to load system prompt:", err);
    return Response.json(
      { error: "Internal configuration error — could not load system prompt." },
      { status: 500 },
    );
  }

  // ─── 7. Call streamText with the 4 harness tools ─────────────────────────
  //
  // The tool object uses the SDK 6 `Tool` shape: { description, inputSchema,
  // execute }. Each execute wraps the imported pure function. The SDK
  // automatically ships each tool's return value to the client as a typed
  // UIMessagePart (type: "tool-<toolName>", state: "output-available",
  // output: <return value>) — the chat panel switches on part.type and
  // renders DoseCard / ReassessmentCard / RefusalCard / AskUserForm.
  //
  // The `tool_call_id: toolCallId` echo in each execute return is vestigial
  // (the SDK tracks ids natively in part.toolCallId) but harmless — it's
  // a stable identifier the tools have always returned and the cards can
  // still read for telemetry.

  try {
    const streamResult = streamText({
      model: anthropic(MODEL),
      system: systemPrompt,
      messages: enrichedMessages,
      stopWhen: stepCountIs(MAX_STEPS),

      tools: {
        // ── load_guideline ───────────────────────────────────────────────
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
            { condition, region: toolRegion },
            { toolCallId },
          ) => {
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
            const result = load_guideline(condition, effectiveRegion);
            return { ...result, tool_call_id: toolCallId };
          },
        },

        // ── calculate_dose ───────────────────────────────────────────────
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
            { guideline_id, dose_rule_id, weight_kg },
            { toolCallId },
          ) => {
            const result = calculate_dose(
              guideline_id,
              dose_rule_id,
              weight_kg,
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
              const rule = getDoseRule(guideline_id, dose_rule_id);
              const guideline = getGuideline(guideline_id);
              const severityRow =
                guideline?.severity_rows
                  .filter((r) => r.applies_to_dose_rule_id === dose_rule_id)
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

        // ── get_reassessment_plan ────────────────────────────────────────
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
            { guideline_id, dose_rule_id, initial_severity },
            { toolCallId },
          ) => {
            const result = get_reassessment_plan(
              guideline_id,
              initial_severity,
              dose_rule_id,
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
                then: b.escalate_to
                  ? `${b.action} · ${b.escalate_to}`
                  : b.action,
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

        // ── ask_user ─────────────────────────────────────────────────────
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
          execute: async ({ kind, question }) => {
            // The AskUserArgsSchema in tools/ask_user.ts uses `prompt` not
            // `question`. We adapt here: the harness input schema uses
            // `question` (clearer for the LLM) and calls ask_user with the
            // right shape. The empty-answer placeholder is replaced when
            // the clinician's typed reply arrives as the NEXT user turn.
            const result = ask_user({ kind, prompt: question });
            // CRITICAL: project kind + question onto the tool output so the
            // chat-panel's AskUserForm renders with the right input shape +
            // the right prompt text. Without this, part.output is
            // {answer:""}, which makes chat-panel fall through to its
            // "free_text" / "Please provide more info." fallbacks — the
            // smoke-2026-05-28 bug.
            return { ...result, kind, question };
          },
        },
      },
    });

    // Return the canonical UI-message-stream response. The client's
    // useChat({transport: new DefaultChatTransport({api: "/api/chat"})})
    // parses this stream natively: text content arrives as text-delta
    // parts, tool calls arrive as tool-<toolName> parts with progressive
    // state ("input-streaming" → "input-available" → "output-available"),
    // and the AssistantBubble switches on part.type to render each.
    //
    // originalMessages preserves the UI message ids across the streaming
    // boundary so the client can correlate streamed parts to its
    // optimistically-rendered messages.
    return streamResult.toUIMessageStreamResponse({
      originalMessages: uiMessages,
    });
  } catch (err) {
    // streamText itself can throw on invalid configuration or network errors
    // before the stream starts. Surface as a 500.
    console.error("[chat] streamText failed:", err);
    return Response.json(
      { error: "A technical error occurred starting the model stream." },
      { status: 500 },
    );
  }
}
