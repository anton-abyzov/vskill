<h1 align="center">vskill</h1>

<p align="center">
  <strong>The package manager for AI skills.</strong><br/>
  Scan. Verify. Install. Across 49 agent platforms.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/vskill"><img src="https://img.shields.io/npm/v/vskill?color=cb3837&logo=npm" alt="npm" /></a>
  <a href="https://www.npmjs.com/package/vskill"><img src="https://img.shields.io/npm/dw/vskill?color=cb3837&logo=npm&label=downloads" alt="downloads" /></a>
  <img src="https://img.shields.io/badge/agents-49_platforms-0969DA" alt="49 agents" />
  <img src="https://img.shields.io/badge/plugins-12-8B5CF6" alt="12 plugins" />
  <img src="https://img.shields.io/badge/skills-41-10B981" alt="41 skills" />
  <a href="https://verified-skill.com"><img src="https://img.shields.io/badge/registry-verified--skill.com-F59E0B" alt="registry" /></a>
  <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT" />
</p>

<br/>

```bash
npx vskill install remotion-best-practices
```

<br/>

## The Problem

**36.82% of AI skills have security flaws** ([Snyk ToxicSkills](https://snyk.io/blog/toxicskills-malicious-ai-agent-skills-clawhub/)).

When you install a skill today, you're trusting blindly:

- **No scanning** — malicious prompts execute with full system access
- **No versioning** — silent updates can inject anything, anytime
- **No deduplication** — the same skill lives in 3 repos, all diverging
- **No blocklist** — known-bad skills install just fine

vskill fixes all of this.

<br/>

## How It Works

```
  ┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
  │  Source   │────>│   Scan   │────>│  Verify  │────>│ Install  │
  │          │     │          │     │          │     │          │
  │ GitHub   │     │ 38 rules │     │ LLM      │     │ Pin SHA  │
  │ Registry │     │ Blocklist│     │ analysis │     │ Lock ver │
  │ Local    │     │ Patterns │     │ Intent   │     │ Symlink  │
  └──────────┘     └──────────┘     └──────────┘     └──────────┘
```

Every install goes through the security pipeline. No exceptions. No `--skip-scan`.

<br/>

## Quick Start

```bash
# Install from any GitHub repo
npx vskill install remotion-dev/skills/remotion-best-practices

# Install by name (registry lookup)
npx vskill install remotion-best-practices

# Browse a repo and pick interactively
npx vskill install remotion-dev/skills

# Install a plugin (Claude Code)
npx vskill install --repo anton-abyzov/vskill --plugin frontend
```

Or install globally: `npm install -g vskill`

<br/>

## Three-Tier Verification

| Tier | How | Trust Level |
|:-----|:----|:------------|
| **Scanned** | 38 deterministic pattern checks against known attack vectors | Baseline |
| **Verified** | Pattern scan + LLM-based intent analysis for subtle threats | Recommended |
| **Certified** | Full manual security review by the vskill team | Highest |

Every install is at minimum **Scanned**. The `vskill.lock` file tracks the SHA-256 hash, scan date, and tier for every installed skill. Running `vskill update` diffs against the locked version and re-scans before applying.

<br/>

## 49 Agent Platforms

vskill auto-detects your installed agents and installs skills to all of them at once.

**CLI & Terminal** — Claude Code, Cursor, GitHub Copilot, Windsurf, Codex, Gemini CLI, Amp, Cline, Roo Code, Goose, Aider, Kilo, Devin, OpenHands, Qwen Code, Trae, and more

**IDE Extensions** — VS Code, JetBrains, Zed, Neovim, Emacs, Sublime Text, Xcode

**Cloud & Hosted** — Replit, Bolt, v0, GPT Pilot, Plandex, Sweep

<br/>

## Plugin Marketplace

vskill ships **41 expert skills** organized into **12 domain plugins**. Each plugin has its own namespace — install only what you need.

```bash
npx vskill install --repo anton-abyzov/vskill --plugin frontend
npx vskill install --repo anton-abyzov/vskill --plugin infra
```

Then invoke as `/plugin:skill` in your agent:

```
/frontend:nextjs     /infra:aws        /mobile:flutter
/ml:rag              /testing:mutation  /security:patterns
```

### Available Plugins

<table>
<tr>
<td width="50%" valign="top">

**frontend** — React 19, Next.js, Figma, i18n, design systems
- `frontend-core` `design` `figma` `i18n` `nextjs`

**backend** — Java Spring Boot, Rust
- `java-spring` `rust`

**infra** — AWS, Azure, GCP, CI/CD, secrets, observability
- `aws` `azure` `gcp` `github-actions` `devsecops` `opentelemetry` `secrets`

**mobile** — React Native, Flutter, SwiftUI, Jetpack, app store
- `react-native` `expo` `flutter` `swiftui` `jetpack` `capacitor` `deep-linking` `testing` `appstore`

**ml** — RAG, LangChain, Hugging Face, fine-tuning, edge ML
- `rag` `langchain` `huggingface` `fine-tuning` `edge`

**testing** — Performance, accessibility, mutation testing
- `performance` `accessibility` `mutation`

</td>
<td width="50%" valign="top">

**kafka** — Kafka Streams, n8n workflows
- `streams-topology` `n8n`

**confluent** — Kafka Connect, ksqlDB, Schema Registry
- `kafka-connect` `ksqldb` `schema-registry`

**payments** — Billing, subscriptions, PCI compliance
- `billing` `pci`

**security** — Vulnerability pattern detection
- `patterns`

**blockchain** — Solidity, Foundry, smart contracts
- `blockchain-core`

**skills** — Skill discovery and recommendations
- `scout`

</td>
</tr>
</table>

<br/>

## Commands

```
vskill install <source>     Install skill after security scan
vskill find <query>         Search the verified-skill.com registry
vskill scan <path>          Run security scan without installing
vskill list                 Show installed skills with status
vskill remove <skill>       Remove an installed skill
vskill update [skill]       Update with diff scanning (--all for everything)
vskill audit [path]         Full project security audit with LLM analysis
vskill info <skill>         Show detailed skill information
vskill submit <source>      Submit a skill for verification
vskill blocklist            Manage blocked malicious skills
vskill init                 Initialize vskill in a project
```

<details>
<summary><strong>Install flags</strong></summary>

| Flag | Description |
|:-----|:------------|
| `--yes` `-y` | Accept defaults, no prompts |
| `--global` `-g` | Install to global scope |
| `--copy` | Copy files instead of symlinking |
| `--skill <name>` | Pick a specific skill from a multi-skill repo |
| `--plugin <name>` | Pick a plugin from a marketplace repo |
| `--plugin-dir <path>` | Local directory as plugin source |
| `--repo <owner/repo>` | Remote GitHub repo as plugin source |
| `--agent <id>` | Target a specific agent (e.g., `cursor`) |
| `--force` | Install even if blocklisted |
| `--cwd <path>` | Override project root |
| `--all` | Install all skills from a repo |

</details>

<br/>

## Security Audit

Scan entire projects for security issues — not just skills:

```bash
vskill audit                              # scan current directory
vskill audit --ci --report sarif          # CI-friendly SARIF output
vskill audit --severity high,critical     # filter by severity
```

<br/>

## Skills vs Plugins

**Skills** are single `SKILL.md` files that work with any of the 49 supported agents. They follow the [Agent Skills Standard](https://agentskills.io) — drop a `SKILL.md` into the agent's commands directory.

**Plugins** are multi-component containers for Claude Code. They bundle skills, hooks, commands, and agents under a single namespace with enable/disable support and marketplace integration.

<br/>

## Why Deduplication Matters

Even Anthropic ships the same skill in two places:

- [`anthropics/skills/frontend-design`](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md) (standalone)
- [`anthropics/claude-code/.../frontend-design`](https://github.com/anthropics/claude-code/blob/main/plugins/frontend-design/skills/frontend-design/SKILL.md) (plugin)

Install both? Duplicates. They diverge? Inconsistencies. vskill gives you one install path with version pinning and dedup, regardless of source.

<br/>

## Registry

Browse and search verified skills at **[verified-skill.com](https://verified-skill.com)**.

```bash
vskill find "react native"          # search from CLI
vskill info remotion-best-practices # skill details
```

<br/>

## Contributing

Submit your skill for verification:

```bash
vskill submit your-org/your-repo/your-skill
```

<br/>

## License

[MIT](LICENSE)
