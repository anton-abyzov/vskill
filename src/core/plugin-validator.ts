// ---------------------------------------------------------------------------
// 0793 — `claude plugin validate <path>` wrapper.
//
// vskill never duplicates Claude Code's plugin schema. Both `vskill plugin new`
// (CLI) and `POST /api/authoring/convert-to-plugin` (Studio) call this helper
// after writing a manifest to confirm the JSON we wrote conforms. When `claude`
// is not on PATH (e.g. CI without Claude Code installed), validation soft-skips
// with `{ ok: true, skipped: true }` so vskill stays usable; callers should
// surface that state to the user.
// ---------------------------------------------------------------------------

import { spawnSync } from "node:child_process";

export interface PluginValidationResult {
  ok: boolean;
  skipped: boolean;
  stderr: string;
}

export interface ValidateClaudePluginOptions {
  /**
   * Override the binary name (tests inject a fake "claude").
   */
  bin?: string;
  /**
   * Timeout in ms. Defaults to 10s — `claude plugin validate` is local-only
   * and typically returns in <300ms; 10s is generous headroom.
   */
  timeoutMs?: number;
}

export function validateClaudePlugin(
  pluginPath: string,
  opts: ValidateClaudePluginOptions = {},
): PluginValidationResult {
  const bin = opts.bin ?? "claude";
  const result = spawnSync(bin, ["plugin", "validate", pluginPath], {
    encoding: "utf8",
    timeout: opts.timeoutMs ?? 10_000,
  });

  // ENOENT => `claude` not on PATH. Soft-skip so vskill remains usable in
  // environments without Claude Code (CI, fresh dev boxes, etc).
  // `result.error` is a NodeJS.ErrnoException when spawn itself failed.
  const err = result.error as (NodeJS.ErrnoException | undefined);
  if (err && err.code === "ENOENT") {
    return { ok: true, skipped: true, stderr: "" };
  }
  if (err) {
    // Any other spawn error (timeout, permission, etc): surface but don't
    // treat as schema failure — caller decides what to do.
    return {
      ok: false,
      skipped: false,
      stderr: `failed to invoke ${bin}: ${err.message}`,
    };
  }

  if (result.status === 0) {
    return { ok: true, skipped: false, stderr: "" };
  }

  // `claude plugin validate` writes diagnostics to stderr (or stdout in some
  // versions). Concatenate both so callers always see the message.
  const stderr = [result.stderr ?? "", result.stdout ?? ""]
    .filter((s) => s && s.trim().length > 0)
    .join("\n")
    .trim();
  return { ok: false, skipped: false, stderr };
}
