// app/console/console.tsx
//
// The v3.1 Heidi-grammar 3-column console — state owner only.
//
// Console composes three Lane F presentational children. The chat thread
// state + transport is owned by the Vercel AI SDK's useChat hook (parses
// the canonical UI-message-stream wire format the route returns); the
// other state slots (centre note, active session, patient header) stay
// here because they're UI-only and not part of the chat protocol.
//
//   <SessionRail>  (LEFT, 220px)  — 5 demo cases, click → load note + reset chat
//   <NotePane>     (CENTRE, 1fr)  — note textarea + extracted-facts accordion
//   <ChatPanel>    (RIGHT, ≥1/3 vw) — thread + composer + suggested prompts
//
// State owned here:
//   - note: string                       — the centre-pane note content
//   - activeSessionId: string | null     — for the SessionRail active-row styling
//   - patientName / patientSubLine       — for NotePane patient header
//   - seededFirstMessageId               — id of the seeded centre-note user
//                                          message; chat-panel filters it from
//                                          the rendered thread (visible in
//                                          centre column already, would
//                                          duplicate in chat)
// State owned by useChat:
//   - messages: UIMessage[]              — full thread, parts[]-shaped
//   - status: ChatStatus                 — submitted | streaming | ready | error
//   - error: Error | undefined           — for the destructive Alert + Retry
//
// Transport: useChat parses the SDK's UI-message-stream natively. Each tool
// call from the route surfaces as a UIMessagePart with type "tool-<toolName>"
// and progressive state; chat-panel's AssistantBubble switches on part.type
// to render DoseCard / ReassessmentCard / RefusalCard / AskUserForm.
//
// Region: NOT owned here — RegionToggle is self-contained (reads + writes
// the `care-partner-region` cookie itself; reloads on change). Lane C's
// lib/region.ts is the cookie contract.

"use client";

import { useCallback, useMemo, useState } from "react";
import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithToolCalls,
  type UIMessage,
} from "ai";

import { ChatPanel } from "./chat-panel";
import { NotePane, type ExtractedFacts } from "./note-pane";
import { SessionRail, type DemoSession } from "./session-rail";

// ─── ID generator for the seeded centre-note user message ────────────────────
// useChat generates ids natively for messages it creates (via sendMessage);
// we only need our own generator for the ONE seeded message we hand it via
// setMessages. Keep it simple — uniqueness within the session is enough.

let _idCounter = 0;
function nextMessageId(): string {
  _idCounter += 1;
  return `seed-${Date.now().toString(36)}-${_idCounter}`;
}

export function Console() {
  // ─── Local state (UI-only, not part of the chat protocol) ─────────────────

  const [note, setNote] = useState("");
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  // T6 (qa-report 2026-05-28): NotePane patient header.
  // Parsed out of session.name on demo-row click (e.g. "Jack T · croup (NZ)"
  // → name "Jack T", sub "croup (NZ)"). When undefined, NotePane shows the
  // empty-state FilePlus avatar.
  const [patientName, setPatientName] = useState<string | undefined>(undefined);
  const [patientSubLine, setPatientSubLine] = useState<string | undefined>(
    undefined,
  );
  // The id of the seeded centre-note user message (if any). ChatPanel
  // filters this id out of the rendered thread so the seeded patient
  // context doesn't appear as a duplicate user bubble (it's already
  // visible in the centre column).
  const [seededFirstMessageId, setSeededFirstMessageId] = useState<
    string | undefined
  >(undefined);

  // ─── useChat — the SDK owns thread state + transport ─────────────────────
  //
  // Per @ai-sdk/react/dist/index.d.ts:39: useChat returns helpers including
  // messages, sendMessage, status, error, setMessages, regenerate. We pass
  // a DefaultChatTransport pointing at our /api/chat route and the
  // lastAssistantMessageIsCompleteWithToolCalls helper for
  // sendAutomaticallyWhen so the loop continues after each tool result
  // until the model gives a final text turn.
  //
  // The transport is memoised so we don't construct a new one on every
  // render (would tear down + recreate the chat session).

  const transport = useMemo(
    () => new DefaultChatTransport({ api: "/api/chat" }),
    [],
  );

  // `stop` is required for any caller of setMessages — see the "+ New chat"
  // race fix below. Without it, clicking New chat mid-stream clears the
  // messages array but the transport keeps writing deltas onto the empty
  // array, so the thread "un-clears" as the rest of the assistant turn
  // lands. stop() aborts the in-flight request and is a no-op if nothing
  // is streaming.
  const {
    messages,
    sendMessage,
    status,
    error,
    setMessages,
    regenerate,
    stop,
  } = useChat({
    transport,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
  });

  const isStreaming = status === "streaming" || status === "submitted";

  // ─── Derive originalNote chip from the seeded message (D13) ──────────────
  //
  // The composer chip is the patient pin — shows "Jack T · croup (NZ)" or
  // similar. v1 derives it from patientName + patientSubLine; if those are
  // absent (clinician pasted into the centre directly without a demo),
  // fall back to the first line of `note`.

  const originalNote = useMemo(() => {
    if (patientName) {
      return {
        primary: patientName,
        secondary: patientSubLine,
      };
    }
    if (note.trim()) {
      const firstLine = note.split("\n")[0]?.trim() ?? "";
      const primary =
        firstLine.length > 60 ? firstLine.slice(0, 57) + "…" : firstLine;
      return primary ? { primary } : undefined;
    }
    return undefined;
  }, [patientName, patientSubLine, note]);

  // ─── Handlers ────────────────────────────────────────────────────────────

  const onChatSubmit = useCallback(
    async (text: string) => {
      // ISSUE-001 fix lives here now via the seeded-first-message pattern:
      // when a centre note is loaded AND there are no messages yet, seed
      // the note as the first user message BEFORE the user-typed text so
      // the route's firstUserContent() pinning sees the patient note as
      // the originalNote. The seeded message is filtered out of the chat
      // panel's rendered thread (it lives in the centre column).
      //
      // If messages already exist OR there's no note, just sendMessage
      // directly. The SDK appends a user turn and POSTs.
      if (messages.length === 0 && note.trim()) {
        const seedId = nextMessageId();
        const seeded: UIMessage = {
          id: seedId,
          role: "user",
          parts: [{ type: "text", text: note.trim() }],
        };
        setMessages([seeded]);
        setSeededFirstMessageId(seedId);
      }
      await sendMessage({ text });
    },
    [messages.length, note, sendMessage, setMessages],
  );

  const onNewChat = useCallback(() => {
    // Abort the in-flight stream BEFORE clearing the array — otherwise the
    // transport keeps writing deltas onto the cleared messages[] and the
    // thread visibly un-clears as the stream completes. Safe when idle
    // (no-op). chat-panel.tsx also gates the trigger control with
    // disabled={isStreaming} as defence in depth.
    stop();
    setMessages([]);
    setNote("");
    setActiveSessionId(null);
    setPatientName(undefined);
    setPatientSubLine(undefined);
    setSeededFirstMessageId(undefined);
  }, [setMessages, stop]);

  const onLoadCase = useCallback(
    (session: DemoSession) => {
      // Demo-row click: load the note into the centre pane, reset the chat
      // thread, mark the rail row active. The clinician then clicks
      // submit on the chat composer (or types follow-up) to actually fire
      // a request — we deliberately don't auto-submit so the demo can be
      // edited first.
      setNote(session.note);
      setMessages([]);
      setSeededFirstMessageId(undefined);
      setActiveSessionId(session.id);

      // Parse session.name (e.g. "Jack T · croup (NZ)" or "Mia R · ?epiglottitis")
      // into a patient name + condition sub-line. The format is "<Name> · <rest>"
      // — split on the first " · " separator. If no separator, the whole label
      // is the name and the sub-line stays empty.
      const sep = session.name.indexOf(" · ");
      if (sep === -1) {
        setPatientName(session.name);
        setPatientSubLine(undefined);
      } else {
        setPatientName(session.name.slice(0, sep));
        setPatientSubLine(session.name.slice(sep + 3));
      }
    },
    [setMessages],
  );

  const onNewSession = useCallback(() => {
    onNewChat();
  }, [onNewChat]);

  const onRetry = useCallback(() => {
    void regenerate();
  }, [regenerate]);

  // For the v1 surface the note-pane is a typing surface — the
  // ExtractedFacts payload is derived server-side in a future iteration.
  // We leave it empty so the accordion shows the placeholder state.
  const facts: ExtractedFacts | undefined = undefined;

  // ─── Render — 3-column Heidi-grammar shell ───────────────────────────────
  //
  // Columns: 220px fixed rail · minmax(0,1fr) centre note · minmax(33vw,42vw)
  // chat. The chat column is floored at one third of the viewport (grows to
  // 42vw on wide screens) so the Care Partner is always ≥1/3 of the screen;
  // minmax(0,1fr) on the centre stops the note textarea from overflowing its
  // track. Mobile <1100px is deferred — the narrow-viewport banner below
  // takes over (globals.css ≤1099px).

  return (
    <>
      <div
        data-testid="heidi-grammar-shell"
        // Desktop-only by design. The narrow-viewport toggle is expressed as
        // Tailwind responsive utilities (same cascade layer as `grid`), NOT a
        // raw globals.css rule — an earlier .bluey-shell/.heidi-shell global
        // selector silently failed to compile, so the shell never hid below
        // 1100px. max-[1099px]:hidden is build-deterministic.
        className="heidi-shell grid h-screen w-full grid-cols-[220px_minmax(0,1fr)_minmax(33vw,42vw)] max-[1099px]:hidden"
      >
        <SessionRail
          activeSessionId={activeSessionId ?? undefined}
          onLoadCase={onLoadCase}
          onNewSession={onNewSession}
        />

        <NotePane
          note={note}
          onNoteChange={setNote}
          patientName={patientName}
          patientSubLine={patientSubLine}
          facts={facts}
          region="NZ"
        />

        {/* T4 (design-review 2026-05-28 LS-2): RegionToggle lives inside
            ChatPanel's footer (not floated here); single canonical region
            toggle per the screenshot spec. */}
        <ChatPanel
          messages={messages}
          onSubmit={onChatSubmit}
          onNewChat={onNewChat}
          isStreaming={isStreaming}
          error={error}
          onRetry={onRetry}
          originalNote={originalNote}
          seededFirstMessageId={seededFirstMessageId}
        />
      </div>

      {/* Narrow-viewport banner — the inverse toggle of the shell above.
          Hidden ≥1100px, shown (flex) below, via Tailwind responsive utilities
          (no globals.css rule). No JS matchMedia, so no hydration mismatch. */}
      <div
        data-testid="narrow-viewport-banner"
        className="narrow-viewport-banner hidden h-screen items-center justify-center bg-background px-6 text-center max-[1099px]:flex"
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
