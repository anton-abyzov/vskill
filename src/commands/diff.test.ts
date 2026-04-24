// ---------------------------------------------------------------------------
// Tests for `vskill diff` (0705 / AC-US4-01..AC-US4-06).
// Covers color TTY / plain / --stat / --json / --files / error / empty /
// URL construction — all in-process with mocked `fetch` and captured stdout.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { diffCommand } from "./diff.js";

// Mock global fetch — diffCommand calls compareVersions() which uses fetch.
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "ERR",
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  };
}

function errorResponse(status: number, statusText: string, body = "") {
  return {
    ok: false,
    status,
    statusText,
    json: () => Promise.reject(new Error("not json")),
    text: () => Promise.resolve(body),
  };
}

// Capture stdout so we can assert on printed bytes without leaking into the
// test runner UI. write() is synchronous in Node for TTY/string paths.
let captured: string;
let origWrite: typeof process.stdout.write;
let origStderrWrite: typeof process.stderr.write;
let capturedErr: string;
let origIsTTY: boolean | undefined;

function capture() {
  captured = "";
  capturedErr = "";
  origWrite = process.stdout.write.bind(process.stdout);
  origStderrWrite = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((s: string | Uint8Array) => {
    captured += typeof s === "string" ? s : Buffer.from(s).toString();
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((s: string | Uint8Array) => {
    capturedErr += typeof s === "string" ? s : Buffer.from(s).toString();
    return true;
  }) as typeof process.stderr.write;
}

function restore() {
  if (origWrite) process.stdout.write = origWrite;
  if (origStderrWrite) process.stderr.write = origStderrWrite;
}

const SAMPLE = {
  source: "github" as const,
  baseSha: "4f2285d",
  headSha: "71a9132",
  files: [
    {
      filename: "plugins/skills/skills/scout/SKILL.md",
      status: "modified",
      additions: 42,
      deletions: 3,
      patch: "@@ -1,3 +1,5 @@\n-old line\n+new line\n context\n",
    },
    {
      filename: "plugins/skills/skills/scout/references/api.md",
      status: "added",
      additions: 10,
      deletions: 0,
      patch: "@@ -0,0 +1,10 @@\n+fresh content\n",
    },
  ],
  githubCompareUrl:
    "https://github.com/anton-abyzov/vskill/compare/4f2285d...71a9132",
};

beforeEach(() => {
  vi.clearAllMocks();
  origIsTTY = process.stdout.isTTY;
  // Ensure no stray env is in play.
  delete process.env.FORCE_COLOR;
  delete process.env.NO_COLOR;
  capture();
});

afterEach(() => {
  restore();
  if (origIsTTY === undefined) delete (process.stdout as unknown as { isTTY?: boolean }).isTTY;
  else (process.stdout as unknown as { isTTY?: boolean }).isTTY = origIsTTY;
});

describe("diffCommand — color (TTY)", () => {
  it("emits ANSI color codes when stdout is a TTY", async () => {
    (process.stdout as unknown as { isTTY: boolean }).isTTY = true;
    mockFetch.mockResolvedValue(jsonResponse(SAMPLE));

    await diffCommand("owner/repo/scout", "4f2285d", "71a9132");

    // Green for additions, red for deletions, grey for hunk headers.
    expect(captured).toContain("\x1b[32m+new line\x1b[0m");
    expect(captured).toContain("\x1b[31m-old line\x1b[0m");
    expect(captured).toContain("\x1b[90m@@ -1,3 +1,5 @@\x1b[0m");
  });
});

describe("diffCommand — plain (non-TTY / NO_COLOR)", () => {
  it("suppresses colors when stdout is not a TTY", async () => {
    (process.stdout as unknown as { isTTY: boolean }).isTTY = false;
    mockFetch.mockResolvedValue(jsonResponse(SAMPLE));

    await diffCommand("scout", "v1", "v2");

    expect(captured).not.toContain("\x1b[");
    expect(captured).toContain("+new line");
    expect(captured).toContain("-old line");
  });

  it("suppresses colors when NO_COLOR is set, even on TTY", async () => {
    (process.stdout as unknown as { isTTY: boolean }).isTTY = true;
    process.env.NO_COLOR = "1";
    try {
      mockFetch.mockResolvedValue(jsonResponse(SAMPLE));
      await diffCommand("scout", "v1", "v2");
      expect(captured).not.toContain("\x1b[");
    } finally {
      delete process.env.NO_COLOR;
    }
  });
});

describe("diffCommand — --stat", () => {
  it("prints one line per file + totals", async () => {
    (process.stdout as unknown as { isTTY: boolean }).isTTY = false;
    mockFetch.mockResolvedValue(jsonResponse(SAMPLE));

    await diffCommand("scout", "v1", "v2", { stat: true });

    expect(captured).toContain("plugins/skills/skills/scout/SKILL.md +42 -3");
    expect(captured).toContain("plugins/skills/skills/scout/references/api.md +10 -0");
    expect(captured).toContain("2 files changed, 52 insertions(+), 3 deletions(-)");
    // --stat must not emit raw patch bodies.
    expect(captured).not.toContain("+new line");
  });
});

describe("diffCommand — --json", () => {
  it("prints pretty JSON of the raw compare response with no colors", async () => {
    (process.stdout as unknown as { isTTY: boolean }).isTTY = true;
    mockFetch.mockResolvedValue(jsonResponse(SAMPLE));

    await diffCommand("scout", "v1", "v2", { json: true });

    expect(captured).not.toContain("\x1b[");
    const parsed = JSON.parse(captured);
    expect(parsed.source).toBe("github");
    expect(parsed.files).toHaveLength(2);
    expect(parsed.githubCompareUrl).toBe(SAMPLE.githubCompareUrl);
  });
});

describe("diffCommand — --files glob filter", () => {
  it("filters files via minimatch pattern", async () => {
    (process.stdout as unknown as { isTTY: boolean }).isTTY = false;
    mockFetch.mockResolvedValue(jsonResponse(SAMPLE));

    await diffCommand("scout", "v1", "v2", { files: "**/SKILL.md", stat: true });

    expect(captured).toContain("scout/SKILL.md +42 -3");
    expect(captured).not.toContain("references/api.md");
    expect(captured).toContain("1 files changed, 42 insertions(+), 3 deletions(-)");
  });
});

describe("diffCommand — error path", () => {
  it("exits with code 1 and prints to stderr on fetch error", async () => {
    mockFetch.mockResolvedValue(errorResponse(500, "Internal Server Error", "db down"));

    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(((code?: number) => {
        throw new Error(`__exit_${code}__`);
      }) as never);

    try {
      await expect(
        diffCommand("scout", "v1", "v2"),
      ).rejects.toThrow("__exit_1__");
      expect(capturedErr).toMatch(/Compare request failed: 500/);
    } finally {
      exitSpy.mockRestore();
    }
  });
});

describe("diffCommand — empty file list", () => {
  it("prints only the totals line for --stat with no files", async () => {
    (process.stdout as unknown as { isTTY: boolean }).isTTY = false;
    mockFetch.mockResolvedValue(
      jsonResponse({ source: "github", files: [] }),
    );

    await diffCommand("scout", "v1", "v2", { stat: true });

    expect(captured.trim()).toBe("0 files changed, 0 insertions(+), 0 deletions(-)");
  });
});

describe("diffCommand — URL construction", () => {
  it("builds the correct compare URL with encoded args", async () => {
    mockFetch.mockResolvedValue(jsonResponse(SAMPLE));

    await diffCommand("owner/repo/scout", "1.0.0", "2.0.0", { json: true });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toMatch(
      /\/api\/v1\/skills\/owner\/repo\/scout\/versions\/compare\?from=1\.0\.0&to=2\.0\.0$/,
    );
  });
});
