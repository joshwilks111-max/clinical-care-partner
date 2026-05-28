// @vitest-environment jsdom
//
// app/console/chat-panel.test.tsx
//
// Asserts the ChatPanel composition contract (D4 / D13-D17):
//   - Empty state renders the suggested-prompt trinity (D15).
//   - Clicking a chip PRE-FILLS the composer (does NOT submit).
//   - onSubmit fires on send.
//   - Shimmer renders during isStreaming.
//   - DoseCard renders INSIDE the assistant message bubble (not as a sibling).
//   - RefusalCard renders on refusal branches.
//   - "+ New chat" with ≥1 message fires the confirm dialog (D16).

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { ChatPanel, type ChatMessage } from "./chat-panel";

function setup(args: Partial<Parameters<typeof ChatPanel>[0]> = {}) {
  const onSubmit = vi.fn(async () => {});
  const onNewChat = vi.fn();
  render(
    <ChatPanel
      messages={[]}
      onSubmit={onSubmit}
      onNewChat={onNewChat}
      {...args}
    />,
  );
  return { onSubmit, onNewChat };
}

describe("ChatPanel — empty state (D15)", () => {
  it("renders the suggested-prompt trinity in the empty state", () => {
    setup();
    expect(
      screen.getByText("Paste a note in the centre, then ask Care Partner."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "What dose?" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "What should I watch for?" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Differential?" }),
    ).toBeInTheDocument();
  });

  it("clicking a suggested-prompt chip PRE-FILLS the composer (no auto-submit)", () => {
    const { onSubmit } = setup();
    fireEvent.click(screen.getByRole("button", { name: "What dose?" }));
    const textarea = screen.getByLabelText(
      "Message Care Partner",
    ) as HTMLTextAreaElement;
    expect(textarea.value).toBe("What dose?");
    // No auto-submit — the parent transport should NOT have been called.
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("ChatPanel — send + streaming", () => {
  it("fires onSubmit with the trimmed draft when the form is submitted", async () => {
    const { onSubmit } = setup();
    const textarea = screen.getByLabelText(
      "Message Care Partner",
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "  Tell me the dose " } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(onSubmit).toHaveBeenCalledWith("Tell me the dose");
  });

  it("renders the Shimmer thinking indicator when isStreaming is true", () => {
    setup({ isStreaming: true });
    // The shimmer renders the literal "Thinking…" string (with horizontal ellipsis).
    expect(
      screen.getByLabelText("Care Partner is thinking"),
    ).toBeInTheDocument();
  });
});

describe("ChatPanel — assistant content", () => {
  it("renders the DoseCard INSIDE the assistant message bubble (not as a sibling)", () => {
    const msg: ChatMessage = {
      id: "a1",
      role: "assistant",
      content: {
        title: "Paediatric croup — moderate severity",
        prose: "Computed dose follows.",
        dose_card: {
          drug: "oral dexamethasone",
          route: "PO",
          severity_row: "moderate",
          dose_mg: 2.13,
          max_mg: 12,
          capped: false,
          source_version: "Starship 2020",
        },
      },
    };
    setup({ messages: [msg] });
    // The dose-card's section element has aria-label starting with "Computed dose:".
    const doseSection = screen.getByLabelText(/Computed dose: 2\.13/);
    expect(doseSection).toBeInTheDocument();
    // The dose-card must be nested INSIDE the assistant <article>.
    const article = doseSection.closest(
      'article[aria-label="Care Partner reply"]',
    );
    expect(article).not.toBeNull();
    expect(article).toContainElement(doseSection as HTMLElement);
  });

  it("renders the RefusalCard on refusal branches", () => {
    const msg: ChatMessage = {
      id: "a1",
      role: "assistant",
      content: {
        refusal: {
          kind: "weight_missing",
          message: "A weight is required to compute a paediatric dose.",
          next_action: "Provide a weight in kilograms.",
        },
      },
    };
    setup({ messages: [msg] });
    expect(screen.getByText("weight_missing")).toBeInTheDocument();
    expect(
      screen.getByText(/A weight is required to compute a paediatric dose/),
    ).toBeInTheDocument();
  });
});

describe("ChatPanel — + New chat hard reset (D16)", () => {
  it("fires the confirm dialog when the thread has ≥1 message", () => {
    const onNewChat = vi.fn();
    const confirmFn = vi.fn(() => true);
    render(
      <ChatPanel
        messages={[{ id: "u1", role: "user", text: "Hi" }]}
        onSubmit={async () => {}}
        onNewChat={onNewChat}
        confirmFn={confirmFn}
      />,
    );
    fireEvent.click(screen.getByText("+ New chat"));
    expect(confirmFn).toHaveBeenCalledWith(
      "Start a new chat? Current conversation will be cleared.",
    );
    expect(onNewChat).toHaveBeenCalledTimes(1);
  });

  it("does NOT fire the confirm dialog when the thread is empty", () => {
    const onNewChat = vi.fn();
    const confirmFn = vi.fn(() => true);
    render(
      <ChatPanel
        messages={[]}
        onSubmit={async () => {}}
        onNewChat={onNewChat}
        confirmFn={confirmFn}
      />,
    );
    fireEvent.click(screen.getByText("+ New chat"));
    expect(confirmFn).not.toHaveBeenCalled();
    expect(onNewChat).toHaveBeenCalledTimes(1);
  });
});
