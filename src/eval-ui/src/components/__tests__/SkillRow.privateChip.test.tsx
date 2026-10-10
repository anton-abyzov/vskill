// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// 0874 AC-05 (0848 T-003) — the sidebar row marks a skill from a private repo
// with the amber lock chip, and only that skill.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SkillRow } from "../SkillRow";
import type { SkillInfo } from "../../types";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function skill(overrides: Partial<SkillInfo> = {}): SkillInfo {
  return {
    plugin: "acme-tools",
    skill: "greet",
    dir: "/tmp/acme-tools/greet",
    hasEvals: false,
    hasBenchmark: false,
    evalCount: 0,
    assertionCount: 0,
    benchmarkStatus: "missing",
    lastBenchmark: null,
    origin: "installed",
    ...overrides,
  };
}

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
});

function render(props: Partial<React.ComponentProps<typeof SkillRow>>) {
  act(() => {
    root.render(<SkillRow skill={skill()} isSelected={false} onSelect={vi.fn()} {...props} />);
  });
}

describe("SkillRow private chip", () => {
  it("shows the chip for a skill from a private repo, naming the repo", () => {
    render({ repoVisibility: "private", repoFullName: "acme/secret-skills" });
    const chip = container.querySelector("[data-testid='skill-row-private-chip']");
    expect(chip).not.toBeNull();
    expect(chip!.getAttribute("title")).toBe("From private repo: acme/secret-skills");
  });

  it("shows no chip for a public skill", () => {
    render({ repoVisibility: "public", repoFullName: "acme/open-skills" });
    expect(container.querySelector("[data-testid='skill-row-private-chip']")).toBeNull();
  });

  it("shows no chip when visibility is unknown or not resolved", () => {
    render({ repoVisibility: "unknown" });
    expect(container.querySelector("[data-testid='skill-row-private-chip']")).toBeNull();
    render({});
    expect(container.querySelector("[data-testid='skill-row-private-chip']")).toBeNull();
  });
});
