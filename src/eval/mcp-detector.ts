// ---------------------------------------------------------------------------
// mcp-detector.ts -- pure function to detect MCP + skill dependencies from SKILL.md
// ---------------------------------------------------------------------------

export interface McpDependency {
  server: string;
  url: string;
  transport: "http" | "stdio";
  matchedTools: string[];
  configSnippet: string;
}

export interface SkillDependency {
  name: string;
  source: "body-reference" | "frontmatter";
}

interface McpRegistryEntry {
  server: string;
  prefixes: string[];
  url: string;
  transport: "http" | "stdio";
}

const MCP_REGISTRY: McpRegistryEntry[] = [
  {
    server: "Slack",
    prefixes: ["slack_"],
    url: "https://mcp.slack.com/mcp",
    transport: "http",
  },
  {
    server: "GitHub",
    prefixes: ["github_"],
    url: "https://api.githubcopilot.com/mcp/",
    transport: "http",
  },
  {
    server: "Linear",
    prefixes: ["linear_"],
    url: "https://mcp.linear.app/mcp",
    transport: "http",
  },
  {
    server: "Google Workspace",
    prefixes: ["gws_", "drive_", "gmail_", "sheets_", "calendar_", "chat_"],
    url: "https://mcp.google.com/mcp",
    transport: "http",
  },
  {
    server: "Notion",
    prefixes: ["notion_"],
    url: "https://mcp.notion.com/mcp",
    transport: "http",
  },
  {
    server: "Jira",
    prefixes: ["jira_"],
    url: "https://mcp.atlassian.com/jira/mcp",
    transport: "http",
  },
  {
    server: "Confluence",
    prefixes: ["confluence_"],
    url: "https://mcp.atlassian.com/confluence/mcp",
    transport: "http",
  },
  {
    server: "Figma",
    prefixes: ["figma_"],
    url: "https://mcp.figma.com/mcp",
    transport: "http",
  },
  {
    server: "Sentry",
    prefixes: ["sentry_"],
    url: "https://mcp.sentry.dev/mcp",
    transport: "http",
  },
];

function buildConfigSnippet(serverKey: string, url: string): string {
  return JSON.stringify(
    { mcpServers: { [serverKey.toLowerCase()]: { type: "http", url } } },
    null,
    2,
  );
}

function parseFrontmatterField(content: string, field: string): string[] {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return [];
  const fm = fmMatch[1];

  // Try YAML list: field:\n  - val1\n  - val2
  const listMatch = fm.match(new RegExp(`${field}:\\s*\\n((?:\\s+-\\s+.+\\n?)+)`));
  if (listMatch) {
    return listMatch[1]
      .split("\n")
      .map((l) => l.replace(/^\s*-\s*/, "").trim())
      .filter(Boolean);
  }

  // Try inline: field: [val1, val2] or field: val1, val2
  const inlineMatch = fm.match(new RegExp(`${field}:\\s*\\[?([^\\]\\n]+)\\]?`));
  if (inlineMatch) {
    return inlineMatch[1]
      .split(",")
      .map((s) => s.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
  }

  return [];
}

function extractToolNames(content: string): string[] {
  const tools: Set<string> = new Set();

  // From frontmatter allowed-tools
  for (const tool of parseFrontmatterField(content, "allowed-tools")) {
    tools.add(tool);
  }

  // Scan body for tool-like patterns (word_word format matching known prefixes)
  const body = content.replace(/^---\n[\s\S]*?\n---/, "");
  for (const entry of MCP_REGISTRY) {
    for (const prefix of entry.prefixes) {
      const regex = new RegExp(`\\b(${prefix.replace("_", "_")}\\w+)\\b`, "g");
      let match;
      while ((match = regex.exec(body)) !== null) {
        tools.add(match[1]);
      }
    }
  }

  return Array.from(tools);
}

export function detectMcpDependencies(content: string): McpDependency[] {
  const toolNames = extractToolNames(content);
  const deps: McpDependency[] = [];

  for (const entry of MCP_REGISTRY) {
    const matched = toolNames.filter((tool) =>
      entry.prefixes.some((prefix) => tool.startsWith(prefix)),
    );
    if (matched.length === 0) continue;

    deps.push({
      server: entry.server,
      url: entry.url,
      transport: entry.transport,
      matchedTools: [...new Set(matched)],
      configSnippet: buildConfigSnippet(entry.server, entry.url),
    });
  }

  return deps;
}

export function detectSkillDependencies(content: string): SkillDependency[] {
  const deps: SkillDependency[] = [];
  const seen = new Set<string>();

  // From frontmatter dependencies field
  for (const dep of parseFrontmatterField(content, "dependencies")) {
    if (!seen.has(dep)) {
      seen.add(dep);
      deps.push({ name: dep, source: "frontmatter" });
    }
  }

  // Scan body for skill references
  const body = content.replace(/^---\n[\s\S]*?\n---/, "");

  // Pattern: "use the X skill", "chains with X", "requires the X skill"
  const patterns = [
    /\buses?\s+the\s+([\w-]+)\s+skill\b/gi,
    /\bchains?\s+with\s+([\w-]+)\b/gi,
    /\brequires?\s+the\s+([\w-]+)\s+skill\b/gi,
    /\bdepends?\s+on\s+the\s+([\w-]+)\s+skill\b/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(body)) !== null) {
      const name = match[1].toLowerCase();
      if (!seen.has(name)) {
        seen.add(name);
        deps.push({ name, source: "body-reference" });
      }
    }
  }

  return deps;
}
