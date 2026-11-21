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
| Waves | `lead` accounts take the clip at its lead time plus `offset_minutes`; `follow` accounts 24 hours after the lead time (the same clock time the next day) plus `offset_minutes` | Short-video feeds first. See "The follow wave" below |
| Hook variant | no slot. Listed under `held` until the base clip's 72 hour read; when released (`"release": true`) it runs only on accounts where the base has no post | An alternate opening is not a second post |
| Time zone | `--tz` with an IANA name; the plan carries local and UTC times | A fixed UTC offset breaks across a daylight-saving change |

The planner writes a plan and a calendar. It never calls a posting service.

### The follow wave

The wave rule in `references/platform-specs.md` sends a clip to timeline platforms only after it passes the winner line. The planner does not know the numbers, so the gate is in how you plan:

1. Plan and create the lead wave only: an `accounts.json` with the `lead` accounts.
2. After the 24 hour read, put the winners in a new `clips.json` with a new `lead` time, plan them onto the `follow` accounts with `--busy` holding everything already queued, and create that plan.

Planning both waves at once is the ungated shortcut for an account whose history you do not need to protect: every clip then goes out on the follow accounts a day later, whatever its numbers.

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
- Rolling caps are checked again against the live queue at create time. Rows of the same run are checked against each other too, so a plan that lists a row twice creates it once.
- A Blotato queue is read page by page. If the list has not ended after 20 pages the helper stops: a partial list would pass the duplicate and cap checks.
- A row whose time is not at least 2 minutes in the future is skipped. A scheduler would publish it at once.
- A success status with no post id is not a create. The run stops, writes a `create_unconfirmed` line and the outcome is unknown, as below.
- A server error or a network error stops the run. The outcome is unknown: read the queue and match account and UTC time before any retry. A blind retry is how duplicates happen.
- Every created post is one line in `receipts.jsonl`. That file is the list of what this batch owns.

## Changing posts after creation

```bash
python3 <SKILL_DIR>/scripts/posts.py --backend postiz show <post-id>
python3 <SKILL_DIR>/scripts/posts.py --backend postiz update changes.json --receipts receipts.jsonl          # dry run
python3 <SKILL_DIR>/scripts/posts.py --backend postiz delete ids.json --receipts receipts.jsonl --go
```

- **In place, own posts only.** A re-rendered master, a caption fix or a new time is an update of the queued post, never a delete and a new post. The helper refuses any id that is not in `receipts.jsonl` as created by this batch on this host. It skips any post the scheduler does not report as queued: the state must be `QUEUE`, with no release URL, and the post must be the only one in its group. A post with no state at all is skipped too, so on a scheduler whose post lookup returns no state every update and delete is skipped; the skip line prints the state it saw. A new time that is not in the future is skipped. A Blotato entry that carries a status other than queued or scheduled, or a public link, is skipped on delete. Other queues on the same accounts stay untouched.
- **Delete, then create again.** A row whose post this batch deleted, with the delete confirmed in the receipts, is free again: the next `create` makes it. Until the delete is confirmed the row stays skipped as `in receipts`.
- Each change carries a `why` and is logged to the receipts. On a Postiz-compatible scheduler the group id changes on every update; the post id does not.
- A published post is not edited by this helper. Fixing or removing a live post is the account owner's decision.

## Never print credential fields

In the source run a post lookup returned the scheduler's whole account object, and part of an API key plus OAuth access and refresh tokens ended up in tool output. Rotating them is the only remedy. The rule since:

- Read posts and queues only through `posts.py`. It prints an allowlist of fields (id, account, platform, state, time, the start of the text, media name, title, URL), each as one plain value, never a nested object, and has no flag for raw output.
- The scheduler URL must be `https` (plain `http` only for `localhost`, or with `STS_ALLOW_HTTP=1` on a network you trust) and must not carry a login. A redirect is refused, so the key is never sent on to another host; the error says "redirect refused" and the fix is to set the final URL.
- The helper masks its own key, password and login wherever they appear in output, including error messages: in any letter case, URL-encoded, JSON-escaped or base64, and for an API key also its first and last 8 characters, because a server that echoes part of a key is how the source run leaked one.
- `redact.py` masks by key name, by the shape of common tokens and long opaque strings, and by known value. A secret under an ordinary key name with no recognisable shape gets through it. That is why raw scheduler JSON is never printed, filtered or not, when `posts.py` can answer the question.
- Anything else that touches a scheduler goes through the filter: `some-command | python3 <SKILL_DIR>/scripts/redact.py`.
- Credentials come from the environment or an env file. Never from the command line, never echoed, never `cat`. Do not print the environment.
- Error bodies and receipts are redacted before they are printed or written.
- If a secret reaches output anyway: stop, say which one and where, and have the owner rotate it. Rotating a key changes what queued-post tools use, so say that too.

## Receipts

One JSON line per action, each with `action` and `at`: `{"action": "create", "backend", "host", "post_id", "ref", "clip", "account", "platform", "when_utc"}` for a create, and `{"action": "update_in_place" | "delete", "post_id", "why", ...}` for a change. Failed and unconfirmed creates are logged as `create_failed`, `media_failed` and `create_unconfirmed` and give no ownership. The fields later runs match on (`host`, `post_id`, `clip`, `account`, `ref`, `group`) are stored exact; everything else in a line is redacted. Keep it with the batch; the retention log and every later update read it.
