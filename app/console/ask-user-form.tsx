// app/console/ask-user-form.tsx
//
// The skill's `ask_user` tool surface, rendered inline inside the
// assistant message bubble (NEVER a modal — per Pass 2 lock).
//
// Rationale (D-design lock): modals break the chat flow and read as
// "something is wrong"; an inline form reads as "I need one more thing
// to keep going" — which is the actual clinical state when ask_user
// fires (missing weight / ambiguous severity / unspecified condition).
//
// Visual contract: same <Alert variant="safety"> amber semaphore as
// RefusalCard. The `kind` drives which input shape renders. The kind
// vocabulary MUST match the tool's input schema (tools/ask_user.ts:42-48
// + the matching enum on app/api/chat/route.ts:411). The five permitted
// kinds and their UI surface:
//   - weight_kg → numeric input + "kg" suffix; min 0, max 200 (Guard-7)
//   - severity  → <Select> of mild | moderate | severe
//   - region    → <Select> of NZ | AU
//   - confirm   → <Select> of Yes | No (e.g. "Is this weight in kg?")
//   - free_text → open <Input> for anything that doesn't fit above
//
// On submit: the answer string is handed to onSubmit(); the parent
// (ChatPanel) POSTs it as the NEXT user turn to /api/chat. The form is
// then replaced by that user turn in the thread — preserving the audit
// trail (the question and the answer both live in the conversation).
//
// History note (kept for git-blame readers): pre-2026-05-28 this file
// used kind = "weight" | "condition" | "severity" — a vocabulary that
// silently drifted out of sync with the tool's input schema. When the
// model called ask_user({kind: "weight_kg"}), NONE of the input branches
// matched, so the form rendered without any input field — just a Submit
// button orphaned in space. The fix is this file aligning to the
// tool's canonical vocabulary; the lesson is "if a UI takes a server-
// declared enum, the enum names must match exactly."

"use client";

import { useState, type FormEvent } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * The closed set of slot kinds the form can render. MUST stay in sync
 * with tools/ask_user.ts:AskUserKind and the route's input schema.
 */
export type AskUserKind =
  | "weight_kg"
  | "severity"
  | "region"
  | "confirm"
  | "free_text";

export interface AskUserFormProps {
  /** Which slot the skill is asking for. Drives the input shape. */
  kind: AskUserKind;
  /**
   * The question text. The skill authors a one-line natural-language
   * prompt, e.g. "What is the patient's weight in kilograms?"
   */
  question: string;
  /** Hand the typed answer up; the parent POSTs it to /api/chat. */
  onSubmit: (answer: string) => void;
  /** Disabled state while the parent is sending. */
  disabled?: boolean;
}

const SEVERITY_OPTIONS = ["mild", "moderate", "severe"] as const;
const REGION_OPTIONS = ["NZ", "AU"] as const;
const CONFIRM_OPTIONS = ["Yes", "No"] as const;

export function AskUserForm({
  kind,
  question,
  onSubmit,
  disabled = false,
}: AskUserFormProps) {
  const [value, setValue] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) {
      return; // empty submit is a no-op; the user can keep typing
    }
    onSubmit(trimmed);
  }

  return (
    <Alert
      variant="safety"
      aria-live="polite"
      className="mt-2 flex flex-col gap-2"
    >
      <AlertTitle className="font-mono text-[11px] font-semibold uppercase tracking-[0.08em]">
        ASK_USER · {kind}
      </AlertTitle>
      <AlertDescription className="text-[12.5px] leading-snug">
        {question}
      </AlertDescription>
      <form onSubmit={handleSubmit} className="mt-1 flex items-end gap-2">
        {kind === "weight_kg" && (
          <div className="relative flex-1">
            <Input
              type="number"
              inputMode="decimal"
              step="0.1"
              min="0"
              max="200"
              aria-label={question}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              disabled={disabled}
              placeholder="14.2"
              className="bg-white pr-9"
            />
            <span
              aria-hidden="true"
              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-muted-foreground"
            >
              kg
            </span>
          </div>
        )}
        {kind === "severity" && (
          <Select value={value} onValueChange={setValue} disabled={disabled}>
            <SelectTrigger aria-label={question} className="flex-1 bg-white">
              <SelectValue placeholder="Select severity" />
            </SelectTrigger>
            <SelectContent>
              {SEVERITY_OPTIONS.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {kind === "region" && (
          <Select value={value} onValueChange={setValue} disabled={disabled}>
            <SelectTrigger aria-label={question} className="flex-1 bg-white">
              <SelectValue placeholder="Select region" />
            </SelectTrigger>
            <SelectContent>
              {REGION_OPTIONS.map((r) => (
                <SelectItem key={r} value={r}>
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {kind === "confirm" && (
          <Select value={value} onValueChange={setValue} disabled={disabled}>
            <SelectTrigger aria-label={question} className="flex-1 bg-white">
              <SelectValue placeholder="Select yes or no" />
            </SelectTrigger>
            <SelectContent>
              {CONFIRM_OPTIONS.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {kind === "free_text" && (
          <Input
            type="text"
            aria-label={question}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={disabled}
            placeholder="Type your answer…"
            className="flex-1 bg-white"
          />
        )}
        <Button
          type="submit"
          disabled={disabled || !value.trim()}
          className="bg-[var(--claret)] text-[var(--claret-ink)] hover:bg-[var(--claret)]/90"
        >
          Submit
        </Button>
      </form>
    </Alert>
  );
}
