import { describe, it, expect } from "vitest";
import {
  detectBrowserRequirements,
  detectPlatformTargets,
  buildIntegrationEvalPrompt,
  parseGeneratedIntegrationEvals,
  CREDENTIAL_HINTS,
} from "../prompt-builder.js";
import { detectMcpDependencies } from "../mcp-detector.js";

// ---------------------------------------------------------------------------
// detectBrowserRequirements (T-011)
// ---------------------------------------------------------------------------

describe("detectBrowserRequirements", () => {
  it("returns hasBrowser: true when Bash tool + browser keyword present", () => {
    const skill = `---
name: web-scraper
allowed-tools: Bash, Read
---
# Web Scraper
This skill opens a browser to scrape web pages using Chrome.`;

    const result = detectBrowserRequirements(skill);
    expect(result.hasBrowser).toBe(true);
    expect(result.suggestedProfile).toBe("Default");
  });

  it("returns hasBrowser: true for Chrome profile reference", () => {
    const skill = `---
name: social-poster
allowed-tools: Bash
---
# Social Poster
Uses a Chrome profile to post content to social media.`;

    const result = detectBrowserRequirements(skill);
    expect(result.hasBrowser).toBe(true);
  });

  it("returns hasBrowser: true for Playwright reference", () => {
    const skill = `---
name: e2e-tester
allowed-tools: Bash, Write
---
# E2E Tester
Runs Playwright tests against the staging environment.`;

    const result = detectBrowserRequirements(skill);
    expect(result.hasBrowser).toBe(true);
  });

  it("returns hasBrowser: false when no Bash tool", () => {
    const skill = `---
name: text-skill
allowed-tools: none
---
# Text Skill
Opens a browser window.`;

    const result = detectBrowserRequirements(skill);
    expect(result.hasBrowser).toBe(false);
  });

  it("returns hasBrowser: false when no browser keywords", () => {
    const skill = `---
name: file-tool
allowed-tools: Bash
---
# File Tool
Processes files on disk.`;

    const result = detectBrowserRequirements(skill);
    expect(result.hasBrowser).toBe(false);
  });

  it("returns hasBrowser: false for content with no frontmatter", () => {
    const skill = "# Simple skill\nNo frontmatter here. Uses a browser.";
    const result = detectBrowserRequirements(skill);
    expect(result.hasBrowser).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// detectPlatformTargets (T-012)
// ---------------------------------------------------------------------------

describe("detectPlatformTargets", () => {
  it("detects Twitter, LinkedIn, and Slack", () => {
    const skill = `---
name: social-poster
---
# Social Poster
Post content to Twitter, LinkedIn, and Slack channels.`;

    const result = detectPlatformTargets(skill);
    expect(result).toContain("Twitter");
    expect(result).toContain("LinkedIn");
    expect(result).toContain("Slack");
  });

  it("detects case-insensitive platform names", () => {
    const skill = `---
name: poster
---
Post to INSTAGRAM and youtube.`;

    const result = detectPlatformTargets(skill);
    expect(result).toContain("Instagram");
    expect(result).toContain("YouTube");
  });

  it("deduplicates platforms (twitter + x.com)", () => {
    const skill = `---
name: x-poster
---
Post to Twitter and x.com for maximum reach.`;

    const result = detectPlatformTargets(skill);
    const twitterCount = result.filter((p) => p === "Twitter").length;
    expect(twitterCount).toBe(1);
  });

  it("returns empty array when no platforms detected", () => {
    const skill = `---
name: calculator
---
# Calculator
Performs math operations.`;

    const result = detectPlatformTargets(skill);
    expect(result).toEqual([]);
  });

  it("detects multiple platforms including dev.to", () => {
    const skill = `---
name: blog-poster
---
# Blog Poster
Cross-posts to dev.to, Reddit, and Discord.`;

    const result = detectPlatformTargets(skill);
    expect(result).toContain("dev.to");
    expect(result).toContain("Reddit");
    expect(result).toContain("Discord");
  });
});

// ---------------------------------------------------------------------------
// CREDENTIAL_HINTS (T-013)
// ---------------------------------------------------------------------------

describe("CREDENTIAL_HINTS", () => {
  it("maps Slack to SLACK_BOT_TOKEN", () => {
    expect(CREDENTIAL_HINTS["Slack"]).toContain("SLACK_BOT_TOKEN");
  });

  it("maps GitHub to GITHUB_TOKEN", () => {
    expect(CREDENTIAL_HINTS["GitHub"]).toContain("GITHUB_TOKEN");
  });

  it("maps Linear to LINEAR_API_KEY", () => {
    expect(CREDENTIAL_HINTS["Linear"]).toContain("LINEAR_API_KEY");
  });

  it("has entries for all major MCP servers", () => {
    expect(Object.keys(CREDENTIAL_HINTS)).toEqual(
      expect.arrayContaining(["Slack", "GitHub", "Linear", "Notion", "Jira", "Figma", "Sentry"]),
    );
  });
});

// ---------------------------------------------------------------------------
// buildIntegrationEvalPrompt (T-016)
// ---------------------------------------------------------------------------

describe("buildIntegrationEvalPrompt", () => {
  const socialSkill = `---
name: social-poster
allowed-tools: Bash
---
# Social Poster
Post content to Twitter using Chrome browser automation.
Uses slack_send_message to notify the team.`;

  it("includes testType integration instruction", () => {
    const mcpDeps = detectMcpDependencies(socialSkill);
    const browserReqs = detectBrowserRequirements(socialSkill);
    const platforms = detectPlatformTargets(socialSkill);

    const prompt = buildIntegrationEvalPrompt(socialSkill, mcpDeps, browserReqs, platforms);
    expect(prompt).toContain("testType");
    expect(prompt).toContain("integration");
  });

  it("includes credential hints from MCP deps", () => {
    const mcpDeps = detectMcpDependencies(socialSkill);
    const browserReqs = detectBrowserRequirements(socialSkill);
    const platforms = detectPlatformTargets(socialSkill);

    const prompt = buildIntegrationEvalPrompt(socialSkill, mcpDeps, browserReqs, platforms);
    expect(prompt).toContain("SLACK_BOT_TOKEN");
    expect(prompt).toContain("requiredCredentials");
  });

  it("includes chromeProfile for browser-based skills", () => {
    const mcpDeps = detectMcpDependencies(socialSkill);
    const browserReqs = detectBrowserRequirements(socialSkill);
    const platforms = detectPlatformTargets(socialSkill);

    const prompt = buildIntegrationEvalPrompt(socialSkill, mcpDeps, browserReqs, platforms);
    expect(prompt).toContain("chromeProfile");
    expect(prompt).toContain("Default");
  });

  it("includes cleanup instructions for platform targets", () => {
    const mcpDeps = detectMcpDependencies(socialSkill);
    const browserReqs = detectBrowserRequirements(socialSkill);
    const platforms = detectPlatformTargets(socialSkill);

    const prompt = buildIntegrationEvalPrompt(socialSkill, mcpDeps, browserReqs, platforms);
    expect(prompt).toContain("cleanup");
    expect(prompt).toContain("delete_post");
    expect(prompt).toContain("Twitter");
  });

  it("omits credential section when no MCP deps", () => {
    const plainSkill = `---
name: browser-tool
allowed-tools: Bash
---
Uses Chrome browser to test websites.`;

    const prompt = buildIntegrationEvalPrompt(plainSkill, [], detectBrowserRequirements(plainSkill), []);
    expect(prompt).not.toContain("Required Credentials");
  });

  it("omits browser section when no browser requirements", () => {
    const apiSkill = `Use slack_send_message to post.`;
    const mcpDeps = detectMcpDependencies(apiSkill);

    const prompt = buildIntegrationEvalPrompt(apiSkill, mcpDeps, { hasBrowser: false }, []);
    expect(prompt).not.toContain("Browser Requirements");
  });
});

// ---------------------------------------------------------------------------
// parseGeneratedIntegrationEvals (T-017)
// ---------------------------------------------------------------------------

describe("parseGeneratedIntegrationEvals", () => {
  it("parses valid integration eval array from code fence", () => {
    const raw = `\`\`\`json
[
  {
    "id": 1,
    "name": "Post to Twitter",
    "prompt": "Post 'Hello World' to Twitter",
    "expected_output": "Tweet posted successfully",
    "testType": "integration",
    "requiredCredentials": ["TWITTER_BEARER_TOKEN"],
    "requirements": { "chromeProfile": "Default", "platform": "Twitter" },
    "cleanup": [{ "action": "delete_post", "platform": "Twitter", "identifier": "{POSTED_ID}" }],
    "assertions": [
      { "id": "assert-1", "text": "Post appears on Twitter timeline", "type": "boolean" }
    ]
  }
]
\`\`\``;

    const result = parseGeneratedIntegrationEvals(raw);
    expect(result).toHaveLength(1);
    expect(result[0].testType).toBe("integration");
    expect(result[0].requiredCredentials).toEqual(["TWITTER_BEARER_TOKEN"]);
    expect(result[0].requirements).toEqual({ chromeProfile: "Default", platform: "Twitter" });
    expect(result[0].cleanup).toHaveLength(1);
  });

  it("accepts wrapped object with evals key", () => {
    const raw = `\`\`\`json
{
  "evals": [
    {
      "id": 1,
      "name": "Test",
      "prompt": "Test prompt",
      "expected_output": "output",
      "testType": "integration",
      "assertions": [{ "id": "a1", "text": "check", "type": "boolean" }]
    }
  ]
}
\`\`\``;

    const result = parseGeneratedIntegrationEvals(raw);
    expect(result).toHaveLength(1);
    expect(result[0].testType).toBe("integration");
  });

  it("throws on missing code fence", () => {
    expect(() => parseGeneratedIntegrationEvals("no json here")).toThrow(/code block/i);
  });

  it("throws on malformed JSON", () => {
    expect(() => parseGeneratedIntegrationEvals("```json\n{invalid}\n```")).toThrow(/Invalid JSON/);
  });

  it("throws on empty array", () => {
    expect(() => parseGeneratedIntegrationEvals("```json\n[]\n```")).toThrow(/non-empty array/);
  });

  it("sets testType to integration for all cases", () => {
    const raw = `\`\`\`json
[
  {
    "id": 1,
    "name": "Test",
    "prompt": "p",
    "expected_output": "e",
    "assertions": [{ "id": "a1", "text": "t", "type": "boolean" }]
  }
]
\`\`\``;

    const result = parseGeneratedIntegrationEvals(raw);
    expect(result[0].testType).toBe("integration");
  });

  it("auto-fills name from id when missing", () => {
    const raw = `\`\`\`json
[
  {
    "id": 42,
    "prompt": "p",
    "expected_output": "e",
    "assertions": [{ "id": "a1", "text": "t", "type": "boolean" }]
  }
]
\`\`\``;

    const result = parseGeneratedIntegrationEvals(raw);
    expect(result[0].name).toBe("integration-case-42");
  });
});
