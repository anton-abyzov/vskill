---
name: html-report
description: "Write work reports, status updates, meeting notes and review results that render as a polished document (property table, serif title, lead paragraph, sections, chips) in any host and from any model: Claude, Codex, Copilot, Gemini, Cursor, OpenCode. Picks the right form per host: structured markdown with flat frontmatter that document viewers render (Claude desktop, SpecWithCode, Obsidian), or a self-contained themed HTML page from the bundled template when the report needs screenshots, comparisons or test matrices (SpecWithCode html_render, Claude artifacts, a file on disk). Use whenever you finish delegated work and report back, write a final report, summary, handoff, review result, release note or meeting note, or the user says 'make it look good', 'pretty report', 'HTML report', 'artifact', 'format this as a document', or complains a report is a wall of text."
version: 1.1.0
license: MIT
repository: anton-abyzov/vskill
metadata:
  tags: report, html, artifact, markdown, frontmatter, document, formatting, worker-report, status-update, cross-model
---

# html-report: reports that read as documents

A report is read, not parsed. A wall of prose with inline code chips is hard to scan; the same facts as a document (properties first, a title, one lead paragraph, short sections) read in seconds. This skill makes that the default for every model and host.

## How the good-looking hosts do it

Claude desktop's polished document look is not an HTML artifact. It is a **markdown file** that the app renders: flat YAML frontmatter becomes a property table (list values become chips), the `# H1` is a serif title, the first paragraph is the lead, `##` sections follow. HTML artifacts are kept for interactive or visual content. SpecWithCode (SpecWeave Studio) renders worker reports the same way, and Obsidian shows the same frontmatter as properties.

So the optimal path is:

1. **Default: structured markdown.** Cheap, works in every model, every host renders it well, and it degrades to clean text anywhere else.
2. **Visual evidence: a self-contained HTML page** built from `template.html`, only when screenshots, a comparison, a results matrix or a chart say more than prose.

## 1. Structured markdown (default)

```markdown
---
title: Show harness on thread rows
status: done
branch: feat/thread-harness-label
tests: 262/262 pass
blockers: none
tags: [web, sidebar, models]
---

# Show harness on thread rows

Thread rows now show the harness first, then the model: "Claude Code · Opus 5.5", "Copilot · Claude Opus 5.5". Before, native threads showed just "Claude".

## Evidence

- Commit `d7c074f0b` on `feat/thread-harness-label`, not pushed.
- Headless screenshots: `threads-light.png`, `threads-dark.png`.
- The 5 full-suite failures also fail on clean `origin/main`.

## Next

- Push and open the PR once the release branch is cut.
```

Rules (these match what document viewers accept):

- Frontmatter is **flat**: `key: value` lines, and lists as `[a, b]` or `- a` lines. No nesting, no `|`/`>` block text, no duplicate keys; any of those makes viewers drop the whole table.
- Keys are lowercase words (`review_cycle` shows as "Review cycle"). Put short facts here: status, branch, version, test totals, blockers, owners, dates. Lists become chips, so use them for tags, people, files.
- One `# H1`, then **one lead paragraph** of one to three sentences: the outcome. Then `##` sections with bullets, one fact per bullet.
- Use `> [!NOTE]`, `> [!WARNING]` or `> [!CAUTION]` callouts for the one thing the reader must not miss.
- Tables only for real comparisons; numeric columns right-align on their own.
- No raw HTML in markdown; viewers strip it.

**Short worker reports** (a 5-line "Outcome / Evidence / Blockers" result) skip frontmatter and the H1. Write each part as its own paragraph opening with a bold label:

```markdown
**Outcome:** Thread rows now show the harness first, then the model.

**Evidence:** commit `d7c074f0b` on `feat/thread-harness-label`, not pushed. Headless screenshots at `threads-light.png`. Unit tests: 262/262 pass.

**Blockers:** none.
```

SpecWithCode shows this as a document: the outcome as the lead, a long Evidence as a bulleted section, a short Blockers as a property.

## Blockers are a question, or none

`Blockers` is either `none` or **the one thing you need from the reader, asked as a question they can answer in one reply**: the decision, the options, and your recommendation.

- Good: `**Blockers:** Ship 1.0.20 now without the Windows build, or wait about 2 hours for the signer? I recommend shipping now and following up.`
- Bad: `**Blockers:** Windows signing is flaky.` (a status, not a question; the reader cannot act on it)
- Not a blocker: problems you already worked around. Put them in Evidence.

SpecWithCode reads this part: a thread whose last report names a blocker shows as **Blocked**, waits in "Waiting on you" with the question on hover and on its card, and never auto-resolves until someone writes back.

## 2. HTML page (visual evidence)

Start from `template.html` next to this file. `examples/worker-report.html` is a finished worker report (before/after screenshots, checks table) built from it. It is self-contained (inline CSS, no network), follows the host theme when one is injected (`--background`, `--foreground`, `--border`, `--accent`, ...) and falls back to its own light and dark palette, so the same file works in a host frame, as an artifact and opened from disk.

- Keep its structure: `dl.props` (facts), `h1`, `p.lead`, `h2` sections, `table` for results with `.pill.ok|bad|warn` status, `.shots` grid of `figure`s for screenshots, `details` for long logs.
- Inline images as `data:` URLs (resize first; keep the page under about 2 MB). Never hotlink.
- No outer card, banner or border, no `100vh`; let content set the height. Fluid width, max 680px text column.
- Charts: inline SVG, or Chart.js only where the host allows that library.
- Light and dark must both read well. Check contrast of pills and chips in both.

## Where to put it, by host

| Host | Markdown report | HTML report |
|---|---|---|
| SpecWithCode / SpecWeave Studio | Your final reply, as above | `html_preview`, then `html_render`, before the final reply; the reply adds only what the page doesn't say |
| Claude desktop (Cowork / Code) | Write a `.md` file, then `present_files` | Write the `.html` file, then `create_artifact` with its `html_path` |
| claude.ai chat | A `text/markdown` artifact | A `text/html` artifact |
| Codex, Copilot, Gemini, Cursor, OpenCode, any CLI | Your final reply, or a `.md` file whose path you print | Write the file to a scratch or reports folder, print the absolute path |

When a host has no way to show a page, still write the file and give its path; never paste HTML into the chat.

## Before you send

- The first two lines answer "what happened". A reader who stops there knows the result.
- Every claim of success has its evidence: a commit, a path, a command and its result.
- Failures, failing tests and security warnings are quoted exactly, never softened.
- Nothing invented to fill the template: drop a property or section you have no fact for.
