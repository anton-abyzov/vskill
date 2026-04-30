# Cross-Vendor AGENTS.md / CLAUDE.md Conventions (load on demand)

Background reference for the `agents-md-author` skill. Skim only the section you need.

## TL;DR

Five vendor names, one converging convention. Use `AGENTS.md` as the source of truth and let other tools symlink or duplicate from it. Frontmatter is uncommon at the project-instructions layer; structure is plain Markdown sections.

## Vendor matrix

| Tool | File it reads | Layered? | Notes |
|---|---|---|---|
| OpenAI Codex (CLI/web/IDE) | `AGENTS.md` | 3-tier: system / user (`~/.codex/AGENTS.md`) / repo | Mergeable; supports `AGENTS.override.md` for sub-dirs |
| Anthropic Claude Code | `CLAUDE.md` | 2-tier: user (`~/.claude/CLAUDE.md`) / repo | Auto-loaded; `<system-reminder>` blocks supported |
| Cursor | `AGENTS.md` (since 2026) + `.cursor/rules/*.md` | Layered | Rules can have YAML frontmatter for activation |
| Windsurf / Codeium | `.windsurfrules` + `AGENTS.md` (recent) | Layered | Cascade reads either |
| GitHub Copilot | `.github/copilot-instructions.md` (legacy) + `AGENTS.md` (2026) | Repo-only | VS Code 1.99+ honors `AGENTS.md` |
| Aider | `CONVENTIONS.md` (loaded via `--read`) | Manual | No auto-load |
| JetBrains AI Assistant | `.aicontext` + `AGENTS.md` (2026) | Repo-only | ACP imports honor source agent's file |
| Gemini CLI | `AGENTS.md` | Repo-only | |
| Replit Agent | `AGENTS.md` | Repo-only | |
| Devin | Internal Knowledge / Playbooks (proprietary) — also reads `AGENTS.md` if present | N/A | Closed platform |

## The agents.md "open standard"

[agents.md](https://agents.md) is the cross-vendor effort to standardize the format. It's not a strict schema — just a recommended structure. The convention:

1. File is plain Markdown — no required frontmatter
2. H1 = project name
3. Short tech-stack section
4. Dev commands (install / dev / build / test / lint)
5. Conventions (style, naming, test colocation)
6. Architecture notes (where things live)
7. "Out of scope" / "don't touch" list

That's it. Anything beyond is project-specific.

## When to use AGENTS.md vs CLAUDE.md

- **Greenfield project, want maximum portability** → `AGENTS.md` only. Most tools (including Claude Code) will pick it up via convention or via a `CLAUDE.md` symlink.
- **Existing Claude Code project** → keep `CLAUDE.md`, add `AGENTS.md` as a symlink → `CLAUDE.md` (or vice versa).
- **Heavy Claude Code usage with `<system-reminder>` blocks** → keep them in `CLAUDE.md` (Codex ignores them gracefully).
- **You want one file editable by everyone** → symlink `CLAUDE.md` → `AGENTS.md`. Single source of truth.

## Layered hierarchy (Codex)

Codex merges three levels at runtime:
1. `/etc/codex/AGENTS.md` (system, read-only on most installs)
2. `~/.codex/AGENTS.md` (user-global)
3. `<repo-root>/AGENTS.md` (project)
4. `<sub-dir>/AGENTS.override.md` (overrides applicable only when working in that subtree)

Closer-to-the-file wins. Same model as `.editorconfig` cascades.

## What NOT to put in AGENTS.md

- Secrets, API keys, environment-specific paths
- Auto-generated content (commit hashes, build numbers)
- Multi-paragraph rationale — agents skim, use bullet points
- Commands that don't exist in `package.json` / `Makefile`
- Per-developer preferences (those go in `~/.codex/AGENTS.md` or `~/.claude/CLAUDE.md`)

## SKILL.md ≠ AGENTS.md

Don't confuse them. Both use Markdown but they're different layers:

- **SKILL.md** = a packaged, reusable behavior the agent invokes ("here's how to publish to npm"). Has YAML frontmatter (`name`, `description`). Ships in plugins.
- **AGENTS.md** = the project-level briefing the agent reads at session start ("this is a Next.js + Prisma app"). Plain Markdown, no frontmatter. Ships in the repo.

A plugin can ship one or many SKILL.md files. A project ships exactly one AGENTS.md (plus optional override layers).

## Sources

- https://developers.openai.com/codex/guides/agents-md
- https://github.com/anthropics/skills
- https://agents.md
- Phase 1 research in this increment (2026-04-30)
