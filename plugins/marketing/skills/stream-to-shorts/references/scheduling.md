# Scheduling

Stage 9: turn checked masters into a spaced calendar, create the posts, and change them safely afterwards.

## Who owns what

| Question | Owner |
|---|---|
| Which account gets which kind of clip, account ids, per-post approval, verify-after-publish habits | `social-media-posting` |
| When each post goes out, spacing, caps, variants, the queue guard, redaction | this skill |

This skill holds no account ids. You build a local `accounts.json` from the routing skill for each batch and keep it out of any repository.

## Inputs

`clips.json`, in priority order:

```json
[
  {"id": "a01-demo", "tags": ["talk", "product"], "lead": "2026-11-21 13:00"},
  {"id": "a02-limit", "tags": ["talk"], "lead": "2026-11-22 10:00"},
  {"id": "a03-game", "tags": ["gameplay"], "lead": "2026-11-22 17:00"},
  {"id": "a02-limit-b", "tags": ["talk"], "variant_of": "a02-limit"}
]
```

`accounts.json`:

```json
{
  "accounts": [
    {"key": "yt-main", "platform": "youtube", "backend": "postiz", "ref": "<scheduler account id>", "wave": "lead", "offset_minutes": 0},
    {"key": "tiktok-main", "platform": "tiktok", "backend": "blotato", "ref": "<id>", "wave": "lead", "offset_minutes": 30},
    {"key": "x-main", "platform": "x", "backend": "blotato", "ref": "<id>", "wave": "follow", "offset_minutes": 0},
    {"key": "pro-main", "platform": "linkedin", "backend": "postiz", "ref": "<id>", "wave": "follow", "offset_minutes": 90, "exclude_tags": ["gameplay"]},
    {"key": "brand-yt", "platform": "youtube", "backend": "postiz", "ref": "<id>", "wave": "follow", "offset_minutes": 30, "require_tags": ["product"]},
    {"key": "es-reels", "platform": "instagram", "backend": "postiz", "ref": "<id>", "lang": "es", "wave": "follow", "offset_minutes": 60, "max_per_day": 1}
  ],
  "caps": [
    {"name": "short-video plan limit", "accounts": ["tiktok-main"], "max": 3, "window_hours": 24}
  ]
}
```

A clip may also carry `content` (the post text, media, title and settings, or one such object per language code) and `meta` (hook type, title wording, length), which the planner copies onto each post. `references/spec-format.md` lists every key.

`busy.json`: every post already queued or created on those accounts, from the scheduler's queue and this batch's receipts, as `[{"account": "yt-main", "when": "2026-11-21T18:00:00Z"}]`. Existing posts count against every rule and are never moved.

## Rules the planner applies

```bash
python3 <SKILL_DIR>/scripts/plan_schedule.py clips.json accounts.json --busy busy.json \
  --tz America/New_York --out plan.json --calendar calendar.csv --report schedule.md
```

| Rule | Default | Why |
|---|---|---|
| Spacing on one account | 6 hours between any two posts, planned or existing (`min_gap_hours`) | A second post inside the window competes with the first |
| Quiet hours | nothing before 07:00 or after 22:00 local (`--earliest`, `--latest`) | No night slots |
| Step | a blocked slot moves forward 30 minutes at a time | Keeps the wanted order |
| Rolling cap | `caps`: at most `max` posts in any `window_hours` across the listed accounts | A scheduler plan may limit short-video posts per 24 hours. It is a parameter because plans differ on whether they count posts or accounts: read yours |
| Daily cap | `max_per_day` on an account | A new account, or one a platform has already restricted, gets 1 API post a day. In the source run a new account was suspended on its first day of API posting |
| Tag routing | `require_tags`, `exclude_tags` | Gameplay stays off professional networks and brand accounts. A brand account gets a clip only when the product is clearly on screen |
| Waves | `lead` accounts take the clip at its lead time plus `offset_minutes`; `follow` accounts about 24 hours later | Short-video feeds first. To halve the number of approvals, hold the follow wave until the clip's 24 hour read and send only winners |
| Hook variant | no slot. Listed under `held` until the base clip's 72 hour read; when released (`"release": true`) it runs only on accounts where the base has no post | An alternate opening is not a second post |
| Time zone | `--tz` with an IANA name; the plan carries local and UTC times | A fixed UTC offset breaks across a daylight-saving change |

The planner writes a plan and a calendar. It never calls a posting service.

## Before creating anything

1. Show `calendar.csv` or `schedule.md` as one batch review: clip ids per account with times, titles and captions. Approval follows `social-media-posting`: personal accounts usually need approval per post; a standing approval covers only what it names.
2. The routing skill may ask about a same-topic post in the last 48 hours. Every clip from one stream shares a topic, so answer it once for the batch with the clip list. The duplicate that matters is the same source window, or the same file on the same account.
3. Run titles and captions through your copy check. Each clip keeps its own wording.

## Creating posts

```bash
# Set STS_POSTIZ_URL and STS_POSTIZ_API_KEY (STS_BLOTATO_URL and STS_BLOTATO_API_KEY for Blotato) in the
# environment or in a file passed with --env-file. Never on the command line. There is no default host.
python3 <SKILL_DIR>/scripts/posts.py --backend postiz state
python3 <SKILL_DIR>/scripts/posts.py --backend postiz upload exports/a01-demo/a01-demo.mp4
python3 <SKILL_DIR>/scripts/posts.py --backend postiz create plan.json --receipts receipts.jsonl          # dry run
python3 <SKILL_DIR>/scripts/posts.py --backend postiz create plan.json --receipts receipts.jsonl --go
python3 <SKILL_DIR>/scripts/posts.py --backend blotato create plan.json --receipts receipts.jsonl --go
```

- Dry run is the default. `--go` creates. `upload` is the exception: it sends the file without `--go`, because an upload posts nothing; put the id and path it prints into the clip's `content.media`.
- `show`, `update` and `delete` on a Postiz-compatible scheduler use its internal API and need `STS_POSTIZ_EMAIL` and `STS_POSTIZ_PASSWORD` as well.
- Create only: no post id is ever sent on create. A row that already exists (same account and minute, or same account and the same first 60 characters) is skipped.
- Rolling caps are checked again against the live queue at create time.
- A server error or a network error stops the run. The outcome is unknown: read the queue and match account and UTC time before any retry. A blind retry is how duplicates happen.
- Every created post is one line in `receipts.jsonl`. That file is the list of what this batch owns.

## Changing posts after creation

```bash
python3 <SKILL_DIR>/scripts/posts.py --backend postiz show <post-id>
python3 <SKILL_DIR>/scripts/posts.py --backend postiz update changes.json --receipts receipts.jsonl          # dry run
python3 <SKILL_DIR>/scripts/posts.py --backend postiz delete ids.json --receipts receipts.jsonl --go
```

- **In place, own posts only.** A re-rendered master, a caption fix or a new time is an update of the queued post, never a delete and a new post. The helper refuses any id that is not in `receipts.jsonl` as created by this batch, and skips any post that is no longer queued. Other queues on the same accounts stay untouched.
- Each change carries a `why` and is logged to the receipts. On a Postiz-compatible scheduler the group id changes on every update; the post id does not.
- A published post is not edited by this helper. Fixing or removing a live post is the account owner's decision.

## Never print credential fields

In the source run a post lookup returned the scheduler's whole account object, and part of an API key plus OAuth access and refresh tokens ended up in tool output. Rotating them is the only remedy. The rule since:

- Read posts and queues only through `posts.py`. It prints an allowlist of fields (id, account, platform, state, time, the start of the text, media name, title, URL) and has no flag for raw output.
- Anything else that touches a scheduler goes through the filter: `some-command | python3 <SKILL_DIR>/scripts/redact.py`.
- Credentials come from the environment or an env file. Never from the command line, never echoed, never `cat`. Do not print the environment.
- Error bodies and receipts are redacted before they are printed or written.
- If a secret reaches output anyway: stop, say which one and where, and have the owner rotate it. Rotating a key changes what queued-post tools use, so say that too.

## Receipts

One JSON line per action: `{"clip", "account", "platform", "post_id", "when_utc", "status"}` for a create, and `{"action": "update_in_place" | "delete", "post_id", "why", ...}` for a change. Keep it with the batch; the retention log and every later update read it.
