// ---------------------------------------------------------------------------
// 0698 T-006: localStorage scope-rename migration shim.
//
// One-shot rewrite of legacy sidebar collapse keys:
//   vskill-sidebar-{agentId}-own-collapsed       → ...-authoring-project-collapsed
//   vskill-sidebar-{agentId}-installed-collapsed → ...-available-project-collapsed
//   vskill-sidebar-{agentId}-global-collapsed    → ...-available-personal-collapsed
// Flag: "vskill.migrations.scope-rename.v1" = "done". Idempotent.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { runScopeRenameMigration } from "../lib/scope-migration";

function mockStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    key(i: number) {
      return Array.from(map.keys())[i] ?? null;
    },
    getItem(k: string) {
      return map.has(k) ? map.get(k)! : null;
    },
    setItem(k: string, v: string) {
      map.set(k, String(v));
    },
    removeItem(k: string) {
      map.delete(k);
    },
    clear() {
      map.clear();
    },
  } satisfies Storage;
}

const FLAG = "vskill.migrations.scope-rename.v1";

describe("runScopeRenameMigration (0698 T-006)", () => {
  let store: Storage;
  beforeEach(() => {
    store = mockStorage();
  });

  it("renames 'own' collapse key to 'authoring-project'", () => {
    store.setItem("vskill-sidebar-claude-code-own-collapsed", "true");
    runScopeRenameMigration(store);
    expect(store.getItem("vskill-sidebar-claude-code-own-collapsed")).toBeNull();
    expect(store.getItem("vskill-sidebar-claude-code-authoring-project-collapsed")).toBe("true");
    expect(store.getItem(FLAG)).toBe("done");
  });

  it("renames 'installed' collapse key to 'available-project'", () => {
    store.setItem("vskill-sidebar-cursor-installed-collapsed", "false");
    runScopeRenameMigration(store);
    expect(store.getItem("vskill-sidebar-cursor-installed-collapsed")).toBeNull();
    expect(store.getItem("vskill-sidebar-cursor-available-project-collapsed")).toBe("false");
  });

  it("renames 'global' collapse key to 'available-personal'", () => {
    store.setItem("vskill-sidebar-claude-code-global-collapsed", "true");
    runScopeRenameMigration(store);
    expect(store.getItem("vskill-sidebar-claude-code-global-collapsed")).toBeNull();
    expect(store.getItem("vskill-sidebar-claude-code-available-personal-collapsed")).toBe("true");
  });

  it("is idempotent: re-running after the flag is set does nothing", () => {
    store.setItem(FLAG, "done");
    // Pre-seed a legacy key — the shim should NOT rewrite it because the flag exists
    store.setItem("vskill-sidebar-claude-code-own-collapsed", "true");
    runScopeRenameMigration(store);
    // Legacy key still intact, no new key created
    expect(store.getItem("vskill-sidebar-claude-code-own-collapsed")).toBe("true");
    expect(store.getItem("vskill-sidebar-claude-code-authoring-project-collapsed")).toBeNull();
  });

  it("sets flag to 'done' even when no legacy keys are present", () => {
    runScopeRenameMigration(store);
    expect(store.getItem(FLAG)).toBe("done");
  });

  it("handles all three legacy scopes across multiple agents in one pass", () => {
    store.setItem("vskill-sidebar-claude-code-own-collapsed", "true");
    store.setItem("vskill-sidebar-claude-code-installed-collapsed", "false");
    store.setItem("vskill-sidebar-claude-code-global-collapsed", "true");
    store.setItem("vskill-sidebar-cursor-own-collapsed", "false");
    store.setItem("vskill-sidebar-cursor-installed-collapsed", "true");

    runScopeRenameMigration(store);

    expect(store.getItem("vskill-sidebar-claude-code-authoring-project-collapsed")).toBe("true");
    expect(store.getItem("vskill-sidebar-claude-code-available-project-collapsed")).toBe("false");
    expect(store.getItem("vskill-sidebar-claude-code-available-personal-collapsed")).toBe("true");
    expect(store.getItem("vskill-sidebar-cursor-authoring-project-collapsed")).toBe("false");
    expect(store.getItem("vskill-sidebar-cursor-available-project-collapsed")).toBe("true");

    // All 5 legacy keys gone
    expect(store.getItem("vskill-sidebar-claude-code-own-collapsed")).toBeNull();
    expect(store.getItem("vskill-sidebar-claude-code-installed-collapsed")).toBeNull();
    expect(store.getItem("vskill-sidebar-claude-code-global-collapsed")).toBeNull();
    expect(store.getItem("vskill-sidebar-cursor-own-collapsed")).toBeNull();
    expect(store.getItem("vskill-sidebar-cursor-installed-collapsed")).toBeNull();
  });

  it("does not touch unrelated keys", () => {
    store.setItem("vskill.studio.prefs", JSON.stringify({ activeAgent: "claude-code" }));
    store.setItem("vskill-theme", "dark");
    store.setItem("some-other-app-key", "value");

    runScopeRenameMigration(store);

    expect(store.getItem("vskill.studio.prefs")).toBe(JSON.stringify({ activeAgent: "claude-code" }));
    expect(store.getItem("vskill-theme")).toBe("dark");
    expect(store.getItem("some-other-app-key")).toBe("value");
  });

  it("does not overwrite an existing new-format key (prefers existing value)", () => {
    store.setItem("vskill-sidebar-claude-code-own-collapsed", "true");
    store.setItem("vskill-sidebar-claude-code-authoring-project-collapsed", "false"); // pre-existing

    runScopeRenameMigration(store);

    // New key stays at the pre-existing value; legacy is removed
    expect(store.getItem("vskill-sidebar-claude-code-authoring-project-collapsed")).toBe("false");
    expect(store.getItem("vskill-sidebar-claude-code-own-collapsed")).toBeNull();
  });
});
