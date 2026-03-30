# Browser Verification Setup Guide

This guide explains how to set up browser-based visual verification for frontend development with Claude Code. Two options are available — they complement each other and can coexist.

## Option 1: Chrome Extension (Recommended for Interactive Development)

The Chrome extension gives Claude direct access to your real browser — the same one you're logged into, with all your sessions, extensions, and bookmarks.

### What it provides
- Live visual inspection of your running app
- Console error and warning reading
- DOM state inspection
- Authenticated app testing (your login sessions)
- Session recording as GIFs
- Multi-tab coordination

### Setup

1. **Install the extension**: Search "Claude in Chrome" in the Chrome Web Store (or Edge Add-ons), install v1.0.36+
2. **Connect to Claude Code**: Either:
   - Start Claude Code with `claude --chrome`
   - Or mid-session, run `/chrome`
3. **Enable by default** (optional): Run `/chrome` → select "Enabled by default" to avoid the `--chrome` flag every time
4. **Disable for a session**: `claude --no-chrome`

### Requirements
- Google Chrome or Microsoft Edge (not Brave, Arc, or other Chromium forks)
- Claude Code v2.0.73+
- Direct Anthropic plan (Pro, Max, Teams, or Enterprise)
- Not available via Bedrock, Vertex AI, or Foundry

### Troubleshooting

| Symptom | Fix |
|---------|-----|
| "Browser extension is not connected" | Restart Chrome and Claude Code, run `/chrome` |
| "Extension not detected" | Install/enable in chrome://extensions |
| "No tab available" | Ask Claude to create a new tab first |
| Connection drops during long sessions | Run `/chrome` → "Reconnect extension" |

### Context cost note
Enabling Chrome by default adds ~7.7% to context window usage from tool definitions. If you only do frontend work occasionally, use `claude --chrome` on-demand.

---

## Option 2: Playwright MCP (Recommended for Automated/Headless Verification)

The Playwright MCP server gives Claude programmatic browser control — including headless mode for CI/CD pipelines.

### What it provides
- Screenshots returned directly to Claude for visual analysis
- Accessibility tree snapshots (semantic page structure)
- Console message capture
- Network request monitoring
- Cross-browser testing (Chromium, Firefox, WebKit)
- Device emulation (iPhone, iPad, etc.)
- Headless mode for CI/CD
- Playwright test script generation

### Setup

One command:
```bash
claude mcp add playwright -- npx @playwright/mcp@latest
```

For headless mode (no browser window):
```bash
claude mcp add playwright -- npx @playwright/mcp@latest --headless
```

Install browser binaries if needed:
```bash
npx playwright install chromium
```

### Key tools available

| Tool | Purpose |
|------|---------|
| `browser_navigate` | Go to a URL |
| `browser_take_screenshot` | Capture viewport, full page, or element |
| `browser_snapshot` | Accessibility tree (structured, semantic) |
| `browser_console_messages` | Read console logs/errors |
| `browser_click` | Click elements |
| `browser_type` | Type text |
| `browser_fill_form` | Fill multiple form fields |
| `browser_evaluate` | Run JavaScript in page |
| `browser_resize` | Change viewport size |
| `browser_network_requests` | View network activity |

### Advanced capabilities (opt-in via --caps flag)

```bash
# Enable verification assertions
claude mcp add playwright -- npx @playwright/mcp@latest --caps=verify

# Enable vision/coordinate mode (for canvas apps)
claude mcp add playwright -- npx @playwright/mcp@latest --caps=vision

# Enable Playwright test code generation
claude mcp add playwright -- npx @playwright/mcp@latest --codegen=typescript

# Combine multiple capabilities
claude mcp add playwright -- npx @playwright/mcp@latest --caps=verify,vision --codegen=typescript
```

### Context cost note
Playwright MCP adds ~6.8% to context window usage from tool definitions. Slightly less than Chrome extension.

---

## Using Both Together

The two tools serve different purposes and don't conflict:

| Scenario | Use |
|----------|-----|
| Building UI interactively, want to see it live | Chrome Extension |
| Testing behind-login flows with your real sessions | Chrome Extension |
| Quick visual check during development | Chrome Extension |
| Automated headless testing in CI/CD | Playwright MCP |
| Cross-browser verification (Firefox, WebKit) | Playwright MCP |
| Device emulation (mobile viewports) | Playwright MCP |
| Generating reusable Playwright test scripts | Playwright MCP |
| Accessibility tree analysis | Playwright MCP |

For maximum coverage, install both. The Chrome extension connects via native messaging to your existing browser, while Playwright MCP launches its own browser instance — they operate independently.

---

## Option 3: Playwright CLI (Minimal Fallback)

If neither MCP server is configured, you can still run Playwright tests from the command line:

```bash
# Install
npm install -D @playwright/test
npx playwright install chromium

# Run tests
npx playwright test

# Run with visual report
npx playwright test --reporter=html
npx playwright show-report
```

This doesn't give Claude real-time visual feedback, but it does provide structured test results and can catch functional regressions. Pair with the `sw:e2e` skill for spec-driven test generation.
