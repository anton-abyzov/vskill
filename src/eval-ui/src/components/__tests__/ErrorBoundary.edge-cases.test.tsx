import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { ErrorBoundary } from "../ErrorBoundary";

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

describe("ErrorBoundary — edge cases", () => {
  // ── Multiple sequential errors ─────────────────────────────────────

  it("stays in error state after multiple getDerivedStateFromError calls", () => {
    // getDerivedStateFromError is static, but calling it multiple times
    // should always return { hasError: true }
    const first = ErrorBoundary.getDerivedStateFromError();
    const second = ErrorBoundary.getDerivedStateFromError();
    expect(first).toEqual({ hasError: true });
    expect(second).toEqual({ hasError: true });
    // Each call returns a fresh object (not the same reference)
    expect(first).not.toBe(second);
  });

  // ── componentDidCatch with various error types ─────────────────────

  it("componentDidCatch handles error with no stack trace", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const boundary = new ErrorBoundary({ children: null });
    const error = new Error("no stack");
    const info = { componentStack: "" } as React.ErrorInfo;
    boundary.componentDidCatch(error, info);
    expect(spy).toHaveBeenCalledWith("ErrorBoundary caught:", error, "");
    spy.mockRestore();
  });

  it("componentDidCatch handles error with very long componentStack", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const boundary = new ErrorBoundary({ children: null });
    const error = new Error("deep stack");
    const longStack = Array.from({ length: 100 }, (_, i) => `\n    in Component${i}`).join("");
    const info = { componentStack: longStack } as React.ErrorInfo;
    boundary.componentDidCatch(error, info);
    expect(spy).toHaveBeenCalledWith("ErrorBoundary caught:", error, longStack);
    spy.mockRestore();
  });

  // ── Render output with null children ───────────────────────────────

  it("renders children when hasError is false and children is null", () => {
    const boundary = new ErrorBoundary({ children: null });
    boundary.state = { hasError: false };
    const output = boundary.render();
    // When hasError is false, render returns this.props.children (null)
    expect(output).toBeNull();
  });

  it("renders children when hasError is false and children is a fragment with multiple elements", () => {
    const children = [
      createElement("div", { key: "1" }, "First"),
      createElement("div", { key: "2" }, "Second"),
    ];
    const boundary = new ErrorBoundary({ children });
    boundary.state = { hasError: false };
    const output = boundary.render();
    expect(output).toEqual(children);
  });

  // ── Fallback UI structure ──────────────────────────────────────────

  it("fallback UI has exactly one button", () => {
    const boundary = new ErrorBoundary({ children: null });
    boundary.state = { hasError: true };
    const output = boundary.render();
    const buttons = collectElements(output, (el) => el.type === "button");
    expect(buttons).toHaveLength(1);
  });

  it("fallback UI button has className containing 'btn'", () => {
    const boundary = new ErrorBoundary({ children: null });
    boundary.state = { hasError: true };
    const output = boundary.render();
    const buttons = collectElements(output, (el) => el.type === "button");
    expect(buttons[0].props.className).toContain("btn");
  });

  it("fallback UI contains centered text (textAlign: center on container)", () => {
    const boundary = new ErrorBoundary({ children: null });
    boundary.state = { hasError: true };
    const output = boundary.render() as ReactEl;
    const style = output.props.style as Record<string, unknown>;
    expect(style.textAlign).toBe("center");
  });

  // ── Error after recovery: re-entering error state ──────────────────

  it("can transition from error state back to normal and then error again", () => {
    const boundary = new ErrorBoundary({ children: createElement("div", null, "OK") });

    // Start normal
    boundary.state = { hasError: false };
    let text = collectText(boundary.render());
    expect(text).toBe("OK");

    // Error happens
    boundary.state = { hasError: true };
    text = collectText(boundary.render());
    expect(text).toContain("Something went wrong");

    // Recovery (e.g., state reset)
    boundary.state = { hasError: false };
    text = collectText(boundary.render());
    expect(text).toBe("OK");

    // Error happens again
    boundary.state = { hasError: true };
    text = collectText(boundary.render());
    expect(text).toContain("Something went wrong");
  });
});
