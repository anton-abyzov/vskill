<p align="center">
  <img src="https://img.shields.io/npm/v/vskill?color=cb3837&label=npm&logo=npm" alt="npm version" />
  <img src="https://img.shields.io/npm/dw/vskill?color=cb3837&logo=npm" alt="npm downloads" />
  <img src="https://img.shields.io/badge/agents-49_platforms-blue?logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiIgdmlld0JveD0iMCAwIDE2IDE2Ij48cGF0aCBmaWxsPSJ3aGl0ZSIgZD0iTTggMWE3IDcgMCAxIDAgMCAxNEE3IDcgMCAwIDAgOCAxem0wIDEyLjVhNS41IDUuNSAwIDEgMSAwLTExIDUuNSA1LjUgMCAwIDEgMCAxMXoiLz48L3N2Zz4=" alt="49 agent platforms" />
  <img src="https://img.shields.io/badge/plugins-12_domains-8B5CF6" alt="12 plugins" />
  <img src="https://img.shields.io/badge/skills-41_experts-10B981" alt="41 skills" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT license" />
  <img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen?logo=node.js" alt="Node.js >= 20" />
</p>

# vskill

**Secure multi-platform AI skill installer.** Scan before you install.

> **36.82% of AI skills have security flaws** ([Snyk ToxicSkills](https://snyk.io/blog/toxicskills-malicious-ai-agent-skills-clawhub/)). Zero versioning on major platforms means updates can inject malware silently. vskill fixes this with **three-tier verification**, **version-pinned trust**, and a **blocklist** of known-malicious skills.

```bash
npx vskill install remotion-dev/skills                           # all skills from a repo
npx vskill install remotion-dev/skills/remotion-best-practices   # specific skill
npx vskill install remotion-best-practices                       # registry lookup
```

---

## Key Features

| | Feature | Description |
|---|---------|-------------|
| **Security** | Three-tier verification | Pattern scanning + LLM intent analysis + manual review |
| **Security** | Blocklist protection | Known-malicious skills blocked by default |
| **Security** | Version pinning | SHA-locked `vskill.lock` — diff scanning on every update |
| **Reach** | 49 agent platforms | Claude Code, Cursor, Copilot, Windsurf, Gemini CLI, Amp, Cline, and 42 more |
| **Ecosystem** | Plugin marketplace | 41 expert skills across 12 domain plugins |
| **Ecosystem** | Registry integration | Browse and install from [verified-skill.com](https://verified-skill.com) |
| **DX** | Interactive prompts | Agent selection, scope, method — or `--yes` for CI |
| **DX** | Deduplication | Detects and prevents duplicate skill installations |

---

## Quick Start

```bash
# Install globally
npm install -g vskill

# Or use directly with npx
npx vskill install <source>
```

### Install a Skill

```bash
# From any GitHub repo
vskill install remotion-dev/skills/remotion-best-practices

# From the registry
vskill install remotion-best-practices

# Browse a repo and pick skills interactively
vskill install remotion-dev/skills
```

### Install a Plugin (Claude Code)

```bash
# Install a domain plugin
npx vskill install --repo anton-abyzov/vskill --plugin frontend

# Install multiple plugins
npx vskill install --repo anton-abyzov/vskill --plugin mobile
npx vskill install --repo anton-abyzov/vskill --plugin infra
```

---

## Plugin Marketplace

This repo ships a **Claude Code plugin marketplace** — 41 expert skills across 12 domain plugins. Install only the plugins you need.

Each plugin has its own namespace. Skills are invoked as `/plugin:skill`:

```
/frontend:nextjs      /ml:rag           /mobile:flutter
/backend:java-spring  /infra:aws        /testing:performance
```

### Plugins & Skills

| Plugin | Skills | Focus |
|--------|--------|-------|
| **frontend** | `frontend-core` `design` `figma` `i18n` `nextjs` | React 19, Next.js, design systems, Figma, i18n |
| **backend** | `java-spring` `rust` | Java Spring Boot, Rust |
| **infra** | `aws` `azure` `gcp` `github-actions` `devsecops` `opentelemetry` `secrets` | Cloud, CI/CD, observability, secrets |
| **mobile** | `react-native` `expo` `flutter` `swiftui` `jetpack` `capacitor` `deep-linking` `testing` `appstore` | Cross-platform mobile, native iOS/Android, app store |
| **ml** | `rag` `langchain` `huggingface` `fine-tuning` `edge` | RAG pipelines, LangChain, Hugging Face, edge ML |
| **testing** | `performance` `accessibility` `mutation` | Performance, a11y, mutation testing |
| **kafka** | `streams-topology` `n8n` | Kafka Streams, n8n workflow automation |
| **confluent** | `kafka-connect` `ksqldb` `schema-registry` | Confluent platform connectors |
| **payments** | `billing` `pci` | Billing, subscriptions, PCI compliance |
| **security** | `patterns` | Real-time vulnerability pattern detection |
| **blockchain** | `blockchain-core` | Solidity, Foundry, smart contract security |
| **skills** | `scout` | Skill discovery and recommendations |

---

## Three-Tier Verification

Every skill is scanned before installation. No exceptions.

```
                ┌─────────────────────────────────────────┐
                │          THREE-TIER VERIFICATION         │
                ├─────────────┬─────────────┬─────────────┤
                │  SCANNED    │  VERIFIED   │  CERTIFIED  │
                │             │             │             │
                │  38 pattern │  + LLM      │  + manual   │
                │  checks     │  intent     │  security   │
                │             │  analysis   │  review     │
                │             │             │             │
                │  Basic      │  Recommended│  Highest    │
                │  Trust      │             │  Trust      │
                └─────────────┴─────────────┴─────────────┘
```

- **Tier 1 — Scanned**: 38 deterministic pattern checks against known attack vectors
- **Tier 2 — Verified**: Scanner + LLM-based intent analysis for subtle threats
- **Tier 3 — Certified**: Full manual security review by the vskill team

---

## Version Pinning

Every install creates a `vskill.lock` with SHA-256 hash, scan date, and verification tier. When you run `vskill update`, the diff is scanned before applying — new patterns are flagged before they reach your machine.

```json
{
  "remotion-best-practices": {
    "sha": "a1b2c3d4...",
    "tier": "scanned",
    "scannedAt": "2026-02-27T10:00:00Z",
    "source": "remotion-dev/skills"
  }
}
```

---

## 49 Agent Platforms

Install skills to any AI coding tool. vskill auto-detects installed agents and lets you choose where to install.

**Terminal agents**: Claude Code, Cursor, GitHub Copilot, Windsurf, Codex, Gemini CLI, Cline, Amp, Roo Code, Kilo, Goose, Aider, Devin, and more

**IDE agents**: VS Code, JetBrains, Zed, Neovim, Sublime Text, Xcode

**Cloud agents**: Replit, Bolt, v0, GPT Pilot

---

## Commands

| Command | Description |
|---------|-------------|
| `install <source>` | Install skill after security scan (aliases: `add`, `i`) |
| `find <query>` | Search the verified-skill.com registry (alias: `search`) |
| `scan <path>` | Run security scan without installing |
| `list` | Show installed skills with verification status |
| `remove <skill>` | Remove an installed skill |
| `update [skill]` | Update with diff scanning (`--all` for everything) |
| `submit <source>` | Submit a skill for verification |
| `audit [path]` | Full security audit with LLM analysis |
| `info <skill>` | Show detailed skill information |
| `blocklist` | Manage blocked malicious skills |
| `init` | Initialize vskill in a project |

### Install Flags

| Flag | Description |
|------|-------------|
| `--yes` / `-y` | Accept all defaults, skip prompts |
| `--global` / `-g` | Install to global scope (`~/.<agent>/commands/`) |
| `--copy` | Copy files instead of symlinking |
| `--skill <name>` | Select a specific skill from a multi-skill repo |
| `--plugin <name>` | Install a specific plugin from a marketplace repo |
| `--plugin-dir <path>` | Use a local directory as plugin source |
| `--repo <owner/repo>` | Use a remote GitHub repo as plugin source |
| `--agent <id>` | Target a specific agent (e.g., `--agent cursor`) |
| `--force` | Install even if blocklisted |
| `--cwd <path>` | Override project root directory |
| `--all` | Install all skills from a multi-skill repo |

---

## Install Formats

### GitHub repos

```bash
# All skills from a repo (interactive selection)
vskill install remotion-dev/skills

# Specific skill (3-part path)
vskill install remotion-dev/skills/remotion-best-practices

# Specific skill (flag)
vskill install remotion-dev/skills --skill remotion-best-practices
```

### Registry

```bash
# Lookup by name — resolves via verified-skill.com
vskill install remotion-best-practices
```

### Plugins

```bash
# Remote plugin from GitHub
vskill install --repo anton-abyzov/vskill --plugin frontend

# Local plugin from cloned directory
vskill install --plugin-dir ./vskill --plugin frontend
```

> Works with `npx`, `bunx`, `pnpx`, or `yarn dlx` if not installed globally.

---

## Skills vs Plugins

**Skills** are single SKILL.md files that work with any AI agent. They follow the [Agent Skills Standard](https://agentskills.io) — a SKILL.md file placed in the agent's commands directory (`.claude/commands/`, `.cursor/commands/`, etc.).

**Plugins** are multi-component containers for Claude Code. A plugin repo has `.claude-plugin/marketplace.json` listing sub-plugins, each with skills, hooks, commands, and agents. Plugins enable `plugin:skill` namespacing, enable/disable support, and marketplace integration.

---

## The Duplication Problem

The skills ecosystem is fragmented. Even Anthropic has the same skill in two places:

- **Standalone**: [`anthropics/skills`](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md)
- **Bundled in plugin**: [`anthropics/claude-code`](https://github.com/anthropics/claude-code/blob/main/plugins/frontend-design/skills/frontend-design/SKILL.md)

Same `frontend-design` skill, two repos. Install both and you get duplicates. They diverge and you get inconsistencies. vskill gives you a single install path with version pinning and deduplication, regardless of where the skill is published.

---

## Security Audit

Scan entire projects for security issues — not just skills:

```bash
# Audit current directory
vskill audit

# CI-friendly output (SARIF v2.1.0)
vskill audit --ci --report sarif

# Filter by severity
vskill audit --severity high,critical
```

---

## Registry

Browse verified skills at **[verified-skill.com](https://verified-skill.com)**.

```bash
# Search from the CLI
vskill find "react native"

# Get details on a specific skill
vskill info remotion-best-practices
```

---

## Contributing

Skills and plugins are welcome. Submit your skill for verification:

```bash
vskill submit your-org/your-repo/your-skill
```

---

## License

[MIT](LICENSE)
