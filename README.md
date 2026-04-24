<h1 align="center">vskill</h1>

<p align="center">
  <strong>The package manager for AI skills.</strong><br/>
  Scan. Verify. Install. Across 49 agent platforms.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/vskill"><img src="https://img.shields.io/npm/v/vskill?color=cb3837&logo=npm" alt="npm" /></a>
  <a href="https://www.npmjs.com/package/vskill"><img src="https://img.shields.io/npm/dw/vskill?color=cb3837&logo=npm&label=downloads" alt="downloads" /></a>
  <img src="https://img.shields.io/badge/agents-49_platforms-0969DA" alt="49 agents" />
  <img src="https://img.shields.io/badge/plugins-5-8B5CF6" alt="5 plugins" />
  <img src="https://img.shields.io/badge/skills-7-10B981" alt="7 skills" />
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

# Browse a repo and pick interactively
npx vskill install remotion-dev/skills

# Install a plugin (Claude Code)
npx vskill install --repo anton-abyzov/vskill --plugin mobile
```

Or install globally: `npm install -g vskill`

> **Getting E401 errors?** If your project has a `.npmrc` pointing to a private registry (e.g. AWS CodeArtifact, GitHub Packages), npx may fail with `npm error code E401`. Fix it by overriding the registry:
> ```bash
> npx --registry https://registry.npmjs.org vskill install <skill>
> ```
> Or install globally once to avoid this entirely: `npm i -g vskill --registry https://registry.npmjs.org`

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

vskill ships **7 expert skills** organized into **5 domain plugins**. Each plugin has its own namespace — install only what you need.

```bash
npx vskill install --repo anton-abyzov/vskill --plugin mobile
npx vskill install --repo anton-abyzov/vskill --plugin marketing
```

Then invoke as `/plugin:skill` in your agent:

```
/mobile:appstore             /marketing:social-media-posting
/google-workspace:gws        /skills:scout
```

### Available Plugins

| Plugin | Description | Skills |
|--------|-------------|--------|
| **mobile** | React Native, Expo, Flutter, SwiftUI, Jetpack Compose, app store | `appstore` |
| **marketing** | Social media content creation, posting, and engagement across 11 platforms, plus Slack messaging | `social-media-posting` `slack-messaging` |
| **google-workspace** | Google Workspace CLI (gws) for Drive, Sheets, Docs, Calendar, Chat, Admin | `gws` |
| **skills** | Skill discovery and recommendations | `scout` |
| **productivity** | Expert network survey completion and paid expertise sharing | `survey-passing` |

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
| `--plugin <name>` | Pick a plugin by name (checks marketplace, then plugins/ folder) |
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

## Skill Evals

Every skill can include evaluations — standardized test cases that verify the skill actually improves LLM output. Skills with evals get quality scores on [verified-skill.com](https://verified-skill.com) and regression tracking across versions.

### How it works

**The eval system tests the skill's plan, not its execution.** It doesn't post to social media, generate images, or call external APIs. Instead, it measures whether your SKILL.md successfully teaches an LLM the correct behavior.

The algorithm:

1. Your **SKILL.md** is loaded as a system prompt
2. The **eval prompt** (a realistic user request) is sent to the LLM
3. The LLM generates a **text response** describing what it would do
4. An **LLM judge** grades each assertion against that response

For example, a social media posting skill's eval might check: does the LLM mention checking for duplicate posts? Does it use the correct aspect ratios per platform? Does it wait for user approval? If the skill description is clear about these behaviors, the LLM will demonstrate them in its response. If it's vague, assertions fail — telling you exactly what to improve.

Think of it like testing a recipe book: you don't cook the food, you check whether someone reading your recipe would know the right steps, quantities, and order.

### Three evaluation modes

| Mode | What it does | When to use |
|------|-------------|-------------|
| **Benchmark** | Runs prompts WITH skill, grades assertions | Measure pass rate after edits |
| **A/B Comparison** | Runs each prompt WITH and WITHOUT skill, blind-judges both | Prove the skill adds value |
| **Activation Test** | Tests whether the skill correctly triggers on relevant prompts | Reduce false positives/negatives |

The **A/B comparison** randomly shuffles outputs as "Response A" and "Response B" before scoring, so the judge can't tell which used the skill. Each response is scored on content (1-5) and structure (1-5). The delta between skill and baseline averages produces a verdict: EFFECTIVE, MARGINAL, INEFFECTIVE, or DEGRADING.

### Unit testing vs integration testing

Skill evals are **unit tests** — they verify the skill's teaching quality in isolation, without calling external tools or APIs. This is a deliberate design choice:

| | Unit Tests (current) | Integration Tests |
|:---|:---|:---|
| **What** | Does the SKILL.md teach the right workflow? | Does the end-to-end tool execution work? |
| **Speed** | ~30s per case | ~3min per case |
| **Infrastructure** | None — any LLM provider | Real MCP servers, auth tokens, test data |
| **CI/CD** | Runs anywhere | Needs secrets, test workspaces |
| **Flakiness** | Low (deterministic text) | High (external APIs, rate limits) |
| **Coverage** | Workflow, tool selection, formatting, parameters | API compatibility, auth, error recovery |

**Why unit tests are sufficient for most skills:** The eval doesn't test whether Slack's API works — it tests whether your SKILL.md correctly teaches an LLM to use `slack_search_channels` before `slack_read_channel`, to use `thread_ts` for replies, and to format messages with `*bold*` instead of `**bold**`. If the teaching is correct, the execution follows.

#### MCP-dependent skills (Slack, GitHub, Linear, etc.)

Skills that reference MCP tools automatically get **simulation mode** during evals. The eval system detects MCP tool references in your SKILL.md and instructs the LLM to demonstrate the complete workflow with simulated tool responses. This means your assertions can test tool selection, parameter correctness, and workflow order — even without a real MCP connection.

```
Standard skill eval:               MCP skill eval (automatic):
┌──────────┐                        ┌──────────┐
│ SKILL.md │ → system prompt        │ SKILL.md │ → system prompt
└──────────┘                        └──────────┘   + simulation instructions
     ↓                                    ↓
┌──────────┐                        ┌──────────┐
│ LLM      │ → text response        │ LLM      │ → simulated workflow
└──────────┘                        └──────────┘   (tool calls + mock responses)
     ↓                                    ↓
┌──────────┐                        ┌──────────┐
│ Judge    │ → pass/fail            │ Judge    │ → pass/fail
└──────────┘                        └──────────┘
```

No configuration needed — if your SKILL.md mentions `slack_*`, `github_*`, `linear_*`, or `gws_*` tools, simulation mode activates automatically.

#### Activation testing

Skills can also include trigger accuracy tests in `evals/activation-prompts.json`:

```json
{
  "prompts": [
    { "prompt": "check what's new in #engineering", "expected": "should_activate" },
    { "prompt": "send an email to the team", "expected": "should_not_activate" }
  ]
}
```

This tests whether your skill's `description` field in SKILL.md causes the skill to trigger on the right prompts (precision) and not miss relevant ones (recall). Results show TP/TN/FP/FN classification with precision, recall, and reliability metrics.

#### Cross-model testing

The eval system supports Claude (CLI or API), Anthropic API, and Ollama. Testing across models reveals:
- Whether your skill helps **weaker models** (Llama, Qwen) follow complex workflows
- Whether base model improvements have made a skill **unnecessary**
- Whether your simulation instructions are **clear enough** for smaller models

```bash
# Test with Opus (high-end)
VSKILL_EVAL_MODEL=opus npx vskill eval run my-skill

# Test with Ollama (open-source)
VSKILL_EVAL_PROVIDER=ollama VSKILL_EVAL_MODEL=llama3.1:8b npx vskill eval run my-skill
```

### Directory structure

```
your-skill/
├── SKILL.md                          # The skill definition
└── evals/
    ├── evals.json                    # Test cases + assertions
    ├── activation-prompts.json       # Trigger accuracy tests (optional)
    └── benchmark.json                # Latest benchmark results (auto-generated)
```

### evals.json format

```json
{
  "skill_name": "your-skill",
  "evals": [
    {
      "id": 1,
      "name": "Descriptive test name",
      "prompt": "Realistic user prompt that tests the skill",
      "expected_output": "Reference output (not graded, for human context)",
      "files": [],
      "assertions": [
        { "id": "a1", "text": "Output includes specific technique X", "type": "boolean" },
        { "id": "a2", "text": "Code example compiles without errors", "type": "boolean" }
      ]
    }
  ]
}
```

### Writing good evals

- **Prompts** should be realistic user requests, not synthetic test inputs
- **Assertions** must be objectively verifiable — avoid subjective criteria like "well-written"
- Each eval case should test a distinct capability of the skill
- 3-5 eval cases with 2-4 assertions each is a good starting point

### CLI commands

```bash
npx vskill eval serve                     # Open visual eval UI (benchmark, compare, history)
npx vskill eval init <skill-dir>          # Scaffold evals.json from SKILL.md via LLM
npx vskill eval run <skill-dir>           # Run evals and grade assertions (CLI output)
npx vskill eval coverage                  # Show eval status for all skills
npx vskill eval generate-all              # Batch-generate for all skills
```

### Visual eval UI

`vskill eval serve` launches a local web UI where you can:
- **Run benchmarks** — all cases or individually, with real-time streaming results
- **Compare A/B** — side-by-side with/without skill scoring and grouped bar charts
- **View history** — previous benchmark results load automatically
- **Edit evals** — add/remove assertions, create new eval cases
- **Switch models** — dropdown to change provider (Claude CLI, Anthropic API, Ollama) and model

Previous benchmark results are displayed on the skill detail page without re-running. Per-case pass/fail status, time, and token usage are shown inline.

## Claude Max/Pro subscription compliance

vSkill Studio does not consume your Max/Pro subscription quota directly. It delegates to the official [Claude Code CLI](https://docs.claude.com/en/docs/claude-code), the sanctioned consumer per Anthropic's April 2026 Terms of Service update. The Claude adapter never reads `~/.claude/credentials*`, `~/.claude/auth*`, or `~/.claude/token*` — a bundled unit test (`src/eval/__tests__/claude-cli-compliance.test.ts`) plus a dist-bundle grep gate (`scripts/check-bundle-compliance.sh`) enforce this on every build.

Issue API keys for direct access at [platform.claude.com/settings/keys](https://platform.claude.com/settings/keys) or [openrouter.ai/settings/keys](https://openrouter.ai/settings/keys). Keys entered in Studio's Settings modal are stored locally on-device only (in-memory + browser localStorage mirror, or macOS Keychain on opt-in) — never synced, never committed to git, never transmitted off-device except to the provider's own API.

### Model configuration

The eval system supports multiple LLM providers. Switch between them in the eval UI dropdown or via environment variables.

| Provider | Models | Requirements |
|:---------|:-------|:-------------|
| **Claude Code (CLI)** | Sonnet, Opus, Haiku | `@anthropic-ai/claude-code` installed on PATH — Studio delegates to your existing Claude Code session. |
| **Anthropic API** | Claude Sonnet 4.6, Opus 4.6, Haiku 4.5 | `ANTHROPIC_API_KEY` env var |
| **Ollama** | Any locally installed model | Ollama running at `localhost:11434` |
| **LM Studio** | Any model loaded in LM Studio | LM Studio running at `localhost:1234` (no API key needed) |

```bash
# Use Anthropic API with Opus
VSKILL_EVAL_PROVIDER=anthropic VSKILL_EVAL_MODEL=claude-opus-4-6 npx vskill eval run my-skill

# Use Ollama with a local model
VSKILL_EVAL_PROVIDER=ollama VSKILL_EVAL_MODEL=qwen2.5:32b npx vskill eval run my-skill

# Custom Ollama server — OLLAMA_HOST is the primary env var (matches Ollama's own docs).
# OLLAMA_BASE_URL is preserved for backcompat but deprecated; Studio logs a one-shot
# warning if both are set.
OLLAMA_HOST=http://gpu-server:11434 VSKILL_EVAL_PROVIDER=ollama npx vskill eval run my-skill

# Use LM Studio with a locally loaded model (no API key required)
VSKILL_EVAL_PROVIDER=lm-studio VSKILL_EVAL_MODEL=qwen2.5-coder-7b npx vskill eval run my-skill

# Custom LM Studio endpoint
LM_STUDIO_BASE_URL=http://lan-box:1234/v1 VSKILL_EVAL_PROVIDER=lm-studio npx vskill eval run my-skill
```

**Which model for what?**

- **Skill creation/improvement**: Claude (Sonnet or Opus) produces the best SKILL.md refinements. Other models like Gemini and Codex can create skills too — they understand the SKILL.md format — but output quality may vary. See Anthropic's [Skill Creator](https://github.com/anthropics/skills/tree/main/skills/skill-creator) for the reference methodology.
- **Benchmarks & A/B comparisons**: Use any model. Cross-model testing reveals whether your skill helps weaker models, and whether base model improvements have made a capability uplift skill unnecessary.
- **Ollama**: Free, local, no API key. Useful for rapid iteration and validating cross-model portability.
- **LM Studio**: Free, local, OpenAI-compatible server. Defaults to `http://localhost:1234/v1`; override with `LM_STUDIO_BASE_URL`. LM Studio ignores the API key, so vskill sends a dummy `Bearer lm-studio` token automatically.

### Platform integration

Skills with `evals/evals.json` get:
- Quality evaluation results displayed at `/skills/[name]/evals`
- Admin editing at `/admin/evals` (admin-only)
- Regression tracking across eval runs

<br/>

## Registry

Browse and search verified skills at **[verified-skill.com](https://verified-skill.com)**.

```bash
vskill find "react native"          # search from CLI
vskill info remotion-best-practices # skill details
```

<br/>

## SKILL.md Spec Compliance

vskill emits SKILL.md files that conform to the canonical specification at **[agentskills.io/specification](https://agentskills.io/specification)**.

The spec requires `tags` and `target-agents` to live **under a `metadata:` block**, not at the top level of the frontmatter:

```yaml
---
name: my-skill
description: "..."
version: 1.0.0
metadata:
  tags:
    - devtools
    - cli
  target-agents:
    - claude-code
    - cursor
---
```

### Validation

- **CI gate** — `npm run lint:skills-spec` walks the repo for every `SKILL.md` and blocks drift. Uses the external `skills-ref` CLI when available; otherwise falls back to a built-in check that enforces the `tags` / `target-agents` nesting rule.
- **Post-creation (Studio)** — the `interpretValidatorResult` / `formatValidatorReport` helpers in `src/eval-server/skill-create-routes.ts` wrap `skills-ref validate`. Warn-only by default (spec drift prints a `Validation warnings` block, skill file stays on disk); `strict: true` flips the outcome to a blocking error with exit code 1. A missing `skills-ref` binary is non-blocking by design — CI is the enforcement line.

### Migration note for downstream consumers

If you previously read `frontmatter.tags` or `frontmatter['target-agents']` at the top level, read them under `frontmatter.metadata.tags` / `frontmatter.metadata['target-agents']` instead. All emitters migrated in lockstep; there is no period where vskill emits mixed shapes.

<br/>

## Studio operations log (`studio-ops.jsonl`)

Every file-changing action taken by vskill studio (skill promote, test-install, revert, skill create/edit/delete, model-config changes) is written as a single newline-terminated JSON line to:

```
~/.vskill/studio-ops.jsonl
```

The log is append-only. Each line conforms to the `StudioOp` shape:

```json
{"id":"<nanoid>","ts":1735123200000,"op":"promote","skillId":"<plugin>/<skill>","fromScope":"installed","toScope":"own","paths":{"source":"<abs>","dest":"<abs>"},"actor":"studio-ui"}
```

Open the drawer from the StatusBar ops-count chip (or press the chip from the keyboard) to browse the log live — new ops are pushed via SSE and prepended to the virtualized list.

**Tombstones (soft-delete).** Dismissing an op from the drawer appends a tombstone line `{"id":"<id>","tombstone":true}`. The UI hides tombstoned entries on read; the raw log still shows both the original op and the tombstone, preserving the audit trail.

**Manual rotation.** The log has no automatic rotation or compaction yet — if it grows large, rotate by hand:

```bash
mv ~/.vskill/studio-ops.jsonl ~/.vskill/studio-ops.jsonl.bak
```

The studio will re-create the file on the next write. A dedicated rotation / retention policy may land in a later increment once we have usage data.

<br/>

## Contributing

Submit your skill for verification:

```bash
vskill submit your-org/your-repo/your-skill
```

<br/>

## License

[MIT](LICENSE)
