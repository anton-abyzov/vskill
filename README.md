# vskill

**Secure multi-platform AI skill installer.** Scan before you install.

```bash
npx vskill install remotion-dev/skills                           # all skills from a repo
npx vskill install remotion-dev/skills/remotion-best-practices   # specific skill (3-part)
npx vskill install remotion-best-practices                       # registry lookup
```

## Claude Code Plugin Marketplace

This repo is a **Claude Code plugin marketplace** — 75 expert skills across 15 domain plugins for frontend, backend, infra, ML, mobile, testing, and more. Install only the plugins you need.

### Install

```bash
# Install a specific plugin (recommended)
npx vskill install --repo anton-abyzov/vskill --plugin frontend

# Install multiple plugins
npx vskill install --repo anton-abyzov/vskill --plugin backend
npx vskill install --repo anton-abyzov/vskill --plugin testing

# From a local clone
git clone https://github.com/anton-abyzov/vskill.git
npx vskill install --plugin-dir ./vskill --plugin frontend
```

### Prefix

Each plugin has its own namespace. Skills are invoked as `plugin:skill`:

```
/frontend:nextjs
/backend:nodejs
/ml:rag
/testing:e2e
/scout:core
```

When installed as **standalone skills** (without the plugin), no prefix:

```
/nextjs
/nodejs
/rag
```

### Plugins (15) & Skills (75)

| Plugin | Skills |
|--------|--------|
| frontend | `core`, `architect`, `design`, `design-system`, `nextjs`, `figma`, `code-explorer`, `i18n` |
| backend | `nodejs`, `python`, `dotnet`, `go`, `rust`, `java-spring`, `graphql`, `db-optimizer` |
| infra | `terraform`, `aws`, `azure`, `gcp`, `github-actions`, `devops`, `devsecops`, `secrets`, `observability`, `opentelemetry` |
| mobile | `react-native`, `expo`, `flutter`, `swiftui`, `jetpack`, `capacitor`, `deep-linking`, `testing`, `appstore` |
| ml | `engineer`, `mlops`, `data-scientist`, `fine-tuning`, `rag`, `langchain`, `huggingface`, `edge`, `specialist` |
| testing | `unit`, `e2e`, `performance`, `accessibility`, `mutation`, `qa` |
| k8s | `manifests`, `helm`, `gitops`, `security` |
| payments | `core`, `billing`, `pci` |
| cost | `cloud-pricing`, `optimization`, `aws` |
| kafka | `architect`, `ops`, `streams-topology`, `n8n` |
| confluent | `kafka-connect`, `ksqldb`, `schema-registry` |
| docs | `docusaurus`, `technical-writing`, `brainstorming` |
| security | `core`, `patterns`, `simplifier` |
| scout | `core` |
| blockchain | `core` |

## Why?

- **36.82% of AI skills have security flaws** ([Snyk ToxicSkills](https://snyk.io/blog/toxicskills-malicious-ai-agent-skills-clawhub/))
- Zero versioning on major platforms — updates can inject malware silently
- No pre-install scanning — you're trusting blindly

vskill fixes this with **three-tier verification** and **version-pinned trust**.

## Install Formats

### 1. All skills from a repo

```bash
vskill install remotion-dev/skills
```

Discovers all SKILL.md files in the repo via GitHub Trees API. You'll be prompted to select which skills to install.

### 2. Specific skill (3-part format)

```bash
vskill install remotion-dev/skills/remotion-best-practices
```

Installs a single skill directly. The path maps to `owner/repo/skill-name`, where `skill-name` is the directory containing `SKILL.md`.

### 3. Specific skill (flag format)

```bash
vskill install remotion-dev/skills --skill remotion-best-practices
```

Equivalent to the 3-part format above.

### 4. Registry lookup

```bash
vskill install remotion-best-practices
```

Looks up the skill in the [verified-skill.com](https://verified-skill.com) registry and installs from the mapped source repo.

### 5. Local plugin

```bash
vskill install . --plugin-dir . --plugin sw-frontend
```

Installs a plugin from a local directory containing `.claude-plugin/marketplace.json`. The `--plugin` flag selects which sub-plugin to install.

### 6. Remote plugin

```bash
vskill install . --repo specweave/specweave --plugin sw-frontend
```

Clones a GitHub repo and installs a plugin from it. Combines `--repo` with `--plugin` to target a specific sub-plugin.

> Replace `vskill` with `npx vskill`, `bunx vskill`, `pnpx vskill`, or `yarn dlx vskill` if not installed globally.

## Interactive Prompts

When run in a terminal, vskill prompts you interactively:

- **Agent selection** — checkboxes for detected AI agents (pre-checked). Supports 49 agents with scrolling viewport.
- **Scope** — Project (`./<agent>/commands/`) or Global (`~/.<agent>/commands/`)
- **Method** — Symlink (default, saves disk) or Copy (for agents that need it)
- **Skill selection** — when a repo has multiple skills, pick which ones to install
- **Claude Code native plugin** — when installing a plugin with Claude Code detected, choose native plugin install (recommended) or skill extraction

All prompts can be skipped with `--yes` (accept defaults) or controlled via flags (`--global`, `--copy`, `--agent`).

## Commands

| Command | Description |
|---------|-------------|
| `install <source>` | Install skill after security scan (aliases: `add`, `i`) |
| `find <query>` | Search the registry (alias: `search`) |
| `scan <path>` | Scan without installing |
| `list` | Show installed skills with status |
| `remove <skill>` | Remove an installed skill |
| `update [skill]` | Update with diff scanning |
| `submit <source>` | Submit for verification |
| `audit [path]` | Security audit with LLM analysis |
| `info <skill>` | Show skill details |
| `blocklist` | Manage blocked skills |
| `init` | Initialize vskill in a project |

### Install flags

| Flag | Description |
|------|-------------|
| `--yes` / `-y` | Accept all defaults, no prompts |
| `--global` / `-g` | Install to global scope |
| `--copy` | Copy files instead of symlinking |
| `--skill <name>` | Select a specific skill from a multi-skill repo |
| `--plugin <name>` | Select a sub-plugin from a plugin repo |
| `--plugin-dir <path>` | Use a local directory as plugin source |
| `--repo <owner/repo>` | Use a remote GitHub repo as plugin source |
| `--agent <id>` | Target a specific agent (e.g., `--agent cursor`) |
| `--force` | Install even if blocklisted |
| `--cwd <path>` | Override project root directory |

## Skills vs Plugins

**Skills** are single SKILL.md files that work with any AI agent. They follow the [Agent Skills Standard](https://agentskills.io) — a SKILL.md file is placed in the agent's commands directory (e.g., `.claude/commands/`, `.cursor/commands/`).

**Plugins** are multi-component containers exclusive to Claude Code. A plugin repo has `.claude-plugin/marketplace.json` listing sub-plugins, each containing skills, hooks, commands, and agents. Plugins enable `plugin-name:skill-name` namespacing, enable/disable support, and marketplace integration.

## The Skills Duplication Problem

The skills ecosystem is already fragmented. Skills can be defined in different repos, published through different channels, and there's no single source of truth.

Even Anthropic has the same skill defined in two different places:

- **As a standalone skill**: [`anthropics/skills`](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md)
- **Inside a plugin**: [`anthropics/claude-code`](https://github.com/anthropics/claude-code/blob/main/plugins/frontend-design/skills/frontend-design/SKILL.md)

Same `frontend-design` skill, two repos. One is used by installing it as a standalone skill, the other comes bundled in a plugin. If you install both, you get duplicates. If they diverge, you get inconsistencies.

This is one of the reasons vskill exists — to give you a single install path with version pinning and deduplication, regardless of where the skill is published.

## Claude Code Native Plugin Install

When vskill detects a plugin repo and Claude Code is among your selected agents, it offers **native plugin install**:

1. vskill runs its security scan first (always)
2. Registers the plugin directory as a marketplace: `claude plugin marketplace add <path>`
3. Installs the plugin natively: `claude plugin install <plugin>@<marketplace>`

**Benefits**: `marketplace:plugin-name` namespacing, `claude plugin enable/disable`, marketplace management.

Native install is available for local plugins (`--plugin-dir`) only. Remote plugins (`--repo`) fall back to skill extraction. Use `--copy` to skip native install and extract skills individually.

## 49 Agent Platforms

Works across Claude Code, Cursor, GitHub Copilot, Windsurf, Codex, Gemini CLI, Cline, Amp, Roo Code, and 40 more — including universal agents (VS Code, JetBrains, Zed, Neovim, Emacs, Sublime Text, Xcode).

## Three-Tier Verification

| Tier | Method | Badge |
|------|--------|-------|
| **Scanned** | 38 deterministic pattern checks | Basic Trust |
| **Verified** | Scanner + LLM intent analysis | Recommended |
| **Certified** | Full manual security review | Highest Trust |

## Version Pinning

Every install creates a `vskill.lock` with SHA, scan date, and tier. Updates run diff scanning — new patterns flagged before install.

## Registry

Browse verified skills at [verified-skill.com](https://verified-skill.com).

## License

MIT
