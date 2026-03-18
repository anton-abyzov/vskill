import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { ErrorBoundary } from "../ErrorBoundary";

type ReactEl = { type: unknown; props: Record<string, unknown> };

/** Recursively collect all text content from a React element tree. */
function collectText(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(collectText).join("");
  const el = node as ReactEl;
  if (el.props?.children != null) return collectText(el.props.children);
  return "";
}

/** Recursively collect elements matching a predicate. */
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

describe("ErrorBoundary", () => {
  it("getDerivedStateFromError returns { hasError: true }", () => {
    const result = ErrorBoundary.getDerivedStateFromError();
    expect(result).toEqual({ hasError: true });
  });

  it("renders children when hasError is false", () => {
    const boundary = new ErrorBoundary({ children: createElement("div", null, "Hello") });
    boundary.state = { hasError: false };
    const output = boundary.render();
    // When not in error state, render() returns this.props.children
    expect(output).toBeDefined();
    const text = collectText(output);
    expect(text).toBe("Hello");
  });

  it("renders fallback UI with 'Something went wrong' when hasError is true", () => {
    const boundary = new ErrorBoundary({ children: createElement("div", null, "Hello") });
    boundary.state = { hasError: true };
    const output = boundary.render();
    const text = collectText(output);
    expect(text).toContain("Something went wrong");
  });

  it("renders a Reload button in fallback UI", () => {
    const boundary = new ErrorBoundary({ children: null });
    boundary.state = { hasError: true };
    const output = boundary.render();
    const buttons = collectElements(output, (el) => el.type === "button");
    expect(buttons.length).toBeGreaterThan(0);
    const buttonText = collectText(buttons[0]);
    expect(buttonText).toMatch(/reload/i);
  });

  it("Reload button onClick calls window.location.reload", () => {
    const reloadMock = vi.fn();
    const prevWindow = globalThis.window;
    // Provide a minimal window stub in Node environment
    (globalThis as Record<string, unknown>).window = { location: { reload: reloadMock } };
    try {
      const boundary = new ErrorBoundary({ children: null });
      boundary.state = { hasError: true };
      const output = boundary.render();
      const buttons = collectElements(output, (el) => el.type === "button");
      expect(buttons.length).toBeGreaterThan(0);
      const onClick = buttons[0].props.onClick as () => void;
      onClick();
      expect(reloadMock).toHaveBeenCalled();
    } finally {
      (globalThis as Record<string, unknown>).window = prevWindow;
    }
  });

  it("componentDidCatch logs to console.error", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const boundary = new ErrorBoundary({ children: null });
      const error = new Error("Test crash");
      const info = { componentStack: "\n    in BrokenComponent\n    in ErrorBoundary" } as React.ErrorInfo;
      boundary.componentDidCatch(error, info);
      expect(consoleSpy).toHaveBeenCalledWith(
        "ErrorBoundary caught:",
        error,
        info.componentStack,
      );
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it("fallback includes explanatory text about unexpected error", () => {
    const boundary = new ErrorBoundary({ children: null });
    boundary.state = { hasError: true };
    const output = boundary.render();
    const text = collectText(output);
    expect(text).toContain("unexpected error");
  });
});
