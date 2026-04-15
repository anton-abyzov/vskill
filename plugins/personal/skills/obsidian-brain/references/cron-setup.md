# CronCreate Schedule Configuration

Configuration for autonomous scheduled vault maintenance via CronCreate.

---

## Default Schedule

4x/day at 08:00, 12:00, 16:00, and 20:00 (server local time):

```
CronCreate({
  schedule: "0 8,12,16,20 * * *",
  prompt: "Run obsidian-brain scheduled maintenance on vault at {{VAULT_PATH}}",
  description: "Obsidian Brain: scheduled vault maintenance (ingest, lint, index)"
})
```

### Alternative Schedules

| Frequency | Cron Expression | Use Case |
|-----------|----------------|----------|
| 4x/day (default) | `0 8,12,16,20 * * *` | Active vault with regular inbox flow |
| 2x/day | `0 9,18 * * *` | Moderate inbox flow |
| 1x/day | `0 9 * * *` | Low-volume vault |
| Every 6 hours | `0 */6 * * *` | High-volume inbox |
| Weekdays only | `0 9,17 * * 1-5` | Work-related vault |

---

## Pre-flight Checks

Every scheduled run performs these checks before executing operations. All checks must pass before any operation begins.

### 1. Vault Accessibility

```bash
test -d "{{VAULT_PATH}}/{{WIKI_DIR}}"
```

If the vault directory is not accessible (unmounted drive, permission issue, wrong path):
- Log: `YYYY-MM-DD HH:MM | !error | - | pre-flight failed: vault not accessible at {{VAULT_PATH}}`
- Abort the entire run

### 2. Inbox File Count

```bash
bash scripts/detect-changes.sh "{{VAULT_PATH}}" "{{INBOX_DIR}}"
```

Output: file count and list of recently modified files. Used to decide whether ingest runs.

### 3. Last-Run Timestamp

Read the last log entry from `{{LOG_FILE}}` and parse its timestamp. If the last scheduled run completed less than 2 hours ago, skip this run to prevent duplicate processing.

```
Last entry: "2026-04-14 08:00 | >ingest | - | scheduled run complete: ..."
Current time: 2026-04-14 09:30
Difference: 1.5 hours → SKIP (< 2 hour threshold)
```

---

## Run Priority Order

When pre-flight passes, execute operations in this order:

1. **Ingest** (if inbox has files)
   - Process all inbox files through the full ingest procedure
   - Skip if inbox is empty

2. **Lint** (conditional)
   - Run if inbox backlog exceeds threshold (default: 10 files)
   - Run if last lint was more than 7 days ago
   - Skip otherwise

3. **Index Rebuild**
   - Always runs: `bash scripts/update-index.sh "{{VAULT_PATH}}" "{{WIKI_DIR}}" "{{INDEX_FILE}}"`
   - Ensures index stays in sync even if manual edits occurred

---

## Run Logging

Every scheduled run produces log entries in `{{LOG_FILE}}`:

| Event | Log Entry |
|-------|-----------|
| Run start | `YYYY-MM-DD HH:MM \| >ingest \| - \| scheduled run started` |
| Run complete | `YYYY-MM-DD HH:MM \| >ingest \| - \| scheduled run complete: N ingested, L lint findings, index rebuilt` |
| Run skipped | `YYYY-MM-DD HH:MM \| >ingest \| - \| scheduled run skipped: last run < 2h ago` |
| Pre-flight fail | `YYYY-MM-DD HH:MM \| !error \| - \| pre-flight failed: <reason>` |
| Operation error | `YYYY-MM-DD HH:MM \| !error \| <context> \| <error description>` |

**No silent failures**: every cron invocation produces at least one log entry.

---

## Managing the Schedule

### List Active Cron Jobs
```
CronList()
```

### Delete the Schedule
```
CronDelete({ id: "<cron-job-id>" })
```

### Pause (temporary)
Delete the cron job, then recreate when ready to resume. There is no pause/resume API -- deletion is the mechanism.

---

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| No log entries after scheduled time | CronCreate not set up | Verify with `CronList()` |
| "vault not accessible" errors | Path changed or drive unmounted | Update `vault_path` in config |
| Duplicate processing | Threshold too short or clock skew | Increase the 2-hour gap or check system time |
| Missed runs | Schedule doesn't match timezone | Adjust cron expression for server timezone |
