// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// 0734 — EngineSelector component tests.
// ACs: AC-US2-01 (tri-state radio + role=tablist), AC-US2-03 (default precedence),
//      AC-US2-04 (tooltip copy), AC-US2-05 (missing-engine [Install]),
//      AC-US2-06 (data-testid), AC-US2-07 (reduced-motion).
// ---------------------------------------------------------------------------

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import {
  EngineSelector,
  defaultEngineFromDetection,
  ENGINE_TOOLTIP_VSKILL,
  ENGINE_TOOLTIP_ANTHROPIC,
  ENGINE_TOOLTIP_NONE,
} from "../EngineSelector";
import type { EngineDetection } from "../EngineSelector";

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

const both: EngineDetection = {
  vskillSkillBuilder: true,
  anthropicSkillCreator: true,
  vskillVersion: "0.1.0",
  anthropicPath: "/some/path",
};

const onlyVskill: EngineDetection = {
  vskillSkillBuilder: true,
  anthropicSkillCreator: false,
  vskillVersion: "0.1.0",
  anthropicPath: null,
};

const onlyAnthropic: EngineDetection = {
  vskillSkillBuilder: false,
  anthropicSkillCreator: true,
  vskillVersion: null,
  anthropicPath: "/some/path",
};

const neither: EngineDetection = {
  vskillSkillBuilder: false,
  anthropicSkillCreator: false,
  vskillVersion: null,
  anthropicPath: null,
};

function getOption(testId: string): HTMLElement {
  const el = container.querySelector(`[data-testid="${testId}"]`);
  if (!el) throw new Error(`option ${testId} not found`);
  return el as HTMLElement;
}

describe("AC-US2-03: defaultEngineFromDetection precedence", () => {
  it("returns 'vskill' when both detected", () => {
    expect(defaultEngineFromDetection(both)).toBe("vskill");
  });
  it("returns 'vskill' when only VSkill detected", () => {
    expect(defaultEngineFromDetection(onlyVskill)).toBe("vskill");
  });
  it("returns 'anthropic-skill-creator' when only Anthropic detected", () => {
    expect(defaultEngineFromDetection(onlyAnthropic)).toBe("anthropic-skill-creator");
  });
  it("returns 'none' when neither detected", () => {
    expect(defaultEngineFromDetection(neither)).toBe("none");
  });
});

describe("AC-US2-01: structure (tablist + 3 options)", () => {
  it("renders role=tablist with 3 children of role=tab", () => {
    act(() => {
      root.render(
        <EngineSelector detection={both} selected="vskill" onSelect={() => {}} onInstallClick={() => {}} />,
      );
    });
    const tablist = container.querySelector('[role="tablist"]');
    expect(tablist).not.toBeNull();
    const tabs = container.querySelectorAll('[role="tab"]');
    expect(tabs).toHaveLength(3);
  });
});

describe("AC-US2-06: data-testid hooks", () => {
  it("each option has the expected data-testid", () => {
    act(() => {
      root.render(
        <EngineSelector detection={both} selected="vskill" onSelect={() => {}} onInstallClick={() => {}} />,
      );
    });
    expect(getOption("engine-selector-vskill")).toBeTruthy();
    expect(getOption("engine-selector-anthropic-skill-creator")).toBeTruthy();
    expect(getOption("engine-selector-none")).toBeTruthy();
  });
});

describe("AC-US2-04: tooltip copy (exact spec strings)", () => {
  it("VSkill option carries the cross-universal tooltip", () => {
    act(() => {
      root.render(
        <EngineSelector detection={both} selected="vskill" onSelect={() => {}} onInstallClick={() => {}} />,
      );
    });
    expect(getOption("engine-selector-vskill").title).toBe(ENGINE_TOOLTIP_VSKILL);
    expect(ENGINE_TOOLTIP_VSKILL).toContain("Cross-universal");
    expect(ENGINE_TOOLTIP_VSKILL).toContain("8 universal agents");
  });

  it("Anthropic option carries the Claude-native first-class tooltip", () => {
    act(() => {
      root.render(
        <EngineSelector detection={both} selected="vskill" onSelect={() => {}} onInstallClick={() => {}} />,
      );
    });
    expect(getOption("engine-selector-anthropic-skill-creator").title).toBe(ENGINE_TOOLTIP_ANTHROPIC);
    expect(ENGINE_TOOLTIP_ANTHROPIC).toContain("Powerful Claude-native engine");
    expect(ENGINE_TOOLTIP_ANTHROPIC).not.toMatch(/fallback/i);
  });

  it("None option carries the raw-generate tooltip", () => {
    act(() => {
      root.render(
        <EngineSelector detection={both} selected="vskill" onSelect={() => {}} onInstallClick={() => {}} />,
      );
    });
    expect(getOption("engine-selector-none").title).toBe(ENGINE_TOOLTIP_NONE);
  });
});

describe("AC-US2-05: missing engines render with reduced opacity + [Install] button", () => {
  it("renders [Install] button next to a missing engine, opacity reduced", () => {
    act(() => {
      root.render(
        <EngineSelector
          detection={onlyVskill}
          selected="vskill"
          onSelect={() => {}}
          onInstallClick={() => {}}
        />,
      );
    });
    const anthropicOption = getOption("engine-selector-anthropic-skill-creator");
    expect(anthropicOption.style.opacity).toBe("0.6");
    const installBtn = container.querySelector(
      '[data-testid="install-anthropic-skill-creator"]',
    );
    expect(installBtn).not.toBeNull();
  });

  it("clicking [Install] fires onInstallClick with the engine name", () => {
    const onInstallClick = vi.fn();
    act(() => {
      root.render(
        <EngineSelector
          detection={onlyVskill}
          selected="vskill"
          onSelect={() => {}}
          onInstallClick={onInstallClick}
        />,
      );
    });
    const installBtn = container.querySelector(
      '[data-testid="install-anthropic-skill-creator"]',
    ) as HTMLButtonElement;
    act(() => installBtn.click());
    expect(onInstallClick).toHaveBeenCalledWith("anthropic-skill-creator");
  });

  it("does not render [Install] button when engine IS detected", () => {
    act(() => {
      root.render(
        <EngineSelector detection={both} selected="vskill" onSelect={() => {}} onInstallClick={() => {}} />,
      );
    });
    expect(container.querySelector('[data-testid="install-vskill"]')).toBeNull();
    expect(container.querySelector('[data-testid="install-anthropic-skill-creator"]')).toBeNull();
  });
});

describe("AC-US2-01: clicking an option fires onSelect", () => {
  it("clicking Anthropic tab selects it", () => {
    const onSelect = vi.fn();
    act(() => {
      root.render(
        <EngineSelector detection={both} selected="vskill" onSelect={onSelect} onInstallClick={() => {}} />,
      );
    });
    const anthropic = getOption("engine-selector-anthropic-skill-creator");
    act(() => anthropic.click());
    expect(onSelect).toHaveBeenCalledWith("anthropic-skill-creator");
  });

  it("aria-selected reflects the current selection", () => {
    act(() => {
      root.render(
        <EngineSelector
          detection={both}
          selected="anthropic-skill-creator"
          onSelect={() => {}}
          onInstallClick={() => {}}
        />,
      );
    });
    expect(getOption("engine-selector-vskill").getAttribute("aria-selected")).toBe("false");
    expect(getOption("engine-selector-anthropic-skill-creator").getAttribute("aria-selected")).toBe("true");
    expect(getOption("engine-selector-none").getAttribute("aria-selected")).toBe("false");
  });
});

describe("AC-US2-07: reduced-motion users get no transition class", () => {
  it("when prefers-reduced-motion: reduce, options render WITHOUT transition class", () => {
    // Fake the matchMedia for reduced motion.
    const originalMatchMedia = window.matchMedia;
    (window as { matchMedia?: typeof window.matchMedia }).matchMedia = ((query: string) => ({
      matches: query.includes("prefers-reduced-motion: reduce"),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;

    try {
      act(() => {
        root.render(
          <EngineSelector
            detection={both}
            selected="vskill"
            onSelect={() => {}}
            onInstallClick={() => {}}
          />,
        );
      });
      const vskillOption = getOption("engine-selector-vskill");
      expect(vskillOption.className).not.toMatch(/transition-/);
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });
});
