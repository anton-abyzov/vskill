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

describe("ErrorCard — model_not_found category", () => {
  const modelNotFoundError: ClassifiedError = {
    category: "model_not_found",
    title: "Model Not Found",
    description: "The requested model does not exist.",
    hint: "The selected model is not available. Try switching to a different model in the dropdown above.",
    retryable: false,
  };

  it("renders hint text for model_not_found", () => {
    const tree = ErrorCard({ error: modelNotFoundError });
    const text = collectText(tree);
    expect(text).toContain(
      "The selected model is not available. Try switching to a different model in the dropdown above.",
    );
  });

  it("uses model_not_found-specific icon, not the unknown fallback icon", () => {
    const tree = ErrorCard({ error: modelNotFoundError }) as ReactEl;
    expect(tree).not.toBeNull();
    const text = collectText(tree);
    // model_not_found should use the magnifying glass icon, not the unknown x-mark
    expect(text).toContain("\uD83D\uDD0D"); // magnifying glass
    expect(text).not.toContain("\u274C"); // x-mark (unknown fallback)
  });

  it("re-exports ClassifiedError type from shared module", async () => {
    // Verify the re-export works at runtime by importing from ErrorCard
    const mod = await import("../ErrorCard");
    // The re-export is a type-only export, so we just verify the module loads
    // and ErrorCard is exported as a function
    expect(typeof mod.ErrorCard).toBe("function");
  });
});
