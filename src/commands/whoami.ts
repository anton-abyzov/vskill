// ---------------------------------------------------------------------------
// whoami.ts — `vskill whoami` (0839 US-003 / T-009).
//
// Single-screen identity summary:
//   - The signed-in GitHub login (resolved via /user with the gho_*).
//   - The active token kind + 12-char prefix (vsk_/gho_).
//   - The active tenant slug (or "(none)").
//   - The list of tenants the user belongs to (slug + name + role).
//
// Anonymous users get "Not logged in. Run `vskill auth login`." and a
// non-zero exit so scripts can branch on it.
//
// Network calls are kept minimal — one /user (cached/short) and one
// /api/v1/account/tenants. Both are fed via dependency-injected fetchers
// so tests never hit the wire.
// ---------------------------------------------------------------------------

import {
  getDefaultKeychain,
  type Keychain,
} from "../lib/keychain.js";
import {
  getActiveTenant,
  type ActiveTenantOptions,
} from "../lib/active-tenant.js";
import { listTenants, type TenantSummary } from "../api/client.js";

export interface WhoamiCommandIO {
  stdout: { write: (s: string) => boolean };
  stderr: { write: (s: string) => boolean };
  exit?: (code: number) => void;
}

export interface WhoamiCommandDeps {
  io: WhoamiCommandIO;
  keychain?: Keychain;
  /** Override the GitHub /user fetch (tests). */
  fetchGitHubUser?: (token: string) => Promise<{ login?: string } | null>;
  /** Override the platform tenants fetch (tests). */
  listTenants?: () => Promise<TenantSummary[]>;
  /** Override config dir (tests). */
  activeTenantOptions?: ActiveTenantOptions;
  /** vskill version for User-Agent. */
  version?: string;
  /** Custom fetch impl (tests). */
  fetchImpl?: typeof fetch;
}

interface TokenSummary {
  /** Plaintext token; do NOT log directly. */
  token: string;
  kind: "vsk_" | "gho_";
  /** First 12 chars (matches the platform's tokenPrefix column for cross-ref). */
  prefix: string;
}

function summarizeToken(token: string): TokenSummary {
  const kind = token.startsWith("vsk_") ? "vsk_" : "gho_";
  return {
    token,
    kind,
    prefix: token.slice(0, 12),
  };
}

async function defaultFetchGitHubUser(
  token: string,
  fetchImpl: typeof fetch,
  version: string,
): Promise<{ login?: string } | null> {
  // Only `gho_*` works against api.github.com; `vsk_*` is verified-skill
  // territory. We still try /user with whatever we have because failures
  // are non-fatal for whoami — we just won't print a login.
  try {
    const res = await fetchImpl("https://api.github.com/user", {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "User-Agent": `vskill/${version}`,
      },
    });
    if (!res.ok) return null;
    return (await res.json()) as { login?: string };
  } catch {
    return null;
  }
}

export async function whoamiCommand(
  argv: string[],
  deps: WhoamiCommandDeps,
): Promise<number> {
  const { io } = deps;
  void argv; // No flags yet; reserved for --json in a follow-up.

  const keychain = deps.keychain ?? getDefaultKeychain();
  const vsk = keychain.getVskillToken();
  const gho = keychain.getGitHubToken();

  if (!vsk && !gho) {
    io.stdout.write("Not logged in. Run `vskill auth login`.\n");
    if (deps.io.exit) deps.io.exit(1);
    return 1;
  }

  // Pick the auth token the API client would actually use (vsk_ wins).
  const apiToken = summarizeToken(vsk ?? gho!);
  const githubToken = gho ?? null;

  // Resolve identity via GitHub /user (only meaningful when we have a gho_*).
  // The vsk_-only path still gets a useful whoami via the tenant list.
  let login: string | null = null;
  if (githubToken) {
    const fetchUser = deps.fetchGitHubUser
      ? deps.fetchGitHubUser
      : (token: string) =>
          defaultFetchGitHubUser(
            token,
            deps.fetchImpl ?? fetch,
            deps.version ?? "vskill",
          );
    try {
      const u = await fetchUser(githubToken);
      if (u && typeof u.login === "string") login = u.login;
    } catch {
      login = null;
    }
  }

  // Tenant info — both the active slug (local) and the full list.
  const active = getActiveTenant(deps.activeTenantOptions);
  let tenants: TenantSummary[] = [];
  let tenantsErr: string | null = null;
  try {
    tenants = await (deps.listTenants ?? listTenants)();
  } catch (err) {
    tenantsErr = (err as Error).message ?? String(err);
  }

  // ----- Render ------------------------------------------------------------
  if (login) {
    io.stdout.write(`Logged in as @${login}\n`);
  } else {
    io.stdout.write(`Logged in (no GitHub /user response)\n`);
  }
  io.stdout.write(`Token: ${apiToken.kind}* (${apiToken.prefix}…)\n`);
  if (vsk && gho) {
    // Both stored — useful diagnostic.
    io.stdout.write(`  GitHub token: gho_* (${gho.slice(0, 12)}…)\n`);
  }

  io.stdout.write(`Active tenant: ${active ?? "(none)"}\n`);

  if (tenantsErr) {
    io.stdout.write(`Tenants: (failed to fetch — ${tenantsErr})\n`);
  } else if (tenants.length === 0) {
    io.stdout.write(`Tenants: (none)\n`);
  } else {
    io.stdout.write(`Tenants:\n`);
    for (const t of tenants) {
      const marker = t.slug === active ? "*" : " ";
      io.stdout.write(`  ${marker} ${t.slug} — ${t.name} (${t.role})\n`);
    }
  }

  if (deps.io.exit) deps.io.exit(0);
  return 0;
}
