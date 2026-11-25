import { describe, expect, it } from "vitest";
import {
  fetchUpstreamDeprecations,
  formatDeprecation,
  readDeprecation,
  readDeprecations,
} from "../deprecation.js";
import type { SkillLockEntry } from "../../lockfile/types.js";

const DEPRECATED = `---
name: task-skill-announcer
description: "DEPRECATED: a smoke-test fixture."
metadata:
  version: "1.0.5"
  deprecated: "true"
  deprecated-message: "A smoke-test fixture, not a user skill; moved to e2e fixtures."
  replaced-by: "none"
  deprecated-since: "1.0.5"
---

# body
`;

const PLAIN = `---
name: gws
metadata:
  version: 1.0.5
---
body
`;

function entry(over: Partial<SkillLockEntry>): SkillLockEntry {
  return { version: "1.0.3", sha: "x", tier: "VERIFIED", installedAt: "", source: "", ...over };
}

describe("readDeprecation", () => {
  it("reads the four flat metadata keys", () => {
    expect(readDeprecation(DEPRECATED)).toEqual({
      message: "A smoke-test fixture, not a user skill; moved to e2e fixtures.",
      replacedBy: "none",
      since: "1.0.5",
    });
  });

  it("accepts an unquoted YAML boolean and CRLF line endings", () => {
    const crlf = "---\r\nname: a\r\nmetadata:\r\n  deprecated: true\r\n  replaced-by: mcp:gws:gmail\r\n---\r\n";
    expect(readDeprecation(crlf)).toEqual({ message: "", replacedBy: "mcp:gws:gmail" });
  });

  it("returns null when not deprecated, false, nested or top-level", () => {
    expect(readDeprecation(PLAIN)).toBeNull();
    expect(readDeprecation(DEPRECATED.replace('deprecated: "true"', 'deprecated: "false"'))).toBeNull();
    const nested = "---\nname: a\nmetadata:\n  deprecation:\n    deprecated: \"true\"\n---\n";
    expect(readDeprecation(nested)).toBeNull();
    const topLevel = "---\nname: a\ndeprecated: \"true\"\nmetadata:\n  version: 1.0.0\n---\n";
    expect(readDeprecation(topLevel)).toBeNull();
    expect(readDeprecation(null)).toBeNull();
    expect(readDeprecation("no frontmatter")).toBeNull();
  });

  it("reads valid YAML scalars: quoted keys, # inside plain text, folded and escaped strings", () => {
    const quoted = '---\nmetadata:\n  "deprecated": "true"\n  \'replaced-by\': mcp:gws\n---\n';
    expect(readDeprecation(quoted)).toEqual({ message: "", replacedBy: "mcp:gws" });
    const hash = "---\nmetadata:\n  deprecated: \"true\"\n  deprecated-message: See docs#install # a comment\n---\n";
    expect(readDeprecation(hash)?.message).toBe("See docs#install");
    const folded = "---\nmetadata:\n  deprecated: \"true\"\n  deprecated-message: >-\n    Moved to\n    fixtures.\n---\n";
    expect(readDeprecation(folded)?.message).toBe("Moved to fixtures.");
    const escaped = '---\nmetadata:\n  deprecated: "true"\n  deprecated-message: "Caf\\u00e9 \\"x\\""\n---\n';
    expect(readDeprecation(escaped)?.message).toBe('Café "x"');
    const long = `mcp:server:${"t".repeat(400)}`;
    expect(readDeprecation(`---\nmetadata:\n  deprecated: "true"\n  replaced-by: ${long}\n---\n`)?.replacedBy).toBe(long);
  });

  it("does not read flow-style or aliased metadata (D-04), or broken YAML", () => {
    expect(readDeprecation('---\nmetadata: { deprecated: "true" }\n---\n')).toBeNull();
    expect(readDeprecation('---\nbase: &m\n  deprecated: "true"\nmetadata: *m\n---\n')).toBeNull();
    expect(readDeprecation("---\nmetadata:\n  deprecated: \"true\n---\n")).toBeNull();
  });

  it("defaults a missing replaced-by to none", () => {
    const d = readDeprecation("---\nmetadata:\n  deprecated: \"true\"\n  deprecated-message: Use x\n---\n");
    expect(d).toEqual({ message: "Use x", replacedBy: "none" });
  });

  it("finds every deprecated skill in combined plugin content", () => {
    const found = readDeprecations([PLAIN, DEPRECATED].join("\n"));
    expect(found).toHaveLength(1);
    expect(found[0].name).toBe("task-skill-announcer");
  });
});

describe("formatDeprecation", () => {
  it("names the message and the replacement", () => {
    expect(formatDeprecation("task-skill-announcer", readDeprecation(DEPRECATED)!)).toBe(
      "task-skill-announcer is deprecated since 1.0.5: A smoke-test fixture, not a user skill; moved to e2e fixtures. " +
        "Replaced by: none (no replacement).",
    );
    expect(formatDeprecation("x", { message: "Use the MCP", replacedBy: "mcp:gws" })).toBe(
      "x is deprecated: Use the MCP. Replaced by: mcp:gws.",
    );
  });
});

describe("fetchUpstreamDeprecations", () => {
  it("flags a single-skill GitHub install that predates the field (reads sourceSkillPath on the branch)", async () => {
    const seen: string[] = [];
    const found = await fetchUpstreamDeprecations(
      "task-skill-announcer",
      entry({
        source: "github:anton-abyzov/vskill",
        sourceSkillPath: "plugins/frontend/skills/task-skill-announcer/SKILL.md",
        sourceBranch: "main",
        pinnedVersion: "1.0.3",
      }),
      { fetchText: async (url) => (seen.push(url), url.endsWith("task-skill-announcer/SKILL.md") ? DEPRECATED : null) },
    );
    expect(seen[0]).toBe(
      "https://raw.githubusercontent.com/anton-abyzov/vskill/main/plugins/frontend/skills/task-skill-announcer/SKILL.md",
    );
    expect(found).toEqual([{ skill: "task-skill-announcer", deprecation: readDeprecation(DEPRECATED) }]);
  });

  it("ignores a fallback SKILL.md that belongs to another skill", async () => {
    const found = await fetchUpstreamDeprecations(
      "foo",
      entry({ source: "github:o/r" }),
      { fetchText: async (url) => (url.endsWith("/SKILL.md") && !url.includes("skills/") ? DEPRECATED : null) },
    );
    expect(found).toEqual([]);
  });

  it("reads each installed skill of a plugin install through marketplace.json", async () => {
    const manifest = JSON.stringify({ plugins: [{ name: "frontend", source: "./plugins/frontend" }] });
    const seen: string[] = [];
    const found = await fetchUpstreamDeprecations(
      "frontend",
      entry({
        source: "github:anton-abyzov/vskill#plugin:frontend",
        files: ["task-skill-announcer/SKILL.md", "figma-connect/SKILL.md", "figma-connect/ref.md"],
      }),
      {
        fetchText: async (url) => {
          seen.push(url);
          if (url.endsWith("/.claude-plugin/marketplace.json")) return manifest;
          if (url.endsWith("plugins/frontend/skills/task-skill-announcer/SKILL.md")) return DEPRECATED;
          if (url.endsWith("plugins/frontend/skills/figma-connect/SKILL.md")) return PLAIN;
          return null;
        },
      },
    );
    expect(seen[0]).toBe("https://raw.githubusercontent.com/anton-abyzov/vskill/HEAD/.claude-plugin/marketplace.json");
    expect(found.map((f) => f.skill)).toEqual(["task-skill-announcer"]);
  });

  it("reads the default branch when the lock pins a commit as sourceBranch", async () => {
    const seen: string[] = [];
    await fetchUpstreamDeprecations(
      "a",
      entry({ source: "github:o/r", sourceSkillPath: "SKILL.md", sourceBranch: "0123456789abcdef0123456789abcdef01234567" }),
      { fetchText: async (url) => (seen.push(url), null) },
    );
    expect(seen[0]).toBe("https://raw.githubusercontent.com/o/r/HEAD/SKILL.md");
  });

  it("shares one deadline across the lookup and aborts the request", async () => {
    let signal: AbortSignal | undefined;
    let calls = 0;
    const hang = (_url: string, s?: AbortSignal) => {
      calls++;
      signal = s;
      return new Promise<string | null>(() => {});
    };
    const started = Date.now();
    expect(await fetchUpstreamDeprecations("a", entry({ source: "github:o/r", sourceSkillPath: "x/SKILL.md" }), { fetchText: hang, timeoutMs: 30 })).toEqual([]);
    expect(Date.now() - started).toBeLessThan(500);
    expect(calls).toBe(1);
    expect(signal?.aborted).toBe(true);
  });

  it("makes no claim when the source is unreachable, slow, private or not GitHub", async () => {
    const throwing = async () => {
      throw new Error("offline");
    };
    expect(await fetchUpstreamDeprecations("a", entry({ source: "github:o/r" }), { fetchText: throwing })).toEqual([]);
    const slow = () => new Promise<string | null>((r) => setTimeout(() => r(DEPRECATED), 200));
    expect(
      await fetchUpstreamDeprecations("a", entry({ source: "github:o/r", sourceSkillPath: "SKILL.md" }), {
        fetchText: slow,
        timeoutMs: 20,
      }),
    ).toEqual([]);
    const any = async () => DEPRECATED;
    expect(await fetchUpstreamDeprecations("a", entry({ source: "github:o/r", sourcePrivate: true }), { fetchText: any })).toEqual([]);
    expect(await fetchUpstreamDeprecations("a", entry({ source: "registry:a" }), { fetchText: any })).toEqual([]);
  });
});
