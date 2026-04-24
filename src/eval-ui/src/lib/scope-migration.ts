// ---------------------------------------------------------------------------
// 0698 T-006: localStorage scope-rename migration.
//
// One-shot rewrite of legacy sidebar collapse keys on app boot. Idempotent
// via flag `vskill.migrations.scope-rename.v1`. Must run BEFORE React mount
// (synchronously, in main.tsx) so the Sidebar renders with the correct initial
// collapse state the first time.
//
// Safety:
//  - Flag-gated — no-op once "done".
//  - Does not overwrite a pre-existing new-format key (preserves user intent).
//  - Does not touch unrelated keys (studio.prefs, theme, sidebar width, etc.).
// ---------------------------------------------------------------------------

const FLAG = "vskill.migrations.scope-rename.v1";

const LEGACY_TO_NEW: Record<string, string> = {
  own: "authoring-project",
  installed: "available-project",
  global: "available-personal",
};

const LEGACY_KEY_PATTERN =
  /^vskill-sidebar-(.+)-(own|installed|global)-collapsed$/;

/**
 * Rewrite legacy scope names in localStorage keys to the new 5-value vocabulary.
 * Runs once per browser session (flag-gated). Takes an injected Storage for
 * testability; production callers pass `window.localStorage`.
 */
export function runScopeRenameMigration(store: Storage): void {
  if (store.getItem(FLAG) === "done") return;

  // Collect keys to migrate up-front so we don't mutate during iteration.
  const toMigrate: Array<{ oldKey: string; newKey: string; value: string }> = [];
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (!key) continue;
    const match = key.match(LEGACY_KEY_PATTERN);
    if (!match) continue;
    const [, agentId, legacyScope] = match;
    const newScope = LEGACY_TO_NEW[legacyScope];
    if (!newScope) continue;
    const value = store.getItem(key);
    if (value === null) continue;
    toMigrate.push({
      oldKey: key,
      newKey: `vskill-sidebar-${agentId}-${newScope}-collapsed`,
      value,
    });
  }

  for (const { oldKey, newKey, value } of toMigrate) {
    // Preserve an existing new-format value if the user has already set one.
    if (store.getItem(newKey) === null) {
      store.setItem(newKey, value);
    }
    store.removeItem(oldKey);
  }

  store.setItem(FLAG, "done");
}
