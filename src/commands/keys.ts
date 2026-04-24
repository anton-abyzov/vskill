// ---------------------------------------------------------------------------
// keys.ts — `vskill keys` subcommand dispatcher.
//
// Subcommands:
//   set <provider>   Prompt (masked) or read piped stdin, persist via store
//   list             Show [Provider, Status, Last Updated, Source] table
//   remove <provider> Idempotent delete
//   path             Print absolute path of keys.env
//
// Keys are NEVER echoed. Only `redactKey()` output (****<last-4>) appears in
// user-facing output.
// ---------------------------------------------------------------------------

import {
  PROVIDERS,
  isProviderId,
  type ProviderId,
} from "../eval-server/providers.js";
import {
  saveKey,
  removeKey,
  listKeys,
  getKeysFilePath,
  redactKey,
} from "../eval-server/settings-store.js";
import { readSecretFromStdin } from "./masked-stdin.js";

export interface KeysCommandIO {
  stdout: { write: (s: string) => boolean };
  stderr: { write: (s: string) => boolean };
  exit: (code: number) => void;
  /** Returns the secret key read from stdin (piped or interactive masked). */
  readKeyFromStdin: () => Promise<string>;
  /** True if stdin is piped (non-TTY). */
  isPiped: () => boolean;
}

function defaultIO(): KeysCommandIO {
  return {
    stdout: process.stdout,
    stderr: process.stderr,
    exit: (code) => process.exit(code),
    readKeyFromStdin: () => readSecretFromStdin(),
    isPiped: () => !process.stdin.isTTY,
  };
}

function usageText(): string {
  return [
    "Usage: vskill keys <subcommand>",
    "",
    "Subcommands:",
    "  set <provider>    Store an API key (provider: anthropic, openai, openrouter)",
    "  list              Show stored keys (redacted) and sources",
    "  remove <provider> Delete a stored key",
    "  path              Print absolute path of keys.env",
    "",
  ].join("\n");
}

function knownProvidersHint(): string {
  const ids = PROVIDERS.map((p) => p.id).join(", ");
  return `Known providers: ${ids}`;
}

function pad(s: string, width: number): string {
  if (s.length >= width) return s;
  return s + " ".repeat(width - s.length);
}

async function cmdSet(provider: string | undefined, io: KeysCommandIO): Promise<void> {
  if (!provider) {
    io.stderr.write(
      `Usage: vskill keys set <provider>\n${knownProvidersHint()}\n`,
    );
    io.exit(1);
    return;
  }
  if (!isProviderId(provider)) {
    io.stderr.write(
      `unknown provider: "${provider}"\n${knownProvidersHint()}\n`,
    );
    io.exit(1);
    return;
  }

  if (!io.isPiped()) {
    io.stdout.write(`Paste API key for ${provider} (input masked): `);
  }
  const key = (await io.readKeyFromStdin()).trim();
  if (!key) {
    io.stderr.write("no key provided\n");
    io.exit(1);
    return;
  }

  try {
    await saveKey(provider, key);
  } catch (err) {
    // redactKey is guaranteed to not echo the raw key; err.message is already
    // scrubbed by settings-store but we redact again for defense-in-depth.
    const msg = (err as Error).message.replace(key, redactKey(key));
    io.stderr.write(`failed to save key: ${msg}\n`);
    io.exit(1);
    return;
  }

  io.stdout.write(
    `Stored ${redactKey(key)} for ${provider} at ${getKeysFilePath()}\n`,
  );
}

async function cmdList(io: KeysCommandIO): Promise<void> {
  const list = listKeys();
  const headers = ["Provider", "Status", "Last Updated", "Source"];
  const rows: string[][] = [];

  let anyAvailable = false;

  for (const p of PROVIDERS) {
    const meta = list[p.id];
    const envSet = !!process.env[p.envVarName];
    let source = "—";
    if (envSet) source = "env var";
    else if (meta.stored) source = "file";

    let status = "not set";
    if (envSet) {
      const raw = process.env[p.envVarName] ?? "";
      status = redactKey(raw);
      anyAvailable = true;
    } else if (meta.stored) {
      // We can't read the raw key without touching the store, but redact
      // only needs last 4 chars. Read via the store's public readKey (which
      // returns null if neither env nor memoryMap has it — but after
      // listKeys+loadIfNeeded it's in the map).
      const { readKey } = await import("../eval-server/settings-store.js");
      const raw = readKey(p.id) ?? "";
      status = redactKey(raw);
      anyAvailable = true;
    }

    const updated = meta.updatedAt ?? "—";
    rows.push([p.id, status, updated, source]);
  }

  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i].length)),
  );

  io.stdout.write(
    headers.map((h, i) => pad(h, widths[i])).join("  ") + "\n",
  );
  io.stdout.write(
    widths.map((w) => "-".repeat(w)).join("  ") + "\n",
  );
  for (const row of rows) {
    io.stdout.write(
      row.map((c, i) => pad(c, widths[i])).join("  ") + "\n",
    );
  }

  if (!anyAvailable) {
    io.stdout.write(
      `\nNo API keys configured. Run \`vskill keys set <provider>\` to add one.\n`,
    );
  }
}

async function cmdRemove(provider: string | undefined, io: KeysCommandIO): Promise<void> {
  if (!provider) {
    io.stderr.write(
      `Usage: vskill keys remove <provider>\n${knownProvidersHint()}\n`,
    );
    io.exit(1);
    return;
  }
  if (!isProviderId(provider)) {
    io.stderr.write(
      `unknown provider: "${provider}"\n${knownProvidersHint()}\n`,
    );
    io.exit(1);
    return;
  }

  try {
    await removeKey(provider as ProviderId);
  } catch (err) {
    io.stderr.write(`failed to remove key: ${(err as Error).message}\n`);
    io.exit(1);
    return;
  }

  io.stdout.write(`Removed ${provider} from keys.env\n`);
}

function cmdPath(io: KeysCommandIO): void {
  io.stdout.write(`${getKeysFilePath()}\n`);
}

export async function keysCommand(
  subcommand: string | undefined,
  arg: string | undefined,
  io: KeysCommandIO = defaultIO(),
): Promise<void> {
  switch (subcommand) {
    case "set":
      return cmdSet(arg, io);
    case "list":
      return cmdList(io);
    case "remove":
    case "rm":
      return cmdRemove(arg, io);
    case "path":
      return cmdPath(io);
    case undefined:
      io.stderr.write(usageText());
      io.exit(1);
      return;
    default:
      io.stderr.write(`unknown subcommand: "${subcommand}"\n${usageText()}`);
      io.exit(1);
      return;
  }
}
