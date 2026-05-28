// @vitest-environment jsdom
//
// app/console/markdown.test.tsx
//
// Locks the renderInlineMarkdown contract: it must render bold / italic /
// inline code, pass plain text through untouched, leave malformed markers
// verbatim — and, the load-bearing one, NEVER emit a link or interpreted HTML
// from untrusted input (the clinical note is untrusted per CLAUDE.md).

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";

import { renderInlineMarkdown } from "./markdown";

function html(text: string): string {
  const { container } = render(<p>{renderInlineMarkdown(text)}</p>);
  return container.querySelector("p")!.innerHTML;
}

describe("renderInlineMarkdown — supported constructs", () => {
  it("renders **bold** as <strong>", () => {
    const { container } = render(
      <p>{renderInlineMarkdown("matches the **moderate** row")}</p>,
    );
    const strong = container.querySelector("strong");
    expect(strong).not.toBeNull();
    expect(strong!.textContent).toBe("moderate");
    expect(container.textContent).toBe("matches the moderate row");
  });

  it("renders *italic* as <em>", () => {
    const { container } = render(
      <p>{renderInlineMarkdown("be *careful* here")}</p>,
    );
    const em = container.querySelector("em");
    expect(em).not.toBeNull();
    expect(em!.textContent).toBe("careful");
  });

  it("renders `inline code` as <code>", () => {
    const { container } = render(
      <p>{renderInlineMarkdown("call `calculate_dose` now")}</p>,
    );
    const code = container.querySelector("code");
    expect(code).not.toBeNull();
    expect(code!.textContent).toBe("calculate_dose");
  });

  it("handles multiple constructs in one line", () => {
    const { container } = render(
      <p>
        {renderInlineMarkdown(
          "**moderate** croup — use `dexamethasone`, *not* prednisolone",
        )}
      </p>,
    );
    expect(container.querySelector("strong")!.textContent).toBe("moderate");
    expect(container.querySelector("code")!.textContent).toBe("dexamethasone");
    expect(container.querySelector("em")!.textContent).toBe("not");
  });

  it("does NOT re-parse markdown inside inline code (code is literal)", () => {
    // The asterisks inside the backticks must survive as literal text.
    const { container } = render(
      <p>{renderInlineMarkdown("literal `**not bold**` span")}</p>,
    );
    const code = container.querySelector("code")!;
    expect(code.textContent).toBe("**not bold**");
    expect(code.querySelector("strong")).toBeNull();
  });
});

describe("renderInlineMarkdown — plain + malformed pass-through", () => {
  it("returns plain text unchanged", () => {
    const { container } = render(
      <p>{renderInlineMarkdown("just plain clinical prose")}</p>,
    );
    expect(container.textContent).toBe("just plain clinical prose");
    expect(container.querySelector("strong")).toBeNull();
    expect(container.querySelector("em")).toBeNull();
    expect(container.querySelector("code")).toBeNull();
  });

  it("leaves an unmatched single asterisk verbatim", () => {
    const { container } = render(
      <p>{renderInlineMarkdown("2.13 mg * 0.15 mg/kg")}</p>,
    );
    expect(container.textContent).toBe("2.13 mg * 0.15 mg/kg");
    expect(container.querySelector("em")).toBeNull();
  });

  it("never drops characters on odd markers", () => {
    expect(html("a *b").replace(/<[^>]+>/g, "")).toContain("a *b");
    expect(html("**unclosed").replace(/<[^>]+>/g, "")).toContain("**unclosed");
  });

  it("renders empty string as nothing", () => {
    const { container } = render(<p>{renderInlineMarkdown("")}</p>);
    expect(container.querySelector("p")!.textContent).toBe("");
  });
});

describe("renderInlineMarkdown — SECURITY: untrusted input is inert", () => {
  it("does NOT create an anchor from [text](url) markdown", () => {
    const { container } = render(
      <p>{renderInlineMarkdown("see [click me](https://evil.example)")}</p>,
    );
    expect(container.querySelector("a")).toBeNull();
    // The bracket/paren syntax survives as literal text — nothing is linkified.
    expect(container.textContent).toContain("[click me](https://evil.example)");
  });

  it("does NOT create an anchor from a javascript: URL", () => {
    const { container } = render(
      <p>{renderInlineMarkdown("[x](javascript:alert(1))")}</p>,
    );
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector("[href]")).toBeNull();
  });

  it("renders raw HTML as inert text, never as elements", () => {
    const { container } = render(
      <p>
        {renderInlineMarkdown("<script>alert(1)</script> and <img src=x>")}
      </p>,
    );
    // React escaped everything — no real <script> or <img> node exists.
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<script>alert(1)</script>");
  });

  it("never emits a live element or event-handler from HTML-shaped input", () => {
    // The <b onclick> is untrusted-looking input. React escapes it to inert
    // text — so the assertion must be STRUCTURAL (query the DOM tree), not a
    // substring scan of innerHTML (the escaped text legitimately contains the
    // characters "onclick"). No <b> node, no element carrying onclick.
    const { container } = render(
      <p>{renderInlineMarkdown('hi <b onclick="steal()">x</b> **bold**')}</p>,
    );
    expect(container.querySelector("b")).toBeNull();
    expect(container.querySelector("[onclick]")).toBeNull();
    // The escaped tag survives as literal text…
    expect(container.textContent).toContain('<b onclick="steal()">x</b>');
    // …and the real markdown we DO support still renders.
    expect(container.querySelector("strong")!.textContent).toBe("bold");
  });
});
