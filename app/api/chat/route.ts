// app/api/chat/route.ts
//
// THE v3.1 HARNESS ROUTE — the thin routing shell that wires the 4 tools into
// a streaming multi-step loop and delegates all prose/clinical reasoning to
// the SKILL (skills/dose-calculator/SKILL.md). Architecture: "thin harness,
// fat skill" per D1/D10.
//
// FLOW PER REQUEST:
//   1. Parse body { messages: ModelMessage[] } → 400 on empty/missing.
//   2. Read region from cookie → "NZ" | "AU" (default NZ, never throws).
//   3. Pin originalNote from first user message → inject system context on
//      multi-turn requests (turn 2+) so the skill can cross-reference the
//      patient note without re-reading the full history.
//   4. Call streamText with the 4 harness tools (load_guideline,
//      calculate_dose, get_reassessment_plan, ask_user). The skill drives
//      the tool-call loop; the harness validates the structured output in
//      onFinish (validateResponse).
//   5. Return toUIMessageStreamResponse(). The validator output (cards +
//      refusal + blocked) is attached as an X-Validated-Response header so
//      the client can render structured cards without parsing the prose.
//
// SAFETY:
//   - The LLM NEVER authors a number. tools/calculate_dose.ts owns every dose
//     value; the tool call arguments (guideline_id, dose_rule_id, weight_kg)
//     are all LLM-authored but the numeric output is deterministic registry
//     math.
//   - Refusals are STRUCTURED RETURNS from all 4 tools (never thrown).
//   - The validator (lib/response-validator.ts) blocks any card that cites a
//     refused tool — a hard runtime guard on the judgment→execution boundary.
//   - The untrusted clinical note is DATA (wrapped by the skill's SKILL.md
//     delimiters), never instructions.
//
// EDGE CASES:
//   - Empty messages[] or no user message → 400 JSON error.
//   - streamText throws (model error, network) → 500 JSON error.
//   - onFinish with empty steps → validateResponse returns {text, refusal: null,
//     dose_card: null, reassessment_card: null} — prose-only or no-op.
//   - Tool execute throws → SDK surface as a tool error; the model handles it;
//     the validator still runs on whatever steps completed.

import { anthropic } from "@ai-sdk/anthropic";
import { streamText, stepCountIs, type ModelMessage } from "ai";
import { z } from "zod";
import { calculate_dose } from "@/tools/calculate_dose";
import { load_guideline } from "@/tools/load_guideline";
import { get_reassessment_plan } from "@/tools/get_reassessment_plan";
import { ask_user } from "@/tools/ask_user";
import { validateResponse } from "@/lib/response-validator";
import { getSystemPrompt } from "@/lib/skill-loader";
import { getRegion } from "@/lib/region";
import { newToolCallId } from "@/lib/tool-call-id";

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
 * Return the content string of the FIRST user-role message, or null if none
 * exists. The original note is pinned here so subsequent turns can reference
 * it without re-extracting it from the full history.
 */
function firstUserContent(messages: ModelMessage[]): string | null {
  for (const m of messages) {
    if (m.role === "user") {
      // In SDK 6 a user message's content may be a string or an array of parts.
      // We only need the text; if it's an array, join text parts.
      if (typeof m.content === "string") return m.content;
      if (Array.isArray(m.content)) {
        const text = m.content
          .filter((p): p is { type: "text"; text: string } => p.type === "text")
          .map((p) => p.text)
          .join(" ");
        return text || null;
      }
    }
  }
  return null;
}

/**
 * Returns true iff the message array already carries a system message whose
 * content includes the given originalNote string. Used to avoid double-
 * injecting on requests that already include a system message.
 */
function hasSystemMessage(messages: ModelMessage[]): boolean {
  return messages.some((m) => m.role === "system");
}

// ---------------------------------------------------------------------------
// POST handler.
// ---------------------------------------------------------------------------

export async function POST(request: Request): Promise<Response> {
  // ─── 1. Parse body ────────────────────────────────────────────────────────

  let messages: ModelMessage[];
  try {
    const body = (await request.json()) as { messages?: unknown };
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return Response.json(
        { error: "Request must include a non-empty `messages` array." },
        { status: 400 },
      );
    }
    messages = body.messages as ModelMessage[];
  } catch {
    return Response.json(
      { error: "Could not parse request body as JSON." },
      { status: 400 },
    );
  }

  // ─── 2. Validate there is at least one user message ───────────────────────

  const originalNote = firstUserContent(messages);
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

  // ─── 4. Optionally inject originalNote system context on turn 2+ ──────────
  //
  // On multi-turn conversations (messages.length > 1) where no system message
  // has already been provided, we prepend a minimal context block so the skill
  // can always reference the original note regardless of how far into the
  // history it is. This is deliberately narrow: we never modify single-turn
  // requests (the full note IS the first user message), and we never duplicate
  // if a system message already exists.

  const enrichedMessages: ModelMessage[] = [...messages];
  if (messages.length > 1 && !hasSystemMessage(messages)) {
    enrichedMessages.unshift({
      role: "system",
      content: `The patient under discussion: ${originalNote}`,
    } as ModelMessage);
  }

  // ─── 5. Load system prompt ────────────────────────────────────────────────

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

  // ─── 6. Call streamText with the 4 harness tools ─────────────────────────
  //
  // The tool object uses the SDK 6 `Tool` shape: { description, inputSchema,
  // execute }. Each execute wraps the imported pure function and attaches a
  // harness-generated `tool_call_id` so the validator can join prose fences
  // to tool results by id.
  //
  // IMPORTANT: tool_call_id in the execute return is NOT the SDK's internal
  // toolCallId (which the SDK manages). It is a harness-level id that the
  // SKILL embeds in its fenced JSON blocks; the validator uses it to look up
  // the matching structured output. See lib/tool-call-id.ts and
  // lib/response-validator.ts for the join contract.

  // Shared mutable slot for the validator result. Written inside onFinish
  // (which runs before the stream drains) and read when building the response
  // headers. Using let + assignment (not a ref object) is safe because
  // onFinish is guaranteed to complete before toUIMessageStreamResponse()
  // resolves the final bytes to the client.
  let validatedResult: ReturnType<typeof validateResponse> | null = null;

  // ─── 6 + 7. streamText → validate → stream response ───────────────────────
  //
  // Structured in a single try/catch so the streamResult local is always
  // initialised before toUIMessageStreamResponse() is called. TypeScript
  // cannot narrow across a try/catch boundary for a pre-declared variable
  // whose assignment happens inside the block, so we compute the Response
  // inside the try and early-return the 500 on error.
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
          execute: async ({ condition, region: toolRegion }) => {
            const effectiveRegion = toolRegion ?? region;
            const callId = newToolCallId();
            const result = load_guideline(condition, effectiveRegion);
            // Merge callId into the result so the skill can embed it in
            // fenced blocks; the validator joins on it.
            return { ...result, tool_call_id: callId };
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
          execute: async ({ guideline_id, dose_rule_id, weight_kg }) => {
            const callId = newToolCallId();
            const result = calculate_dose(
              guideline_id,
              dose_rule_id,
              weight_kg,
            );
            return { ...result, tool_call_id: callId };
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
          execute: async ({ guideline_id, dose_rule_id, initial_severity }) => {
            const callId = newToolCallId();
            const result = get_reassessment_plan(
              guideline_id,
              initial_severity,
              dose_rule_id,
            );
            return { ...result, tool_call_id: callId };
          },
        },

        // ── ask_user ─────────────────────────────────────────────────────
        // Structured slot tool. The skill calls this when a clinically-
        // required piece of information is missing (weight, severity, region).
        // The harness UI surfaces an inline form keyed by `kind`; the
        // clinician's answer flows back as the tool result `{ answer: string }`.
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
            // right shape. The empty-answer placeholder is replaced by the
            // harness UI with the real clinician input before the next turn.
            const result = ask_user({ kind, prompt: question });
            return result;
          },
        },
      },

      // ── onFinish: validate the completed multi-step response ─────────────
      //
      // Runs after ALL steps complete (per D2). Walks every step's toolResults
      // and aggregates prose to extract + validate fenced JSON blocks. The
      // result is stored in the shared `validatedResult` slot and attached
      // to the response as a header so the client can render structured cards
      // without parsing the prose stream.
      onFinish: async (event) => {
        // The OnFinishEvent.steps is StepResult[], each with .text and
        // .toolResults (TypedToolResult[]). The validator's OnFinishLike
        // interface matches this shape structurally — cast is safe.
        validatedResult = validateResponse(
          event as Parameters<typeof validateResponse>[0],
        );
      },
    });

    // ─── 7. Return the streaming response with validator metadata ───────────
    //
    // DELIVERY STRATEGY:
    // We await streamResult.steps (a PromiseLike that "automatically consumes
    // the stream" per the SDK docs) to ensure the full model generation is
    // complete and onFinish has fired BEFORE we build the response. This gives
    // us a populated validatedResult to attach as a response header.
    //
    // The tradeoff: the route buffers the full generation before sending the
    // SSE body to the client (true chunk-by-chunk streaming is not realised).
    // For this care-partner harness that is acceptable — clinical notes are
    // short, the multi-step loop is bounded at 5 steps, and the structured
    // cards (dose_card, reassessment_card) are only meaningful when the full
    // response is validated. The SSE wire format is preserved for the client
    // SDK's useChat hook.
    //
    // The header approach works because the validator result is always small
    // (JSON with 1-2 cards). If it ever exceeds HTTP header limits the
    // delivery mechanism should move to a trailing SSE data event.
    await streamResult.steps;

    const streamingResponse = streamResult.toUIMessageStreamResponse();

    // Build a mutable response so we can append the header. Clone preserves
    // the streaming body; we only add headers.
    const responseHeaders = new Headers(streamingResponse.headers);
    if (validatedResult !== null) {
      // encodeURIComponent ensures the JSON is Latin-1-safe for HTTP headers.
      // The validator result may contain non-ASCII chars (e.g. "→" U+2192 in
      // calculation_trace strings from calculate_dose). Headers.set() rejects
      // any byte > 255 (ByteString constraint). The client decodes with
      // decodeURIComponent when reading X-Validated-Response.
      responseHeaders.set(
        "X-Validated-Response",
        encodeURIComponent(JSON.stringify(validatedResult)),
      );
    }

    return new Response(streamingResponse.body, {
      status: streamingResponse.status,
      headers: responseHeaders,
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
