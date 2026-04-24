// ---------------------------------------------------------------------------
// first-run-onboarding.ts — Prompt user to configure an API key on studio
// startup if none is detected.
//
// Runs BEFORE the browser opens. Skips silently when:
//   - stdin is not a TTY
//   - any provider env var is already set
//   - any provider already has a stored key
//
// Otherwise asks yes/no; on yes, reads a masked key and saves it via the
// store. On any failure path, returns action=declined rather than throwing —
// studio launch must not be blocked by onboarding.
// ---------------------------------------------------------------------------

import {
  PROVIDERS,
  type ProviderId,
} from "./eval-server/providers.js";
import {
  saveKey,
  listKeys,
  redactKey,
} from "./eval-server/settings-store.js";
import { readSecretFromStdin } from "./commands/masked-stdin.js";

export type OnboardingAction = "skip" | "saved" | "declined";

export interface OnboardingResult {
  action: OnboardingAction;
  provider?: ProviderId;
}

export interface OnboardingIO {
  stdout: { write: (s: string) => boolean };
  stderr: { write: (s: string) => boolean };
  isTTY: () => boolean;
  promptConfirm: (question: string) => Promise<boolean>;
  readMaskedKey: () => Promise<string>;
  env: NodeJS.ProcessEnv;
}

function defaultPromptConfirm(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    process.stdout.write(`${question} (y/N): `);
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw === true;
    if (typeof stdin.setRawMode === "function") stdin.setRawMode(true);
    stdin.resume();
    const onData = (buf: Buffer): void => {
      const ch = buf.toString("utf8").toLowerCase();
      cleanup();
      if (ch === "y") {
        process.stdout.write("y\n");
        resolve(true);
      } else {
        process.stdout.write("\n");
        resolve(false);
      }
    };
    function cleanup(): void {
      stdin.removeListener("data", onData);
      if (typeof stdin.setRawMode === "function") stdin.setRawMode(wasRaw);
      stdin.pause();
    }
    stdin.on("data", onData);
  });
}

function defaultIO(): OnboardingIO {
  return {
    stdout: process.stdout,
    stderr: process.stderr,
    isTTY: () => !!process.stdin.isTTY,
    promptConfirm: defaultPromptConfirm,
    readMaskedKey: () => readSecretFromStdin(),
    env: process.env,
  };
}

/**
 * Returns true if any provider env var is set or any key is stored in the
 * file-backed store.
 */
function anyProviderConfigured(env: NodeJS.ProcessEnv): boolean {
  for (const p of PROVIDERS) {
    if (env[p.envVarName]) return true;
  }
  const list = listKeys();
  for (const p of PROVIDERS) {
    if (list[p.id].stored) return true;
  }
  return false;
}

export async function firstRunOnboarding(
  io: OnboardingIO = defaultIO(),
): Promise<OnboardingResult> {
  // Non-TTY: never prompt (e.g. CI, piped, detached).
  if (!io.isTTY()) return { action: "skip" };

  // Already configured → nothing to do.
  if (anyProviderConfigured(io.env)) return { action: "skip" };

  io.stdout.write(
    "\nNo API key detected. Skill Studio needs an Anthropic API key to run evals.\n",
  );
  const accepted = await io.promptConfirm("Add one now?");
  if (!accepted) {
    io.stdout.write(
      "Skipping. Run `vskill keys set anthropic` later to configure.\n",
    );
    return { action: "declined" };
  }

  io.stdout.write("Paste your Anthropic API key (input masked): ");
  const key = (await io.readMaskedKey()).trim();
  if (!key) {
    io.stdout.write(
      "No key provided. Run `vskill keys set anthropic` later to configure.\n",
    );
    return { action: "declined" };
  }

  try {
    await saveKey("anthropic", key);
  } catch (err) {
    // Defense-in-depth redaction; settings-store already scrubs its errors.
    const msg = (err as Error).message.replace(key, redactKey(key));
    io.stderr.write(`failed to save key: ${msg}\n`);
    io.stdout.write(
      "Run `vskill keys set anthropic` later to try again.\n",
    );
    return { action: "declined" };
  }

  io.stdout.write(
    `Saved ${redactKey(key)} for anthropic. Continuing studio launch.\n`,
  );
  return { action: "saved", provider: "anthropic" };
}
