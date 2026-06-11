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
import { getSystemPrompt } from "@/lib/skill-loader";
import { getRegion } from "@/lib/region";
import { createChatTools } from "@/lib/chat-tools";

// Node runtime (NOT edge): the AI SDK + node:crypto need it.
// maxDuration 300s gives the opus-4-7 multi-step loop headroom.
export const runtime = "nodejs";
export const maxDuration = 300;

const MODEL = process.env.CHAT_MODEL ?? "claude-opus-4-7";

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
  // The cacheControl breakpoint here caches the entire stable prompt prefix —
  // tool definitions + the ~21KB SKILL.md system prompt + this region line —
  // across steps within a turn (≤5) and across turns/sessions for 5 minutes.
  // Cached reads bill at 0.1×, so this cuts input cost ~10× on every step
  // after the first. Only two cache variants exist (NZ/AU); the per-
  // conversation pinned-note system message (step 5 above) lands AFTER this
  // message on the wire, so it never fragments the cache. Wire content is
  // byte-identical with or without this annotation — caching is metadata.
  enrichedMessages.unshift({
    role: "system",
    content: `Active clinical jurisdiction for this session: ${region}. Use this region for all guideline lookups unless the clinician explicitly names a different one. Do not infer the region from the note.`,
    providerOptions: {
      anthropic: { cacheControl: { type: "ephemeral" } },
    },
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
  // createChatTools returns the tool definitions (description + inputSchema +
  // execute) ready to pass directly as `tools:` to streamText. Each execute
  // wraps the imported pure function. The SDK automatically ships each tool's
  // return value to the client as a typed UIMessagePart (type:
  // "tool-<toolName>", state: "output-available", output: <return value>) —
  // the chat panel switches on part.type and renders DoseCard /
  // ReassessmentCard / RefusalCard / AskUserForm.
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
      tools: createChatTools({ region }),
      onFinish: ({ usage, providerMetadata }) => {
        // One line per turn in the function logs: verifies the prompt cache
        // is hitting (anthropic.cacheReadInputTokens > 0 from step 2 onward)
        // and tracks spend drivers. No clinical content is logged.
        console.log(
          `[chat] model=${MODEL} usage=${JSON.stringify(usage)} anthropic=${JSON.stringify(providerMetadata?.anthropic ?? {})}`,
        );
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
