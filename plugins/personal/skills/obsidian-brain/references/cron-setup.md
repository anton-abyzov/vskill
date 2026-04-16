# Scheduling Obsidian Brain

Three ways to run the pipeline automatically, each with different trade-offs.

---

## Quick Comparison

```
┌─────────────┬───────────┬──────────┬──────────┬────────┬──────────┐
│ Method      │ Where     │ Survives │ Survives │ Local  │ Best For │
│             │           │ session  │ reboot   │ files  │          │
├─────────────┼───────────┼──────────┼──────────┼────────┼──────────┤
│ launchd     │ macOS     │ Yes      │ Yes      │ Yes    │ Permanent│
│ agent       │ native    │          │          │        │ 4x/day   │
├─────────────┼───────────┼──────────┼──────────┼────────┼──────────┤
│ CronCreate  │ Claude    │ 7 days   │ Yes      │ Yes    │ Quick    │
│ (durable)   │ local     │ (expiry) │ (durable)│        │ setup    │
├─────────────┼───────────┼──────────┼──────────┼────────┼──────────┤
│ CronCreate  │ Claude    │ No       │ No       │ Yes    │ One-off  │
│ (session)   │ local     │          │          │        │ testing  │
├─────────────┼───────────┼──────────┼──────────┼────────┼──────────┤
│ Routine     │ Anthropic │ Yes      │ Yes      │ No     │ Cloud    │
│ (/schedule) │ cloud     │          │          │        │ tasks    │
├─────────────┼───────────┼──────────┼──────────┼────────┼──────────┤
│ /loop       │ Claude    │ No       │ No       │ Yes    │ Polling  │
│             │ local     │          │          │        │ in work  │
└─────────────┴───────────┴──────────┴──────────┴────────┴──────────┘
```

**Obsidian Brain needs local file access** (read/write markdown in the vault). This rules out cloud Routines. The recommended setup is **launchd** for permanent scheduling + **CronCreate** for quick in-session use.

---

## Option 1: launchd Agent (Recommended — Permanent)

Runs the pipeline via Claude Code CLI on macOS. Survives reboots, no session needed.

### Setup

Create the plist:

```bash
cat > ~/Library/LaunchAgents/com.user.obsidian-brain.plist << 'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.user.obsidian-brain</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>-c</string>
        <string>claude -p "Run the obsidian-brain knowledge pipeline on ~/Projects/Obsidian/personal-docs/. Process raw/inbox/ files: classify, route credentials securely, compile wiki pages, cross-link related documents, update index.md and log.md, run lint checks. Follow the obsidian-brain skill instructions." --output-format text >> ~/.obsidian-brain/run.log 2>&1</string>
    </array>
    <key>StartCalendarInterval</key>
    <array>
        <dict><key>Hour</key><integer>8</integer><key>Minute</key><integer>13</integer></dict>
        <dict><key>Hour</key><integer>12</integer><key>Minute</key><integer>13</integer></dict>
        <dict><key>Hour</key><integer>16</integer><key>Minute</key><integer>13</integer></dict>
        <dict><key>Hour</key><integer>20</integer><key>Minute</key><integer>13</integer></dict>
    </array>
    <key>StandardOutPath</key>
    <string>/Users/antonabyzov/.obsidian-brain/launchd-stdout.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/antonabyzov/.obsidian-brain/launchd-stderr.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>
    </dict>
</dict>
</plist>
PLIST
```

### Activate

```bash
mkdir -p ~/.obsidian-brain
launchctl load ~/Library/LaunchAgents/com.user.obsidian-brain.plist
```

### Manage

```bash
# Check status
launchctl list | grep obsidian-brain

# Run manually (test)
bash -c 'claude -p "Run the obsidian-brain knowledge pipeline on ~/Projects/Obsidian/personal-docs/..." --output-format text'

# View logs
tail -50 ~/.obsidian-brain/run.log
tail -20 ~/.obsidian-brain/launchd-stderr.log

# Stop
launchctl unload ~/Library/LaunchAgents/com.user.obsidian-brain.plist

# Restart (after editing plist)
launchctl unload ~/Library/LaunchAgents/com.user.obsidian-brain.plist
launchctl load ~/Library/LaunchAgents/com.user.obsidian-brain.plist
```

---

## Option 2: CronCreate (In-Session — Quick Setup)

Works while Claude is open. Use `durable: true` to survive restarts (7-day expiry).

### Register

```
CronCreate({
  cron: "13 8,12,16,20 * * *",
  prompt: "Run the obsidian-brain knowledge pipeline on ~/Projects/Obsidian/personal-docs/. Process raw/inbox/ files: classify, route credentials securely, compile wiki pages, cross-link related documents, update index.md and log.md, run lint checks. Follow the obsidian-brain skill instructions.",
  recurring: true,
  durable: true
})
```

### Alternative Schedules

| Frequency | Cron Expression | Use Case |
|-----------|----------------|----------|
| 4x/day (default) | `13 8,12,16,20 * * *` | Active vault with regular inbox flow |
| 2x/day | `7 9,18 * * *` | Moderate inbox flow |
| 1x/day | `3 9 * * *` | Low-volume vault |
| Every 6 hours | `17 */6 * * *` | High-volume inbox |
| Weekdays only | `7 9,17 * * 1-5` | Work-related vault |

Minutes are offset from :00/:30 to avoid API congestion.

### Manage

```
CronList()                    # List active jobs
CronDelete({ id: "<id>" })   # Remove a job
```

### Limitations

- `durable: false` (default): dies when Claude session ends
- `durable: true`: written to `~/.claude/scheduled_tasks.json`, survives restarts, but **auto-expires after 7 days**
- Minimum interval: 60s, Maximum: 3600s
- Only fires while Claude REPL is idle (not mid-query)

---

## Option 3: Routine (/schedule — Cloud)

Runs in Anthropic cloud. Does **NOT** work for obsidian-brain because it cannot access local files. Listed here for completeness.

```
/schedule "daily vault summary at 9am"
```

Could work for: notifications, Slack alerts about vault status, or triggering a webhook that invokes a local script. But the actual vault processing must run locally.

---

## What to Tell Claude in a New Session

Copy-paste this to give any new session full context:

> "I have the obsidian-brain skill installed. It manages my Obsidian vault at ~/Projects/Obsidian/personal-docs/ using the PARA + LLM Wiki pattern. Operations: ingest (inbox → wiki + PARA routing), query (cross-vault synthesis), lint (orphans, backlog, missing links). Scheduled 4x/day via launchd (com.user.obsidian-brain). Logs at ~/.obsidian-brain/run.log and wiki/log.md. If I need to modify the pipeline, edit the skill at repositories/anton-abyzov/vskill/plugins/personal/skills/obsidian-brain/SKILL.md."

---

## Pre-flight Checks (All Methods)

Every scheduled run performs these checks before executing. All must pass.

### 1. Vault Accessibility

```bash
test -d "{{VAULT_PATH}}/{{WIKI_DIR}}"
```

If not accessible: log `!error | pre-flight failed: vault not accessible`, abort.

### 2. Inbox File Count

```bash
bash scripts/detect-changes.sh "{{VAULT_PATH}}" "{{INBOX_DIR}}"
```

Output: file count + recently modified files. Decides whether ingest runs.

### 3. Last-Run Timestamp

Read last log entry from `{{LOG_FILE}}`. If last scheduled run < 2 hours ago, skip to prevent duplicates.

---

## Run Priority Order

1. **Ingest** (if inbox has files) — full ingest procedure
2. **Lint** (if backlog > 10 or last lint > 7 days ago) — orphans, missing links, stale info
3. **Index Rebuild** (always) — `bash scripts/update-index.sh`

---

## Run Logging

Every run produces at least one log entry. **No silent failures.**

| Event | Log Entry |
|-------|-----------|
| Run start | `YYYY-MM-DD HH:MM \| >ingest \| - \| scheduled run started` |
| Run complete | `YYYY-MM-DD HH:MM \| >ingest \| - \| scheduled run complete: N ingested, L lint findings` |
| Run skipped | `YYYY-MM-DD HH:MM \| >ingest \| - \| scheduled run skipped: last run < 2h ago` |
| Pre-flight fail | `YYYY-MM-DD HH:MM \| !error \| - \| pre-flight failed: <reason>` |
| Error | `YYYY-MM-DD HH:MM \| !error \| <context> \| <error description>` |

---

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| No log entries after scheduled time | Schedule not active | `launchctl list \| grep obsidian-brain` or `CronList()` |
| "vault not accessible" errors | Path changed or drive unmounted | Update vault_path config |
| Duplicate processing | Threshold too short | Increase 2-hour gap |
| launchd not firing | Plist not loaded | `launchctl load ~/Library/LaunchAgents/com.user.obsidian-brain.plist` |
| CronCreate expired | 7-day auto-expiry | Re-register with `CronCreate()` |
| Claude CLI not found by launchd | PATH not set in plist | Verify PATH in EnvironmentVariables includes claude location |
