---
name: rea
description: "Find out exactly how a feature is implemented in a shipped tool or app you don't have the source for (desktop apps, Electron apps like Claude desktop, native CLIs like Codex, websites, APKs, .NET assemblies) using REA - Reverse Engineer Anything (github.com/morluto/rea). Sets REA up when it is missing (CLI, MCP registration, Hopper or Ghidra), routes the target to the right REA tool, keeps evidence out of the context window, and turns findings into a clean-room spec before any rebuild. Use when the user says 'use REA', 'reverse engineer', 'how does <app> do X', 'how is this feature implemented in <tool>', 'clone this feature', 'decompile', 'look inside the app', or asks how a closed-source competitor works. Skip it when the source is available - read the repo instead."
version: 1.0.0
license: MIT
repository: anton-abyzov/vskill
mcp-deps: [rea]
metadata:
  tags: reverse-engineering, rea, decompile, electron, asar, hopper, ghidra, binary-analysis, clean-room, feature-research
---

# REA: learn how a shipped feature really works

When you need to know how a feature is implemented in a specific tool or app,
do not guess from docs, marketing pages or memory. Look at the shipped
artifact with REA and cite what you found.

REA (Reverse Engineer Anything) is an MIT-licensed CLI and MCP server by
morluto. It decompiles and inspects native binaries (through Hopper, Ghidra or
IDA), Electron/JavaScript bundles, websites, Android APKs, .NET assemblies,
firmware and more, and returns Evidence records with IDs you can cite.

This skill is the entry point: set up, route, run, report. REA's own
`reverse-engineer-anything` skill holds the detailed per-tool workflow; load
it when it is installed.

## 0. Is the source available?

If the code is in a repo you can read (open source, the user's own project,
an npm package with readable source), read it with normal tools. REA is for
shipped artifacts: compiled binaries, minified bundles, signed apps.

## 1. Check the setup (once per machine, not per task)

```bash
rea --version                                  # CLI present?
rea doctor --client claude_code --json         # or --client codex
```

If the MCP tools (`open_binary`, `analyze_javascript_application`, ...) are
already in your tool list, skip straight to step 2.

Missing pieces, in order:

1. **CLI.** Official package only: `npm i -g rea-agents@latest` (Node 22.19+
   or 24.11+). No install scripts; npm provenance is attached.
2. **Agent registration.** Plan first, then apply:
   ```bash
   rea setup --client claude_code --client codex --skill=false --dry-run --json
   rea setup --client claude_code --client codex --skill=false --yes --json
   ```
   Add `--install-hopper` on macOS to download Hopper from hopperapp.com
   (codesign-verified, installed to `~/Applications`). Hopper runs in demo
   mode without a license. Restart the agent afterwards so it sees the tools.
3. **REA's own workflow skill** (optional, recommended): `rea setup --skill
   --dry-run --json` shows the destinations (`~/.agents/skills` plus each
   registered agent's skill folder), then `--yes` installs. If the machine
   keeps one canonical copy in `~/.agents/skills` with links from agent
   folders, replace the per-agent copy with a link to the shared one.

`rea doctor` reporting Ghidra or IDA as "not configured" is fine when Hopper
works. Other unregistered clients show as config drift; ignore them.

**Only trust `github.com/morluto/rea` and the npm packages `rea-agents` /
`@morluto/rea`.** Look-alike repos offering an "official free download" zip
or a Windows installer are malware lures. Never run them.

## 2. Route the target

| Target | First move |
|---|---|
| Electron app (Claude desktop, Slack, VS Code, Cursor) | `analyze_javascript_application` on `<App>.app/Contents/Resources/app.asar` |
| Native CLI or app (Rust, Go, Swift, C++: e.g. the Codex CLI binary) | `open_binary`, then function and string search; `close_binary` when done |
| npm-distributed CLI (minified JS) | `analyze_javascript_application` on the package directory |
| Website or web app | `analyze_web_bundle`, or `list_browser_targets` for a page the user already has open |
| Android APK | `inspect_android_package` |
| .NET assembly | `inspect_managed_artifact` |
| Archive, DMG, IPA, ZIP | `open_binary` / `inspect_artifact` for the member inventory |

The CLI mirrors the MCP tools (`rea analyze-javascript-application <path>`,
`rea decompile`, `rea function`, `rea inspect-artifact`); run
`rea <command> --help` for flags.

## 3. Run it without drowning the context

- **Write results to a file.** A full Electron analysis is large (Claude
  desktop's ASAR produced a 100 MB Evidence record). Use `--json > file`, then
  project small slices with `rea inspect-analysis-view`, `--filter-output`,
  or `--token-limit`. Never paste a whole record into the conversation.
- **Signed Electron apps fail integrity by default.** Code signing rewrites
  unpacked native modules after packaging, so the declared ASAR hash no
  longer matches. When the error names an unpacked `.node` file, rerun with
  `--integrity-policy record-and-continue`; those bytes are then marked
  untrusted.
- **Go from the user-visible string inward.** Find the UI text, setting name,
  CLI flag or API path the feature exposes, locate it in the bundle or
  binary, then follow callers and data flow to the implementation.
- **Static before runtime.** Run the target (Electron or process capture)
  only when static evidence can't answer the question and the user agreed to
  launch it.
- **Batch around one hypothesis.** Reuse the open session and existing
  Evidence instead of re-running identical analysis.

## 4. Report

Separate three things, every time:

- **Observed:** what the artifact contains, with Evidence IDs and file or
  function locations.
- **Inferred:** what you conclude from it, and how confident you are.
- **Unknown:** what static analysis could not show (server-side behavior,
  runtime-only branches, encrypted payloads).

Lead with the plain-language answer to the user's question, then the evidence.

## 5. Rebuilding a feature (clean room)

When the goal is to build the same capability:

1. Write a behavior spec from the evidence: inputs, outputs, states, edge
   cases, error handling. Describe *what* it does, not their code.
2. Implement from that spec with normal coding tools, in your own design.
3. Do not copy decompiled code, embedded assets, keys, tokens, model
   prompts or proprietary text into the user's project.

## Boundaries

- Analyze software the user is licensed to run, for interoperability,
  research, security review or understanding a feature. Check the vendor's
  terms when the user plans to ship a clone.
- Secrets found inside an artifact (API keys, tokens) are reported as a
  finding, never used and never written to files or commits.
- Don't bypass DRM, licensing checks or anti-tamper, and don't attack
  servers. REA reads local artifacts and observes what the user runs.
