// ---------------------------------------------------------------------------
// keychain.test.ts — unit tests for src/lib/keychain.ts.
//
// The module wraps @napi-rs/keyring with a mode-0600 file fallback. The
// in-process API is created via `createKeychain({ keyring, fs, ... })` so
// we can swap out the backends in tests without touching real disk or the
// host's secure storage.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createKeychain, GITHUB_TOKEN_KEY } from "../keychain.js";

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
  warnings: string[];
}

function fakeFs(): FakeFs {
  return { files: new Map(), warnings: [] };
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

describe("keychain", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("stores and retrieves GitHub token via keyring backend", () => {
    const kr = fakeKeyring();
    const fsState = fakeFs();
    const warn = vi.fn();
    const k = createKeychain({
      keyring: kr,
      fs: makeFsAdapter(fsState),
      fallbackPath: "/tmp/vskill-test-keys.env",
      warn,
    });

    k.setGitHubToken("ghu_abc123");
    expect(k.getGitHubToken()).toBe("ghu_abc123");
    expect(kr.store.get(`vskill-github::${GITHUB_TOKEN_KEY}`)).toBe("ghu_abc123");
    expect(fsState.files.size).toBe(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it("clearGitHubToken removes the keyring entry and returns true", () => {
    const kr = fakeKeyring();
    const k = createKeychain({
      keyring: kr,
      fs: makeFsAdapter(fakeFs()),
      fallbackPath: "/tmp/vskill-test-keys.env",
      warn: vi.fn(),
    });
    k.setGitHubToken("token-1");
    expect(k.clearGitHubToken()).toBe(true);
    expect(k.getGitHubToken()).toBeNull();
  });

  it("falls back to 0600 file when keyring is unavailable, with one-time warning", () => {
    const kr = fakeKeyring({ available: false });
    const fsState = fakeFs();
    const warn = vi.fn();
    const k = createKeychain({
      keyring: kr,
      fs: makeFsAdapter(fsState),
      fallbackPath: "/tmp/vskill-test-keys.env",
      warn,
    });

    k.setGitHubToken("file-token");
    expect(k.getGitHubToken()).toBe("file-token");
    const stored = fsState.files.get("/tmp/vskill-test-keys.env");
    expect(stored).toBeTruthy();
    expect(stored!.mode).toBe(0o600);
    expect(stored!.content).toContain("github_token=file-token");

    // second op should not re-warn
    k.getGitHubToken();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/keychain unavailable/i);
  });

  it("returns null when neither keyring nor fallback file has the token", () => {
    const kr = fakeKeyring();
    const k = createKeychain({
      keyring: kr,
      fs: makeFsAdapter(fakeFs()),
      fallbackPath: "/tmp/vskill-test-keys.env",
      warn: vi.fn(),
    });
    expect(k.getGitHubToken()).toBeNull();
    expect(k.clearGitHubToken()).toBe(false);
  });

  it("never logs the plaintext token via warn or stderr", () => {
    const kr = fakeKeyring({ available: false });
    const fsState = fakeFs();
    const warn = vi.fn();
    const k = createKeychain({
      keyring: kr,
      fs: makeFsAdapter(fsState),
      fallbackPath: "/tmp/vskill-test-keys.env",
      warn,
    });
    k.setGitHubToken("ghu_supersecret_abcdef");
    for (const call of warn.mock.calls) {
      expect(String(call[0])).not.toContain("ghu_supersecret_abcdef");
    }
  });

  it("file fallback round-trips through clearGitHubToken (deletes the entry)", () => {
    const kr = fakeKeyring({ available: false });
    const fsState = fakeFs();
    const k = createKeychain({
      keyring: kr,
      fs: makeFsAdapter(fsState),
      fallbackPath: "/tmp/vskill-test-keys.env",
      warn: vi.fn(),
    });
    k.setGitHubToken("t1");
    expect(k.clearGitHubToken()).toBe(true);
    expect(k.getGitHubToken()).toBeNull();
  });
});
