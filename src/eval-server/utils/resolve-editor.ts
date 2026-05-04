// ---------------------------------------------------------------------------
// resolve-editor.ts — 0820
//
// Pure helper that decides which editor to launch and how to invoke it.
//
// Resolution ladder (first match wins):
//   1. $VISUAL   (split on whitespace; first token = command, rest = flags)
//   2. $EDITOR   (same)
//   3. `code`    on PATH
//   4. `cursor`  on PATH
//   5. OS default — `open` (darwin) / `xdg-open` (linux) / `cmd /c start "" …` (win32)
//
// The resolved path is ALWAYS appended as the last argv element, so a
// $VISUAL-supplied flag cannot displace it.
//
// Pure: no I/O on import. `which`, `env`, and `platform` are injectable so
// tests pin them deterministically.
// ---------------------------------------------------------------------------

import { join } from "node:path";
import { whichSync } from "./which.js";

export type EditorTarget = { dir: string; file?: string };
export type EditorLaunch = { command: string; args: string[] };

export class NoEditorError extends Error {
  constructor() {
    super("no_editor");
    this.name = "NoEditorError";
  }
}

function pathFor(target: EditorTarget): string {
  return target.file ? join(target.dir, target.file) : target.dir;
}

// Limitation: this is whitespace-only tokenization. A `$VISUAL` value with a
// quoted path (e.g. `code "/Applications/Visual Studio Code.app/.../code"`)
// will tokenize incorrectly and the launch will fail with ENOENT, surfacing
// as the generic "Could not open" toast in the UI. Acceptable for the common
// `command --flag` shape; switch to a shell-aware parser if needed.
function splitEnvCommand(value: string | undefined): string[] | null {
  if (!value) return null;
  const tokens = value.trim().split(/\s+/).filter(Boolean);
  return tokens.length > 0 ? tokens : null;
}

/**
 * Backwards-compatible re-export. New code should import `whichSync` from
 * `./which.js` directly.
 */
export const defaultWhich = whichSync;

export function resolveEditorCommand(
  target: EditorTarget,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  which: (cmd: string) => boolean = defaultWhich,
): EditorLaunch {
  const path = pathFor(target);

  // 1 + 2: $VISUAL / $EDITOR
  for (const key of ["VISUAL", "EDITOR"] as const) {
    const tokens = splitEnvCommand(env[key]);
    if (tokens) {
      const [command, ...flags] = tokens;
      return { command: command!, args: [...flags, path] };
    }
  }

  // 3 + 4: known graphical editors on PATH
  for (const candidate of ["code", "cursor"]) {
    if (which(candidate)) {
      return { command: candidate, args: [path] };
    }
  }

  // 5: OS default
  switch (platform) {
    case "darwin":
      return { command: "open", args: [path] };
    case "linux":
      return { command: "xdg-open", args: [path] };
    case "win32":
      // `start` is a cmd builtin. The empty string is the (required) window
      // title placeholder — without it, `start "<path>"` would treat the
      // path as the title and open a new shell instead.
      return { command: "cmd", args: ["/c", "start", "", path] };
    default:
      throw new NoEditorError();
  }
}
