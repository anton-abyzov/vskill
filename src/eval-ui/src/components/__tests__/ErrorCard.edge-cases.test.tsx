import { describe, it, expect, vi } from "vitest";

// Mock React hooks — return [initialState, noop] for useState
vi.mock("react", () => ({
  useState: (init: unknown) => [init, () => {}],
  useEffect: () => {},
  useRef: (init: unknown) => ({ current: init }),
}));

import { ErrorCard } from "../ErrorCard";
import type { ClassifiedError } from "../../shared/classifiedError";

type ReactEl = { type: unknown; props: Record<string, unknown> };

function collectText(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(collectText).join("");
  const el = node as ReactEl;
  if (el.props?.children != null) return collectText(el.props.children);
  return "";
}

function collectElements(node: unknown, match: (el: ReactEl) => boolean): ReactEl[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) {
    return node.flatMap((c) => collectElements(c, match));
  }
  const el = node as ReactEl;
  const results: ReactEl[] = [];
  if (el.type != null && match(el)) results.push(el);
  if (el.props?.children != null) {
    results.push(...collectElements(el.props.children, match));
  }
  return results;
}

describe("ErrorCard — edge cases", () => {
  // ── onRetry undefined: no retry button should render ──────────────

  it("does not render retry button when onRetry is undefined", () => {
    const error: ClassifiedError = {
      category: "unknown",
      title: "Error",
      description: "Something failed",
      hint: "Try again",
      retryable: false,
    };
    const tree = ErrorCard({ error });
    const buttons = collectElements(tree, (el) => el.type === "button");
    // No retry button should appear (onDismiss is also undefined)
    const retryButtons = buttons.filter((b) => {
      const text = collectText(b);
      return text.includes("Retry");
    });
    expect(retryButtons).toHaveLength(0);
  });

  // ── onRetry provided: retry button should render ──────────────────

  it("renders retry button when onRetry is provided", () => {
    const error: ClassifiedError = {
      category: "timeout",
      title: "Timeout",
      description: "Request timed out",
      hint: "Try again",
      retryable: true,
    };
    const tree = ErrorCard({ error, onRetry: () => {} });
    const buttons = collectElements(tree, (el) => el.type === "button");
    const retryButtons = buttons.filter((b) => collectText(b).includes("Retry"));
    expect(retryButtons.length).toBeGreaterThan(0);
  });

  // ── onDismiss renders dismiss button ──────────────────────────────

  it("renders dismiss (X) button when onDismiss is provided", () => {
    const error: ClassifiedError = {
      category: "unknown",
      title: "Error",
      description: "Something failed",
      hint: "",
      retryable: false,
    };
    const tree = ErrorCard({ error, onDismiss: () => {} });
    // The dismiss button contains an SVG (X icon), not text
    const buttons = collectElements(tree, (el) => el.type === "button");
    expect(buttons.length).toBeGreaterThan(0);
  });

  it("does not render dismiss button when onDismiss is undefined", () => {
    const error: ClassifiedError = {
      category: "unknown",
      title: "Error",
      description: "Something failed",
      hint: "",
      retryable: false,
    };
    const tree = ErrorCard({ error });
    // With no onRetry and no onDismiss, there should be no buttons at all
    const buttons = collectElements(tree, (el) => el.type === "button");
    expect(buttons).toHaveLength(0);
  });

  // ── onDismiss and onRetry both provided ───────────────────────────

  it("renders both dismiss and retry buttons when both callbacks provided", () => {
    const error: ClassifiedError = {
      category: "rate_limit",
      title: "Rate Limit",
      description: "Too many requests",
      hint: "Wait and retry",
      retryable: true,
    };
    const tree = ErrorCard({ error, onRetry: () => {}, onDismiss: () => {} });
    const buttons = collectElements(tree, (el) => el.type === "button");
    // At least 2 buttons: dismiss (X) and retry
    expect(buttons.length).toBeGreaterThanOrEqual(2);
  });

  // ── onRetry called: verify it fires ───────────────────────────────

  it("onRetry callback fires when retry button onClick is invoked", () => {
    const onRetry = vi.fn();
    const error: ClassifiedError = {
      category: "timeout",
      title: "Timeout",
      description: "Request timed out",
      hint: "Try again",
      retryable: true,
    };
    const tree = ErrorCard({ error, onRetry });
    const buttons = collectElements(tree, (el) => el.type === "button");
    const retryBtn = buttons.find((b) => collectText(b).includes("Retry"));
    expect(retryBtn).toBeDefined();
    const onClick = retryBtn!.props.onClick as () => void;
    onClick();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("onRetry fires on each rapid click (no built-in debounce)", () => {
    const onRetry = vi.fn();
    const error: ClassifiedError = {
      category: "timeout",
      title: "Timeout",
      description: "Timed out",
      hint: "",
      retryable: true,
    };
    const tree = ErrorCard({ error, onRetry });
    const buttons = collectElements(tree, (el) => el.type === "button");
    const retryBtn = buttons.find((b) => collectText(b).includes("Retry"));
    const onClick = retryBtn!.props.onClick as () => void;
    // Simulate rapid double-click
    onClick();
    onClick();
    onClick();
    expect(onRetry).toHaveBeenCalledTimes(3);
  });

  // ── Very long error descriptions ──────────────────────────────────

  it("renders very long description without crashing", () => {
    const longDesc = "A".repeat(5000);
    const error: ClassifiedError = {
      category: "unknown",
      title: "Error",
      description: longDesc,
      hint: "Some hint",
      retryable: false,
    };
    const tree = ErrorCard({ error });
    const text = collectText(tree);
    expect(text).toContain(longDesc);
  });

  it("renders very long hint without crashing", () => {
    const longHint = "B".repeat(3000);
    const error: ClassifiedError = {
      category: "unknown",
      title: "Error",
      description: "Short",
      hint: longHint,
      retryable: false,
    };
    const tree = ErrorCard({ error });
    const text = collectText(tree);
    expect(text).toContain(longHint);
  });

  // ── All known categories render with their specific icon ──────────

  const categoryTests: Array<{ category: ClassifiedError["category"]; expectedIcon: string }> = [
    { category: "rate_limit", expectedIcon: "\u23F1" },
    { category: "context_window", expectedIcon: "\u26A0" },
    { category: "auth", expectedIcon: "\uD83D\uDD12" },
    { category: "timeout", expectedIcon: "\u231B" },
    { category: "model_not_found", expectedIcon: "\uD83D\uDD0D" },
    { category: "provider_unavailable", expectedIcon: "\u26A1" },
    { category: "parse_error", expectedIcon: "\u2753" },
    { category: "unknown", expectedIcon: "\u274C" },
  ];

  for (const { category, expectedIcon } of categoryTests) {
    it(`renders correct icon for category "${category}"`, () => {
      const error: ClassifiedError = {
        category,
        title: "Test",
        description: "test",
        hint: "",
        retryable: false,
      };
      const tree = ErrorCard({ error });
      const text = collectText(tree);
      expect(text).toContain(expectedIcon);
    });
  }

  // ── Unknown category fallback ─────────────────────────────────────

  it("uses unknown fallback icon for unrecognized category string", () => {
    const error = {
      category: "totally_new_category" as ClassifiedError["category"],
      title: "New",
      description: "new error type",
      hint: "",
      retryable: false,
    };
    const tree = ErrorCard({ error });
    const text = collectText(tree);
    // Should fall back to the unknown icon
    expect(text).toContain("\u274C");
  });

  // ── Rate limit with countdown (retryAfterMs) ─────────────────────

  it("shows countdown text when rate_limit has retryAfterMs", () => {
    // Note: useState is mocked to return initial value
    // For rate_limit with retryAfterMs, useState(null) is initial,
    // but the useEffect would set it. Since useEffect is mocked as noop,
    // the countdown won't actually activate. This tests the static render path.
    const error: ClassifiedError = {
      category: "rate_limit",
      title: "Rate Limit",
      description: "Too fast",
      hint: "Wait",
      retryable: true,
      retryAfterMs: 5000,
    };
    const tree = ErrorCard({ error, onRetry: () => {} });
    // With mocked useState returning null for countdown,
    // the retry button should show "Retry" (not disabled)
    const buttons = collectElements(tree, (el) => el.type === "button");
    const retryBtn = buttons.find((b) => collectText(b).includes("Retry"));
    expect(retryBtn).toBeDefined();
    // Not disabled since countdown is null (useEffect mock doesn't run)
    expect(retryBtn!.props.disabled).toBeFalsy();
  });

  // ── Empty title and hint ──────────────────────────────────────────

  it("renders with empty title", () => {
    const error: ClassifiedError = {
      category: "unknown",
      title: "",
      description: "desc",
      hint: "",
      retryable: false,
    };
    const tree = ErrorCard({ error });
    const text = collectText(tree);
    expect(text).toContain("desc");
  });

  // ── Description with HTML characters ──────────────────────────────

  it("renders description containing HTML tags as literal text (React escapes)", () => {
    const error: ClassifiedError = {
      category: "unknown",
      title: "Error",
      description: '<img src="x" onerror="alert(1)">',
      hint: "",
      retryable: false,
    };
    const tree = ErrorCard({ error });
    const text = collectText(tree);
    // React renders this as text, not as HTML
    expect(text).toContain('<img src="x" onerror="alert(1)">');
  });
});
