// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { matchSkillQuery } from "../SidebarSearch";

describe("matchSkillQuery (pure helper)", () => {
  it("matches on skill name substring (case-insensitive)", () => {
    expect(matchSkillQuery({ skill: "Obsidian-Brain", plugin: "x", dir: "/y" }, "obsi")).toBe(true);
    expect(matchSkillQuery({ skill: "foo", plugin: "x", dir: "/y" }, "zz")).toBe(false);
  });

  it("matches on plugin", () => {
    expect(matchSkillQuery({ skill: "a", plugin: "react-web", dir: "/y" }, "REACT")).toBe(true);
  });

  it("matches on dir", () => {
    expect(matchSkillQuery({ skill: "a", plugin: "b", dir: "/home/u/.claude/skills/foo" }, ".claude")).toBe(true);
  });

  it("returns true for empty query", () => {
    expect(matchSkillQuery({ skill: "a", plugin: "b", dir: "/y" }, "")).toBe(true);
    expect(matchSkillQuery({ skill: "a", plugin: "b", dir: "/y" }, "   ")).toBe(true);
  });
});

describe("SidebarSearch (component)", () => {
  it("calls onChange on input", async () => {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { SidebarSearch } = await import("../SidebarSearch");

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    const onChange = vi.fn();
    act(() => {
      root.render(React.createElement(SidebarSearch, { value: "", onChange }));
    });

    const input = container.querySelector("input[type='search']") as HTMLInputElement;
    expect(input).toBeTruthy();

    act(() => {
      // React 19: fire an input event with valueTracker synced so React picks up the change.
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
      nativeSetter?.call(input, "foo");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith("foo");

    act(() => root.unmount());
    container.remove();
  });

  it("Escape clears input via onChange('')", async () => {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { SidebarSearch } = await import("../SidebarSearch");

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    const onChange = vi.fn();
    act(() => {
      root.render(React.createElement(SidebarSearch, { value: "foo", onChange }));
    });

    const input = container.querySelector("input[type='search']") as HTMLInputElement;
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith("");

    act(() => root.unmount());
    container.remove();
  });

  // ---------------------------------------------------------------------
  // T-054 — aria-invalid + aria-describedby on validation error.
  // AC-US8-08: inputs that surface a validation error expose the error to
  // assistive tech via aria-invalid="true" and aria-describedby pointing at
  // the error message node.
  // ---------------------------------------------------------------------
  it("sets aria-invalid + aria-describedby when value fails validationPattern", async () => {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { SidebarSearch } = await import("../SidebarSearch");

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    const onChange = vi.fn();
    // pattern: alphanumeric + dash only (mimics a plugin-name-style filter)
    act(() => {
      root.render(
        React.createElement(SidebarSearch, {
          value: "bad@@@value",
          onChange,
          validationPattern: /^[a-zA-Z0-9-]+$/,
          validationMessage: "Only letters, numbers, and dashes",
        }),
      );
    });

    const input = container.querySelector("input[type='search']") as HTMLInputElement;
    expect(input.getAttribute("aria-invalid")).toBe("true");

    const describedBy = input.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    // document.getElementById handles colon-bearing useId values that
    // querySelector + CSS.escape may not in every jsdom version.
    const errorEl = document.getElementById(describedBy!);
    expect(errorEl).toBeTruthy();
    expect(errorEl?.textContent).toBe("Only letters, numbers, and dashes");
    expect(errorEl?.getAttribute("role")).toBe("alert");

    act(() => root.unmount());
    container.remove();
  });

  it("clears aria-invalid when value becomes valid", async () => {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { SidebarSearch } = await import("../SidebarSearch");

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        React.createElement(SidebarSearch, {
          value: "bad@@",
          onChange: () => {},
          validationPattern: /^[a-zA-Z0-9-]+$/,
        }),
      );
    });

    let input = container.querySelector("input[type='search']") as HTMLInputElement;
    expect(input.getAttribute("aria-invalid")).toBe("true");

    // re-render with a valid value — aria-invalid must be removed entirely
    // (not "false") per AC-US8-08.
    act(() => {
      root.render(
        React.createElement(SidebarSearch, {
          value: "obsi-brain",
          onChange: () => {},
          validationPattern: /^[a-zA-Z0-9-]+$/,
        }),
      );
    });

    input = container.querySelector("input[type='search']") as HTMLInputElement;
    expect(input.hasAttribute("aria-invalid")).toBe(false);
    expect(input.hasAttribute("aria-describedby")).toBe(false);
    expect(container.querySelector("[role='alert']")).toBeNull();

    act(() => root.unmount());
    container.remove();
  });

  it("never marks an empty value as invalid (required-field semantics not applied)", async () => {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { SidebarSearch } = await import("../SidebarSearch");

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        React.createElement(SidebarSearch, {
          value: "",
          onChange: () => {},
          validationPattern: /^[a-zA-Z0-9-]+$/,
        }),
      );
    });

    const input = container.querySelector("input[type='search']") as HTMLInputElement;
    expect(input.hasAttribute("aria-invalid")).toBe(false);

    act(() => root.unmount());
    container.remove();
  });

  it("focuses input when `/` is pressed outside an input", async () => {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { SidebarSearch } = await import("../SidebarSearch");

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(React.createElement(SidebarSearch, { value: "", onChange: () => {} }));
    });

    const input = container.querySelector("input[type='search']") as HTMLInputElement;
    expect(document.activeElement).not.toBe(input);

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true }));
    });
    expect(document.activeElement).toBe(input);

    act(() => root.unmount());
    container.remove();
  });
});
