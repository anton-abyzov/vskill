// ---------------------------------------------------------------------------
// orgs.ts — `vskill orgs {list,use,current}` (0839 US-003 / T-008).
//
// Manages the active tenant slug stored at `~/.vskill/config.json`.
// `list` calls `GET /api/v1/account/tenants` (T-002) and prints the rows
// with `*` next to the active one. `use <slug>` validates the slug
// against the same listing before persisting. `current` prints the
// active slug or `(none)`.
//
// Anonymous-safe: `list` prints "Not logged in. Run `vskill auth login`."
// and exits 0 when no token is present (AC-US3-05). The other subcommands
// degrade gracefully too: `current` works without a token (it only reads
// the local config), `use` returns non-zero with a "log in first" hint.
//
// Output format is intentionally simple text so users can grep / pipe.
// `--json` is reserved for a follow-up; not required by the AC.
// ---------------------------------------------------------------------------

import {
  getDefaultKeychain,
  type Keychain,
} from "../lib/keychain.js";
import {
  getActiveTenant,
  setActiveTenant,
  type ActiveTenantOptions,
} from "../lib/active-tenant.js";
import { listTenants, type TenantSummary } from "../api/client.js";

export interface OrgsCommandIO {
  stdout: { write: (s: string) => boolean };
  stderr: { write: (s: string) => boolean };
  exit?: (code: number) => void;
}

export interface OrgsCommandDeps {
  io: OrgsCommandIO;
  keychain?: Keychain;
  /** 0839 — override for tests so we don't hit the network. */
  listTenants?: () => Promise<TenantSummary[]>;
  /** Override the config dir (tests). */
  activeTenantOptions?: ActiveTenantOptions;
}

function hasAnyToken(keychain: Keychain): boolean {
  try {
    return !!(keychain.getVskillToken() || keychain.getGitHubToken());
  } catch {
    return false;
  }
}

async function listCmd(deps: OrgsCommandDeps): Promise<number> {
  const { io } = deps;
  const keychain = deps.keychain ?? getDefaultKeychain();

  // AC-US3-05 — anonymous-safe `list`. We deliberately do NOT make the
  // network call when no token is stored; the platform would reject with
  // 401, but printing a generic "Not logged in" is friendlier than a
  // raw HTTP error and keeps `orgs list` script-safe (exit 0).
  if (!hasAnyToken(keychain)) {
    io.stdout.write("Not logged in. Run `vskill auth login` to view tenants.\n");
    return 0;
  }

  let tenants: TenantSummary[];
  try {
    tenants = await (deps.listTenants ?? listTenants)();
  } catch (err) {
    const e = err as Error & { status?: number };
    if (e.status === 401) {
      io.stderr.write(
        "Token rejected by the platform. Run `vskill auth login` to refresh.\n",
      );
      return 1;
    }
    io.stderr.write(
      `vskill orgs list: failed to fetch tenants (${e.message ?? String(err)})\n`,
    );
    return 1;
  }

  if (tenants.length === 0) {
    io.stdout.write(
      "You have no tenants yet. Install the GitHub App to create one.\n",
    );
    return 0;
  }

  const active = getActiveTenant(deps.activeTenantOptions);
  // Two-column ASCII table: marker + slug + name + role.
  // Column widths chosen for readability without external deps.
  const slugW = Math.max(4, ...tenants.map((t) => t.slug.length));
  const nameW = Math.max(4, ...tenants.map((t) => t.name.length));

  io.stdout.write(
    `  ${"SLUG".padEnd(slugW)}  ${"NAME".padEnd(nameW)}  ROLE\n`,
  );
  for (const t of tenants) {
    const marker = t.slug === active ? "*" : " ";
    io.stdout.write(
      `${marker} ${t.slug.padEnd(slugW)}  ${t.name.padEnd(nameW)}  ${t.role}\n`,
    );
  }
  return 0;
}

async function useCmd(slug: string | undefined, deps: OrgsCommandDeps): Promise<number> {
  const { io } = deps;
  if (!slug || slug.length === 0) {
    io.stderr.write("Usage: vskill orgs use <slug>\n");
    return 2;
  }
  const keychain = deps.keychain ?? getDefaultKeychain();
  if (!hasAnyToken(keychain)) {
    io.stderr.write(
      "Not logged in. Run `vskill auth login` before switching tenants.\n",
    );
    return 1;
  }

  let tenants: TenantSummary[];
  try {
    tenants = await (deps.listTenants ?? listTenants)();
  } catch (err) {
    const e = err as Error & { status?: number };
    if (e.status === 401) {
      io.stderr.write(
        "Token rejected by the platform. Run `vskill auth login` to refresh.\n",
      );
      return 1;
    }
    io.stderr.write(
      `vskill orgs use: failed to validate tenant (${e.message ?? String(err)})\n`,
    );
    return 1;
  }

  const match = tenants.find((t) => t.slug === slug);
  if (!match) {
    io.stderr.write(`Unknown tenant: ${slug}\n`);
    if (tenants.length > 0) {
      io.stderr.write(`Available: ${tenants.map((t) => t.slug).join(", ")}\n`);
    }
    return 1;
  }

  try {
    setActiveTenant(slug, deps.activeTenantOptions);
  } catch (err) {
    io.stderr.write(
      `vskill orgs use: failed to write config (${(err as Error).message})\n`,
    );
    return 1;
  }

  io.stdout.write(`Active tenant set to ${slug} (${match.name}).\n`);
  return 0;
}

function currentCmd(deps: OrgsCommandDeps): number {
  const active = getActiveTenant(deps.activeTenantOptions);
  if (active) {
    deps.io.stdout.write(`${active}\n`);
  } else {
    deps.io.stdout.write("(none)\n");
  }
  return 0;
}

function usage(io: OrgsCommandIO): void {
  io.stdout.write(
    [
      "Usage: vskill orgs <subcommand>",
      "",
      "Subcommands:",
      "  list                List tenants you belong to (* marks active)",
      "  use <slug>          Set the active tenant",
      "  current             Print the active tenant slug, or (none)",
      "",
    ].join("\n"),
  );
}

export async function orgsCommand(
  argv: string[],
  deps: OrgsCommandDeps,
): Promise<number> {
  const sub = argv[0];
  let exit = 0;
  switch (sub) {
    case "list":
    case "ls":
      exit = await listCmd(deps);
      break;
    case "use":
    case "switch":
      exit = await useCmd(argv[1], deps);
      break;
    case "current":
    case "whoami-tenant":
      exit = currentCmd(deps);
      break;
    case undefined:
    case "--help":
    case "-h":
      usage(deps.io);
      exit = sub ? 0 : 1;
      break;
    default:
      deps.io.stderr.write(`unknown subcommand: ${sub}\n`);
      usage(deps.io);
      exit = 1;
      break;
  }

  if (deps.io.exit) deps.io.exit(exit);
  return exit;
}
