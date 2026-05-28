---
name: blotato
description: "Blotato social-media publishing and scheduling platform — REST API + MCP server. Publish and schedule posts across X/Twitter, TikTok, Instagram, LinkedIn, YouTube, Facebook, Threads, Pinterest, and more from a single integration. Use this skill whenever the user wants to schedule, publish, queue, or batch-post content to multiple social channels at once, especially when limits on browser-based posting tools (Postiz, Buffer) are an issue. Trigger phrases: 'schedule on Blotato', 'use Blotato', 'post to TikTok and X', 'Blotato API', 'bulk-schedule posts'. Also activate when the user references their Blotato account, Blotato dashboard, Blotato API key, or asks about post status / queue verification."
metadata:
  version: 1.0.0
  tags: blotato, social-media, posting, scheduling, tiktok, twitter, x, instagram, linkedin, threads, youtube, facebook, automation, mcp, api
  author: Anton Abyzov
  repository: https://github.com/anton-abyzov/vskill
---

# Blotato Publisher

Publish and schedule social-media posts across X/Twitter, TikTok, Instagram, LinkedIn, YouTube, Facebook, Threads, Pinterest, Bluesky and more — via REST API or the Blotato MCP server. Designed for high-volume launches where browser-based tools (Postiz, Buffer) hit their per-platform UI rate limits.

---

## When to use

- Scheduling 5+ posts across 2+ platforms in one batch
- Publishing the same media (video, image, carousel) to TikTok + X + Instagram + Threads simultaneously
- Building a multi-day launch campaign (e.g., 13-day product-launch cadence)
- When Postiz / Buffer / native UIs are blocked, rate-limited, or unsupported for the target account
- When the user has already connected accounts at `https://www.blotato.com/dashboard` and has an API key

## When NOT to use

- Single one-off post that the user can publish manually in 30 seconds
- Replying to specific tweets / engagement workflows (Blotato is for posting, not engaging — use platform-specific tools or browser automation)
- When the user explicitly asks to use a different tool (e.g., "use Postiz only")

---

## Setup (one-time)

1. **Sign up** at `https://www.blotato.com/` — create a Blotato account.
2. **Connect social accounts** at `https://www.blotato.com/dashboard` → Accounts → add X, TikTok, Instagram, LinkedIn, etc. Authorize each one. Blotato handles the OAuth flow per platform.
3. **Get API key**: `https://www.blotato.com/dashboard` → Settings → API → Generate key. Copy it (format: `blt_<base64>=`).
4. **Store the key** in the user's secrets vault. Recommended path: `~/.zshrc` or `.env`:
   ```bash
   export BLOTATO_API_KEY='blt_xxxxxxxxxxxxxxxxxxxxxxxx='
   ```
5. **Verify** by calling `list accounts` (see below). The response should include every connected platform with its `accountId`.

---

## Two integration modes

### Mode A — REST API (recommended for batch work, scripts, CI/CD)

**Base URL**: `https://backend.blotato.com/v2`
**Auth header**: `blotato-api-key: $BLOTATO_API_KEY`
**Content-Type**: `application/json`

> ⚠️ **DNS gotcha (April 2026 onward)**: `backend.blotato.com` sometimes fails to resolve via public DNS resolvers. The actual host is on Heroku. Workaround:
> ```bash
> IP=$(dig +short A blooming-garbanzo-gikc58n9n0a3rgn28l96fwwu.herokudns.com | head -1)
> curl ... --resolve "backend.blotato.com:443:$IP"
> ```
> Re-resolve at the start of every batch — Heroku IPs rotate.

### Mode B — MCP server (recommended for chat-style interactive use)

Add to `~/.claude/mcp.json`:
```json
{
  "mcpServers": {
    "blotato": {
      "type": "http",
      "url": "https://mcp.blotato.com/mcp",
      "headers": { "blotato-api-key": "$BLOTATO_API_KEY" }
    }
  }
}
```

Tools exposed:
- `blotato_list_accounts` — get every connected social account
- `blotato_upload_media` — upload an image/video, returns a Blotato-hosted media URL
- `blotato_create_post` — schedule or publish immediately
- `blotato_get_post_status` — poll until `scheduled` / `published` / `failed`

---

## Core workflow

```
1. LIST ACCOUNTS   → get the accountId for each platform you want to post to
2. UPLOAD MEDIA    → if posting video/image, upload to Blotato storage first
3. CREATE POST     → schedule each post (or fire immediately by omitting scheduledTime)
4. VERIFY          → list posts and confirm scheduled state + correct time
```

### Step 1 — List accounts

```bash
IP=$(dig +short A blooming-garbanzo-gikc58n9n0a3rgn28l96fwwu.herokudns.com | head -1)
curl -sS "https://backend.blotato.com/v2/accounts" \
  -H "blotato-api-key: $BLOTATO_API_KEY" \
  --resolve "backend.blotato.com:443:$IP" | jq
```

Response shape:
```json
{
  "accounts": [
    { "id": "44288", "platform": "tiktok", "handle": "wc26net", "active": true },
    { "id": "19294", "platform": "twitter", "handle": "wc26net", "active": true },
    { "id": "18001", "platform": "twitter", "handle": "aabyzov", "active": true }
  ]
}
```

> Always cache the `id` per platform/handle in a constants block at the top of your batch script. Account IDs are stable.

### Step 2 — Upload media (optional)

If you already have a public CDN URL (S3, Cloudflare R2, Postiz CDN, etc.), skip this step and use the public URL directly in `mediaUrls`.

If your media is local-only:

```bash
curl -sS -X POST "https://backend.blotato.com/v2/media" \
  -H "blotato-api-key: $BLOTATO_API_KEY" \
  --resolve "backend.blotato.com:443:$IP" \
  -F "file=@/path/to/video.mp4"
```

Response includes `{"mediaUrl": "https://database.blotato.io/storage/v1/object/public/public_media/<owner>/<uuid>.mp4"}` — use that string in `mediaUrls`.

### Step 3 — Create a post

#### X / Twitter

```bash
curl -sS -X POST "https://backend.blotato.com/v2/posts" \
  -H "blotato-api-key: $BLOTATO_API_KEY" \
  -H "Content-Type: application/json" \
  --resolve "backend.blotato.com:443:$IP" \
  -d '{
    "post": {
      "accountId": "19294",
      "content": {
        "platform": "twitter",
        "text": "13 days until kickoff.\n\nwc-26.net",
        "mediaUrls": ["https://database.blotato.io/storage/.../launch.mp4"]
      },
      "target": { "targetType": "twitter" }
    },
    "scheduledTime": "2026-05-29T15:00:00Z"
  }'
```

#### TikTok (richer target object)

```bash
curl -sS -X POST "https://backend.blotato.com/v2/posts" \
  -H "blotato-api-key: $BLOTATO_API_KEY" \
  -H "Content-Type: application/json" \
  --resolve "backend.blotato.com:443:$IP" \
  -d '{
    "post": {
      "accountId": "44288",
      "content": {
        "platform": "tiktok",
        "text": "13 days. 48 teams. 16 cities.\n\nwc-26.net 👇\n\n#WorldCup2026 #fyp",
        "mediaUrls": ["https://database.blotato.io/storage/.../launch.mp4"]
      },
      "target": {
        "targetType": "tiktok",
        "privacyLevel": "PUBLIC_TO_EVERYONE",
        "disabledComments": false,
        "disabledDuet": false,
        "disabledStitch": false,
        "isBrandedContent": false,
        "isYourBrand": true,
        "isAiGenerated": false
      }
    },
    "scheduledTime": "2026-05-29T13:00:00Z"
  }'
```

> **Critical TikTok flags**: `isYourBrand: true` is required for first-party brand accounts. `isAiGenerated: true` MUST be set when the video was AI-generated (Veo / Kling / Higgsfield / Sora / Kie.ai) — TikTok now enforces AI-content labels per their policy. Misclassifying gets accounts shadowbanned.

#### Instagram (standalone)

```json
{
  "post": {
    "accountId": "<ig_account_id>",
    "content": {
      "platform": "instagram",
      "text": "13 days until WC26. ⚽🌎",
      "mediaUrls": ["https://.../launch.mp4"]
    },
    "target": { "targetType": "instagram", "postType": "post" }
  },
  "scheduledTime": "2026-05-29T16:00:00Z"
}
```

> Valid `postType` values for Instagram-standalone: `"post"`, `"story"`. Do **not** use `"reel"` — Blotato will reject. For Reels, use Instagram-via-Facebook-Business connection.

#### Common pitfalls (debugged in production)

| Issue | Fix |
|---|---|
| `text` contains newlines / quotes | JSON-escape: `$(jq -Rs . <<<"$text")` in bash |
| Schedule fires immediately | Always include `scheduledTime` in **ISO 8601 UTC** format with trailing `Z` |
| 401 unauthorized | Check header name: `blotato-api-key` (kebab-case, lowercase) |
| Post creates but never publishes | Check the account is still authorized in dashboard — Blotato silently disables expired OAuth tokens |
| DNS resolution fails | Use `--resolve` workaround above |

### Step 4 — Verify queue

```bash
curl -sS "https://backend.blotato.com/v2/posts?limit=100" \
  -H "blotato-api-key: $BLOTATO_API_KEY" \
  --resolve "backend.blotato.com:443:$IP" | \
  jq -r '.items[] | select(.state.type=="scheduled") |
    "\(.postTime[0:16]) | \(.platform | .[0:2] | ascii_upcase) | \(.text | .[0:80] | gsub("\n";" "))"'
```

> **Response schema gotcha**: the queue endpoint returns `{"items": [...], "cursor": "..."}`, **not** `{"posts": [...]}`. The cursor is a base64-encoded continuation token for pagination — pass it as `?cursor=` to get the next page. Iterate until `cursor` is empty/null.

---

## Batch scheduling pattern (production-tested)

For multi-day campaigns, structure your script as a single bash file with helper functions:

```bash
#!/bin/bash
set -e
export BLOTATO_API_KEY='blt_...'
IP=$(dig +short A blooming-garbanzo-gikc58n9n0a3rgn28l96fwwu.herokudns.com | head -1)
MEDIA="https://database.blotato.io/storage/.../launch.mp4"
TT_ACCOUNT=44288   # TikTok @wc26net
X_ACCOUNT=19294    # X @wc26net

post_tt() {
  curl -sS -X POST "https://backend.blotato.com/v2/posts" \
    -H "blotato-api-key: $BLOTATO_API_KEY" -H "Content-Type: application/json" \
    --resolve "backend.blotato.com:443:$IP" \
    -d "{\"post\":{\"accountId\":\"$1\",\"content\":{\"platform\":\"tiktok\",\"text\":$(jq -Rs . <<<"$2"),\"mediaUrls\":[\"$MEDIA\"]},\"target\":{\"targetType\":\"tiktok\",\"privacyLevel\":\"PUBLIC_TO_EVERYONE\",\"disabledComments\":false,\"disabledDuet\":false,\"disabledStitch\":false,\"isBrandedContent\":false,\"isYourBrand\":true,\"isAiGenerated\":false}},\"scheduledTime\":\"$3\"}" \
    | jq -r '.postSubmissionId // .error'
}

post_x() {
  curl -sS -X POST "https://backend.blotato.com/v2/posts" \
    -H "blotato-api-key: $BLOTATO_API_KEY" -H "Content-Type: application/json" \
    --resolve "backend.blotato.com:443:$IP" \
    -d "{\"post\":{\"accountId\":\"$1\",\"content\":{\"platform\":\"twitter\",\"text\":$(jq -Rs . <<<"$2"),\"mediaUrls\":[\"$MEDIA\"]},\"target\":{\"targetType\":\"twitter\"}},\"scheduledTime\":\"$3\"}" \
    | jq -r '.postSubmissionId // .error'
}

# Day 1 cadence
post_tt $TT_ACCOUNT "13 days. 48 teams. 16 cities."  "2026-05-29T13:00:00Z"
post_x  $X_ACCOUNT  "13 days until FIFA World Cup."  "2026-05-29T15:00:00Z"

# ... continue for each day ...
```

This pattern scales to 50+ posts per script. Every successful create returns a `postSubmissionId` — log these so you can match server-side state back to your local plan.

---

## Algorithm-aware cadence (per platform)

| Platform | Daily cap | Best-time UTC | Notes |
|---|---|---|---|
| TikTok | **3/day max** | 13:00, 16:00, 22:00 | FIFA's official Preferred Platform. Highest 3-second-retention algorithm. AI-content label MUST be honest. |
| X / Twitter | 4–6/day | 13:00, 15:00, 19:00, 22:00 | Replies > standalone posts for organic reach. Don't stack same-content across times. |
| Instagram-standalone | 2/day | 14:00, 17:00 | Reels surface to non-followers more than feed posts. |
| LinkedIn | 1/day | 13:00 Tue/Wed/Thu | Founder voice beats brand voice 5×. |
| Threads | 3–5/day | 14:00, 19:00 | Algorithm rewards reply-density. |
| Facebook Page | 1–2/day | 14:00, 18:00 | Older demographic; better paid-ad target than organic. |
| YouTube Shorts | 1–2/day | 23:00 (US peak) | Longest tail; SEO matters. |

> **Never paste the same caption across platforms.** The algorithms penalize obvious cross-posts. Adapt: shorter for X, hashtags for IG/TikTok, no hashtags for LinkedIn, conversational for Threads.

---

## Verification & telemetry

After scheduling a batch, dump the queue to a file and diff against your plan:

```bash
curl -sS "https://backend.blotato.com/v2/posts?limit=100" \
  -H "blotato-api-key: $BLOTATO_API_KEY" \
  --resolve "backend.blotato.com:443:$IP" > /tmp/blotato-queue.json

# Count scheduled by platform
jq -r '[.items[] | select(.state.type=="scheduled")] | group_by(.platform) | .[] | "\(.[0].platform): \(length)"' /tmp/blotato-queue.json
```

The web dashboard view of scheduled posts is at:
**`https://www.blotato.com/dashboard`** → Posts → Scheduled tab.

> `https://my.blotato.com/scheduled` is **NOT** a valid URL — returns 404. Always use `www.blotato.com/dashboard` as the canonical entry point.

---

## Failure modes & escalation

| Symptom | Likely cause | Fix |
|---|---|---|
| HTTP 401 on every call | Wrong auth header name or expired key | Use `blotato-api-key:` (NOT `Authorization: Bearer`). Regenerate key in dashboard. |
| HTTP 522 / SSL error | Heroku DNS rotation | Re-run `dig +short A blooming-garbanzo-gikc58n9n0a3rgn28l96fwwu.herokudns.com` and update `--resolve`. |
| Post scheduled but never publishes | Account OAuth expired | Open `www.blotato.com/dashboard` → Accounts → re-authorize the disconnected platform. |
| TikTok post fails with content-policy error | Missing `isAiGenerated` or incorrect `privacyLevel` | Add `"isAiGenerated": true` if applicable; valid privacy: `PUBLIC_TO_EVERYONE`, `MUTUAL_FOLLOW_FRIENDS`, `FOLLOWER_OF_CREATOR`, `SELF_ONLY`. |
| Instagram fails with "post_type invalid" | Tried `"reel"` on standalone IG | Use `"post"` or connect IG via Facebook Business for reels. |
| `mediaUrls` rejected | URL not publicly accessible | Upload via `/v2/media` first OR use a public CDN (R2, S3, Cloudflare). |

---

## Quotas & limits (as of May 2026)

- **Free tier**: 10 posts/month, 1 account per platform
- **Creator ($29/mo)**: 200 posts/month, 5 accounts per platform
- **Agency ($99/mo)**: 1000 posts/month, unlimited accounts
- **API rate limit**: 60 requests/minute (across all endpoints)
- **Max media size**: 500 MB (video), 25 MB (image)
- **Max video duration**: 10 minutes (platform-specific limits apply downstream — TikTok 10min, X 2:20, IG Reels 90s)

Hitting the rate limit returns `429 Too Many Requests` with a `Retry-After` header. Respect it; don't hammer.

---

## Requirements

- Blotato account at `https://www.blotato.com/` (free tier works for small launches)
- API key in `$BLOTATO_API_KEY`
- `curl` + `jq` for the REST flow (every modern dev box has both)
- `dig` for the DNS workaround (macOS / Linux native)
- Publicly accessible media (CDN URL or Blotato `/v2/media` upload)

---

## Related skills

- `social-media-posting` (this plugin) — broader cross-platform orchestrator with image generation
- `social-posts` (this plugin) — copywriting + Chrome-based interactive posting
- `slack-messaging` (this plugin) — Slack-specific session boundaries

Use Blotato when you have already drafted content and need reliable batch scheduling. Use `social-media-posting` when you need the full draft → image → review → post loop.

---

## Quick reference — every operation in one block

```bash
# 0. Setup
export BLOTATO_API_KEY='blt_...'
IP=$(dig +short A blooming-garbanzo-gikc58n9n0a3rgn28l96fwwu.herokudns.com | head -1)
HDR="-H blotato-api-key:$BLOTATO_API_KEY"
RES="--resolve backend.blotato.com:443:$IP"
BASE="https://backend.blotato.com/v2"

# 1. List accounts
curl -sS $HDR $RES "$BASE/accounts" | jq '.accounts[] | {id, platform, handle}'

# 2. Upload media (only if no public CDN URL)
curl -sS $HDR $RES -X POST "$BASE/media" -F file=@./launch.mp4 | jq -r '.mediaUrl'

# 3. Create post (X example)
curl -sS $HDR $RES -X POST "$BASE/posts" \
  -H "Content-Type: application/json" \
  -d '{"post":{"accountId":"19294","content":{"platform":"twitter","text":"hello world","mediaUrls":[]},"target":{"targetType":"twitter"}},"scheduledTime":"2026-06-01T15:00:00Z"}' \
  | jq -r '.postSubmissionId'

# 4. List queue
curl -sS $HDR $RES "$BASE/posts?limit=50" | \
  jq -r '.items[] | select(.state.type=="scheduled") | "\(.postTime[0:16]) \(.platform) \(.text[0:60])"'

# 5. Delete (cancel) a scheduled post
curl -sS $HDR $RES -X DELETE "$BASE/posts/<postId>"
```
