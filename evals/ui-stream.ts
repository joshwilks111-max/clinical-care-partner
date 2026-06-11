// evals/ui-stream.ts
//
// Pure parser: AI SDK v6 UI-message SSE stream → { prose, toolCalls, error? }.
//
// Wire format produced by toUIMessageStreamResponse():
//   data: <JSON UIMessageChunk>\n\n
//   ...
//   data: [DONE]\n\n
//
// Chunk types consumed (from node_modules/ai/dist/index.d.ts UIMessageChunk):
//   text-delta             → { type, id, delta }     — accumulate into prose
//   tool-input-available   → { type, toolCallId, toolName, input }
//   tool-output-available  → { type, toolCallId, output }
//   error                  → { type, errorText }       — set error in result
//
// All other chunk types (start, finish, start-step, finish-step, text-start,
// text-end, reasoning-*, source-*, tool-input-start, tool-input-delta, …)
// are tolerated and silently ignored.

import type { EvalToolCall } from "./types";

export interface ParsedStream {
  prose: string;
  toolCalls: EvalToolCall[];
  error?: string;
}

/** Strip mcp__<server>__ prefix — matches normalisation in grade.ts. */
function normaliseName(name: string): string {
  return name.replace(/^mcp__[^_]+(?:__[^_]+)*?__/, "");
}

/**
 * Parse an AI SDK v6 UI-message SSE stream from a Fetch Response.
 *
 * Reads the response body as text, splits on the SSE framing
 * (`data: ...\n\n` / `data: [DONE]\n\n`), and extracts prose + tool calls.
 *
 * Throws only on unrecoverable stream read failures; application-level
 * errors (stream error chunks) are surfaced in ParsedStream.error.
 */
export async function parseUIStream(response: Response): Promise<ParsedStream> {
  const body = await response.text();
  return parseUIStreamText(body);
}

/**
 * Parse raw SSE text (for testing without a live HTTP response).
 * Exported so unit tests can pass hand-written fixture strings directly.
 */
export function parseUIStreamText(sseText: string): ParsedStream {
  const prose: string[] = [];
  // Map toolCallId → { toolName, input } so we can pair with output chunks.
  const pendingInputs = new Map<string, { toolName: string; input: unknown }>();
  const toolCalls: EvalToolCall[] = [];
  let error: string | undefined;

  // Split on the SSE event boundary: "data: ...\n\n"
  const lines = sseText.split("\n");

  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith("data:")) continue;

    const payload = line.slice(5).trim();
    if (payload === "[DONE]") break;

    let chunk: Record<string, unknown>;
    try {
      chunk = JSON.parse(payload) as Record<string, unknown>;
    } catch {
      // Malformed JSON line — skip, don't throw.
      continue;
    }

    const type = chunk["type"] as string | undefined;

    switch (type) {
      case "text-delta": {
        const delta = chunk["delta"];
        if (typeof delta === "string") {
          prose.push(delta);
        }
        break;
      }

      case "tool-input-available": {
        const toolCallId = chunk["toolCallId"] as string | undefined;
        const toolName = chunk["toolName"] as string | undefined;
        if (toolCallId && toolName) {
          pendingInputs.set(toolCallId, {
            toolName: normaliseName(toolName),
            input: chunk["input"] ?? {},
          });
        }
        break;
      }

      case "tool-output-available": {
        const toolCallId = chunk["toolCallId"] as string | undefined;
        const output = chunk["output"];
        if (toolCallId) {
          const pending = pendingInputs.get(toolCallId);
          if (pending) {
            toolCalls.push({
              name: pending.toolName,
              input: pending.input,
              output,
            });
            pendingInputs.delete(toolCallId);
          } else {
            // Output with no matching input (shouldn't happen in practice, but
            // we still record it so grading can flag the anomaly).
            toolCalls.push({
              name: "unknown",
              input: {},
              output,
            });
          }
        }
        break;
      }

      case "error": {
        const errorText = chunk["errorText"];
        error =
          typeof errorText === "string" ? errorText : "unknown stream error";
        break;
      }

      // All other types (start, finish, start-step, finish-step, text-start,
      // text-end, reasoning-*, source-*, tool-input-start, tool-input-delta,
      // tool-input-error, tool-output-error, tool-output-denied, abort, …)
      // are intentionally ignored.
      default:
        break;
    }
  }

  return {
    prose: prose.join(""),
    toolCalls,
    ...(error !== undefined ? { error } : {}),
  };
}
