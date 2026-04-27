---
name: gws
description: "Google Workspace CLI (gws) — unified command-line tool for Gmail, Drive, Sheets, Docs, Calendar, Chat, Admin, and 40+ Google APIs. Use this skill when the user wants to interact with any Google Workspace service from the terminal or via AI agents, set up gws authentication, configure the gws MCP server, manage Google Drive files, read or send Gmail, create or query Google Sheets, edit Google Docs, manage Calendar events, or automate any Google Workspace workflow. Also activate when the user mentions 'gws', 'google workspace cli', 'google drive cli', 'gmail from terminal', 'sheets api', 'google docs api', 'gws mcp', 'workspace automation', or asks to 'list my drive files', 'send email via cli', 'read my calendar', 'update spreadsheet', 'create a google doc'. Do NOT activate for native Claude MCP integrations (claude_ai_Gmail, claude_ai_Google_Calendar) unless the user explicitly wants to use gws instead, or needs services not covered by native integrations (Sheets, Docs, Drive, Chat, Admin)."
metadata:
  version: 1.0.3
  tags: google-workspace, gws, gmail, drive, sheets, docs, calendar, chat, admin, mcp, cli, automation
  upstream: https://github.com/googleworkspace/cli
  upstream-version: 0.4.x
  stability: preview
---

# Google Workspace CLI (gws)

One CLI for all of Google Workspace — Drive, Gmail, Calendar, Sheets, Docs, Chat, Admin, and every API published via Google Discovery Service. Built in Rust, distributed via npm, designed for humans and AI agents.

**Upstream**: [googleworkspace/cli](https://github.com/googleworkspace/cli) (Apache 2.0)
**Status**: Pre-v1.0 — breaking changes possible. Pin versions in production scripts.

---

## When to Use gws vs Native Claude MCP

| Need | Use |
|------|-----|
| Read/send Gmail | Native `claude_ai_Gmail` (already configured) |
| Calendar events | Native `claude_ai_Google_Calendar` (already configured) |
| Google Drive files | **gws** (no native integration) |
| Google Sheets | **gws** (no native integration) |
| Google Docs | **gws** (no native integration) |
| Google Chat | **gws** (no native integration) |
| Admin / Directory | **gws** (no native integration) |
| Bulk automation across services | **gws** (unified CLI, scriptable) |
| Custom/new Google APIs | **gws** (dynamic discovery picks up new APIs automatically) |

---

## Installation

```bash
# Via npm (recommended — includes pre-built native binary)
npm install -g @googleworkspace/cli

# Verify
gws --version
```

Alternative: download pre-built binaries from [GitHub Releases](https://github.com/googleworkspace/cli/releases).

---

## Authentication Setup

### Prerequisites

1. A Google Cloud project (create via [console.cloud.google.com](https://console.cloud.google.com) or `gcloud`)
2. Required Google APIs enabled in the project (Drive API, Gmail API, etc.)
3. OAuth consent screen configured (add test users if in testing mode)

### Interactive Setup (Recommended)

```bash
# Guided setup — walks through GCP project configuration
gws auth setup

# OAuth login — opens browser for consent
gws auth login

# Verify authentication
gws auth status
```

### Service Account (Headless/CI)

```bash
export GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE=/path/to/service-account.json
```

### Pre-obtained Token

```bash
export GOOGLE_WORKSPACE_CLI_TOKEN=$(gcloud auth print-access-token)
```

### Common Auth Errors

| Error | Fix |
|-------|-----|
| "Access blocked" | Add yourself as test user in OAuth consent screen |
| "Google hasn't verified this app" | Click "Continue" (expected in testing mode) |
| "invalid_scope" | Unverified apps limited to ~25 scopes — reduce requested scopes |
| "redirect_uri_mismatch" | Add `http://localhost` to Authorized Redirect URIs in GCP Console |
| 403 on API call | Enable the required API in Google Cloud Console, wait a few seconds |

**Reset auth**: `gws auth logout` then `gws auth login`

**Credentials storage**: Encrypted with AES-256-GCM, stored in OS keyring (macOS Keychain / Windows Credential Manager / Linux Secret Service). Tokens auto-refresh.

---

## Command Structure

All commands follow:

```bash
gws <service> <resource> <method> [--params '<json>'] [flags]
```

Commands are **dynamically generated** from Google's Discovery Service at runtime. When Google adds an API endpoint, gws picks it up automatically (discovery docs cached 24 hours).

### Core Services & Examples

**Google Drive**
```bash
# List 10 most recent files
gws drive files list --params '{"pageSize": 10}'

# Upload a file
gws drive files create --params '{"name": "report.pdf"}' --upload ./report.pdf

# Create a folder
gws drive files create --params '{"name": "Project X", "mimeType": "application/vnd.google-apps.folder"}'

# Move a file to a folder
gws drive files update --params '{"addParents": "FOLDER_ID", "removeParents": "OLD_PARENT_ID"}' --file-id FILE_ID
```

**Gmail**
```bash
# List recent messages
gws gmail messages list --params '{"maxResults": 5}'

# Read a specific message
gws gmail messages get --params '{"id": "MESSAGE_ID", "format": "full"}'

# Send an email
gws gmail messages send --params '{"raw": "BASE64_ENCODED_RFC822"}'
```

**Google Sheets**
```bash
# Read values from a range
gws sheets spreadsheets.values get --params '{"spreadsheetId": "SHEET_ID", "range": "Sheet1!A1:D10"}'

# Append rows
gws sheets spreadsheets.values append --params '{"spreadsheetId": "SHEET_ID", "range": "Sheet1!A1", "valueInputOption": "USER_ENTERED", "requestBody": {"values": [["Name", "Score"], ["Alice", 95]]}}'

# Update cells
gws sheets spreadsheets.values update --params '{"spreadsheetId": "SHEET_ID", "range": "Sheet1!B2", "valueInputOption": "RAW", "requestBody": {"values": [[100]]}}'
```

**Google Docs**
```bash
# Create a new document
gws docs documents create --params '{"title": "Meeting Notes"}'

# Get document content
gws docs documents get --params '{"documentId": "DOC_ID"}'
```

**Google Calendar**
```bash
# List upcoming events
gws calendar events list --params '{"calendarId": "primary", "maxResults": 10, "timeMin": "2026-03-08T00:00:00Z"}'

# Create an event
gws calendar events insert --params '{"calendarId": "primary", "requestBody": {"summary": "Team Sync", "start": {"dateTime": "2026-03-10T14:00:00Z"}, "end": {"dateTime": "2026-03-10T15:00:00Z"}}}'
```

**Google Chat**
```bash
# List spaces
gws chat spaces list

# Send a message to a space
gws chat spaces.messages create --params '{"parent": "spaces/SPACE_ID", "requestBody": {"text": "Hello from gws!"}}'
```

**Admin / Directory**
```bash
# List users in domain
gws admin directory users list --params '{"domain": "example.com"}'

# Get user info
gws admin directory users get --params '{"userKey": "user@example.com"}'
```

### Discovering Available Commands

```bash
# List all available services
gws help

# List resources/methods for a service
gws drive help
gws sheets help

# Get method details
gws drive files list --help
```

---

## MCP Server Mode

gws includes a built-in MCP (Model Context Protocol) server that exposes Google Workspace APIs as structured tools over stdio.

### Starting the MCP Server

```bash
# Specific services (recommended — principle of least privilege)
gws mcp -s drive,sheets,docs

# All services
gws mcp -s all

# Single service
gws mcp -s gmail
```

### Tool Modes

| Mode | Tools Exposed | Context Cost | Best For |
|------|--------------|--------------|----------|
| `full` (default) | 200-400 individual tools | High | When you need all methods upfront |
| `compact` | ~26 tools (1 per service + `gws_discover`) | Low | Agents with limited context windows |

```bash
# Compact mode (recommended for agents)
gws mcp -s drive,sheets,calendar --tool-mode compact
```

In **compact mode**, the `gws_discover` meta-tool lets the agent explore available methods on demand without loading all tool definitions upfront.

### Claude Code MCP Configuration

Register the MCP server via the Claude CLI:

```bash
claude mcp add google-workspace -- npx @googleworkspace/cli mcp -s drive,sheets,docs,calendar --tool-mode compact
```

To scope it to a specific project only, add `--scope project`.

**Service filtering** (`-s` flag) is a security boundary — only expose services the agent actually needs. Don't use `-s all` unless necessary.

### Claude Desktop Configuration

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "google-workspace": {
      "command": "npx",
      "args": ["@googleworkspace/cli", "mcp", "-s", "drive,sheets,docs", "--tool-mode", "compact"]
    }
  }
}
```

---

## Agent Workflow Patterns

### Pattern 1: CLI-First (Bash Tool)

Use `gws` directly via Bash when you need quick, one-off operations:

```bash
# Check auth before any operation
gws auth status

# Then execute
gws drive files list --params '{"pageSize": 5}'
```

**Always check `gws auth status` first.** If not authenticated, guide the user through `gws auth login`.

### Pattern 2: MCP-First (Structured Tools)

When the MCP server is configured, use the exposed tools directly (they appear as MCP tools in Claude Code). The compact mode `gws_discover` tool helps find the right method:

1. Call `gws_discover` with the service name to see available methods
2. Call the service-specific tool (e.g., `drive_tool`) with the discovered method and params
3. Parse the structured JSON response

### Pattern 3: Scripted Automation

For multi-step workflows, chain commands:

```bash
# Create folder, upload file, share with team
FOLDER_ID=$(gws drive files create --params '{"name": "Sprint 42", "mimeType": "application/vnd.google-apps.folder"}' | jq -r '.id')
gws drive files create --params "{\"name\": \"retro.md\", \"parents\": [\"$FOLDER_ID\"]}" --upload ./retro.md
gws drive permissions create --params "{\"fileId\": \"$FOLDER_ID\", \"requestBody\": {\"role\": \"writer\", \"type\": \"group\", \"emailAddress\": \"engineering@company.com\"}}"
```

---

## Security Rules

1. **Never expose OAuth tokens or credentials** in logs, output, or tool responses
2. **Validate file paths** — prevent directory traversal when handling paths from untrusted input
3. **URL-encode user-supplied values** embedded in URL path segments
4. **Use `--sanitize` flag** when processing untrusted input (enables Google Model Armor for prompt injection detection)
5. **Principle of least privilege** — use `-s` to expose only needed services via MCP
6. **Never store credentials in code** — rely on OS keyring (automatic) or environment variables

---

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE` | Path to service account JSON |
| `GOOGLE_WORKSPACE_CLI_CLIENT_ID` | OAuth client ID override |
| `GOOGLE_WORKSPACE_CLI_CLIENT_SECRET` | OAuth client secret override |
| `GOOGLE_WORKSPACE_CLI_CONFIG_DIR` | Override config dir (default: `~/.config/gws`) |
| `GOOGLE_WORKSPACE_CLI_TOKEN` | Pre-obtained OAuth access token |

---

## Error Handling

| Error | Cause | Fix |
|-------|-------|-----|
| 401 Unauthorized | Token expired or invalid | `gws auth login` to re-authenticate |
| 403 Forbidden | API not enabled or insufficient permissions | Enable the API in GCP Console; check OAuth scopes |
| 404 Not Found | Wrong resource ID or API not enabled | Verify the ID; enable the API in GCP Console |
| 429 Rate Limited | Too many requests | Back off and retry with exponential delay |
| "command not found: gws" | Not installed | `npm install -g @googleworkspace/cli` |
| JSON parse error in `--params` | Malformed JSON | Validate JSON before passing; use single quotes around the JSON string |

---

## Output Format

All gws commands return **structured JSON**. Parse with `jq` for scripting:

```bash
# Get just file names
gws drive files list --params '{"pageSize": 5}' | jq -r '.files[].name'

# Get event times
gws calendar events list --params '{"calendarId": "primary", "maxResults": 3}' | jq '.items[] | {summary, start: .start.dateTime}'
```

---

## Limitations (Pre-v1.0)

- Breaking changes may occur between minor versions
- Unverified OAuth apps are limited to ~25 scopes (may need to verify your app for full access)
- Not an official Google product — no enterprise SLA
- Discovery document caching (24h) means very new APIs may take a day to appear
- Pull requests from external contributors temporarily disabled on the upstream repo
