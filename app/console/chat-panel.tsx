// app/console/chat-panel.tsx
//
// RIGHT column of the Heidi-grammar 3-column shell (D4) — the Care
// Partner conversation surface. 520px at ≥1500px. The centrepiece UI.
//
// Composition (per plan §2 RIGHT RAIL):
//   - Header: "Care Partner" chip + "+ New chat" claret link (D16 hard reset)
//   - Thread (role="log" aria-live="polite"):
//       · Empty state → "Paste a note in the centre, then ask Care Partner."
//         + suggested-prompt trinity (D15) as 3 outline buttons via ButtonGroup
//       · User <Message from="user"> → claret fill, 13/13/4/13 radius
//       · Assistant <Message from="assistant"> → ONE bubble per turn:
//           - <Reasoning> "Thought for Ns" chip
//           - <Sources> "N sources · View" chip
//           - <a-title> serif headline + <a-prose> with inline-cite pills
//           - <DoseCard>          EMBEDDED INSIDE the bubble (D14)
//           - <ReassessmentCard>  EMBEDDED INSIDE the bubble
//           - <RefusalCard>       on refusal branches (amber, NEVER red)
//           - <AskUserForm>       on ask_user tool branches (inline, not modal)
//   - <Composer>: context chip showing originalNote pin (D13) + PromptInput
//     textarea + claret send button + Lucide-icon tool row
//   - Footer: legalese line + <RegionToggle>
//
// Wiring: this v1 ships a minimal state machine — messages array + isStreaming
// flag + sendMessage(text) helper. The real /api/chat POST happens in Phase 3
// (Lane F doesn't wire that; the prompt says it's the route's job). We expose
// `onSubmit` and `messages` so the parent can wire whatever transport it likes.

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpen, FileText, Mic, Plus, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/components/lib/utils";
import { Message, MessageContent } from "@/components/ai-elements/message";
import { Shimmer } from "@/components/ai-elements/shimmer";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import {
  Sources,
  SourcesContent,
  SourcesTrigger,
  Source,
} from "@/components/ai-elements/sources";
import {
  InlineCitation,
  InlineCitationCard,
  InlineCitationCardBody,
  InlineCitationCardTrigger,
} from "@/components/ai-elements/inline-citation";
import { DoseCard, type DoseCardProps } from "./dose-card";
import {
  ReassessmentCard,
  type ReassessmentCardProps,
} from "./reassessment-card";
import { RefusalCard } from "./refusal-card";
import { AskUserForm, type AskUserKind } from "./ask-user-form";
import { RegionToggle } from "./region-toggle";
import type { AnyRefusalKind } from "@/tools/types";

// ─── Message types ─────────────────────────────────────────────────────────
// The thread is heterogeneous: user messages are plain text; assistant
// messages may carry ANY combination of prose, dose-card, reass-card,
// refusal, ask-user, or sources. We model that with a discriminated union
// keyed off `role` and a content array for the assistant turn so the
// renderer doesn't have to special-case absent fields.

export interface ChatSource {
  id: string;
  label: string;
  url?: string;
}

export interface InlineCite {
  label: string;
  source_version: string;
  source_url?: string;
}

export interface AssistantContent {
  /** Optional "Thought for Ns" chip text. Omit to hide. */
  reasoning?: string;
  /** Optional sources chip — "N sources · View". */
  sources?: ChatSource[];
  /** Optional serif headline above the prose. */
  title?: string;
  /** Prose body. Plain text in v1; Phase 3 may swap to streaming Markdown. */
  prose?: string;
  /** Inline citations to render after the prose as a small chip row. */
  citations?: InlineCite[];
  /** Embedded dose-card. */
  dose_card?: DoseCardProps;
  /** Embedded reassessment-card. */
  reassessment_card?: ReassessmentCardProps;
  /** Embedded refusal-card. */
  refusal?: {
    kind: AnyRefusalKind;
    message: string;
    next_action?: string;
  };
  /** Embedded ask-user form. */
  ask_user?: {
    kind: AskUserKind;
    question: string;
  };
}

export type ChatMessage =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "assistant"; content: AssistantContent };

// ─── Context-chip data ─────────────────────────────────────────────────────
// The composer shows a chip representing the server-derived originalNote
// pin (D13). The chat-panel itself doesn't read the pin from anywhere —
// the parent passes a summary down. When absent, the chip is hidden.

export interface OriginalNoteSummary {
  /** Patient name + age + weight, e.g. "Jack T, 3yo, 14.2 kg". */
  primary: string;
  /** Optional condition suffix, e.g. "croup". */
  secondary?: string;
}

// ─── Suggested-prompt trinity (D15) ────────────────────────────────────────
// Three fixed chips, visible in the empty state. Clicking pre-fills the
// composer (does NOT auto-submit — clinicians edit before they ask).

const SUGGESTED_PROMPTS = [
  "What dose?",
  "What should I watch for?",
  "Differential?",
] as const;

// ─── Component ─────────────────────────────────────────────────────────────

export interface ChatPanelProps {
  /** Thread state — full history of user + assistant turns. */
  messages: ChatMessage[];
  /**
   * Fire on send. The parent owns the transport (POST /api/chat in
   * Phase 3); we just hand up the typed-text string.
   */
  onSubmit: (text: string) => void | Promise<void>;
  /**
   * Hard-reset hook for "+ New chat". On confirm (when thread has
   * ≥1 message) the parent should: clear messages, DELETE session-id
   * cookie via lib/region.clearSession(), and refocus the composer.
   */
  onNewChat: () => void;
  /** Stream-state flag — drives the Shimmer "thinking" indicator. */
  isStreaming?: boolean;
  /** Context chip for the composer (server-derived per D13). */
  originalNote?: OriginalNoteSummary;
  /**
   * Test seam for window.confirm so the "+ New chat hard reset"
   * test can assert the confirm path fires without stubbing the
   * global. Production callers should omit.
   */
  confirmFn?: (message: string) => boolean;
}

export function ChatPanel({
  messages,
  onSubmit,
  onNewChat,
  isStreaming = false,
  originalNote,
  confirmFn,
}: ChatPanelProps) {
  // The composer is locally controlled — we keep the textarea value in
  // state so suggested-prompt chips can PRE-FILL without submitting (D15).
  const [draft, setDraft] = useState("");
  const threadRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Auto-scroll the thread to the bottom on new messages / streaming.
  // Standard chat-pane affordance — without it, late assistant content
  // sits below the fold and reads as "stuck".
  useEffect(() => {
    const el = threadRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages.length, isStreaming]);

  const handleSubmit = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      const text = draft.trim();
      if (!text) return;
      setDraft("");
      await onSubmit(text);
    },
    [draft, onSubmit],
  );

  // Cmd/Ctrl+Enter submits — matches today's app/console/console.tsx pattern.
  // Plain Enter inserts a newline (clinicians paste multi-line notes).
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        handleSubmit();
      }
      if (e.key === "Escape") {
        setDraft("");
      }
    },
    [handleSubmit],
  );

  // Cmd/Ctrl+K = new chat. Mirrors the universal "new conversation"
  // keybind. We fire onNewChat directly (with the confirm path baked
  // into handleNewChat).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        handleNewChat();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

  function handleNewChat() {
    if (messages.length > 0) {
      const confirm = confirmFn ?? ((m: string) => window.confirm(m));
      const ok = confirm(
        "Start a new chat? Current conversation will be cleared.",
      );
      if (!ok) return;
    }
    onNewChat();
  }

  function handleSuggestedPrompt(text: string) {
    setDraft(text);
    textareaRef.current?.focus();
  }

  const isEmpty = messages.length === 0 && !isStreaming;

  return (
    <section
      role="region"
      aria-label="Care Partner chat"
      className="flex h-full flex-col border-l border-[var(--cream-2)] bg-[var(--cream)]"
    >
      {/* Header */}
      <header className="flex items-center justify-between border-b border-[var(--cream-2)] bg-[var(--cream)] px-4 py-2.5">
        <Badge
          variant="outline"
          className="border-[var(--cream-2)] bg-[var(--cream-2)] px-2.5 py-1 text-[12px] font-semibold text-foreground"
        >
          Care Partner
        </Badge>
        <button
          type="button"
          onClick={handleNewChat}
          className="cursor-pointer text-[12.5px] font-semibold text-[var(--claret)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--claret)] focus-visible:ring-offset-2"
        >
          + New chat
        </button>
      </header>

      {/* Thread */}
      <div
        ref={threadRef}
        role="log"
        aria-live="polite"
        aria-label="Chat thread"
        className="flex flex-1 flex-col gap-2.5 overflow-auto px-4 py-3.5"
      >
        {isEmpty && <EmptyState onPick={handleSuggestedPrompt} />}

        {messages.map((m) =>
          m.role === "user" ? (
            <UserBubble key={m.id} text={m.text} />
          ) : (
            <AssistantBubble
              key={m.id}
              content={m.content}
              onAskSubmit={(answer) => onSubmit(answer)}
            />
          ),
        )}

        {isStreaming && (
          <div aria-label="Care Partner is thinking" className="self-start">
            <Shimmer className="text-[12.5px] italic">Thinking…</Shimmer>
          </div>
        )}
      </div>

      {/* Composer */}
      <Composer
        draft={draft}
        onDraftChange={setDraft}
        onSubmit={handleSubmit}
        onKeyDown={handleKeyDown}
        isStreaming={isStreaming}
        originalNote={originalNote}
        textareaRef={textareaRef}
      />

      {/* Footer */}
      <footer className="flex items-center justify-between gap-2 border-t border-[var(--cream-2)] bg-[var(--cream)] px-4 py-2 text-[11px] text-muted-foreground">
        <span>Medical knowledge support. Confirm with clinical judgement.</span>
        <RegionToggle />
      </footer>
    </section>
  );
}

// ─── Empty state ───────────────────────────────────────────────────────────

function EmptyState({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <div className="flex flex-col items-start gap-3 px-1 py-6">
      <p className="text-[13px] text-muted-foreground">
        Paste a note in the centre, then ask Care Partner.
      </p>
      <ButtonGroup className="flex-wrap" orientation="horizontal">
        {SUGGESTED_PROMPTS.map((p) => (
          <Button
            key={p}
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onPick(p)}
            className="border-[var(--cream-2)] bg-white text-[12.5px] hover:bg-[var(--cream-2)]"
          >
            {p}
          </Button>
        ))}
      </ButtonGroup>
    </div>
  );
}

// ─── User bubble ───────────────────────────────────────────────────────────
// Claret fill + white text + 13/13/4/13 radius (asymmetric corner closest
// to the avatar). The AI Elements <Message> primitive handles the
// is-user class for us; we override the bubble paint to claret per D14.

function UserBubble({ text }: { text: string }) {
  return (
    <Message from="user">
      <article aria-label="You asked" className="contents">
        <MessageContent
          className={cn(
            // Override the AI-element default bubble paint with the Heidi
            // claret. The is-user class still triggers right-alignment.
            "group-[.is-user]:bg-[var(--claret)] group-[.is-user]:text-[var(--claret-ink)] group-[.is-user]:rounded-[13px_13px_4px_13px] group-[.is-user]:px-3 group-[.is-user]:py-2",
          )}
        >
          <span className="text-[13px] leading-snug">{text}</span>
        </MessageContent>
      </article>
    </Message>
  );
}

// ─── Assistant bubble ──────────────────────────────────────────────────────
// THE anti-slop surface (D14). Every nested card lives INSIDE this one
// bubble. The bubble has 13/13/13/4 radius (asymmetric corner closest
// to the avatar), white fill, hairline border. Reasoning chip + sources
// chip + title + prose + dose-card + reass-card + refusal + ask-user
// all stack vertically inside.

function AssistantBubble({
  content,
  onAskSubmit,
}: {
  content: AssistantContent;
  onAskSubmit: (answer: string) => void;
}) {
  return (
    <Message from="assistant">
      <article aria-label="Care Partner reply" className="contents">
        <MessageContent
          className={cn(
            "max-w-[96%] rounded-[13px_13px_13px_4px] border border-[var(--cream-2)] bg-white p-0",
          )}
        >
          {/* Reasoning chip — top-left of bubble */}
          {content.reasoning && (
            <div className="px-3.5 pb-0 pt-2.5">
              <Reasoning className="w-fit">
                <ReasoningTrigger className="inline-flex items-center gap-1.5 rounded-full border border-[var(--cream-2)] bg-[var(--cream-2)] px-2.5 py-0.5 text-[11px] text-muted-foreground">
                  <span aria-hidden="true" className="text-[var(--claret)]">
                    ⚡
                  </span>
                  {content.reasoning}
                </ReasoningTrigger>
                <ReasoningContent className="mt-1 text-[11.5px] text-muted-foreground">
                  {content.reasoning}
                </ReasoningContent>
              </Reasoning>
            </div>
          )}

          {/* Sources chip */}
          {content.sources && content.sources.length > 0 && (
            <div className="px-3.5 pt-1.5">
              <Sources>
                <SourcesTrigger
                  count={content.sources.length}
                  className="inline-flex items-center gap-1.5 rounded-md border border-[var(--cream-2)] bg-[#f1ebde] px-2.5 py-1 text-[12px] text-foreground"
                />
                <SourcesContent>
                  {content.sources.map((s) => (
                    <Source key={s.id} href={s.url ?? "#"} title={s.label} />
                  ))}
                </SourcesContent>
              </Sources>
            </div>
          )}

          {/* Body */}
          <div className="px-3.5 pb-3 pt-2">
            {content.title && (
              <h3
                className="mb-1.5 text-[18px] font-bold leading-[1.3] tracking-[-0.01em]"
                style={{ fontFamily: "var(--serif)" }}
              >
                {content.title}
              </h3>
            )}
            {content.prose && (
              <p className="mb-1.5 text-[13px] leading-[1.55] text-[#3a312b]">
                {content.prose}
                {content.citations && content.citations.length > 0 && (
                  <>
                    {" "}
                    {content.citations.map((c, i) => (
                      <InlineCitation key={`${c.label}-${i}`}>
                        <InlineCitationCard>
                          <InlineCitationCardTrigger
                            sources={[c.source_url ?? "#"]}
                            aria-label={`Source: ${c.source_version}`}
                          />
                          <InlineCitationCardBody>
                            <div className="p-2 text-[12px]">
                              <div className="font-semibold">
                                {c.source_version}
                              </div>
                              {c.source_url && (
                                <a
                                  href={c.source_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-[#1d7a8c] hover:underline"
                                >
                                  View source
                                </a>
                              )}
                            </div>
                          </InlineCitationCardBody>
                        </InlineCitationCard>
                      </InlineCitation>
                    ))}
                  </>
                )}
              </p>
            )}

            {content.dose_card && <DoseCard {...content.dose_card} />}
            {content.reassessment_card && (
              <ReassessmentCard {...content.reassessment_card} />
            )}
            {content.refusal && (
              <RefusalCard
                kind={content.refusal.kind}
                message={content.refusal.message}
                next_action={content.refusal.next_action}
              />
            )}
            {content.ask_user && (
              <AskUserForm
                kind={content.ask_user.kind}
                question={content.ask_user.question}
                onSubmit={onAskSubmit}
              />
            )}
          </div>
        </MessageContent>
      </article>
    </Message>
  );
}

// ─── Composer ──────────────────────────────────────────────────────────────
// Context chip showing the originalNote pin + textarea + claret send +
// Lucide tool row. Tool icons are visual affordances only in v1 —
// wiring (+ menu, templates, sources, mic) is deferred.

function Composer({
  draft,
  onDraftChange,
  onSubmit,
  onKeyDown,
  isStreaming,
  originalNote,
  textareaRef,
}: {
  draft: string;
  onDraftChange: (v: string) => void;
  onSubmit: (e?: React.FormEvent) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  isStreaming: boolean;
  originalNote?: OriginalNoteSummary;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  return (
    <form
      onSubmit={onSubmit}
      className="border-t border-[var(--cream-2)] bg-white px-3.5 py-2.5"
    >
      {originalNote && (
        <div className="mb-1.5 inline-flex items-center gap-1.5 rounded-md border border-[var(--cream-2)] bg-[var(--cream-2)] px-2.5 py-1 text-[11.5px]">
          <span
            aria-hidden="true"
            className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-[var(--claret)] text-[10px] font-bold text-[var(--claret-ink)]"
          >
            {originalNote.primary.slice(0, 2).toUpperCase()}
          </span>
          <span className="font-semibold">{originalNote.primary}</span>
          {originalNote.secondary && (
            <span className="text-muted-foreground">
              · {originalNote.secondary}
            </span>
          )}
        </div>
      )}

      <div className="flex items-end gap-1.5">
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask a follow-up question…"
          aria-label="Message Care Partner"
          rows={1}
          disabled={isStreaming}
          className="flex-1 resize-none rounded-md border border-[var(--cream-2)] bg-white px-3 py-2 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--claret)] focus-visible:ring-offset-1"
          style={{ minHeight: 42 }}
        />
        <Button
          type="submit"
          aria-label="Send message"
          disabled={isStreaming || !draft.trim()}
          className="h-11 w-11 flex-none bg-[var(--claret)] p-0 text-[var(--claret-ink)] hover:bg-[var(--claret)]/90"
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>

      <Separator className="my-2 bg-transparent" />

      <div className="flex items-center gap-3 text-[11.5px] text-muted-foreground">
        <button
          type="button"
          aria-label="Add attachment"
          className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-[var(--cream-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--claret)]"
        >
          <Plus className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label="Templates"
          className="inline-flex h-8 items-center gap-1 rounded-md px-2 hover:bg-[var(--cream-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--claret)]"
        >
          <FileText className="h-3.5 w-3.5" />
          Templates
        </button>
        <button
          type="button"
          aria-label="Sources"
          className="inline-flex h-8 items-center gap-1 rounded-md px-2 hover:bg-[var(--cream-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--claret)]"
        >
          <BookOpen className="h-3.5 w-3.5" />
          Sources
        </button>
        <button
          type="button"
          aria-label="Voice input"
          className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-[var(--cream-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--claret)]"
        >
          <Mic className="h-4 w-4" />
        </button>
      </div>
    </form>
  );
}
