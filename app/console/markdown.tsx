// app/console/markdown.tsx
//
// renderInlineMarkdown — a deliberately tiny inline-markdown renderer for the
// assistant's prose in the chat panel.
//
// WHY THIS EXISTS (and why it's ~60 lines, not a dependency):
//   The model emits light markdown in its qualitative prose — **bold** for the
//   severity row it matched, the occasional `inline code` for a rule id or a
//   tool name, *italic* for emphasis. Rendered raw in a <p>, the asterisks and
//   backticks show through as literal punctuation (the F-002 finding). A full
//   markdown library (react-markdown + remark) would fix it, but it's a heavy
//   dep for three inline constructs and — more importantly — it pulls in link
//   and raw-HTML handling we explicitly do NOT want here.
//
// SECURITY CONTRACT (CLAUDE.md — the clinical note is UNTRUSTED data):
//   - Supports ONLY bold, italic, and inline code. No links, no images, no
//     raw HTML, no autolink. There is no URL surface to spoof and nothing is
//     ever passed to dangerouslySetInnerHTML — every output node is a plain
//     React element with the matched substring as a text child, so React's
//     default escaping applies. A note that contains "[click](javascript:…)"
//     or "<script>" renders as literal, inert text.
//   - This is safe BY CONSTRUCTION: the grammar simply has no production that
//     emits an <a>, an <img>, or interpreted HTML. Widening it later (e.g. to
//     real links) would require re-reviewing this contract.
//
// SCOPE (intentionally not CommonMark):
//   - Inline only. No block constructs (headings, lists, blockquotes,
//     fenced code). The model's prose is single-paragraph qualitative text;
//     block markdown doesn't appear. If it ever does, swap to react-markdown
//     with a constrained allowlist rather than growing this.
//   - Non-greedy matching, leftmost-first. Unmatched/odd markers (a lone "*")
//     pass through verbatim — we never throw and never drop characters.

import { Fragment, type ReactNode } from "react";

// Ordered by precedence. Inline code first so a backtick span is never
// re-parsed for bold/italic inside it (code is literal). Bold (**) before
// italic (*) so "**x**" is one bold span, not nested italics.
//
// Each pattern captures the INNER text in group 1. The delimiters are fixed
// literals — there is no attribute, URL, or HTML capture anywhere.
const RULES: { re: RegExp; wrap: (inner: string, key: number) => ReactNode }[] =
  [
    {
      // `code` — literal span, inner is NOT recursed into.
      re: /`([^`]+)`/,
      wrap: (inner, key) => (
        <code
          key={key}
          className="rounded bg-black/[0.06] px-1 py-0.5 font-mono text-[0.92em]"
        >
          {inner}
        </code>
      ),
    },
    {
      // **bold** — inner IS recursed (so **a *b*** nests italic inside bold).
      re: /\*\*([^*]+(?:\*(?!\*)[^*]*)*)\*\*/,
      wrap: (inner, key) => <strong key={key}>{renderInline(inner)}</strong>,
    },
    {
      // *italic* — single asterisk, inner recursed for inline code.
      re: /\*([^*]+)\*/,
      wrap: (inner, key) => <em key={key}>{renderInline(inner)}</em>,
    },
  ];

// Recursive worker. Finds the leftmost match across all rules, emits the text
// before it verbatim, the wrapped match, then recurses on the remainder.
function renderInline(text: string): ReactNode[] {
  if (!text) return [];

  // Pick the earliest-starting match across all rules (leftmost wins; on a
  // tie, RULES order — code, then bold, then italic — breaks it).
  let best: {
    index: number;
    length: number;
    inner: string;
    ruleIdx: number;
  } | null = null;
  for (let i = 0; i < RULES.length; i++) {
    const m = RULES[i].re.exec(text);
    if (m && (best === null || m.index < best.index)) {
      best = { index: m.index, length: m[0].length, inner: m[1], ruleIdx: i };
    }
  }

  if (best === null) {
    // No markers left — the rest is plain text.
    return [text];
  }

  const out: ReactNode[] = [];
  if (best.index > 0) out.push(text.slice(0, best.index));
  out.push(RULES[best.ruleIdx].wrap(best.inner, out.length));
  const rest = text.slice(best.index + best.length);
  for (const node of renderInline(rest)) out.push(node);
  return out;
}

/**
 * Render a single line/paragraph of the assistant's prose with inline
 * markdown (bold / italic / inline code only). Returns React nodes ready to
 * drop inside a <p>. Plain text passes straight through. Safe for untrusted
 * input: no links, no HTML, no dangerouslySetInnerHTML.
 */
export function renderInlineMarkdown(text: string): ReactNode {
  return <Fragment>{renderInline(text)}</Fragment>;
}
