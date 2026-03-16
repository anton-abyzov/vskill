// ---------------------------------------------------------------------------
// vskill credentials -- manage credentials for integration tests
// ---------------------------------------------------------------------------

import { createInterface } from "node:readline";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveCredential, resolveAllCredentials, writeCredential } from "../../eval/credential-resolver.js";
import { loadAndValidateEvals } from "../../eval/schema.js";
import { green, red, yellow, dim, bold, table } from "../../utils/output.js";

/**
 * vskill credentials set <KEY> -- prompt for value and store in .env.local
 */
export async function runCredentialsSet(skillDir: string, key: string): Promise<void> {
  const value = await promptHidden(`Enter value for ${key}: `);
  if (!value) {
    console.error(red("No value provided. Aborted."));
    return;
  }

  writeCredential(skillDir, key, value);
  console.log(green(`${key} saved to .env.local`));

  // Verify it resolves
  const result = resolveCredential(key, skillDir);
  if (result) {
    console.log(dim(`Verified: resolves from ${result.source}`));
  }
}

/**
 * vskill credentials list -- show all credentials referenced by integration tests
 */
export async function runCredentialsList(skillDir: string): Promise<void> {
  const names = collectRequiredCredentials(skillDir);
  if (names.length === 0) {
    console.log(dim("No integration test credentials found in evals."));
    return;
  }

  const statuses = resolveAllCredentials(names, skillDir);
  const rows = statuses.map((s) => [
    s.name,
    s.status === "ready" ? green("Ready") : red("Missing"),
    s.source ?? "-",
  ]);

  console.log(bold("\nCredential Status\n"));
  console.log(table(["NAME", "STATUS", "SOURCE"], rows));
}

/**
 * vskill credentials check -- resolve each credential and report source
 */
export async function runCredentialsCheck(skillDir: string): Promise<void> {
  const names = collectRequiredCredentials(skillDir);
  if (names.length === 0) {
    console.log(dim("No integration test credentials found in evals."));
    return;
  }

  const statuses = resolveAllCredentials(names, skillDir);
  const rows = statuses.map((s) => [
    s.name,
    s.status === "ready" ? green("Ready") : red("Missing"),
    s.source === "env"
      ? "Environment variable"
      : s.source === "dotenv"
        ? ".env.local"
        : "-",
  ]);

  console.log(bold("\nCredential Resolution Check\n"));
  console.log(table(["NAME", "STATUS", "SOURCE"], rows));

  const missing = statuses.filter((s) => s.status === "missing");
  if (missing.length > 0) {
    console.log(yellow(`\n${missing.length} credential(s) missing. Set them with:`));
    for (const m of missing) {
      console.log(dim(`  vskill credentials set ${m.name}`));
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function collectRequiredCredentials(skillDir: string): string[] {
  try {
    const evalsFile = loadAndValidateEvals(skillDir);
    const allCreds = new Set<string>();
    for (const evalCase of evalsFile.evals) {
      if (evalCase.testType === "integration" && evalCase.requiredCredentials) {
        for (const cred of evalCase.requiredCredentials) {
          allCreds.add(cred);
        }
      }
    }
    return [...allCreds].sort();
  } catch {
    return [];
  }
}

function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    // Attempt to hide input (works in TTY mode)
    if (process.stdin.isTTY) {
      process.stdout.write(question);
      const stdin = process.stdin;
      const wasRaw = stdin.isRaw;
      stdin.setRawMode(true);
      let input = "";
      const onData = (char: Buffer) => {
        const c = char.toString();
        if (c === "\n" || c === "\r") {
          stdin.setRawMode(wasRaw ?? false);
          stdin.removeListener("data", onData);
          process.stdout.write("\n");
          rl.close();
          resolve(input);
        } else if (c === "\u0003") {
          // Ctrl+C
          stdin.setRawMode(wasRaw ?? false);
          stdin.removeListener("data", onData);
          rl.close();
          resolve("");
        } else if (c === "\u007F" || c === "\b") {
          // Backspace
          input = input.slice(0, -1);
        } else {
          input += c;
        }
      };
      stdin.on("data", onData);
    } else {
      // Non-TTY: just use readline normally
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer);
      });
    }
  });
}
