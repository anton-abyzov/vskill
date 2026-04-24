// ---------------------------------------------------------------------------
// `vskill diff <skill> <from> <to>` — multi-file version diff renderer.
//
// Fetches GitHub-backed compare data via the platform /versions/compare
// endpoint and renders it to stdout. Zero shell-outs (no `git`, no `diff`);
// pure fetch + stdout.write. Works on Windows cmd/PowerShell because it uses
// raw ANSI escape codes that Windows Terminal and modern cmd.exe render
// natively (conhost: enabled since Windows 10 1511+).
//
// Flags:
//   default    unified color diff (respects TTY + NO_COLOR/FORCE_COLOR)
//   --stat     per-file `filename +N -M` summary with a totals line
//   --json     pretty-printed raw compare response, no colors
//   --files    glob filter applied via minimatch
//
// Exit code: 0 on success, 1 on fetch error / non-OK HTTP.
// ---------------------------------------------------------------------------

import { minimatch } from "minimatch";
import { compareVersions, type CompareFile, type CompareVersionsResult } from "../api/client.js";

export interface DiffOpts {
  stat?: boolean;
  json?: boolean;
  files?: string;
}

const ANSI = {
  green: "\x1b[32m",
  red: "\x1b[31m",
  grey: "\x1b[90m",
  cyan: "\x1b[36m",
  bold: "\x1b[1m",
  reset: "\x1b[0m",
} as const;

/**
 * Color output decision. Matches conventions used by git, diff, and ls:
 *   • FORCE_COLOR=1 → force colors on
 *   • NO_COLOR=1    → force colors off (https://no-color.org/)
 *   • else          → colors iff stdout is a TTY
 */
function shouldColor(): boolean {
  if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== "0") return true;
  if (process.env.NO_COLOR) return false;
  return !!process.stdout.isTTY;
}

export async function diffCommand(
  skill: string,
  from: string,
  to: string,
  opts: DiffOpts = {},
): Promise<void> {
  let data: CompareVersionsResult;
  try {
    data = await compareVersions(skill, from, to);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`vskill diff: ${msg}\n`);
    process.exit(1);
  }

  const files = opts.files
    ? data.files.filter((f) => minimatch(f.filename, opts.files as string))
    : data.files;

  if (opts.json) {
    // --json emits raw compare response with filtered file list, pretty-printed,
    // no colors so output is pipeable into `jq` etc.
    process.stdout.write(JSON.stringify({ ...data, files }, null, 2) + "\n");
    return;
  }

  if (opts.stat) {
    printStat(files);
    return;
  }

  const useColor = shouldColor();
  for (const file of files) {
    printFileDiff(file, useColor);
  }
}

function printStat(files: CompareFile[]): void {
  let totalAdd = 0;
  let totalDel = 0;
  for (const f of files) {
    totalAdd += f.additions || 0;
    totalDel += f.deletions || 0;
    process.stdout.write(
      ` ${f.filename} +${f.additions || 0} -${f.deletions || 0}\n`,
    );
  }
  process.stdout.write(
    ` ${files.length} files changed, ${totalAdd} insertions(+), ${totalDel} deletions(-)\n`,
  );
}

function printFileDiff(file: CompareFile, useColor: boolean): void {
  const bold = useColor ? ANSI.bold : "";
  const cyan = useColor ? ANSI.cyan : "";
  const reset = useColor ? ANSI.reset : "";
  process.stdout.write(
    `${bold}${cyan}diff --skill ${file.filename}${reset}\n`,
  );
  process.stdout.write(
    `${bold}status: ${file.status}  +${file.additions || 0} -${file.deletions || 0}${reset}\n`,
  );
  if (!file.patch) {
    process.stdout.write(`${useColor ? ANSI.grey : ""}(no patch content)${reset}\n`);
    return;
  }
  for (const line of file.patch.split("\n")) {
    process.stdout.write(colorize(line, useColor) + "\n");
  }
}

function colorize(line: string, useColor: boolean): string {
  if (!useColor) return line;
  if (line.startsWith("+") && !line.startsWith("+++")) return `${ANSI.green}${line}${ANSI.reset}`;
  if (line.startsWith("-") && !line.startsWith("---")) return `${ANSI.red}${line}${ANSI.reset}`;
  if (line.startsWith("@@")) return `${ANSI.grey}${line}${ANSI.reset}`;
  return line;
}
