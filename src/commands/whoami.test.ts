// ---------------------------------------------------------------------------
// whoami.test.ts — `vskill whoami` (0839 T-009).
//
// Covers AC-US3-04 / AC-US3-05.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { whoamiCommand } from "./whoami.js";
import type { Keychain } from "../lib/keychain.js";
import type { TenantSummary } from "../api/client.js";

interface FakeKeychainState {
  gho?: string | null;
  vsk?: string | null;
}

function fakeKeychain(state: FakeKeychainState): Keychain {
  return {
    setGitHubToken(t) {
      state.gho = t;
    },
    getGitHubToken() {
      return state.gho ?? null;
    },
    clearGitHubToken() {
      const had = state.gho != null;
      state.gho = null;
      return had;
    },
    setVskillToken(t) {
      state.vsk = t;
    },
    getVskillToken() {
      return state.vsk ?? null;
    },
    clearVskillToken() {
      const had = state.vsk != null;
      state.vsk = null;
      return had;
    },
    usingFallback() {
      return false;
    },
  };
}

interface FakeIO {
  stdoutBuf: string;
  stderrBuf: string;
  exitCode: number | null;
  io: {
    stdout: { write: (s: string) => boolean };
    stderr: { write: (s: string) => boolean };
    exit: (code: number) => void;
  };
}

function fakeIO(): FakeIO {
  const f: FakeIO = {
    stdoutBuf: "",
    stderrBuf: "",
    exitCode: null,
    io: {
      stdout: {
        write: (s) => {
          f.stdoutBuf += s;
          return true;
        },
      },
      stderr: {
        write: (s) => {
          f.stderrBuf += s;
          return true;
        },
      },
      exit: (c) => {
        f.exitCode = c;
      },
    },
  };
  return f;
}

function tmpConfigDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "vskill-whoami-test-"));
}

const acmeT: TenantSummary = {
  tenantId: "t_acme",
  slug: "acme",
  name: "Acme Inc",
  role: "owner",
};
const contosoT: TenantSummary = {
  tenantId: "t_contoso",
  slug: "contoso",
  name: "Contoso",
  role: "member",
};

describe("0839 T-009 — vskill whoami", () => {
  let configDir: string;
  beforeEach(() => {
    configDir = tmpConfigDir();
  });

  it("AC-US3-04: prints login + token-prefix + active tenant + tenant list", async () => {
    fs.writeFileSync(
      path.join(configDir, "config.json"),
      JSON.stringify({ currentTenant: "acme" }),
      { encoding: "utf8", mode: 0o600 },
    );
    const f = fakeIO();
    const exit = await whoamiCommand([], {
      io: f.io,
      keychain: fakeKeychain({
        gho: "gho_aaaaaaaaaaaaa",
        vsk: "vsk_bbbbbbbbbbbbb",
      }),
      fetchGitHubUser: async () => ({ login: "octocat" }),
      listTenants: async () => [acmeT, contosoT],
      activeTenantOptions: { configDir },
    });

    expect(exit).toBe(0);
    expect(f.stdoutBuf).toMatch(/Logged in as @octocat/);
    // 12-char prefix shown for the active token (vsk_ wins).
    expect(f.stdoutBuf).toMatch(/Token: vsk_/);
    expect(f.stdoutBuf).toMatch(/vsk_bbbbbbbb/);
    expect(f.stdoutBuf).toMatch(/Active tenant: acme/);
    expect(f.stdoutBuf).toMatch(/\* acme/);
    expect(f.stdoutBuf).toMatch(/contoso/);
  });

  it("active tenant unset prints '(none)'", async () => {
    const f = fakeIO();
    const exit = await whoamiCommand([], {
      io: f.io,
      keychain: fakeKeychain({ gho: "gho_xx", vsk: "vsk_yy" }),
      fetchGitHubUser: async () => ({ login: "octo" }),
      listTenants: async () => [acmeT],
      activeTenantOptions: { configDir },
    });
    expect(exit).toBe(0);
    expect(f.stdoutBuf).toMatch(/Active tenant: \(none\)/);
  });

  it("AC-US3-05: not logged in → 'Run vskill auth login', non-zero exit", async () => {
    const f = fakeIO();
    const listFn = vi.fn();
    const userFn = vi.fn();
    const exit = await whoamiCommand([], {
      io: f.io,
      keychain: fakeKeychain({}),
      fetchGitHubUser: userFn as never,
      listTenants: listFn,
      activeTenantOptions: { configDir },
    });

    expect(exit).toBe(1);
    expect(listFn).not.toHaveBeenCalled();
    expect(userFn).not.toHaveBeenCalled();
    expect(f.stdoutBuf + f.stderrBuf).toMatch(/Not logged in/i);
    expect(f.stdoutBuf + f.stderrBuf).toMatch(/auth login/);
  });

  it("tenants fetch failure is non-fatal — whoami still prints identity", async () => {
    const f = fakeIO();
    const exit = await whoamiCommand([], {
      io: f.io,
      keychain: fakeKeychain({ gho: "gho_zz", vsk: "vsk_zz" }),
      fetchGitHubUser: async () => ({ login: "octo" }),
      listTenants: async () => {
        throw new Error("network down");
      },
      activeTenantOptions: { configDir },
    });
    expect(exit).toBe(0);
    expect(f.stdoutBuf).toMatch(/Logged in as @octo/);
    expect(f.stdoutBuf).toMatch(/failed to fetch/);
  });
});
