// 0894: `vskill install heygen-com/hyperframes --skill talking-head-recut`
// installed 2 of 28 files (music-to-video 11 of 169, embedded-captions 40 of
// 144): only the top level of five fixed folders, text extensions only.
// These pin the complete-tree fetch against mocked GitHub responses.

import { describe, it, expect } from "vitest";
import {
  fetchGitHubSkillBundle,
  SkillBundleError,
  ROOT_SKILL_BUNDLE_DIRS,
} from "./github-skill-bundle.js";

const OWNER = "acme";
const REPO = "skills";
const REF = "0123456789abcdef0123456789abcdef01234567";

// A woff2-ish header with NUL bytes and invalid UTF-8: must stay raw bytes.
const BINARY = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0x00, 0x01, 0xff, 0xfe, 0x80, 0x00]);
const TEXT_WITH_BOM = "﻿export const a = 1;\n";

type Entry = { path: string; mode: string; type: string; size?: number };

function treeFor(files: Record<string, string | Uint8Array>, extra: Entry[] = []): Entry[] {
  const out: Entry[] = [];
  const dirs = new Set<string>();
  for (const [path, content] of Object.entries(files)) {
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
    const size = typeof content === "string" ? Buffer.byteLength(content) : content.byteLength;
    out.push({ path, mode: path.endsWith(".sh") ? "100755" : "100644", type: "blob", size });
  }
  for (const d of dirs) out.push({ path: d, mode: "040000", type: "tree" });
  return [...out, ...extra];
}

interface MockRepo {
  /** dir (repo-relative) -> its subtree listing, or "truncated" */
  trees: Record<string, Entry[] | "truncated">;
  /** repo-relative path -> content */
  blobs: Record<string, string | Uint8Array>;
  failBlob?: string;
}

function mockFetch(repo: MockRepo) {
  const calls: string[] = [];
  const fetchImpl = async (url: string): Promise<Response> => {
    calls.push(url);
    const u = new URL(url);
    if (u.hostname === "api.github.com") {
      const m = u.pathname.match(/\/git\/trees\/(.+)$/);
      if (!m || u.searchParams.get("recursive") !== "1") return new Response("bad", { status: 400 });
      const treeish = decodeURIComponent(m[1]);
      const [ref, dir] = [treeish.slice(0, treeish.indexOf(":")), treeish.slice(treeish.indexOf(":") + 1)];
      if (ref !== REF) return new Response("no ref", { status: 404 });
      const t = repo.trees[dir];
      if (!t) return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
      if (t === "truncated") return Response.json({ tree: [], truncated: true });
      return Response.json({ sha: "x", tree: t, truncated: false });
    }
    if (u.hostname === "raw.githubusercontent.com") {
      const prefix = `/${OWNER}/${REPO}/${REF}/`;
      const path = decodeURIComponent(u.pathname.slice(prefix.length));
      if (path === repo.failBlob) return new Response("boom", { status: 500 });
      const body = repo.blobs[path];
      if (body === undefined) return new Response("404", { status: 404 });
      return new Response(typeof body === "string" ? body : body.slice());
    }
    return new Response("host", { status: 400 });
  };
  return { fetchImpl, calls };
}

function nestedSkill(): MockRepo {
  const files: Record<string, string | Uint8Array> = {
    "SKILL.md": "---\nname: recut\n---\n# Recut\nRun scripts/lib/cut.mjs",
    "NOTICE.md": "Apache-2.0 notice",
    "scripts/lib/cut.mjs": "export function cut() {}\n",
    "scripts/lib/deep/more/util.mjs": TEXT_WITH_BOM,
    "scripts/run.sh": "#!/bin/sh\necho hi\n",
    "sub-agents/editor.md": "# Editor sub-agent",
    "references/layouts/pip.md": "# PiP",
    "assets/fonts/Inter.woff2": BINARY,
    "assets/audio/beep.mp3": new Uint8Array([0xff, 0xfb, 0x90, 0x00, 0x00]),
    ".DS_Store": new Uint8Array([0, 0, 0, 1]),
  };
  const tree = treeFor(files, [
    { path: "link-to-readme", mode: "120000", type: "blob", size: 9 },
    { path: "vendor/sub", mode: "160000", type: "commit" },
  ]);
  const blobs: Record<string, string | Uint8Array> = {};
  for (const [p, c] of Object.entries(files)) blobs[`skills/recut/${p}`] = c;
  return { trees: { "skills/recut": tree }, blobs };
}

describe("fetchGitHubSkillBundle — complete skill folder", () => {
  it("fetches nested dirs, non-standard paths and binaries with ONE tree call", async () => {
    const { fetchImpl, calls } = mockFetch(nestedSkill());
    const b = await fetchGitHubSkillBundle({
      owner: OWNER, repo: REPO, ref: REF, skillMdPath: "skills/recut/SKILL.md", fetchImpl,
    });

    expect(b.fileList).toEqual([
      "NOTICE.md",
      "SKILL.md",
      "assets/audio/beep.mp3",
      "assets/fonts/Inter.woff2",
      "references/layouts/pip.md",
      "scripts/lib/cut.mjs",
      "scripts/lib/deep/more/util.mjs",
      "scripts/run.sh",
      "sub-agents/editor.md",
    ]);
    // SKILL.md is fetched/scanned by the caller, not duplicated in files.
    expect(b.files["SKILL.md"]).toBeUndefined();
    // Binaries stay raw bytes, byte for byte.
    expect(b.files["assets/fonts/Inter.woff2"]).toBeInstanceOf(Uint8Array);
    expect(Array.from(b.files["assets/fonts/Inter.woff2"] as Uint8Array)).toEqual(Array.from(BINARY));
    expect(b.files["assets/audio/beep.mp3"]).toBeInstanceOf(Uint8Array);
    // Text stays an exact string (BOM preserved).
    expect(b.files["scripts/lib/deep/more/util.mjs"]).toBe(TEXT_WITH_BOM);
    expect(b.files["sub-agents/editor.md"]).toBe("# Editor sub-agent");
    // Exec bits from the tree mode.
    expect(b.executables).toEqual(["scripts/run.sh"]);
    // Symlinks and submodules are reported, not silently written.
    expect(b.skipped.map((s) => s.path).sort()).toEqual(["link-to-readme", "vendor/sub"]);
    // One recursive tree listing, no per-directory Contents API calls.
    const apiCalls = calls.filter((c) => c.includes("api.github.com"));
    expect(apiCalls).toHaveLength(1);
    expect(apiCalls[0]).toContain("/git/trees/");
    expect(apiCalls[0]).toContain("recursive=1");
    expect(calls.some((c) => c.includes("/contents/"))).toBe(false);
  });

  it("fails loudly over the file-count limit instead of truncating", async () => {
    const { fetchImpl, calls } = mockFetch(nestedSkill());
    await expect(
      fetchGitHubSkillBundle({
        owner: OWNER, repo: REPO, ref: REF, skillMdPath: "skills/recut/SKILL.md", fetchImpl,
        limits: { maxFiles: 3 },
      }),
    ).rejects.toThrow(/9 files, over the 3-file install limit/);
    // Nothing downloaded before the limit check.
    expect(calls.some((c) => c.includes("raw.githubusercontent.com"))).toBe(false);
  });

  it("fails loudly over the per-file and total size limits", async () => {
    const { fetchImpl } = mockFetch(nestedSkill());
    await expect(
      fetchGitHubSkillBundle({
        owner: OWNER, repo: REPO, ref: REF, skillMdPath: "skills/recut/SKILL.md", fetchImpl,
        limits: { maxFileBytes: 12 },
      }),
    ).rejects.toThrow(SkillBundleError);
    await expect(
      fetchGitHubSkillBundle({
        owner: OWNER, repo: REPO, ref: REF, skillMdPath: "skills/recut/SKILL.md", fetchImpl,
        limits: { maxTotalBytes: 20 },
      }),
    ).rejects.toThrow(/over the 20-byte install limit/);
  });

  it("refuses a truncated tree listing", async () => {
    const { fetchImpl } = mockFetch({ trees: { "skills/recut": "truncated" }, blobs: {} });
    await expect(
      fetchGitHubSkillBundle({ owner: OWNER, repo: REPO, ref: REF, skillMdPath: "skills/recut/SKILL.md", fetchImpl }),
    ).rejects.toThrow(/truncated/);
  });

  it("refuses to return a partial bundle when a download fails", async () => {
    const repo = nestedSkill();
    repo.failBlob = "skills/recut/assets/fonts/Inter.woff2";
    const { fetchImpl } = mockFetch(repo);
    await expect(
      fetchGitHubSkillBundle({ owner: OWNER, repo: REPO, ref: REF, skillMdPath: "skills/recut/SKILL.md", fetchImpl }),
    ).rejects.toThrow(/assets\/fonts\/Inter\.woff2 \(HTTP 500\)/);
  });

  it("for a repo-root SKILL.md fetches only the convention folders, recursively", async () => {
    const trees: MockRepo["trees"] = {
      scripts: treeFor({ "lib/a.py": "print(1)\n" }),
      assets: treeFor({ "img/logo.png": BINARY }),
    };
    const blobs = { "scripts/lib/a.py": "print(1)\n", "assets/img/logo.png": BINARY };
    const { fetchImpl, calls } = mockFetch({ trees, blobs });
    const b = await fetchGitHubSkillBundle({ owner: OWNER, repo: REPO, ref: REF, skillMdPath: "SKILL.md", fetchImpl });
    expect(b.fileList).toEqual(["SKILL.md", "assets/img/logo.png", "scripts/lib/a.py"]);
    expect(b.files["assets/img/logo.png"]).toBeInstanceOf(Uint8Array);
    expect(calls.filter((c) => c.includes("/git/trees/"))).toHaveLength(ROOT_SKILL_BUNDLE_DIRS.length);
  });
});
