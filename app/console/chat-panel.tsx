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
//           - <a-prose> render of text parts
//           - <DoseCard>          when part.type === "tool-calculate_dose"
//           - <ReassessmentCard>  when part.type === "tool-get_reassessment_plan"
//           - <RefusalCard>       on any tool refusal output
//           - <AskUserForm>       on tool-ask_user parts
//   - <Composer>: context chip showing originalNote pin (D13) + PromptInput
//     textarea + claret send button + Lucide-icon tool row
//   - Footer: legalese line + <RegionToggle>
//
// Wiring: this panel renders the canonical SDK 6 UIMessage shape. The parent
// (console.tsx) owns the useChat hook + state; we receive `messages`,
// `status`, `error`, `regenerate`, and emit `onSubmit(text)` for user turns.
// The SDK's typed tool parts mean we don't need a server-side validator or
// a custom response header — each tool call surfaces in messages[].parts[]
// as a typed part with the tool name as the discriminator.

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  FileText,
  Mic,
  Plus,
  Send,
} from "lucide-react";
import {
  isToolUIPart,
  type UIMessage,
  type UIMessagePart,
  type UIDataTypes,
  type UITools,
} from "ai";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/components/lib/utils";
import { Message, MessageContent } from "@/components/ai-elements/message";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { DoseCard, type DoseCardProps } from "./dose-card";
import {
  ReassessmentCard,
  type ReassessmentCardProps,
} from "./reassessment-card";
import { RefusalCard } from "./refusal-card";
import { AskUserForm, type AskUserKind } from "./ask-user-form";
import { RegionToggle } from "./region-toggle";
import type { AnyRefusalKind } from "@/tools/types";

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
  /**
   * Thread state — full history of user + assistant turns, as UIMessage[]
   * from the SDK. Each message has parts[]; text parts render as prose,
   * tool-<toolName> parts render as the matching card.
   */
  messages: UIMessage[];
  /**
   * Fire on send. The parent owns the transport (useChat's sendMessage);
   * we just hand up the typed-text string.
   */
  onSubmit: (text: string) => void | Promise<void>;
  /**
   * Hard-reset hook for "+ New chat". On confirm (when thread has
   * ≥1 message) the parent should: clear messages, reset note + active
   * session, refocus the composer.
   */
  onNewChat: () => void;
  /**
   * Stream-state flag — drives the Shimmer "thinking" indicator. Set to
   * true while useChat's status is "submitted" or "streaming".
   */
  isStreaming?: boolean;
  /**
   * Optional error from useChat. When present we render a destructive
   * Alert + Retry button at the bottom of the thread; clicking Retry
   * calls onRetry (parent calls useChat's regenerate()).
   */
  error?: Error;
  /**
   * Fire to retry the last assistant generation. Parent wires to
   * useChat's regenerate(). Omit to hide the Retry button.
   */
  onRetry?: () => void;
  /** Context chip for the composer (server-derived per D13). */
  originalNote?: OriginalNoteSummary;
  /**
   * Test seam for window.confirm so the "+ New chat hard reset"
   * test can assert the confirm path fires without stubbing the
   * global. Production callers should omit.
   */
  confirmFn?: (message: string) => boolean;
  /**
   * The id of the FIRST user message — used to filter out the seeded
   * centre-note context from the rendered thread. When the parent calls
   * setMessages([{role:"user", parts:[{type:"text", text: noteText}]}])
   * to seed the note as the model's context, we don't want that to
   * render as a user bubble in the chat thread (it's already visible in
   * the centre column). Pass undefined to render every message.
   */
  seededFirstMessageId?: string;
}

export function ChatPanel({
  messages,
  onSubmit,
  onNewChat,
  isStreaming = false,
  error,
  onRetry,
  originalNote,
  confirmFn,
  seededFirstMessageId,
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
  // into handleNewChat). Mid-stream this is a no-op — same gate as the
  // button (parent stops the stream too as the correctness fix, but
  // ignoring the keypress entirely is simpler and matches the visual
  // disabled state of the button).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        if (isStreaming) return;
        handleNewChat();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, isStreaming]);

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

  // Filter the seeded centre-note message out of the rendered thread.
  // The note is the model's PATIENT CONTEXT — it lives in the centre
  // column already; rendering it as a user bubble would duplicate it
  // and confuse the clinician about what they "said".
  const renderedMessages = seededFirstMessageId
    ? messages.filter((m) => m.id !== seededFirstMessageId)
    : messages;

  const isEmpty = renderedMessages.length === 0 && !isStreaming;

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
        {/* T3 (design-review 2026-05-28 LS-1): flex-shrink-0 + whitespace-nowrap
            so the link never truncates to "+ N" at narrower right-rail widths.
            Disabled while streaming so the clinician gets a "system busy" cue
            and we close off the setMessages([])-mid-stream race (the parent's
            onNewChat also calls stop() as the correctness fix; this is the UX
            cue + defence in depth). Mirrors the Send button's gating. */}
        <button
          type="button"
          onClick={handleNewChat}
          disabled={isStreaming}
          className="flex-shrink-0 cursor-pointer whitespace-nowrap text-[12.5px] font-semibold text-[var(--claret)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--claret)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:no-underline"
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

        {renderedMessages.map((m) =>
          m.role === "user" ? (
            <UserBubble key={m.id} message={m} />
          ) : (
            <AssistantBubble
              key={m.id}
              message={m}
              onAskSubmit={(answer) => onSubmit(answer)}
            />
          ),
        )}

        {isStreaming && (
          <div aria-label="Care Partner is thinking" className="self-start">
            <Shimmer className="text-[12.5px] italic">Thinking…</Shimmer>
          </div>
        )}

        {/* T1 (design-review 2026-05-28 D4): technical-failure surface.
            Red <Alert variant="destructive"> per D14 (red = technical;
            amber = clinical safety abstention). useChat surfaces the
            error via the `error` prop; clicking Retry fires regenerate(). */}
        {error && (
          <Alert
            variant="destructive"
            data-testid="chat-error-alert"
            aria-live="assertive"
            className="self-start"
          >
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            <AlertTitle>Couldn't reach Care Partner</AlertTitle>
            <AlertDescription className="flex flex-col gap-2">
              <span>
                {error.message || "A technical error interrupted the response."}{" "}
                Check that ANTHROPIC_API_KEY is configured and /api/chat is
                reachable.
              </span>
              {onRetry && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={onRetry}
                  className="self-start"
                  data-testid="chat-error-retry"
                >
                  Retry
                </Button>
              )}
            </AlertDescription>
          </Alert>
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

// ─── Helpers — extract text from a UIMessage's parts ───────────────────────

function extractText(parts: UIMessage["parts"]): string {
  return parts
    .filter(
      (p): p is { type: "text"; text: string } & typeof p =>
        p.type === "text" && typeof (p as { text?: unknown }).text === "string",
    )
    .map((p) => p.text)
    .join("");
}

/**
 * Type-guard for refusal-shaped tool output.
 *
 * The harness has two refusal conventions (per memory
 * refusal-wrapper-two-shapes):
 *   - calculate_dose             → { kind: "refusal", reason, message }
 *   - load_guideline             → { status: "refusal", reason, message }
 *   - get_reassessment_plan      → { status: "refusal", reason, message }
 *
 * Both carry reason + message; we accept either discriminator.
 */
function isRefusalOutput(
  output: unknown,
): output is { reason: string; message: string } {
  if (typeof output !== "object" || output === null) return false;
  const o = output as { kind?: unknown; status?: unknown };
  return o.kind === "refusal" || o.status === "refusal";
}

// ─── User bubble ───────────────────────────────────────────────────────────
// Claret fill + white text + 13/13/4/13 radius (asymmetric corner closest
// to the avatar). The AI Elements <Message> primitive handles the
// is-user class for us; we override the bubble paint to claret per D14.

function UserBubble({ message }: { message: UIMessage }) {
  const text = extractText(message.parts);
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
// THE anti-slop surface (D14). Renders message.parts[] inline in order;
// every part (text, tool-calculate_dose, tool-get_reassessment_plan,
// tool-load_guideline, tool-ask_user) renders in the same bubble. The
// bubble has 13/13/13/4 radius, white fill, hairline border.
//
// part.type discriminator drives the renderer:
//   - "text"                          → prose <p>
//   - "tool-calculate_dose"           → <DoseCard> or <RefusalCard>
//   - "tool-get_reassessment_plan"    → <ReassessmentCard> or <RefusalCard>
//   - "tool-load_guideline"           → <RefusalCard> on refusal; nothing
//                                        on success (the data is plumbed
//                                        through the model's next tool call,
//                                        not surfaced directly to clinician)
//   - "tool-ask_user"                 → <AskUserForm> when state available
//
// Parts in state "input-streaming" / "input-available" render a small
// loading indicator; "output-error" renders a small inline error.

function AssistantBubble({
  message,
  onAskSubmit,
}: {
  message: UIMessage;
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
          <div className="flex flex-col gap-2 px-3.5 py-3">
            {message.parts.map((part, i) => (
              <PartRenderer
                key={`${message.id}-part-${i}`}
                part={part}
                onAskSubmit={onAskSubmit}
              />
            ))}
          </div>
        </MessageContent>
      </article>
    </Message>
  );
}

// ─── Per-part renderer ─────────────────────────────────────────────────────

function PartRenderer({
  part,
  onAskSubmit,
}: {
  part: UIMessagePart<UIDataTypes, UITools>;
  onAskSubmit: (answer: string) => void;
}) {
  // Text part — render the prose verbatim
  if (part.type === "text") {
    const textPart = part as { type: "text"; text: string };
    if (!textPart.text) return null;
    return (
      <p className="text-[13px] leading-[1.55] text-[#3a312b]">
        {textPart.text}
      </p>
    );
  }

  // Tool parts — switch on the tool name (encoded in part.type as
  // "tool-<toolName>"). We use the isToolUIPart guard (from `ai`) to
  // narrow the type before reading toolName + state + output.
  if (isToolUIPart(part)) {
    const toolName = part.type.slice("tool-".length);
    const state = part.state;
    const output = (part as { output?: unknown }).output;

    // While the tool call is being prepared by the model, show a subtle
    // loading affordance. The card content is suppressed until the tool
    // has returned a result.
    if (state === "input-streaming" || state === "input-available") {
      return (
        <div
          aria-label={`${toolName} is running`}
          className="text-[11.5px] italic text-muted-foreground"
        >
          Running {toolName.replace(/_/g, " ")}…
        </div>
      );
    }

    if (state === "output-error") {
      return (
        <Alert
          variant="destructive"
          data-testid={`tool-error-${toolName}`}
          className="text-[12px]"
        >
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          <AlertTitle>{toolName} failed</AlertTitle>
          <AlertDescription>
            The tool encountered an error; the response continues without it.
          </AlertDescription>
        </Alert>
      );
    }

    if (state !== "output-available") {
      return null;
    }

    // Refusal-shaped output renders as RefusalCard regardless of which
    // tool returned it. RefusalKind reasons are documented in
    // tools/types.ts; we cast to AnyRefusalKind for the card prop.
    if (isRefusalOutput(output)) {
      const ref = output as { reason: string; message: string };
      return (
        <RefusalCard
          kind={ref.reason as AnyRefusalKind}
          message={ref.message}
        />
      );
    }

    // Tool-specific success renders
    if (toolName === "calculate_dose") {
      return <DoseCard {...(output as DoseCardProps)} />;
    }

    if (toolName === "get_reassessment_plan") {
      return <ReassessmentCard {...(output as ReassessmentCardProps)} />;
    }

    if (toolName === "ask_user") {
      // ask_user's tool output is {answer: "", kind, question} — the
      // route's execute closure projects kind+question onto the result so
      // this renderer doesn't need defensive fallbacks for them. The form
      // collects the clinician's real answer; the parent's onSubmit
      // appends it as the NEXT user turn to /api/chat (server-side
      // execute pattern, not addToolOutput round-trip). The skill prompt
      // tells the model "the next user turn IS the answer to your last
      // ask_user" so it doesn't misread the typed weight as a decline.
      const askOutput = output as {
        kind?: AskUserKind;
        question?: string;
      };
      // Defensive: if a future regression strips kind/question (the
      // 2026-05-28 bug), render LOUDLY so it's caught at smoke instead
      // of silently degrading to free-text with placeholder copy.
      if (!askOutput.kind || !askOutput.question) {
        return (
          <Alert
            variant="destructive"
            data-testid="tool-ask_user-malformed"
            className="text-[12px]"
          >
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            <AlertTitle>ask_user payload malformed</AlertTitle>
            <AlertDescription>
              The harness expected kind + question on the tool output and
              received neither. This is a route-execute bug — file an issue.
            </AlertDescription>
          </Alert>
        );
      }
      return (
        <AskUserForm
          kind={askOutput.kind}
          question={askOutput.question}
          onSubmit={onAskSubmit}
        />
      );
    }

    if (toolName === "load_guideline") {
      // Success case: nothing to render directly. The model uses the
      // returned guideline payload to drive subsequent tool calls
      // (calculate_dose + get_reassessment_plan); the clinician sees
      // those cards, not the raw guideline.
      return null;
    }

    // Unknown tool name — surface defensively
    return (
      <div
        aria-label={`Tool ${toolName} returned a result`}
        className="text-[11.5px] italic text-muted-foreground"
      >
        ({toolName} returned a result)
      </div>
    );
  }

  // Unknown part type — silently skip. Future part types (sources,
  // reasoning, file etc.) can grow renderers here as needed.
  return null;
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
