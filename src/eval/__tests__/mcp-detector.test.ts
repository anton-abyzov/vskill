import { describe, it, expect } from "vitest";
import { detectMcpDependencies, detectSkillDependencies } from "../mcp-detector.js";

describe("detectMcpDependencies", () => {
  it("detects Slack tool patterns in body", () => {
    const content = `---
description: "Slack messaging skill"
---
Use slack_send_message to post and slack_list_channels to browse.`;

    const deps = detectMcpDependencies(content);
    expect(deps).toHaveLength(1);
    expect(deps[0].server).toBe("Slack");
    expect(deps[0].url).toBe("https://mcp.slack.com/mcp");
    expect(deps[0].transport).toBe("http");
    expect(deps[0].matchedTools).toContain("slack_send_message");
    expect(deps[0].matchedTools).toContain("slack_list_channels");
  });

  it("detects GitHub tool patterns", () => {
    const content = `Use github_create_pr and github_list_repos for code management.`;
    const deps = detectMcpDependencies(content);
    expect(deps).toHaveLength(1);
    expect(deps[0].server).toBe("GitHub");
    expect(deps[0].matchedTools).toContain("github_create_pr");
  });

  it("detects Google Workspace from multiple prefixes", () => {
    const content = `Use drive_list_files and gmail_send to handle docs.`;
    const deps = detectMcpDependencies(content);
    expect(deps).toHaveLength(1);
    expect(deps[0].server).toBe("Google Workspace");
    expect(deps[0].matchedTools).toContain("drive_list_files");
    expect(deps[0].matchedTools).toContain("gmail_send");
  });

  it("detects Linear tool patterns", () => {
    const content = `Call linear_create_issue when a bug is reported.`;
    const deps = detectMcpDependencies(content);
    expect(deps).toHaveLength(1);
    expect(deps[0].server).toBe("Linear");
  });

  it("detects tools from frontmatter allowed-tools", () => {
    const content = `---
description: "Slack skill"
allowed-tools: [slack_post, slack_reply]
---
Body text here.`;

    const deps = detectMcpDependencies(content);
    expect(deps).toHaveLength(1);
    expect(deps[0].server).toBe("Slack");
    expect(deps[0].matchedTools).toContain("slack_post");
    expect(deps[0].matchedTools).toContain("slack_reply");
  });

  it("returns empty for no known patterns", () => {
    const content = `---
description: "A generic skill"
---
This skill does basic text processing.`;

    const deps = detectMcpDependencies(content);
    expect(deps).toHaveLength(0);
  });

  it("generates valid JSON config snippets", () => {
    const content = `Use slack_send_message for messaging.`;
    const deps = detectMcpDependencies(content);
    expect(deps).toHaveLength(1);
    const parsed = JSON.parse(deps[0].configSnippet);
    expect(parsed.mcpServers).toBeDefined();
    expect(parsed.mcpServers.slack).toBeDefined();
    expect(parsed.mcpServers.slack.url).toBe("https://mcp.slack.com/mcp");
  });

  it("deduplicates tools from frontmatter and body", () => {
    const content = `---
allowed-tools: [slack_send_message]
---
Also uses slack_send_message and slack_reply in text.`;

    const deps = detectMcpDependencies(content);
    expect(deps).toHaveLength(1);
    const slackTools = deps[0].matchedTools;
    // slack_send_message should appear only once
    expect(slackTools.filter((t) => t === "slack_send_message")).toHaveLength(1);
  });
});

describe("detectSkillDependencies", () => {
  it("detects 'use the X skill' pattern", () => {
    const content = `---
description: "test"
---
This skill uses the scout skill for research.`;

    const deps = detectSkillDependencies(content);
    expect(deps).toHaveLength(1);
    expect(deps[0].name).toBe("scout");
    expect(deps[0].source).toBe("body-reference");
  });

  it("detects 'chains with X' pattern", () => {
    const content = `This chains with social-media-posting for distribution.`;
    const deps = detectSkillDependencies(content);
    expect(deps).toHaveLength(1);
    expect(deps[0].name).toBe("social-media-posting");
  });

  it("detects explicit frontmatter dependencies", () => {
    const content = `---
dependencies: [scout, social-media-posting]
---
Body content.`;

    const deps = detectSkillDependencies(content);
    expect(deps).toHaveLength(2);
    expect(deps[0].name).toBe("scout");
    expect(deps[0].source).toBe("frontmatter");
    expect(deps[1].name).toBe("social-media-posting");
  });

  it("returns empty for no references", () => {
    const content = `---
description: "standalone skill"
---
No dependencies here.`;

    const deps = detectSkillDependencies(content);
    expect(deps).toHaveLength(0);
  });

  it("deduplicates across patterns", () => {
    const content = `---
dependencies: [scout]
---
Use the scout skill for research.`;

    const deps = detectSkillDependencies(content);
    expect(deps).toHaveLength(1);
    expect(deps[0].source).toBe("frontmatter"); // frontmatter takes priority
  });
});
