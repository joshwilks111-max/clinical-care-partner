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
// RefusalCard. The kind (weight | condition | severity) drives which
// input shape renders:
//   - weight    → number input + "kg" suffix
//   - condition → free-text input
//   - severity  → <Select> with mild | moderate | severe
//
// On submit: the answer string is handed to onSubmit(); the parent
// (ChatPanel) POSTs it as the NEXT user turn to /api/chat. The form is
// then replaced by that user turn in the thread — preserving the audit
// trail (the question and the answer both live in the conversation).

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

export type AskUserKind = "weight" | "condition" | "severity";

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
        {kind === "weight" && (
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
              className="pr-9 bg-white"
            />
            <span
              aria-hidden="true"
              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-muted-foreground"
            >
              kg
            </span>
          </div>
        )}
        {kind === "condition" && (
          <Input
            type="text"
            aria-label={question}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={disabled}
            placeholder="e.g. croup"
            className="flex-1 bg-white"
          />
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
