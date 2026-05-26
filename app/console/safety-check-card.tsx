// app/console/safety-check-card.tsx
//
// Turn 1.5 HIGH-IMPACT QUESTION card — advisory diagnostic-completeness assist.
// Sits between the differential and guideline buttons; does not block dosing.

"use client";

import { CheckCircle2 } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

import { ProvenanceBadge } from "./provenance-badge";
import type { DiscriminatorAnswer } from "@/app/api/turn1.5/route";

export type HighImpactQuestionCardProps = {
  target: string;
  question: string;
  rationaleSummary: string;
  onAnswer: (answer: DiscriminatorAnswer) => void;
  onSkip: () => void;
  busy?: boolean;
};

const ANSWER_OPTIONS: ReadonlyArray<{
  value: DiscriminatorAnswer;
  label: string;
}> = [
  { value: "present", label: "Yes" },
  { value: "absent", label: "No" },
  { value: "not_assessed", label: "Not assessed" },
];

export function HighImpactQuestionCard({
  target,
  question,
  rationaleSummary,
  onAnswer,
  onSkip,
  busy = false,
}: HighImpactQuestionCardProps) {
  return (
    <section
      data-testid="high-impact-question-card"
      className="rounded-lg border border-dashed border-safety-border bg-safety/40 p-3"
    >
      <div className="mb-2 flex items-center gap-2">
        <span
          data-testid="high-impact-eyebrow"
          className="font-mono text-[11px] font-semibold uppercase tracking-wide text-safety-foreground"
        >
          HIGH-IMPACT QUESTION · {target.toUpperCase()}
        </span>
        <ProvenanceBadge kind="clinician-selected" />
      </div>

      <p
        data-testid="high-impact-question"
        className="text-[14px] font-semibold text-safety-foreground"
      >
        {question}
      </p>

      <p className="mt-1 text-[12px] text-muted-foreground">{rationaleSummary}</p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {ANSWER_OPTIONS.map((opt) => (
          <Button
            key={opt.value}
            variant="outline"
            data-answer={opt.value}
            disabled={busy}
            onClick={() => onAnswer(opt.value)}
          >
            {opt.label}
          </Button>
        ))}
        <Button
          variant="ghost"
          data-testid="high-impact-skip"
          disabled={busy}
          className="text-muted-foreground"
          onClick={onSkip}
        >
          Skip
        </Button>
      </div>
    </section>
  );
}

export type NoQuestionNeededBannerProps = {
  rationaleSummary?: string;
};

export function NoQuestionNeededBanner({
  rationaleSummary,
}: NoQuestionNeededBannerProps) {
  return (
    <Alert
      data-testid="turn15-no-question"
      className="border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"
    >
      <CheckCircle2 className="text-emerald-600" />
      <AlertTitle className="flex items-center gap-2">
        <span className="font-mono text-[11px] tracking-wide">
          NO CLARIFYING QUESTION NEEDED
        </span>
      </AlertTitle>
      {rationaleSummary && (
        <AlertDescription className="text-emerald-800 dark:text-emerald-200">
          {rationaleSummary}
        </AlertDescription>
      )}
    </Alert>
  );
}

export type AnswerRecordedBannerProps = {
  target: string;
  engaged: boolean;
};

export function AnswerRecordedBanner({
  target,
  engaged,
}: AnswerRecordedBannerProps) {
  const message = engaged
    ? `Answer recorded for ${target}. Select a guideline when ready.`
    : `Skipped clarifying question about ${target}. Select a guideline when ready.`;
  return (
    <Alert
      data-testid="turn15-recorded"
      className="border-muted bg-muted/30"
    >
      <AlertDescription className="text-[13px]">{message}</AlertDescription>
    </Alert>
  );
}
