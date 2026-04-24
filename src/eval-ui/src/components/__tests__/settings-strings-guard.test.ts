import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// 0702 T-052: Strings guard — AC-US5-04.
//
// No UI string under src/eval-ui/src/ may reference the deleted storage
// concepts: "tier", "keychain", "Browser storage", "macOS Keychain".
// Comments within __tests__ files (like this one) are excluded — the scan
// allow-lists the __tests__ directories that legitimately name the forbidden
// strings in assertions.
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UI_SRC = path.resolve(__dirname, "..", "..");

// Patterns target storage-tier concepts specifically. The bare word "tier"
// legitimately appears in unrelated surfaces (two-tier sidebar layout, free
// tier pricing copy) — we only flag tier when it's paired with a storage
// noun, or the StorageTier identifier itself.
const FORBIDDEN: { pattern: RegExp; label: string }[] = [
  { pattern: /\bBrowser storage\b/i, label: "Browser storage" },
  { pattern: /\bmacOS Keychain\b/i, label: "macOS Keychain" },
  { pattern: /\bkeychain\b/i, label: "keychain" },
  { pattern: /\bStorageTier\b/, label: "StorageTier" },
  { pattern: /\bstorage\s+tier\b/i, label: "storage tier" },
  { pattern: /\btier\s+radio\b/i, label: "tier radio" },
  { pattern: /\bstorage-tier\b/i, label: "storage-tier" },
];

// Test assertions inside __tests__ are already excluded by directory rule
// below; this list is for non-test files that legitimately need to name the
// forbidden strings. MigrationBanner is the ONE user-facing surface allowed
// to name "macOS Keychain" — that's the legacy store we're migrating FROM
// (0702 US-006).
const ALLOWLIST_FILES = new Set<string>([
  path.resolve(__dirname, "settings-strings-guard.test.ts"),
  path.resolve(UI_SRC, "components", "MigrationBanner.tsx"),
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Allow tests to reference forbidden strings inside their own bodies.
      if (entry.name === "__tests__") continue;
      if (entry.name === "node_modules") continue;
      if (entry.name === "dist") continue;
      walk(full, out);
    } else if (
      entry.name.endsWith(".ts") ||
      entry.name.endsWith(".tsx")
    ) {
      out.push(full);
    }
  }
  return out;
}

describe("0702 T-052: forbidden storage strings removed from src/eval-ui/src/", () => {
  const files = walk(UI_SRC).filter((f) => !ALLOWLIST_FILES.has(f));

  for (const { pattern, label } of FORBIDDEN) {
    it(`contains no occurrence of "${label}"`, () => {
      const hits: { file: string; line: number; text: string }[] = [];
      for (const file of files) {
        const text = fs.readFileSync(file, "utf8");
        const lines = text.split("\n");
        lines.forEach((line, idx) => {
          if (pattern.test(line)) {
            hits.push({ file, line: idx + 1, text: line.trim() });
          }
        });
      }
      if (hits.length > 0) {
        const preview = hits
          .slice(0, 10)
          .map((h) => `${h.file}:${h.line}  ${h.text}`)
          .join("\n");
        throw new Error(
          `Expected 0 occurrences of "${label}" in src/eval-ui/src/ (excluding __tests__), found ${hits.length}:\n${preview}`,
        );
      }
    });
  }
});
