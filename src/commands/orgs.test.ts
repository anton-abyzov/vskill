// ---------------------------------------------------------------------------
// orgs.test.ts — `vskill orgs {list,use,current}` (0839 T-008).
//
// Covers AC-US3-01 / AC-US3-02 / AC-US3-03 / AC-US3-05 (anonymous-safe).
// Uses an in-process fake keychain + a temp dir for the config file (so
// the real filesystem is not touched and tests run in parallel safely).
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { orgsCommand } from "./orgs.js";
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
  io: {
    stdout: { write: (s: string) => boolean };
    stderr: { write: (s: string) => boolean };
  };
}

function fakeIO(): FakeIO {
  const f: FakeIO = {
    stdoutBuf: "",
    stderrBuf: "",
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
    },
  };
  return f;
}

function tmpConfigDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "vskill-orgs-test-"));
}

const acmeT: TenantSummary = {
  tenantId: "t_acme",
  slug: "acme",
  name: "Acme Inc",
  role: "owner",
  installationId: 111,
};
const contosoT: TenantSummary = {
  tenantId: "t_contoso",
  slug: "contoso",
  name: "Contoso",
  role: "member",
  installationId: 222,
};

describe("0839 T-008 — vskill orgs list", () => {
  let configDir: string;
  beforeEach(() => {
    configDir = tmpConfigDir();
  });

  it("AC-US3-01: prints both tenants with `*` next to the active one", async () => {
    const f = fakeIO();
    // Pre-set active = acme by writing the config file directly.
    fs.writeFileSync(
      path.join(configDir, "config.json"),
      JSON.stringify({ currentTenant: "acme" }),
      { encoding: "utf8", mode: 0o600 },
    );

    const exit = await orgsCommand(["list"], {
      io: f.io,
      keychain: fakeKeychain({ vsk: "vsk_test" }),
      listTenants: async () => [acmeT, contosoT],
      activeTenantOptions: { configDir },
    });

    expect(exit).toBe(0);
    expect(f.stdoutBuf).toMatch(/SLUG/);
    expect(f.stdoutBuf).toMatch(/\* acme/);
    expect(f.stdoutBuf).toMatch(/^ {2}contoso/m);
  });

  it("AC-US3-05: anonymous mode — exit 0 with 'Not logged in'", async () => {
    const f = fakeIO();
    const listFn = vi.fn();

    const exit = await orgsCommand(["list"], {
      io: f.io,
      keychain: fakeKeychain({}),
      listTenants: listFn,
      activeTenantOptions: { configDir },
    });

    expect(exit).toBe(0);
    expect(listFn).not.toHaveBeenCalled();
    expect(f.stdoutBuf).toMatch(/Not logged in/i);
  });

  it("empty tenant list prints a friendly message", async () => {
    const f = fakeIO();
    const exit = await orgsCommand(["list"], {
      io: f.io,
      keychain: fakeKeychain({ vsk: "vsk_x" }),
      listTenants: async () => [],
      activeTenantOptions: { configDir },
    });
    expect(exit).toBe(0);
    expect(f.stdoutBuf).toMatch(/no tenants/i);
  });

  it("401 from platform → 'Run vskill auth login' on stderr, non-zero", async () => {
    const f = fakeIO();
    const exit = await orgsCommand(["list"], {
      io: f.io,
      keychain: fakeKeychain({ vsk: "vsk_stale" }),
      listTenants: async () => {
        const e = new Error("API request failed: 401") as Error & {
          status?: number;
        };
        e.status = 401;
        throw e;
      },
      activeTenantOptions: { configDir },
    });

    expect(exit).toBe(1);
    expect(f.stderrBuf).toMatch(/auth login/);
  });
});

describe("0839 T-008 — vskill orgs use <slug>", () => {
  let configDir: string;
  beforeEach(() => {
    configDir = tmpConfigDir();
  });

  it("AC-US3-02: known slug → updates config, exit 0", async () => {
    const f = fakeIO();
    const exit = await orgsCommand(["use", "contoso"], {
      io: f.io,
      keychain: fakeKeychain({ vsk: "vsk_x" }),
      listTenants: async () => [acmeT, contosoT],
      activeTenantOptions: { configDir },
    });
    expect(exit).toBe(0);
    const written = JSON.parse(
      fs.readFileSync(path.join(configDir, "config.json"), "utf8"),
    );
    expect(written.currentTenant).toBe("contoso");
    expect(f.stdoutBuf).toMatch(/contoso/);
  });

  it("AC-US3-03: unknown slug → non-zero, 'Unknown tenant: bogus'", async () => {
    const f = fakeIO();
    const exit = await orgsCommand(["use", "bogus"], {
      io: f.io,
      keychain: fakeKeychain({ vsk: "vsk_x" }),
      listTenants: async () => [acmeT, contosoT],
      activeTenantOptions: { configDir },
    });
    expect(exit).toBe(1);
    expect(f.stderrBuf).toMatch(/Unknown tenant: bogus/);
    // Available list helps the user.
    expect(f.stderrBuf).toMatch(/acme.*contoso|contoso.*acme/);
  });

  it("missing slug arg → exits 2 with usage", async () => {
    const f = fakeIO();
    const exit = await orgsCommand(["use"], {
      io: f.io,
      keychain: fakeKeychain({ vsk: "vsk_x" }),
      listTenants: async () => [acmeT],
      activeTenantOptions: { configDir },
    });
    expect(exit).toBe(2);
    expect(f.stderrBuf).toMatch(/Usage/);
  });

  it("anonymous → 'Not logged in', exit 1", async () => {
    const f = fakeIO();
    const listFn = vi.fn();
    const exit = await orgsCommand(["use", "acme"], {
      io: f.io,
      keychain: fakeKeychain({}),
      listTenants: listFn,
      activeTenantOptions: { configDir },
    });
    expect(exit).toBe(1);
    expect(listFn).not.toHaveBeenCalled();
    expect(f.stderrBuf).toMatch(/auth login/);
  });
});

describe("0839 T-008 — vskill orgs current", () => {
  let configDir: string;
  beforeEach(() => {
    configDir = tmpConfigDir();
  });

  it("AC-US3-02: prints active slug when set", async () => {
    fs.writeFileSync(
      path.join(configDir, "config.json"),
      JSON.stringify({ currentTenant: "acme" }),
      { encoding: "utf8", mode: 0o600 },
    );
    const f = fakeIO();
    const exit = await orgsCommand(["current"], {
      io: f.io,
      keychain: fakeKeychain({ vsk: "vsk_x" }),
      activeTenantOptions: { configDir },
    });
    expect(exit).toBe(0);
    expect(f.stdoutBuf.trim()).toBe("acme");
  });

  it("prints '(none)' when unset, exit 0 (anonymous-safe)", async () => {
    const f = fakeIO();
    const exit = await orgsCommand(["current"], {
      io: f.io,
      keychain: fakeKeychain({}),
      activeTenantOptions: { configDir },
    });
    expect(exit).toBe(0);
    expect(f.stdoutBuf.trim()).toBe("(none)");
  });
});
