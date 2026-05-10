// ---------------------------------------------------------------------------
// 0839 US-005 — vskill-token (vsk_*) keychain helpers.
//
// Mirrors the existing keychain.test.ts patterns for the GitHub token but
// targets the new `setVskillToken`/`getVskillToken`/`clearVskillToken`
// surface in src/lib/keychain.ts. ADR-001 (gho_ + vsk_ coexistence) — both
// slots must round-trip independently.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import {
  createKeychain,
  VSKILL_TOKEN_KEY,
  VSKILL_TOKEN_SERVICE,
  GITHUB_TOKEN_KEY,
} from "../keychain.js";

interface FakeKeyring {
  store: Map<string, string>;
  available: boolean;
  setPassword: (svc: string, account: string, pwd: string) => void;
  getPassword: (svc: string, account: string) => string | null;
  deletePassword: (svc: string, account: string) => boolean;
}

function fakeKeyring(opts: { available?: boolean } = {}): FakeKeyring {
  const store = new Map<string, string>();
  const available = opts.available !== false;
  const guard = () => {
    if (!available) throw new Error("PlatformNotSupportedError");
  };
  return {
    store,
    available,
    setPassword(svc, account, pwd) {
      guard();
      store.set(`${svc}::${account}`, pwd);
    },
    getPassword(svc, account) {
      guard();
      return store.get(`${svc}::${account}`) ?? null;
    },
    deletePassword(svc, account) {
      guard();
      return store.delete(`${svc}::${account}`);
    },
  };
}

interface FakeFs {
  files: Map<string, { content: string; mode: number }>;
}

function fakeFs(): FakeFs {
  return { files: new Map() };
}

function makeFsAdapter(state: FakeFs) {
  return {
    readFileSync: (path: string): string => {
      const f = state.files.get(path);
      if (!f) {
        const err = new Error(`ENOENT: ${path}`) as Error & { code?: string };
        err.code = "ENOENT";
        throw err;
      }
      return f.content;
    },
    writeFileSync: (path: string, content: string, mode: number): void => {
      state.files.set(path, { content, mode });
    },
    chmodSync: (path: string, mode: number): void => {
      const f = state.files.get(path);
      if (f) f.mode = mode;
    },
    existsSync: (path: string): boolean => state.files.has(path),
    mkdirSync: (_path: string): void => {},
    unlinkSync: (path: string): void => {
      state.files.delete(path);
    },
  };
}

describe("keychain — vsk_ token helpers (0839 US-005)", () => {
  it("setVskillToken stores under the vskill-token service slot", () => {
    const kr = fakeKeyring();
    const k = createKeychain({
      keyring: kr,
      fs: makeFsAdapter(fakeFs()),
      fallbackPath: "/tmp/vskill-test-keys.env",
      warn: vi.fn(),
    });

    k.setVskillToken("vsk_abc123");
    expect(kr.store.get(`${VSKILL_TOKEN_SERVICE}::${VSKILL_TOKEN_KEY}`)).toBe(
      "vsk_abc123",
    );
  });

  it("getVskillToken round-trips a stored token", () => {
    const kr = fakeKeyring();
    const k = createKeychain({
      keyring: kr,
      fs: makeFsAdapter(fakeFs()),
      fallbackPath: "/tmp/vskill-test-keys.env",
      warn: vi.fn(),
    });
    k.setVskillToken("vsk_round_trip");
    expect(k.getVskillToken()).toBe("vsk_round_trip");
  });

  it("getVskillToken returns null when nothing is stored", () => {
    const kr = fakeKeyring();
    const k = createKeychain({
      keyring: kr,
      fs: makeFsAdapter(fakeFs()),
      fallbackPath: "/tmp/vskill-test-keys.env",
      warn: vi.fn(),
    });
    expect(k.getVskillToken()).toBeNull();
  });

  it("clearVskillToken removes the entry and returns true", () => {
    const kr = fakeKeyring();
    const k = createKeychain({
      keyring: kr,
      fs: makeFsAdapter(fakeFs()),
      fallbackPath: "/tmp/vskill-test-keys.env",
      warn: vi.fn(),
    });
    k.setVskillToken("vsk_clear_me");
    expect(k.clearVskillToken()).toBe(true);
    expect(k.getVskillToken()).toBeNull();
  });

  it("clearVskillToken returns false when no token exists", () => {
    const kr = fakeKeyring();
    const k = createKeychain({
      keyring: kr,
      fs: makeFsAdapter(fakeFs()),
      fallbackPath: "/tmp/vskill-test-keys.env",
      warn: vi.fn(),
    });
    expect(k.clearVskillToken()).toBe(false);
  });

  it("vsk_ and gho_ tokens coexist in distinct slots (ADR-001)", () => {
    const kr = fakeKeyring();
    const k = createKeychain({
      keyring: kr,
      fs: makeFsAdapter(fakeFs()),
      fallbackPath: "/tmp/vskill-test-keys.env",
      warn: vi.fn(),
    });
    k.setGitHubToken("gho_github");
    k.setVskillToken("vsk_platform");
    expect(k.getGitHubToken()).toBe("gho_github");
    expect(k.getVskillToken()).toBe("vsk_platform");
    expect(
      kr.store.get(`com.verifiedskill.desktop::${GITHUB_TOKEN_KEY}`),
    ).toBe("gho_github");
    expect(kr.store.get(`${VSKILL_TOKEN_SERVICE}::${VSKILL_TOKEN_KEY}`)).toBe(
      "vsk_platform",
    );
  });

  it("clearVskillToken does NOT clear the GitHub token", () => {
    const kr = fakeKeyring();
    const k = createKeychain({
      keyring: kr,
      fs: makeFsAdapter(fakeFs()),
      fallbackPath: "/tmp/vskill-test-keys.env",
      warn: vi.fn(),
    });
    k.setGitHubToken("gho_keep");
    k.setVskillToken("vsk_drop");
    expect(k.clearVskillToken()).toBe(true);
    expect(k.getVskillToken()).toBeNull();
    expect(k.getGitHubToken()).toBe("gho_keep");
  });

  it("falls back to 0600 file when keyring unavailable for vsk_ tokens", () => {
    const kr = fakeKeyring({ available: false });
    const fsState = fakeFs();
    const k = createKeychain({
      keyring: kr,
      fs: makeFsAdapter(fsState),
      fallbackPath: "/tmp/vskill-test-keys.env",
      warn: vi.fn(),
    });
    k.setVskillToken("vsk_fallback_token");
    expect(k.getVskillToken()).toBe("vsk_fallback_token");
    const stored = fsState.files.get("/tmp/vskill-test-keys.env");
    expect(stored).toBeTruthy();
    expect(stored!.mode).toBe(0o600);
    expect(stored!.content).toContain(`${VSKILL_TOKEN_KEY}=vsk_fallback_token`);
  });

  it("setVskillToken throws when token is empty", () => {
    const kr = fakeKeyring();
    const k = createKeychain({
      keyring: kr,
      fs: makeFsAdapter(fakeFs()),
      fallbackPath: "/tmp/vskill-test-keys.env",
      warn: vi.fn(),
    });
    expect(() => k.setVskillToken("")).toThrow(/non-empty/);
  });
});
