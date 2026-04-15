import { describe, it, expect } from "vitest";
import { parseTargetAgents } from "./frontmatter.js";

// ---------------------------------------------------------------------------
// parseTargetAgents()
// ---------------------------------------------------------------------------

describe("parseTargetAgents", () => {
  it("parses comma-separated target-agents from frontmatter", () => {
    const content = `---
description: "Test skill"
target-agents: claude-code, cursor
---

# Skill body`;
    const result = parseTargetAgents(content);
    expect(result).toEqual(["claude-code", "cursor"]);
  });

  it("returns undefined when target-agents is absent", () => {
    const content = `---
description: "Test skill"
---

# Skill body`;
    const result = parseTargetAgents(content);
    expect(result).toBeUndefined();
  });

  it("handles single agent", () => {
    const content = `---
description: "Test skill"
target-agents: claude-code
---

# Body`;
    const result = parseTargetAgents(content);
    expect(result).toEqual(["claude-code"]);
  });

  it("trims whitespace from agent names", () => {
    const content = `---
target-agents:  claude-code , cursor , cline
---

# Body`;
    const result = parseTargetAgents(content);
    expect(result).toEqual(["claude-code", "cursor", "cline"]);
  });

  it("returns undefined when no frontmatter exists", () => {
    const content = "# Just a skill body";
    const result = parseTargetAgents(content);
    expect(result).toBeUndefined();
  });

  it("handles quoted target-agents value", () => {
    const content = `---
description: "Test"
target-agents: "claude-code, cursor"
---

# Body`;
    const result = parseTargetAgents(content);
    expect(result).toEqual(["claude-code", "cursor"]);
  });

  it("filters out empty strings from trailing commas", () => {
    const content = `---
target-agents: claude-code, cursor,
---

# Body`;
    const result = parseTargetAgents(content);
    expect(result).toEqual(["claude-code", "cursor"]);
  });
});
