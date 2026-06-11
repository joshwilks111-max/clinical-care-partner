// evals/ui-stream.test.ts
//
// Vitest unit tests for the parseUIStreamText() parser in evals/ui-stream.ts.
//
// Coverage:
//   1. text-only response         — accumulates text-delta prose, no toolCalls
//   2. text + 2 tool calls        — tool-input-available + tool-output-available
//                                   pairs paired by toolCallId, names normalised
//   3. error chunk                — error field set, partial prose preserved
//   4. unknown chunk types        — silently ignored, no throw
//   5. real wire format fixture   — constructed via createUIMessageStream +
//                                   JsonToSseTransformStream from the ai package
//                                   itself, piped through the parser (pins to
//                                   the real SSE wire format)
//   6. mcp__ prefix stripping     — tool name normalised in output
//   7. [DONE] terminates parsing  — lines after [DONE] are ignored
//   8. malformed JSON line        — skipped without throwing
//   9. output with no matching input — recorded as "unknown" tool

import { describe, it, expect } from "vitest";
import { parseUIStreamText, parseUIStream } from "./ui-stream";
import {
  createUIMessageStream,
  JsonToSseTransformStream,
  createUIMessageStreamResponse,
} from "ai";

// ─── SSE fixture helpers ──────────────────────────────────────────────────────

/** Build a raw SSE string from an array of chunk objects + [DONE] terminator. */
function sse(chunks: unknown[]): string {
  return (
    chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") +
    "data: [DONE]\n\n"
  );
}

// ─── 1. Text-only response ────────────────────────────────────────────────────

describe("parseUIStreamText — text-only", () => {
  it("accumulates text-delta deltas into prose, no toolCalls", () => {
    const fixture = sse([
      { type: "start" },
      { type: "text-start", id: "t1" },
      { type: "text-delta", id: "t1", delta: "Hello " },
      { type: "text-delta", id: "t1", delta: "world." },
      { type: "text-end", id: "t1" },
      { type: "finish" },
    ]);

    const result = parseUIStreamText(fixture);

    expect(result.prose).toBe("Hello world.");
    expect(result.toolCalls).toHaveLength(0);
    expect(result.error).toBeUndefined();
  });
});

// ─── 2. Text + 2 tool calls ───────────────────────────────────────────────────

describe("parseUIStreamText — text + 2 tool calls", () => {
  it("pairs tool-input-available with tool-output-available by toolCallId", () => {
    const fixture = sse([
      { type: "start" },
      { type: "text-start", id: "t1" },
      { type: "text-delta", id: "t1", delta: "Loading guideline." },
      { type: "text-end", id: "t1" },
      {
        type: "tool-input-available",
        toolCallId: "call_1",
        toolName: "load_guideline",
        input: { guideline: "croup", region: "NZ" },
      },
      {
        type: "tool-output-available",
        toolCallId: "call_1",
        output: { status: "ok", guideline_id: "starship-croup-2020" },
      },
      {
        type: "tool-input-available",
        toolCallId: "call_2",
        toolName: "calculate_dose",
        input: {
          guideline_id: "starship-croup-2020",
          dose_rule_id: "croup-dex-moderate",
          weight_kg: 14.2,
        },
      },
      {
        type: "tool-output-available",
        toolCallId: "call_2",
        output: {
          status: "ok",
          tool_call_id: "calc_abc123",
          drug: "dexamethasone",
          route: "PO",
        },
      },
      { type: "text-start", id: "t2" },
      { type: "text-delta", id: "t2", delta: " Dose calculated." },
      { type: "text-end", id: "t2" },
      { type: "finish" },
    ]);

    const result = parseUIStreamText(fixture);

    expect(result.prose).toBe("Loading guideline. Dose calculated.");
    expect(result.toolCalls).toHaveLength(2);

    const [lg, cd] = result.toolCalls;
    expect(lg.name).toBe("load_guideline");
    expect(lg.input).toEqual({ guideline: "croup", region: "NZ" });
    expect((lg.output as Record<string, unknown>)["status"]).toBe("ok");

    expect(cd.name).toBe("calculate_dose");
    expect((cd.output as Record<string, unknown>)["drug"]).toBe(
      "dexamethasone",
    );

    expect(result.error).toBeUndefined();
  });
});

// ─── 3. Error chunk ───────────────────────────────────────────────────────────

describe("parseUIStreamText — error chunk", () => {
  it("sets error field; preserves any prose accumulated before the error", () => {
    const fixture = sse([
      { type: "text-delta", id: "t1", delta: "Partial text." },
      { type: "error", errorText: "Model overload — please retry." },
    ]);

    const result = parseUIStreamText(fixture);

    expect(result.prose).toBe("Partial text.");
    expect(result.error).toBe("Model overload — please retry.");
    expect(result.toolCalls).toHaveLength(0);
  });

  it("uses 'unknown stream error' when errorText is missing", () => {
    const fixture = sse([{ type: "error" }]);

    const result = parseUIStreamText(fixture);

    expect(result.error).toBe("unknown stream error");
  });
});

// ─── 4. Unknown chunk types silently ignored ──────────────────────────────────

describe("parseUIStreamText — unknown chunk types", () => {
  it("unknown types do not throw and do not pollute toolCalls or prose", () => {
    const fixture = sse([
      { type: "reasoning-start", id: "r1" },
      { type: "reasoning-delta", id: "r1", delta: "Let me think…" },
      { type: "reasoning-end", id: "r1" },
      { type: "source-url", sourceId: "s1", url: "https://example.com" },
      { type: "completely-made-up-future-type", data: 42 },
      { type: "text-delta", id: "t1", delta: "Answer." },
    ]);

    expect(() => parseUIStreamText(fixture)).not.toThrow();
    const result = parseUIStreamText(fixture);
    expect(result.prose).toBe("Answer.");
    expect(result.toolCalls).toHaveLength(0);
    expect(result.error).toBeUndefined();
  });
});

// ─── 5. Real wire format via ai package createUIMessageStream ─────────────────

describe("parseUIStream — real wire format (ai package)", () => {
  it("parses a stream built by createUIMessageStream + JsonToSseTransformStream", async () => {
    // Build a real UIMessageChunk stream using the ai package's own stream
    // builder, then pipe through JsonToSseTransformStream (same transform that
    // toUIMessageStreamResponse uses) and collect as text.
    const chunkStream = createUIMessageStream({
      execute({ writer }) {
        writer.write({ type: "text-start", id: "tx1" });
        writer.write({ type: "text-delta", id: "tx1", delta: "Real " });
        writer.write({ type: "text-delta", id: "tx1", delta: "wire." });
        writer.write({ type: "text-end", id: "tx1" });
        writer.write({
          type: "tool-input-available",
          toolCallId: "tc_real",
          toolName: "load_guideline",
          input: { guideline: "croup", region: "NZ" },
        });
        writer.write({
          type: "tool-output-available",
          toolCallId: "tc_real",
          output: { status: "ok" },
        });
      },
    });

    // Build the Response the same way toUIMessageStreamResponse does.
    const response = createUIMessageStreamResponse({ stream: chunkStream });

    const result = await parseUIStream(response);

    expect(result.prose).toBe("Real wire.");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe("load_guideline");
    expect(
      (result.toolCalls[0].output as Record<string, unknown>)["status"],
    ).toBe("ok");
    expect(result.error).toBeUndefined();
  });
});

// ─── 6. mcp__ prefix stripping ────────────────────────────────────────────────

describe("parseUIStreamText — mcp__ prefix stripping", () => {
  it("strips mcp__server__ prefix from tool names", () => {
    const fixture = sse([
      {
        type: "tool-input-available",
        toolCallId: "c1",
        toolName: "mcp__evals__calculate_dose",
        input: {},
      },
      {
        type: "tool-output-available",
        toolCallId: "c1",
        output: { status: "ok" },
      },
    ]);

    const result = parseUIStreamText(fixture);

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe("calculate_dose");
  });
});

// ─── 7. [DONE] terminates parsing ────────────────────────────────────────────

describe("parseUIStreamText — [DONE] terminates parsing", () => {
  it("lines after [DONE] are not parsed", () => {
    // Manually build SSE text with content after [DONE].
    const fixture =
      'data: {"type":"text-delta","id":"t1","delta":"Before."}\n\n' +
      "data: [DONE]\n\n" +
      'data: {"type":"text-delta","id":"t1","delta":"After."}\n\n';

    const result = parseUIStreamText(fixture);

    expect(result.prose).toBe("Before.");
  });
});

// ─── 8. Malformed JSON line skipped ──────────────────────────────────────────

describe("parseUIStreamText — malformed JSON", () => {
  it("malformed JSON data line is skipped without throwing", () => {
    const fixture =
      'data: {"type":"text-delta","id":"t1","delta":"OK."}\n\n' +
      "data: {not valid json\n\n" +
      "data: [DONE]\n\n";

    expect(() => parseUIStreamText(fixture)).not.toThrow();
    const result = parseUIStreamText(fixture);
    expect(result.prose).toBe("OK.");
  });
});

// ─── 9. Output with no matching input ────────────────────────────────────────

describe("parseUIStreamText — orphaned tool-output-available", () => {
  it("output with no matching input recorded as 'unknown' tool", () => {
    const fixture = sse([
      {
        type: "tool-output-available",
        toolCallId: "orphan_1",
        output: { status: "ok", note: "orphan" },
      },
    ]);

    const result = parseUIStreamText(fixture);

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe("unknown");
    expect(
      (result.toolCalls[0].output as Record<string, unknown>)["note"],
    ).toBe("orphan");
  });
});
