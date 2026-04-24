// ---------------------------------------------------------------------------
// deleted-symbols.test.ts — T-008: enforce deletion of tier + Keychain API.
//
// Pairs with T-009 (DELETE) — this file fails until the old symbols are gone.
// ---------------------------------------------------------------------------

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as settingsStore from "../settings-store.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Deleted symbols (T-008)", () => {
  it("TC-012: old tier API symbols are undefined on the module namespace", () => {
    const ns = settingsStore as unknown as Record<string, unknown>;
    expect(ns.setTier).toBeUndefined();
    expect(ns.getTier).toBeUndefined();
    expect(ns.UnsupportedTierError).toBeUndefined();
    expect(ns._setPlatformOverride).toBeUndefined();
    expect(ns._setSpawn).toBeUndefined();
    expect(ns._setLogger).toBeUndefined();
  });

  it("TC-013: no 'keychain' or 'tier' strings in settings-store.ts (case-insensitive)", () => {
    const storePath = path.resolve(__dirname, "..", "settings-store.ts");
    const source = fs.readFileSync(storePath, "utf8");
    // Allow mentions inside comments describing the NEW contract only if they're prefixed with a negation or documentation about removal, but to keep it simple require zero occurrences.
    expect(/keychain/i.test(source)).toBe(false);
    expect(/\btier\b/i.test(source)).toBe(false);
  });
});
