import { describe, it, expect } from "vitest";
import { classifyOrigin } from "./skill-scanner.js";

// 0693 AC-US2-02, AC-US2-03: skill-scanner uses NON_AGENT_CONFIG_DIRS from
// the agents-registry instead of a locally defined EXTRA_CONFIG_DIRS.

describe("classifyOrigin (0693 AC-US2-02)", () => {
  const root = "/repo";

  it("classifies skills under .claude as installed (agent prefix)", () => {
    expect(classifyOrigin("/repo/.claude/skills/foo", root)).toBe("installed");
  });

  it("classifies skills under .specweave as installed (NON_AGENT_CONFIG_DIRS)", () => {
    expect(classifyOrigin("/repo/.specweave/skills/foo", root)).toBe("installed");
  });

  it("classifies skills under .vscode as installed (NON_AGENT_CONFIG_DIRS)", () => {
    expect(classifyOrigin("/repo/.vscode/skills/foo", root)).toBe("installed");
  });

  it("classifies skills under .idea as installed (NON_AGENT_CONFIG_DIRS)", () => {
    expect(classifyOrigin("/repo/.idea/skills/foo", root)).toBe("installed");
  });

  it("classifies skills under .zed as installed (NON_AGENT_CONFIG_DIRS)", () => {
    expect(classifyOrigin("/repo/.zed/skills/foo", root)).toBe("installed");
  });

  it("classifies skills under .devcontainer as installed (NON_AGENT_CONFIG_DIRS)", () => {
    expect(classifyOrigin("/repo/.devcontainer/skills/foo", root)).toBe("installed");
  });

  it("classifies user-authored skills as source", () => {
    expect(classifyOrigin("/repo/skills/foo", root)).toBe("source");
    expect(classifyOrigin("/repo/my-plugin/skills/foo", root)).toBe("source");
  });

  it("classifies plugin cache as installed", () => {
    expect(classifyOrigin("/repo/plugins/cache/x/skills/foo", root)).toBe("installed");
  });
});
