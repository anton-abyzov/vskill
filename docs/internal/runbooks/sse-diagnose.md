# SSE Diagnose Runbook

> Increment 0838 — `sse-diagnose-source-origin-updates` (US-001 / AC-US1-05; US-005 / AC-US5-05).

When a user reports "I never see update toasts in Skill Studio", this runbook
identifies the failing branch in **under 60 seconds**. Four failure modes are
possible:

1. **EventSource never opens** — the studio's installed-skill list resolves
   to zero subscription IDs, so `useSkillUpdates` never calls `new
   EventSource(...)`.
2. **EventSource opens but reconnects** — the connection drops repeatedly
   (network blip, Cloudflare DO restart, watchdog timeout) and `fallback`
   polling takes over.
3. **Polling fallback runs but produces zero results** — typically because
   source-origin skills (locally-authored, no `vskill.lock` entry) are
   excluded from `/api/v1/skills/check-updates` unless the
   `?include=source-origin` flag is set.
4. **Toasts suppressed by visibility** — the EventSource fires `skill.updated`
   while `document.visibilityState === "hidden"`, the bell counter
   increments, but no toast renders. (Fixed in 0838 by the visibility queue;
   if the queue is also broken, all toasts vanish silently.)

---

## 60-second procedure

### 1. Open DevTools

In Skill Studio (the macOS desktop app or `vskill studio` browser tab):
- Right-click anywhere → **Inspect** (Tauri WebView) — OR —
- In `vskill studio` browser mode: `F12` / `Cmd+Opt+I`.

Open the **Console** and **Network** tabs side-by-side.

### 2. Enable the debug flag

Pick ONE of:

```
# Option A — restart with env flag (most reliable)
VSKILL_DEBUG_SSE=1 vskill studio

# Option B — append to URL (no restart)
http://localhost:<port>/?debugSse=1

# Option C — Vite/Webpack env var (when running the dev server)
VITE_VSKILL_DEBUG_SSE=1 npm run studio:dev
```

Reload the page (`Cmd+R`). The flag enables:
- Verbose `[sse]` console logs from `useSkillUpdates` (every lifecycle event).
- Structured `proxy.sse.start` / `proxy.sse.end` logs in the eval-server
  process (in the terminal running `vskill studio`).
- An `X-Request-Id` response header on every SSE proxy request — visible in
  the Network tab and matched against the eval-server logs.

### 3. Identify the branch

Inspect the bell icon **status pip** (top-right of the Studio window):

| Pip color | `useSkillUpdates.status` | Meaning |
|-----------|--------------------------|---------|
| Green     | `connected`              | EventSource open, healthy. |
| Amber     | `fallback`               | EventSource dropped → polling fallback. |
| Grey      | `connecting`             | EventSource still negotiating. |
| **Hidden**| —                        | Zero installed + zero source-origin tracked skills (no SSE attempted). |

Hover the bell tooltip — it appends `Live updates: connected` /
`reconnecting` / `offline` for screen readers and at-a-glance ops.

#### Branch (a) — EventSource never opens

**Symptoms**:
- No `[sse] open` console log within ~3 seconds of page load.
- No `/api/v1/skills/stream` entry in Network tab.
- Bell pip is hidden.

**Cause**: zero resolvable subscription IDs. Either the user has no installed
skills with a registry twin, OR all skills are source-origin and the studio
hasn't matched them via `/api/v1/skills/lookup-by-name`.

**Fix path**:
- Confirm at least one installed skill has a `uuid`/`slug` (check
  `useStudio().skills` in the React DevTools).
- If only source-origin skills are present, confirm they have an `author`
  field in their `SKILL.md` frontmatter — the lookup batch silently drops
  entries without one.
- Confirm `/api/v1/skills/lookup-by-name` returns at least one row with a
  `uuid` in the Network tab.

#### Branch (b) — EventSource opens but reconnects

**Symptoms**:
- Repeated `[sse] open` → `[sse] error` → `[sse] reconnect-scheduled`
  console pairs.
- `proxy.sse.end` logs show non-zero `status` codes (502, 504) on the
  server side.
- Bell pip is amber (or flickers between green and amber).

**Cause**: upstream Cloudflare Worker is dropping connections. Common
triggers: DO restart on deploy, watchdog timeout, customer-side network
blip.

**Fix path**:
- Check `proxy.sse.end` `durationMs` — durations < ~30s suggest upstream
  drop; durations > the watchdog (90s by default) suggest a network
  blip.
- Cross-reference `X-Request-Id` from a failing request with eval-server
  logs to confirm the proxy saw the same status.
- If sustained, escalate to platform team: query Analytics Engine
  `studio_sse_telemetry` dataset for the affected `sessionId` (see
  AC-US5-04 telemetry below).

#### Branch (c) — Polling fallback runs but produces zero results

**Symptoms**:
- `[sse] fallback-armed` then `[sse] fallback-flipped` console logs.
- Network tab shows `/api/v1/skills/check-updates` returning `{results: []}`
  every poll cycle.
- Bell counter stays at zero despite known publishes.

**Cause**: source-origin skills are not included in the polling request
body. Without `?include=source-origin` AND a `sourceOrigin: [...]` payload,
the platform only walks `vskill.lock` entries.

**Fix path**:
- Confirm the studio's polling request (`Network → check-updates → Payload`)
  includes a `sourceOrigin` array AND the URL has `?include=source-origin`.
- Confirm each source-origin entry has `name` (3-segment when known),
  `author`, and `version`.
- If the entry has no registry twin, the platform silently excludes it by
  contract (AC-US2-03) — there is nothing to fix; the skill simply has not
  been published.

#### Branch (d) — Toasts suppressed by visibility

**Symptoms**:
- `[sse] message` logs fire AND the bell counter increments.
- No toast appears.
- `document.visibilityState === "hidden"` at the moment the message
  arrives.

**Cause**: the toast was enqueued to `localStorage` under key
`vskill:toast-queue` (US-003 / 0838). On the next visibility flip to
`visible`, queued toasts replay at 250ms intervals.

**Fix path**:
- Inspect `localStorage["vskill:toast-queue"]` in the Console:
  ```js
  JSON.parse(localStorage.getItem("vskill:toast-queue") ?? "[]")
  ```
- Cmd+Tab back to Studio — toasts should drain in order with 250ms spacing.
- If queued toasts are older than 30 minutes, they are dropped silently
  (stale; presumed reconciled by polling).
- Cross-window dedupe: each tab keeps an in-memory `Set<eventId>`; a toast
  already replayed in tab A will not re-fire in tab B.

---

## Telemetry (AC-US5-04)

Every EventSource lifecycle transition writes one Analytics Engine row
under the `STUDIO_SSE_TELEMETRY` binding (`studio_sse_telemetry` dataset).
Schema:

| Column      | Source                          |
|-------------|---------------------------------|
| `index1`    | `sessionId` (v4 UUID per tab)   |
| `blob1`     | `event` enum                    |
| `blob2`     | `sourceTier` enum               |
| `double1`   | `timestamp` (ms epoch)          |
| `double2`   | `durationSinceOpenMs` (or 0)    |

Query example (Cloudflare dashboard → Workers & Pages → Analytics →
custom queries):

```sql
SELECT blob1 AS event,
       blob2 AS sourceTier,
       count() AS n
FROM studio_sse_telemetry
WHERE timestamp > now() - INTERVAL '24' HOUR
GROUP BY event, sourceTier
ORDER BY n DESC
```

Failures (4xx, 5xx, network) are swallowed silently — telemetry never
blocks the user-visible SSE path.

> **Privacy note**: payloads contain NO skill IDs, NO user identifiers, NO
> message content. Only the v4 session UUID, event enum, source-tier enum,
> and a timestamp.

### Telemetry opt-out (AC-US5-05)

To suppress all telemetry pings from one Studio session, append
`?disableTelemetry=1` to the URL OR set `VSKILL_DISABLE_TELEMETRY=1` in
the environment before launching `vskill studio`. The studio honors the
flag for the entire tab lifetime.

```
# Per-launch
VSKILL_DISABLE_TELEMETRY=1 vskill studio

# Per-session (URL)
http://localhost:<port>/?disableTelemetry=1

# Both flags can be combined freely:
VSKILL_DEBUG_SSE=1 VSKILL_DISABLE_TELEMETRY=1 vskill studio
```

---

## Useful selectors

| Where        | Selector                                   |
|--------------|--------------------------------------------|
| Bell button  | `[data-testid="update-bell"]`              |
| Bell icon    | `[data-testid="update-bell-icon"]`         |
| Bell badge   | `[data-testid="update-bell-badge"]`        |
| Status pip   | `[data-testid="update-bell-status-pip"]`   |
| Status text  | `[data-testid="update-bell-status-text"]`  |

The hidden `update-bell-status-text` span is wired via `aria-describedby`
to the bell button so screen readers announce the live-updates state on
focus.

---

## Related contracts

- ID format (UUID or `sk_published_*` slug): see
  `src/lib/skill-update/update-hub.ts` (vskill-platform).
- Subscription resolver: `src/eval-ui/src/utils/resolveSubscriptionIds.ts`
  (vskill).
- Source-origin lookup: `POST /api/v1/skills/lookup-by-name`
  (vskill-platform).
- Source-origin polling: `POST /api/v1/skills/check-updates?include=source-origin`
  with `body.sourceOrigin: [{name, author, version}, ...]`.
- Telemetry sink: `POST /api/v1/studio/telemetry/sse` →
  `STUDIO_SSE_TELEMETRY` Analytics Engine dataset.
- Visibility queue: `src/eval-ui/src/utils/toastQueue.ts` (`localStorage`
  key `vskill:toast-queue`, max 10 entries, 30-min TTL, 250ms replay).
