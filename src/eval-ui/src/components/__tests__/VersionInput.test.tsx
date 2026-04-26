// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// 0734 — VersionInput component tests.
// ACs: AC-US4-01 (prefill 1.0.0), AC-US4-02 (semver validation on blur),
//      AC-US4-03 (Submit gating via onValidityChange callback),
//      AC-US4-05 (tooltip text), AC-US4-07 (Versions link in update mode only).
// ---------------------------------------------------------------------------

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { VersionInput } from "../VersionInput";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

function findInput(): HTMLInputElement {
  const input = container.querySelector('input[data-testid="version-input"]');
  if (!input) throw new Error("VersionInput input not found");
  return input as HTMLInputElement;
}

function setInputValue(input: HTMLInputElement, next: string): void {
  // React tracks `value` via a native setter — bypassing it via direct
  // assignment is invisible to React. Using the prototype setter ensures
  // React's onChange fires on the subsequent input event.
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, next);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function findHelperText(): HTMLElement | null {
  return container.querySelector('[data-testid="version-input-helper"]');
}

function findVersionsLink(): HTMLAnchorElement | null {
  return container.querySelector('a[data-testid="version-input-versions-link"]');
}

describe("VersionInput", () => {
  it("AC-US4-01: prefills the input with the provided value (1.0.0 default)", () => {
    act(() => {
      root.render(<VersionInput value="1.0.0" onChange={() => {}} mode="create" />);
    });
    expect(findInput().value).toBe("1.0.0");
  });

  it("AC-US4-01: prefills the input with the supplied value in update mode (e.g. existing version)", () => {
    act(() => {
      root.render(<VersionInput value="2.3.4" onChange={() => {}} mode="update" />);
    });
    expect(findInput().value).toBe("2.3.4");
  });

  it("AC-US4-02: invalid semver on blur → renders helper text + red border class", () => {
    const onValidityChange = vi.fn();
    act(() => {
      root.render(
        <VersionInput
          value="not-a-version"
          onChange={() => {}}
          onValidityChange={onValidityChange}
          mode="create"
        />,
      );
    });
    const input = findInput();
    act(() => {
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    const helper = findHelperText();
    expect(helper).not.toBeNull();
    expect(helper!.textContent).toContain("Must be valid semver");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(onValidityChange).toHaveBeenCalledWith(false);
  });

  it("AC-US4-02: valid semver on blur → no helper text + onValidityChange(true)", () => {
    const onValidityChange = vi.fn();
    act(() => {
      root.render(
        <VersionInput
          value="2.1.3-beta.1"
          onChange={() => {}}
          onValidityChange={onValidityChange}
          mode="create"
        />,
      );
    });
    const input = findInput();
    act(() => {
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(findHelperText()).toBeNull();
    expect(input.getAttribute("aria-invalid")).toBe("false");
    expect(onValidityChange).toHaveBeenCalledWith(true);
  });

  it("AC-US4-04: typing fires onChange with the new value", () => {
    const onChange = vi.fn();
    act(() => {
      root.render(<VersionInput value="1.0.0" onChange={onChange} mode="create" />);
    });
    const input = findInput();
    act(() => {
      setInputValue(input, "1.0.1");
    });
    expect(onChange).toHaveBeenCalledWith("1.0.1");
  });

  it("AC-US4-05: tooltip (title attribute) carries the spec copy", () => {
    act(() => {
      root.render(<VersionInput value="1.0.0" onChange={() => {}} mode="create" />);
    });
    const input = findInput();
    expect(input.title).toBe("Skill version (semver). Auto-bumps on update unless versioningMode=author.");
  });

  it("AC-US4-07: Versions link rendered in update mode when versionsHref provided", () => {
    act(() => {
      root.render(
        <VersionInput
          value="1.0.0"
          onChange={() => {}}
          mode="update"
          versionsHref="https://verified-skill.com/skills/owner/repo/skill/versions"
        />,
      );
    });
    const link = findVersionsLink();
    expect(link).not.toBeNull();
    expect(link!.href).toBe("https://verified-skill.com/skills/owner/repo/skill/versions");
    expect(link!.textContent).toContain("Versions");
  });

  it("AC-US4-07: Versions link NOT rendered in create mode", () => {
    act(() => {
      root.render(
        <VersionInput
          value="1.0.0"
          onChange={() => {}}
          mode="create"
          versionsHref="https://verified-skill.com/skills/owner/repo/skill/versions"
        />,
      );
    });
    expect(findVersionsLink()).toBeNull();
  });
});
