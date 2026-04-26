<h1 align="center">vskill</h1>

<p align="center">
  <strong>The package manager for AI skills.</strong><br/>
  Author. Eval. Publish. Install — across 53 agent platforms.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/vskill"><img src="https://img.shields.io/npm/v/vskill?color=cb3837&logo=npm" alt="npm" /></a>
  <a href="https://www.npmjs.com/package/vskill"><img src="https://img.shields.io/npm/dw/vskill?color=cb3837&logo=npm&label=downloads" alt="downloads" /></a>
  <img src="https://img.shields.io/badge/agents-53_platforms-0969DA" alt="53 agents" />
  <img src="https://img.shields.io/badge/plugins-8-8B5CF6" alt="8 plugins" />
  <img src="https://img.shields.io/badge/skills-14-10B981" alt="14 skills" />
  <a href="https://verified-skill.com"><img src="https://img.shields.io/badge/registry-verified--skill.com-F59E0B" alt="registry" /></a>
  <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT" />
</p>

<br/>

```bash
npx vskill@latest studio        # open the local IDE for AI skills
npx vskill@latest install remotion-best-practices
```

<br/>

## Why vskill

**36.82% of AI skills have security flaws** ([Snyk ToxicSkills](https://snyk.io/blog/toxicskills-malicious-ai-agent-skills-clawhub/)).
And the ones that aren't malicious often *don't even improve the model* — they just feel like they should.

vskill is built around three problems:

- **Trust** — every install runs a 3-tier scan (52 patterns → blocklist → LLM intent). No `--skip-scan`.
- **Proof** — Skill Studio runs A/B evals so you can *show* a skill makes a model better, not assume it.
- **Reach** — one skill, 53 agents (Claude Code, Cursor, Copilot, Codex, Windsurf, Zed, Gemini CLI, Ollama, …).

<br/>

## Skill Studio — the local IDE for skills

```bash
npx vskill@latest studio
```

A localhost workbench opens at a deterministic per-project port. You can:

- **Author** new skills with an AI-assisted generator (Anthropic skill-creator engine *or* vskill native — first-class peers, you pick).
- **Edit** SKILL.md live with a Linear/Raycast-grade UI.
- **Run benchmarks** with SSE-streamed pass/fail across Claude, GPT, Llama, Gemini, local Ollama / LM Studio.
- **A/B compare** with vs. without your skill — blind LLM judge ranks outputs as EFFECTIVE / MARGINAL / INEFFECTIVE / DEGRADING.
- **Cross-model sweep** the same skill across providers (Anthropic Batch API supported — 50% cheaper).
- **Find skills** from the verified-skill.com registry with a `⌘⇧K` palette, install with consent + provenance.
- **Publish** with one click — `git push` from the UI, then opens the submit form on verified-skill.com pre-filled.

CORS-free by design: the browser only ever talks to localhost. The server proxies to verified-skill.com and to provider APIs. Every mutation is logged to `~/.vskill/studio-ops.jsonl` for audit.

<br/>

## How install works

```
  ┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
  │  Source  │────>│   Scan   │────>│  Verify  │────>│ Install  │
  │          │     │          │     │          │     │          │
  │ GitHub   │     │ 52 rules │     │ LLM      │     │ Pin SHA  │
  │ Registry │     │ Blocklist│     │ intent   │     │ Lock ver │
  │ Local    │     │ Patterns │     │ analysis │     │ Symlink  │
  └──────────┘     └──────────┘     └──────────┘     └──────────┘
```

Every install runs the full pipeline. SARIF v2.1.0 output is available for CI (`vskill audit --ci`).

<br/>

## Quick Start

```bash
# Install one skill
npx vskill@latest install remotion-dev/skills/remotion-best-practices

# Browse a repo, pick interactively
npx vskill@latest install remotion-dev/skills

# Install a Claude Code plugin (full domain bundle)
npx vskill@latest install --repo anton-abyzov/vskill --plugin frontend
```

Install globally for repeat use: `npm i -g vskill`

<sub>Behind a private npm registry? See <a href="https://verified-skill.com/docs/getting-started">Getting Started</a> for the E401 workaround.</sub>

<br/>

## What ships today

| Surface | Count | Notes |
|---|---|---|
| **Agent platforms** | **53** | Claude Code, Cursor, Copilot, Windsurf, Codex, Gemini CLI, Zed, Ollama, LM Studio, … |
| **Plugins** | **8** | Multi-skill bundles for Claude Code |
| **Skills** | **14** | Individual SKILL.md files inside plugins |
| **Top-level CLI commands** | **22** | `install`, `studio`, `eval`, `find`, `scan`, `audit`, `submit`, `skill`, `keys`, … |
| **Tests** | **307 test files** | More tests than source files |

### Plugins (Claude Code)

| Plugin | Skills |
|---|---|
| **frontend** | figma-connect, frontend-design, task-skill-announcer |
| **personal** | obsidian-brain, greet-anton, tax-filing |
| **marketing** | slack-messaging, social-media-posting |
| **skills** | skill-builder, scout |
| **mobile** | appstore |
| **google-workspace** | gws |
| **easychamp** | tournament-manager |
| **productivity** | survey-passing |

Install all eight: `npx vskill@latest install --repo anton-abyzov/vskill --all`

Browse the full catalog → [verified-skill.com/docs/plugins](https://verified-skill.com/docs/plugins)

<br/>

## Commands you'll actually use

```bash
npx vskill@latest studio               # open local IDE
npx vskill@latest install <skill>      # install with full security scan
npx vskill@latest find <query>         # search verified-skill.com registry
npx vskill@latest list --installed     # what's installed where
npx vskill@latest diff <skill> v1 v2   # compare versions before upgrading
npx vskill@latest skill new            # create a new skill (AI-assisted)
npx vskill@latest eval sweep <skill>   # benchmark across models
npx vskill@latest audit --ci           # SARIF v2.1.0 for CI
npx vskill@latest keys set anthropic   # store API keys in ~/.vskill/keys.env
```

Full reference → [verified-skill.com/docs/cli-reference](https://verified-skill.com/docs/cli-reference)

<br/>

## Recent highlights (0.5.x)

- **0.5.129** — Studio Publish: one-click `git push` + open verified-skill.com submit pre-filled
- **0.5.12x** — Studio Find palette (`⌘⇧K`): search the registry from inside Studio
- **0.5.11x** — Engine selector in Create flow: choose Anthropic skill-creator *or* vskill native
- **0.5.10x** — Multi-project tabs, deterministic per-project port (3077–3177), bookmarkable URLs
- **0.5.0x** — A/B comparison with blind LLM judge, cross-model sweep, MCP-skill simulation mode

Full changelog → [github.com/anton-abyzov/vskill/releases](https://github.com/anton-abyzov/vskill/releases)

<br/>

## Learn more

| Topic | Where |
|---|---|
| Quick start & first install | [verified-skill.com/docs/getting-started](https://verified-skill.com/docs/getting-started) |
| Full CLI reference | [verified-skill.com/docs/cli-reference](https://verified-skill.com/docs/cli-reference) |
| Security model & 3-tier verification | [verified-skill.com/docs/security-guidelines](https://verified-skill.com/docs/security-guidelines) |
| Plugin marketplace | [verified-skill.com/docs/plugins](https://verified-skill.com/docs/plugins) |
| Submit a skill for verification | [verified-skill.com/docs/submitting](https://verified-skill.com/docs/submitting) |
| FAQ | [verified-skill.com/docs/faq](https://verified-skill.com/docs/faq) |
| Browse the registry | [verified-skill.com](https://verified-skill.com) |

<br/>

## Contributing

Issues and PRs welcome at [github.com/anton-abyzov/vskill](https://github.com/anton-abyzov/vskill). To submit a skill to the registry, see [verified-skill.com/docs/submitting](https://verified-skill.com/docs/submitting).

## License

MIT
