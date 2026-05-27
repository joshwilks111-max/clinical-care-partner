// app/console/console.tsx
//
// The v3.1 Heidi-grammar 3-column console — state owner only.
//
// Console composes three Lane F presentational children, owns the chat
// thread state, and drives a single transport (POST /api/chat). The
// legacy turn1/turn1.5/turn2 orchestration is GONE; everything routes
// through the streamText harness.
//
//   <SessionRail>  (LEFT, 220px)  — 5 demo cases, click → load note + reset chat
//   <NotePane>     (CENTRE, 1fr)  — note textarea + extracted-facts accordion
//   <ChatPanel>    (RIGHT, 520px) — thread + composer + suggested prompts
//
// State owned here:
//   - messages: ChatMessage[]            — the chat thread (user + assistant turns)
//   - note: string                       — the centre-pane note content
//   - originalNote: OriginalNoteSummary  — derived chip for the composer (D13)
//   - isStreaming: boolean               — true while POST /api/chat is in flight
//   - activeSessionId: string | null     — for the SessionRail active-row styling
//
// Transport (postChat helper at bottom): builds the messages array for
// /api/chat, awaits the streaming response, parses the X-Validated-Response
// header populated by the route's onFinish + response-validator. The header
// carries the dose-card / reassessment-card / refusal that the assistant
// turn renders as embedded UI cards (per AssistantContent.dose_card etc).
//
// Region: NOT owned here — RegionToggle is self-contained (reads + writes
// the `care-partner-region` cookie itself; reloads on change). Lane C's
// lib/region.ts is the cookie contract.

"use client";

import { useCallback, useMemo, useState } from "react";

import { ChatPanel, type ChatMessage } from "./chat-panel";
import { NotePane, type ExtractedFacts } from "./note-pane";
import { SessionRail, type DemoSession } from "./session-rail";
import { RegionToggle } from "./region-toggle";
import type { AnyRefusalKind } from "@/tools/types";
import type { DoseCardProps } from "./dose-card";
import type {
  ReassessmentCardProps,
  ReassessmentBranch,
} from "./reassessment-card";

// ─── Validated-response shape (mirrors lib/response-validator output) ───────
//
// The /api/chat route serialises this as JSON, URI-encodes it (because
// calculation_trace contains "→" U+2192 which is > Latin-1), and sets it
// as the X-Validated-Response header on the streaming response. We
// decode + parse it here and lift the cards onto the AssistantContent.
//
// We keep the type permissive (Record<string, unknown> for the merged
// card payloads) so a Lane B schema bump doesn't cascade here — the
// card components do the strict shape-check at render time.

interface ValidatedResponse {
  text: string;
  dose_card: Record<string, unknown> | null;
  reassessment_card: Record<string, unknown> | null;
  refusal: {
    toolName: string;
    kind: string;
    message: string;
  } | null;
  blocked?: {
    reason: string;
    detail: string;
    card_kind?: string;
  };
}

// ─── ID generator for client-side message ids ────────────────────────────────
// nanoid would be heavier; this is fine for keys (uniqueness within a
// session, not collision-safe across processes).

let _idCounter = 0;
function nextMessageId(): string {
  _idCounter += 1;
  return `m${Date.now().toString(36)}-${_idCounter}`;
}

export function Console() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [note, setNote] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  // ─── Derive originalNote chip from the first user message (D13) ──────────
  //
  // The composer's context chip shows "Jack T, 3yo, 14.2 kg · croup" or
  // similar — a one-line summary the clinician sees as the conversation
  // pin. v1 derives it from the first user message + the note. Phase 3
  // server-side extraction (out of scope) would compute it from the
  // assistant's first turn's ExtractedFacts.

  const originalNote = useMemo(() => {
    const firstUser = messages.find((m) => m.role === "user");
    if (!firstUser) return undefined;
    // Cheap heuristic: trim to ~60 chars, use the first line.
    const firstLine = firstUser.text.split("\n")[0]?.trim() ?? "";
    return {
      primary: firstLine.length > 60 ? firstLine.slice(0, 57) + "…" : firstLine,
    };
  }, [messages]);

  // ─── Submit a turn to /api/chat ──────────────────────────────────────────
  //
  // The single transport. Builds the next messages[] state (user turn
  // appended), POSTs to /api/chat, awaits the response + the
  // X-Validated-Response header, appends the assistant turn. Errors
  // surface as an assistant prose message so the thread doesn't
  // silently swallow failures.

  const submit = useCallback(
    async (userText: string, currentMessages: ChatMessage[]) => {
      const userMsg: ChatMessage = {
        id: nextMessageId(),
        role: "user",
        text: userText,
      };
      const nextMessages = [...currentMessages, userMsg];
      setMessages(nextMessages);
      setIsStreaming(true);

      try {
        const { prose, validated } = await postChat(
          // The route reads ModelMessage shape; map our ChatMessage union
          // to {role, content} pairs. Assistant turns we've already
          // rendered get their text aggregated from any prose field.
          nextMessages.map((m) =>
            m.role === "user"
              ? { role: "user" as const, content: m.text }
              : { role: "assistant" as const, content: m.content.prose ?? "" },
          ),
        );

        const assistantMsg: ChatMessage = {
          id: nextMessageId(),
          role: "assistant",
          content: {
            prose,
            dose_card: validated?.dose_card
              ? (validated.dose_card as unknown as DoseCardProps)
              : undefined,
            reassessment_card: validated?.reassessment_card
              ? toReassessmentCardProps(validated.reassessment_card)
              : undefined,
            refusal: validated?.refusal
              ? {
                  kind: validated.refusal.kind as AnyRefusalKind,
                  message: validated.refusal.message,
                }
              : undefined,
          },
        };
        setMessages([...nextMessages, assistantMsg]);
      } catch (err) {
        // Surface failure inline as an assistant prose error — never
        // crash the UI or leave the user with a half-finished thread.
        const message =
          err instanceof Error
            ? err.message
            : "Could not reach /api/chat.";
        setMessages([
          ...nextMessages,
          {
            id: nextMessageId(),
            role: "assistant",
            content: {
              prose: `⚠ Technical error: ${message}`,
            },
          },
        ]);
      } finally {
        setIsStreaming(false);
      }
    },
    [],
  );

  // ─── Handlers ────────────────────────────────────────────────────────────

  const onChatSubmit = useCallback(
    async (text: string) => {
      await submit(text, messages);
    },
    [submit, messages],
  );

  const onNewChat = useCallback(() => {
    setMessages([]);
    setNote("");
    setActiveSessionId(null);
  }, []);

  const onLoadCase = useCallback((session: DemoSession) => {
    // Demo-row click: load the note into the centre pane, reset the chat
    // thread, mark the rail row active. The clinician then clicks
    // submit on the chat composer (or types follow-up) to actually fire
    // a request — we deliberately don't auto-submit so the demo can be
    // edited first.
    setNote(session.note);
    setMessages([]);
    setActiveSessionId(session.id);
  }, []);

  const onNewSession = useCallback(() => {
    onNewChat();
  }, [onNewChat]);

  // For the v1 surface the note-pane is a typing surface — the
  // ExtractedFacts payload is derived server-side in a future iteration.
  // We leave it empty so the accordion shows the placeholder state.
  const facts: ExtractedFacts | undefined = undefined;

  // ─── Render — 3-column Heidi-grammar shell ───────────────────────────────
  //
  // Breakpoints per D4 (design-review 2026-05-28): 220/700/520 ≥1500px,
  // 200/1fr/480 1180–1500px, 180/1fr/420 1024–1180px. Mobile <1024px
  // deferred (TODO; see TODOS.md). The narrow-viewport banner from the
  // old shell is preserved for ≤1024px users.

  return (
    <>
      <div
        data-testid="heidi-grammar-shell"
        className="heidi-shell grid h-screen w-full grid-cols-[220px_1fr_520px]"
      >
        <SessionRail
          activeSessionId={activeSessionId ?? undefined}
          onLoadCase={onLoadCase}
          onNewSession={onNewSession}
        />

        <NotePane
          note={note}
          onNoteChange={setNote}
          facts={facts}
          region="NZ"
        />

        <div className="relative flex h-full flex-col">
          {/* RegionToggle floats top-right of the chat column — self-contained,
              cookie-driven, reloads on change. */}
          <div className="absolute right-3 top-2 z-10">
            <RegionToggle />
          </div>
          <ChatPanel
            messages={messages}
            onSubmit={onChatSubmit}
            onNewChat={onNewChat}
            isStreaming={isStreaming}
            originalNote={originalNote}
          />
        </div>
      </div>

      {/* Narrow-viewport banner — preserved from the prior shell. CSS-only
          so no hydration risk. Shell above is hidden in CSS at <1024px;
          this banner is hidden ≥1024px. */}
      <div
        data-testid="narrow-viewport-banner"
        className="narrow-viewport-banner hidden h-screen items-center justify-center bg-background px-6 text-center"
      >
        <div className="max-w-sm">
          <h1 className="text-[18px] font-semibold text-foreground">
            This demo is built for desktop.
          </h1>
          <p className="mt-2 text-[13px] text-muted-foreground">
            Open on a larger screen (≥ 1024px wide) to interact with the care
            partner.
          </p>
        </div>
      </div>
    </>
  );
}

// ─── Transport helper ───────────────────────────────────────────────────────
//
// Single fetch to /api/chat. Awaits the full response body (the route
// buffers internally per its documented trade-off — see app/api/chat/route.ts
// lines 363-380), then decodes the X-Validated-Response header to lift the
// validator's structured output back into the parent state. Cookies (the
// region cookie) are sent automatically by the browser; no manual handling.
//
// Response shape from the SDK's toUIMessageStreamResponse():
//   - Content-Type: text/event-stream
//   - Body: SSE "data: ..." frames. We aggregate the text content into a
//     single prose string for the assistant message.
//
// If the route returns 4xx/5xx the body is JSON {error}; we surface
// that as the error message.

async function postChat(
  messages: { role: "user" | "assistant"; content: string }[],
): Promise<{ prose: string; validated: ValidatedResponse | null }> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages }),
  });

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) detail = body.error;
    } catch {
      // Body wasn't JSON; keep the HTTP-status detail.
    }
    throw new Error(detail);
  }

  // Decode the X-Validated-Response header first (set BEFORE the body
  // is sent by the route per its single-request flow).
  let validated: ValidatedResponse | null = null;
  const validatedHeader = res.headers.get("X-Validated-Response");
  if (validatedHeader) {
    try {
      validated = JSON.parse(
        decodeURIComponent(validatedHeader),
      ) as ValidatedResponse;
    } catch {
      // Malformed header — leave validated = null; assistant message
      // will render prose only.
    }
  }

  // Aggregate the SSE body's text content. SDK's UI-message stream
  // protocol emits text-delta frames; we accept the simplest case (full
  // text in one frame) and the chunked case (multiple deltas).
  const proseFromValidator = validated?.text;
  let prose: string;
  if (proseFromValidator !== undefined && proseFromValidator.length > 0) {
    // Validator already aggregated all step text; use it as the source
    // of truth (matches what the validator saw + parsed for cards).
    prose = proseFromValidator;
  } else {
    // Fallback: read the body as text. For SSE responses this returns
    // the raw SSE frames; we pull out the data fields.
    const raw = await res.text();
    prose = extractTextFromSSE(raw);
  }

  return { prose, validated };
}

// ─── SSE-to-text helper ────────────────────────────────────────────────────
//
// The AI SDK's UI-message stream uses JSON-per-frame: each `data:` line is
// a small JSON object like {type:"text-delta", text:"…"} or
// {type:"text-end"}. We aggregate the text content. This is a fallback
// path; the primary path reads validated.text which is already aggregated
// by lib/response-validator.

function extractTextFromSSE(raw: string): string {
  const lines = raw.split("\n");
  let out = "";
  for (const line of lines) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const frame = JSON.parse(payload) as {
        type?: string;
        text?: string;
        delta?: string;
      };
      if (typeof frame.text === "string") out += frame.text;
      else if (typeof frame.delta === "string") out += frame.delta;
    } catch {
      // Non-JSON data line; skip.
    }
  }
  return out;
}

// ─── Reassessment card prop shaping ─────────────────────────────────────────
//
// The validator merges the get_reassessment_plan tool's typed result into
// the emitted reassessment-card. The tool returns next_branches as a
// closed-shape array but the card UI uses ReassessmentBranch{...}; we do
// a permissive cast here because the card component does the final
// shape-check at render.

function toReassessmentCardProps(
  raw: Record<string, unknown>,
): ReassessmentCardProps {
  return raw as unknown as ReassessmentCardProps;
}
