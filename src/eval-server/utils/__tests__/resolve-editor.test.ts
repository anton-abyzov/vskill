// ---------------------------------------------------------------------------
// resolve-editor.test.ts — 0820: editor command resolver
//
// Pure function tests. `resolveEditorCommand` accepts env, platform, and a
// `which` predicate as injected parameters so every test pins them
// deterministically — no shell-out, no PATH dependency.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  resolveEditorCommand,
  NoEditorError,
} from "../resolve-editor.js";

const dir = "/r/p/skills/s";
const file = "SKILL.md";
const fullPath = `${dir}/${file}`;
const target = { dir, file };
const targetNoFile = { dir };
const noWhich = (_cmd: string) => false;
const yesWhich = (_cmd: string) => true;

describe("resolveEditorCommand — env vars", () => {
  it("uses $VISUAL with flags split into argv (path appended last)", () => {
    const launch = resolveEditorCommand(
      target,
      { VISUAL: "code --reuse-window" } as NodeJS.ProcessEnv,
      "darwin",
      noWhich,
    );
    expect(launch).toEqual({
      command: "code",
      args: ["--reuse-window", fullPath],
    });
  });

  it("uses $EDITOR when $VISUAL is missing", () => {
    const launch = resolveEditorCommand(
      target,
      { EDITOR: "vim" } as NodeJS.ProcessEnv,
      "darwin",
      noWhich,
    );
    expect(launch).toEqual({ command: "vim", args: [fullPath] });
  });

  it("$VISUAL takes precedence over $EDITOR", () => {
    const launch = resolveEditorCommand(
      target,
      { VISUAL: "subl", EDITOR: "vim" } as NodeJS.ProcessEnv,
      "darwin",
      noWhich,
    );
    expect(launch.command).toBe("subl");
  });

  it("ignores empty/whitespace $VISUAL and falls through", () => {
    const launch = resolveEditorCommand(
      target,
      { VISUAL: "   " } as NodeJS.ProcessEnv,
      "linux",
      noWhich,
    );
    expect(launch).toEqual({ command: "xdg-open", args: [fullPath] });
  });
});

describe("resolveEditorCommand — PATH probes", () => {
  it("prefers `code` when on PATH", () => {
    const launch = resolveEditorCommand(target, {}, "linux", (cmd) => cmd === "code");
    expect(launch).toEqual({ command: "code", args: [fullPath] });
  });

  it("falls back to `cursor` when only `cursor` is on PATH", () => {
    const launch = resolveEditorCommand(target, {}, "linux", (cmd) => cmd === "cursor");
    expect(launch).toEqual({ command: "cursor", args: [fullPath] });
  });

  it("prefers `code` over `cursor` when both are present", () => {
    const launch = resolveEditorCommand(target, {}, "linux", yesWhich);
    expect(launch.command).toBe("code");
  });
});

describe("resolveEditorCommand — OS fallback", () => {
  it("darwin → `open <path>`", () => {
    const launch = resolveEditorCommand(target, {}, "darwin", noWhich);
    expect(launch).toEqual({ command: "open", args: [fullPath] });
  });

  it("linux → `xdg-open <path>`", () => {
    const launch = resolveEditorCommand(target, {}, "linux", noWhich);
    expect(launch).toEqual({ command: "xdg-open", args: [fullPath] });
  });

  it("win32 → `cmd /c start \"\" <path>`", () => {
    const launch = resolveEditorCommand(target, {}, "win32", noWhich);
    expect(launch).toEqual({
      command: "cmd",
      args: ["/c", "start", "", fullPath],
    });
  });

  it("throws NoEditorError on an unsupported platform with no env / no PATH", () => {
    expect(() =>
      resolveEditorCommand(target, {}, "freebsd" as NodeJS.Platform, noWhich),
    ).toThrow(NoEditorError);
  });
});

describe("resolveEditorCommand — target shape", () => {
  it("when target.file is omitted, the spawn target is the dir", () => {
    const launch = resolveEditorCommand(targetNoFile, { EDITOR: "vim" } as NodeJS.ProcessEnv, "darwin", noWhich);
    expect(launch.args[launch.args.length - 1]).toBe(dir);
  });

  it("when target.file is present, the spawn target is dir/file", () => {
    const launch = resolveEditorCommand(target, { EDITOR: "vim" } as NodeJS.ProcessEnv, "darwin", noWhich);
    expect(launch.args[launch.args.length - 1]).toBe(fullPath);
  });

  it("path is the LAST argv element even with $VISUAL flags", () => {
    const launch = resolveEditorCommand(
      target,
      { VISUAL: "code -n -w" } as NodeJS.ProcessEnv,
      "darwin",
      noWhich,
    );
    expect(launch.args[launch.args.length - 1]).toBe(fullPath);
    expect(launch.args.slice(0, -1)).toEqual(["-n", "-w"]);
  });
});
