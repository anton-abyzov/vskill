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

  it("detects Notion tool patterns", () => {
    const content = `Use notion_create_page and notion_search to manage Notion workspace.`;
    const deps = detectMcpDependencies(content);
    expect(deps).toHaveLength(1);
    expect(deps[0].server).toBe("Notion");
    expect(deps[0].url).toBe("https://mcp.notion.com/mcp");
    expect(deps[0].transport).toBe("http");
    expect(deps[0].matchedTools).toContain("notion_create_page");
    expect(deps[0].matchedTools).toContain("notion_search");
  });

  it("detects Jira tool patterns", () => {
    const content = `Use jira_create_issue to file bugs in Jira.`;
    const deps = detectMcpDependencies(content);
    expect(deps).toHaveLength(1);
    expect(deps[0].server).toBe("Jira");
    expect(deps[0].url).toBe("https://mcp.atlassian.com/jira/mcp");
    expect(deps[0].transport).toBe("http");
    expect(deps[0].matchedTools).toContain("jira_create_issue");
  });

  it("detects Confluence tool patterns", () => {
    const content = `Use confluence_create_page to write documentation.`;
    const deps = detectMcpDependencies(content);
    expect(deps).toHaveLength(1);
    expect(deps[0].server).toBe("Confluence");
    expect(deps[0].url).toBe("https://mcp.atlassian.com/confluence/mcp");
    expect(deps[0].transport).toBe("http");
    expect(deps[0].matchedTools).toContain("confluence_create_page");
  });

  it("detects Figma tool patterns", () => {
    const content = `Use figma_get_file to inspect design files.`;
    const deps = detectMcpDependencies(content);
    expect(deps).toHaveLength(1);
    expect(deps[0].server).toBe("Figma");
    expect(deps[0].url).toBe("https://mcp.figma.com/mcp");
    expect(deps[0].transport).toBe("http");
    expect(deps[0].matchedTools).toContain("figma_get_file");
  });

  it("detects Sentry tool patterns", () => {
    const content = `Use sentry_list_issues to monitor errors.`;
    const deps = detectMcpDependencies(content);
    expect(deps).toHaveLength(1);
    expect(deps[0].server).toBe("Sentry");
    expect(deps[0].url).toBe("https://mcp.sentry.dev/mcp");
    expect(deps[0].transport).toBe("http");
    expect(deps[0].matchedTools).toContain("sentry_list_issues");
  });

  it("detects multiple new servers simultaneously", () => {
    const content = `Use notion_create_page for docs, jira_create_issue for bugs, and figma_get_file for design.`;
    const deps = detectMcpDependencies(content);
    expect(deps).toHaveLength(3);
    const servers = deps.map((d) => d.server);
    expect(servers).toContain("Notion");
    expect(servers).toContain("Jira");
    expect(servers).toContain("Figma");
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
