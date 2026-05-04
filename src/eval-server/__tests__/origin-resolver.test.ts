// 0823 T-001/T-002 — Origin Resolver: five-tier provenance resolution.
//
// Tiers (first hit wins):
//   (1) project lockfile  cwd()/vskill.lock
//   (2) user-global lockfile  ~/.agents/vskill.lock
//   (3) frontmatter `source:` field in SKILL.md
//   (4) Anthropic-skill registry
//   (5) bare-name fallback (no upstream)
//
// Returns `OriginEnvelope` for full audit trail.

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  readLockfile: vi.fn(),
  parseSource: vi.fn(),
  homedir: vi.fn(() => "/Users/test"),
  readSkillFrontmatter: vi.fn(),
}));

vi.mock("../../lockfile/lockfile.js", () => ({
  readLockfile: mocks.readLockfile,
}));

vi.mock("../../resolvers/source-resolver.js", () => ({
  parseSource: mocks.parseSource,
}));

vi.mock("node:os", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, homedir: mocks.homedir };
});

const { resolveSkillOrigin, ANTHROPIC_SKILL_REGISTRY, resetOriginResolverCache } = await import(
  "../origin-resolver.js"
);

beforeEach(() => {
  mocks.readLockfile.mockReset();
  mocks.parseSource.mockReset();
  mocks.readSkillFrontmatter.mockReset();
  resetOriginResolverCache();
});

describe("origin-resolver — Tier 1 (project lockfile)", () => {
  it("AC-US2-01,02: returns platform/vskill envelope when project lockfile has the entry", async () => {
    mocks.readLockfile.mockImplementation((dir?: string) =>
      dir === "/proj"
        ? { skills: { nanobanana: { source: "github:foo/bar", version: "1.0.0" } } }
        : null,
    );
    mocks.parseSource.mockReturnValue({ type: "github", owner: "foo", repo: "bar" });

    const env = await resolveSkillOrigin("nanobanana", ".claude", "/proj");
    expect(env.source).toBe("platform");
    expect(env.owner).toBe("foo");
    expect(env.repo).toBe("bar");
    expect(env.provider).toBe("vskill");
    expect(env.trackedForUpdates).toBe(true);
    expect(env.lockfilePath).toBe("/proj");
  });
});

describe("origin-resolver — Tier 2 (user-global lockfile ~/.agents)", () => {
  it("AC-US2-02: falls back to ~/.agents/vskill.lock when project lockfile lacks the entry", async () => {
    mocks.readLockfile.mockImplementation((dir?: string) =>
      dir === "/Users/test/.agents"
        ? { skills: { nanobanana: { source: "github:foo/bar", version: "1.0.0" } } }
        : null,
    );
    mocks.parseSource.mockReturnValue({ type: "github", owner: "foo", repo: "bar" });

    const env = await resolveSkillOrigin("nanobanana", ".claude", "/proj-no-lock");
    expect(env.source).toBe("platform");
    expect(env.owner).toBe("foo");
    expect(env.repo).toBe("bar");
    expect(env.provider).toBe("vskill");
    expect(env.lockfilePath).toBe("/Users/test/.agents");
  });
});

describe("origin-resolver — Tier 1 wins over Tier 2 (precedence)", () => {
  it("AC-US2-10: project lockfile wins when both project and global have the entry", async () => {
    mocks.readLockfile.mockImplementation((dir?: string) => {
      if (dir === "/proj")
        return { skills: { nanobanana: { source: "github:project/wins", version: "2.0.0" } } };
      if (dir === "/Users/test/.agents")
        return { skills: { nanobanana: { source: "github:global/loses", version: "1.0.0" } } };
      return null;
    });
    mocks.parseSource.mockImplementation((src: string) => {
      const m = /github:([^/]+)\/(.+)/.exec(src);
      return m ? { type: "github", owner: m[1], repo: m[2] } : { type: "unknown" };
    });

    const env = await resolveSkillOrigin("nanobanana", ".claude", "/proj");
    expect(env.owner).toBe("project");
    expect(env.repo).toBe("wins");
  });
});

describe("origin-resolver — Tier 4 (Anthropic-skill registry)", () => {
  it("AC-US2-02,05: matches well-known Anthropic skill names → anthropics/skills/<name>", async () => {
    mocks.readLockfile.mockReturnValue(null);

    const env = await resolveSkillOrigin("slack-messaging", ".claude", "/proj");
    expect(env.source).toBe("anthropic-registry");
    // Verified live: the working URL pattern is anthropics/skills/<name>,
    // not anthropic-skills/<name>.
    expect(env.owner).toBe("anthropics");
    expect(env.repo).toBe("skills");
    expect(env.provider).toBe("anthropic");
    expect(env.trackedForUpdates).toBe(true);
    expect(env.registryMatch).toBe("slack-messaging");
  });

  it("AC-US2-02,05: covers the canonical Anthropic-shipped names", async () => {
    mocks.readLockfile.mockReturnValue(null);
    const expected = [
      "pptx",
      "excalidraw-diagram-generator",
      "frontend-design",
      "gws",
      "remotion-best-practices",
      "social-media-posting",
      "webapp-testing",
      "obsidian-brain",
      "nanobanana",
    ];
    for (const name of expected) {
      expect(ANTHROPIC_SKILL_REGISTRY[name]).toBeDefined();
      expect(ANTHROPIC_SKILL_REGISTRY[name].owner).toBe("anthropics");
      expect(ANTHROPIC_SKILL_REGISTRY[name].repo).toBe("skills");
    }
  });
});

describe("origin-resolver — Tier 5 (bare-name fallback / unknown)", () => {
  it("AC-US2-07: returns local provider when no tier matches", async () => {
    mocks.readLockfile.mockReturnValue(null);
    const env = await resolveSkillOrigin("totally-unknown-skill", ".claude", "/proj");
    expect(env.source).toBe("local");
    expect(env.owner).toBeNull();
    expect(env.repo).toBeNull();
    expect(env.provider).toBe("local");
    expect(env.trackedForUpdates).toBe(false);
  });
});

describe("origin-resolver — Lockfile entry without parseable source", () => {
  it("falls through to next tier when entry.source is malformed", async () => {
    mocks.readLockfile.mockImplementation((dir?: string) =>
      dir === "/proj"
        ? { skills: { "slack-messaging": { source: "weird-format", version: "1.0.0" } } }
        : null,
    );
    mocks.parseSource.mockReturnValue({ type: "unknown" });

    const env = await resolveSkillOrigin("slack-messaging", ".claude", "/proj");
    // Tier 4 (Anthropic registry) catches it
    expect(env.source).toBe("anthropic-registry");
    expect(env.provider).toBe("anthropic");
  });
});

describe("origin-resolver — Cache", () => {
  it("caches resolved envelopes by (plugin, skill) for repeat lookups", async () => {
    mocks.readLockfile.mockReturnValue(null);
    const a = await resolveSkillOrigin("slack-messaging", ".claude", "/proj");
    const b = await resolveSkillOrigin("slack-messaging", ".claude", "/proj");
    expect(b).toBe(a); // referentially equal — cache hit
  });

  it("isolates cache per plugin", async () => {
    mocks.readLockfile.mockReturnValue(null);
    const a = await resolveSkillOrigin("slack-messaging", ".claude", "/proj");
    const b = await resolveSkillOrigin("slack-messaging", ".cursor", "/proj");
    expect(b).not.toBe(a);
    expect(b.source).toBe("anthropic-registry");
  });

  it("does NOT cache local fallback (unknown skills) to avoid poisoning", async () => {
    mocks.readLockfile.mockReturnValue(null);
    // First call: no entry, returns local
    const a = await resolveSkillOrigin("future-skill", ".claude", "/proj");
    expect(a.source).toBe("local");
    // Now lockfile gains the entry
    mocks.readLockfile.mockImplementation((dir?: string) =>
      dir === "/proj"
        ? { skills: { "future-skill": { source: "github:owner/repo", version: "1.0.0" } } }
        : null,
    );
    mocks.parseSource.mockReturnValue({ type: "github", owner: "owner", repo: "repo" });
    const b = await resolveSkillOrigin("future-skill", ".claude", "/proj");
    expect(b.source).toBe("platform");
    expect(b.owner).toBe("owner");
  });
});
