// ---------------------------------------------------------------------------
// vskill clone — interactive prompts (TTY-only, readline-based)
// ---------------------------------------------------------------------------
// Mirrors the pattern used in src/commands/remove.ts (createInterface + a
// promise-wrapped question). Falls back to non-interactive defaults when
// stdin is not a TTY so the CLI is scriptable in CI.
// ---------------------------------------------------------------------------

import { createInterface } from "node:readline";

export interface ConfirmPromptOptions {
  /** When true, bypass all prompts and return true. */
  yes?: boolean;
  /** Override TTY detection (defaults to process.stdin.isTTY). */
  stdinIsTTY?: boolean;
}

export async function confirmPrompt(
  message: string,
  opts: ConfirmPromptOptions = {},
): Promise<boolean> {
  if (opts.yes) return true;
  const isTTY = opts.stdinIsTTY ?? process.stdin.isTTY;
  if (!isTTY) {
    process.stderr.write(
      "refusing to prompt in non-TTY context — re-run with --yes to confirm\n",
    );
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<boolean>((resolveAns) => {
    rl.question(`${message} (y/N): `, (answer) => {
      rl.close();
      resolveAns(answer.trim().toLowerCase() === "y");
    });
  });
}

export async function promptInput(message: string): Promise<string> {
  if (!process.stdin.isTTY) return "";
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<string>((resolveAns) => {
    rl.question(`${message} `, (answer) => {
      rl.close();
      resolveAns(answer.trim());
    });
  });
}

/**
 * Prompt the user to choose one of N labelled options. Returns the chosen
 * index. Re-prompts on bad input.
 */
export async function promptChoice(message: string, labels: string[]): Promise<number> {
  if (!process.stdin.isTTY) return 0;
  console.log(message);
  for (let i = 0; i < labels.length; i++) {
    console.log(`  [${i + 1}] ${labels[i]}`);
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const askOnce = () =>
    new Promise<string>((resolveAns) => {
      rl.question(`Pick 1-${labels.length}: `, (answer) => {
        resolveAns(answer.trim());
      });
    });
  try {
    while (true) {
      const raw = await askOnce();
      const n = Number.parseInt(raw, 10);
      if (Number.isInteger(n) && n >= 1 && n <= labels.length) {
        return n - 1;
      }
      console.log(`  invalid — enter a number between 1 and ${labels.length}.`);
    }
  } finally {
    rl.close();
  }
}
