# codex-bridge

Reference implementation of vskill's **dual-manifest** plugin pattern: a single source tree that's installable in both Anthropic Claude Code and OpenAI Codex CLI from the same files.

## Why this exists

The Anthropic Agent Skills open spec (Dec 2025) standardized `SKILL.md` across 32+ tools. Within four months, Claude Code, Codex, Cursor, Windsurf, Copilot, Gemini CLI, Replit, Devin, and Zed all adopted it. The two leading runtimes — Claude Code and Codex — use deliberately near-identical conventions:

| Concept | Claude Code | Codex |
|---|---|---|
| Plugin manifest | `.claude-plugin/plugin.json` | `.codex-plugin/plugin.json` |
| Marketplace | `.claude-plugin/marketplace.json` | `.agents/plugins/marketplace.json` |
| Skill file | `SKILL.md` | `SKILL.md` (stricter — only `name` + `description` allowed in frontmatter) |
| Skills dir | `.claude/skills/` (local), `~/.claude/skills/` (global) | `.codex/skills/` (local), `~/.codex/skills/` (global), or `.agents/skills/` |
| Project doc | `CLAUDE.md` | `AGENTS.md` |

A plugin author who follows the **lowest common denominator** (strict frontmatter) gets a single SKILL.md that works in both — no forking required.

## Layout

```
codex-bridge/
├── .claude-plugin/plugin.json    # Claude Code marketplace record
├── .codex-plugin/plugin.json     # Codex marketplace record
├── README.md                     # this file
└── skills/
    └── agents-md-author/
        ├── SKILL.md              # frontmatter: name + description ONLY
        └── references/
            └── agents-md-spec.md # lazy-loaded background
```

## Install

### From vskill (Claude Code, and any other agent vskill knows about)

```bash
# in your project root
npx vskill@latest install --repo anton-abyzov/vskill --plugin codex-bridge
```

The vskill installer materializes the skill into `.claude/skills/agents-md-author/`, `.codex/skills/agents-md-author/`, and any other registered agent's local skill dir.

### From Codex CLI directly

```bash
# add the marketplace
codex plugin marketplace add anton-abyzov/vskill
# enable the plugin in ~/.codex/config.toml (interactive via /plugins, or manually)
codex /plugins
```

Codex discovers `codex-bridge` via `.agents/plugins/marketplace.json` at the vskill repo root.

## Authoring a similar dual-target plugin

This plugin is the template. To build your own:

1. **Create the directory** `vskill/plugins/<your-plugin>/` with two manifests:
   - `.claude-plugin/plugin.json` — follows the existing 8 vskill plugins (mirror `plugins/skills/.claude-plugin/plugin.json`)
   - `.codex-plugin/plugin.json` — adds `skills[]` (array of relative paths to your skills) and an optional `interface{}` block (marketplace presentation: `displayName`, `shortDescription`, `category`, `defaultPrompt[]`, `brandColor`)

2. **Author your SKILL.md with strict frontmatter** — only `name` and `description`. Codex rejects extra keys; Claude accepts them. The intersection is what works in both.

   ```yaml
   ---
   name: your-skill
   description: "What it does. Triggers on: <keywords>."
   ---
   ```

3. **Register in both marketplaces**:
   - `vskill/.claude-plugin/marketplace.json` → append to `plugins[]`
   - `vskill/.agents/plugins/marketplace.json` → append to `plugins[]` (or create the file if it's the first dual-target plugin)

4. **Verify installs**:
   - `mkdir /tmp/test && cd /tmp/test && npx vskill install --repo <vskill> --plugin <your-plugin>`
   - `codex plugin marketplace add <vskill-path>` then `codex /plugins`

## Codex schema gotchas (caught while building this plugin)

The published Codex docs at developers.openai.com/codex/plugins/build show example fields but don't spell out every enum or naming quirk. These came up during real `codex plugin marketplace add` against this plugin and would have wasted a few hours of guesswork without `codex-cli` returning the actual error messages:

| Field | Wrong (what the docs imply) | Right (what `codex-cli` v0.125 accepts) |
|---|---|---|
| `policy.installation` | `"manual"` | `"AVAILABLE"` (or `"NOT_AVAILABLE"` / `"INSTALLED_BY_DEFAULT"`) — **enforced**, returns "unknown variant" error otherwise |
| `policy.authentication` | `"none"` | `"ON_USE"` (or `"ON_INSTALL"`) — **enforced**, same error pattern |
| `source.<key>` | `"type": "local"` | `"source": "local"` — yes, the inner key is also `source`, not `type` |
| `category` | `"development"` | `"Engineering"` (PascalCase; see `~/.codex/.tmp/bundled-marketplaces/openai-bundled/.agents/plugins/marketplace.json` for canonical values) — **convention, not enforced** by codex CLI today |
| `interface.capabilities[]` | free-form strings | one of `"Read"`, `"Write"`, `"Interactive"` (convention; not enforced at registration) |
| `SKILL.md` `description` | any length | **max 1024 chars** — Codex hard-rejects longer descriptions with "invalid description: exceeds maximum length" |
| `plugin.json` `skills` | array of paths `["./skills/foo"]` | **string directory** `"./skills/"` — every working OpenAI plugin (browser-use, github, gmail, computer-use) uses the string form; the array form may not be loaded by codex's plugin loader |

Look at `~/.codex/.tmp/bundled-marketplaces/openai-bundled/.agents/plugins/marketplace.json` and any `~/.codex/plugins/cache/<marketplace>/<plugin>/<version>/.codex-plugin/plugin.json` after `codex plugin marketplace add` for the canonical reference shapes — they're the most reliable schema source until OpenAI ships a JSON Schema.

## Strict-mode frontmatter convention

The convention that makes this work:

> The `SKILL.md` YAML frontmatter SHOULD contain only `name` and `description`. Avoid `metadata`, `allowed-tools`, `model`, `tags`.

What Codex CLI v0.125 actually validates (verified by real-world testing on 2026-04-30):
- `name`: present, used as the skill identifier (kebab-case is convention, **not** enforced — `Codex_Bridge` was accepted)
- `description`: present, **≤1024 characters** (this IS enforced — over-length rejects with "invalid description: exceeds maximum length")
- Valid YAML syntax

What Codex CLI does NOT enforce today (as of v0.125):
- Rejection of extra frontmatter keys — `tags: [foo]` was silently accepted
- kebab-case on plugin or skill names

Treat strict-mode as a **portability convention**, not a runtime guard. The reason to follow it anyway: future Codex versions may tighten the parser, and other AI tools that adopted the Anthropic Agent Skills open spec may already enforce these rules. Coding to the documented contract today gives you forward-compatibility for free.

If you need Claude-specific behavior (like `allowed-tools`), ship two SKILL.md files via vskill's existing per-agent field-stripping installer — but that's the path **away** from cross-runtime portability, not toward it. The whole point of `codex-bridge` is to demonstrate the simpler way.

## Out of scope for this plugin

- App connectors (`.app.json`)
- Hooks (`hooks.json`)
- Slash commands (`commands/`)
- Agents (`agents/`)

These are all valid plugin features, but adding them complicates the cross-runtime story. This plugin stays minimal on purpose — it's the template, not the showcase.

## See also

- The skill itself: [`skills/agents-md-author/SKILL.md`](skills/agents-md-author/SKILL.md)
- Cross-vendor spec primer: [`skills/agents-md-author/references/agents-md-spec.md`](skills/agents-md-author/references/agents-md-spec.md)
- Anthropic Agent Skills spec: https://github.com/anthropics/skills
- OpenAI Codex plugin docs: https://developers.openai.com/codex/plugins
- agents.md open standard: https://agents.md
