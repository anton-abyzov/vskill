#!/usr/bin/env python3
"""Create, check, update and delete scheduled posts on a Postiz-compatible
scheduler or on Blotato. Dry run unless --go.

Usage:
  posts.py --backend postiz|blotato [--env-file FILE] [--receipts receipts.jsonl] CMD ...

  state [--from ISO] [--to ISO] [--all]   list queued posts (allowlisted fields)
  show <post-id>                          one post (allowlisted fields)
  upload <file>                           postiz: upload media, print its id and path
                                          (runs without --go: it uploads a file, it posts nothing)
  create <plan.json> [--go] [--only N]    create the plan rows for this backend
  update <changes.json> [--go]            postiz: in-place edit of this batch's queued posts
  delete <ids.json> [--go]                delete this batch's queued posts

Configuration comes from the environment or from --env-file (KEY=VALUE lines),
never from the command line, and is never printed:
  STS_POSTIZ_URL        scheduler root, for example https://postiz.example.invalid
  STS_POSTIZ_API_KEY    public API key (state, upload, create)
  STS_POSTIZ_EMAIL      login for the internal API (show, update, delete)
  STS_POSTIZ_PASSWORD
  STS_BLOTATO_URL       Blotato API base including the version path
  STS_BLOTATO_API_KEY
There is no default host.

plan.json rows (from plan_schedule.py) need "ref" (the scheduler's account id),
"when_utc", "content" {"text", "media", "title" (optional), "settings"
(optional)}, and may carry "settings" from the account. Postiz media is
{"id", "path"} from upload; Blotato media is {"url"} or a URL string.
Platform settings such as a channel id or a title cap ("title_max") come from
the row, never from this helper.

changes.json: [{"post_id", "why", "media": {"id", "path"}, "content", "title",
                "title_max", "replace": [old, new], "date"}] (all but post_id optional)
ids.json:     [{"post_id", "why"}]

Guards: update and delete refuse a post id that is not in the receipts as
created by this batch, and skip a post that is no longer queued. create never
sends a post id, skips a row that already exists and re-checks the plan's
rolling caps against the live queue. A 5xx or a network error on create stops
the run: the outcome is unknown. Everything printed goes through public_view
or redact_text; every receipt goes through redact().
"""
import argparse
import datetime as dt
import http.cookiejar
import json
import mimetypes
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from plan_schedule import window_ok  # noqa: E402
from redact import public_view, redact, redact_text  # noqa: E402

UTC = dt.timezone.utc
PUBLIC_UA = "Mozilla/5.0 stream-to-shorts"
BROWSER_UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
BLOTATO_UA = "curl/8.7.1"
UNKNOWN = "outcome unknown: read the queue and match (account, UTC time) before any retry"
BLOTATO_PLATFORM = {"tiktok": "tiktok", "x": "twitter", "twitter": "twitter"}
ENV_KEYS = ("STS_POSTIZ_URL", "STS_POSTIZ_API_KEY", "STS_POSTIZ_EMAIL",
            "STS_POSTIZ_PASSWORD", "STS_BLOTATO_URL", "STS_BLOTATO_API_KEY")


class Stop(Exception):
    """Stop the run with a one-line reason."""


class TransportError(Exception):
    pass


# ---------- transport ----------

class UrllibTransport:
    """request(method, url, headers, body) -> (status, text). Keeps cookies."""

    def __init__(self, timeout=120):
        self.timeout = timeout
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def request(self, method, url, headers, body=None):
        req = urllib.request.Request(url, data=body, method=method, headers=headers or {})
        try:
            with self.opener.open(req, timeout=self.timeout) as r:
                return r.status, r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            return e.code, e.read()[:4000].decode("utf-8", "replace")
        except (urllib.error.URLError, OSError) as e:
            raise TransportError(type(e).__name__)


# ---------- configuration ----------

def load_env_file(path):
    out = {}
    with open(path, encoding="utf-8") as f:
        for n, line in enumerate(f, 1):
            s = line.strip()
            if not s or s.startswith("#"):
                continue
            if s.startswith("export "):
                s = s[7:].strip()
            if "=" not in s:
                raise Stop("env file line %d: expected KEY=VALUE" % n)
            k, v = s.split("=", 1)
            v = v.strip()
            if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
                v = v[1:-1]
            out[k.strip()] = v
    return out


def config(env, env_file=None):
    cfg = {k: env.get(k) for k in ENV_KEYS if env.get(k)}
    if env_file:
        cfg.update({k: v for k, v in load_env_file(env_file).items() if k in ENV_KEYS and v})
    return cfg


def need(cfg, *keys):
    missing = [k for k in keys if not cfg.get(k)]
    if missing:
        raise Stop("not set: " + ", ".join(missing))
    return [cfg[k] for k in keys]


# ---------- pure helpers ----------

def parse_utc(s):
    t = str(s).strip().replace("Z", "+00:00")
    d = dt.datetime.fromisoformat(t)
    if d.tzinfo is None:
        d = d.replace(tzinfo=UTC)
    return d.astimezone(UTC)


def utc_minute(s):
    return parse_utc(s).strftime("%Y-%m-%dT%H:%M")


def plain(text):
    """Text without HTML tags or repeated whitespace, for duplicate checks."""
    t = re.sub(r"<[^>]+>", " ", text or "")
    return " ".join(t.split())


def safe_body(text, limit=500):
    """An error body made safe to print."""
    try:
        s = json.dumps(redact(json.loads(text)), ensure_ascii=False)
    except (ValueError, TypeError):
        s = text if isinstance(text, str) else str(text)
    return redact_text(s)[:limit]


def row_settings(row):
    s = dict(row.get("settings") or {})
    s.update((row.get("content") or {}).get("settings") or {})
    return s


def build_create_body(row, group):
    """Postiz public API schedule body for one plan row. Never carries a post id."""
    content = row.get("content") or {}
    if not content.get("text"):
        raise Stop("row %s/%s has no content.text" % (row.get("clip"), row.get("account")))
    if row.get("ref") is None:
        raise Stop("row %s/%s has no ref" % (row.get("clip"), row.get("account")))
    settings = row_settings(row)
    settings.setdefault("__type", row["platform"])
    title_max = settings.pop("title_max", None)
    title = content.get("title")
    if title:
        settings["title"] = title[:int(title_max)] if title_max else title
    media = content.get("media")
    image = [{"id": media["id"], "path": media["path"]}] if isinstance(media, dict) else []
    return {"type": "schedule",
            "date": parse_utc(row["when_utc"]).strftime("%Y-%m-%dT%H:%M:00.000Z"),
            "shortLink": False, "tags": [],
            "posts": [{"integration": {"id": row["ref"]}, "group": group,
                       "value": [{"content": content["text"], "image": image}],
                       "settings": settings}]}


def _integration_id(d, p):
    if isinstance(d.get("integration"), str):
        return d["integration"]
    if isinstance(p.get("integration"), dict):
        return p["integration"]["id"]
    return p["integrationId"]


def build_update_body(fetched, change):
    """In-place update body: same post id and group, date kept unless changed.
    The scheduler may still give the group a new id; the receipt records both."""
    p = fetched["posts"][0]
    pid = change["post_id"]
    settings = fetched.get("settings") or p.get("settings") or {}
    if isinstance(settings, str):
        settings = json.loads(settings)
    settings = dict(settings)
    img = p.get("image") or []
    if isinstance(img, str):
        img = json.loads(img)
    if "media" in change:
        img = [{"id": change["media"]["id"], "path": change["media"]["path"]}]
    if "title" in change:
        tm = change.get("title_max")
        settings["title"] = change["title"][:int(tm)] if tm else change["title"]
    text = change.get("content", p["content"])
    if "replace" in change:
        old, new = change["replace"]
        if old not in p["content"]:
            raise Stop("%s: expected text not found" % pid)
        text = p["content"].replace(old, new)
    return {"type": "schedule", "date": change.get("date", p["publishDate"]),
            "shortLink": False, "tags": [],
            "posts": [{"integration": {"id": _integration_id(fetched, p)},
                       "group": fetched["group"],
                       "value": [{"id": pid, "content": text, "image": img}],
                       "settings": settings}]}


def build_blotato_body(row, media_url):
    """Blotato /posts body. Target options (privacy, AI label) come from the row settings."""
    if row.get("ref") is None:
        raise Stop("row %s/%s has no ref" % (row.get("clip"), row.get("account")))
    content = row.get("content") or {}
    plat = BLOTATO_PLATFORM.get(row["platform"], row["platform"])
    target = {"targetType": plat}
    target.update(row_settings(row))
    return {"post": {"accountId": row["ref"],
                     "content": {"text": content.get("text", ""), "mediaUrls": [media_url],
                                 "platform": plat},
                     "target": target},
            "scheduledTime": parse_utc(row["when_utc"]).strftime("%Y-%m-%dT%H:%M:%SZ")}


def build_multipart(field, filename, data, ctype, boundary):
    head = ("--%s\r\nContent-Disposition: form-data; name=\"%s\"; filename=\"%s\"\r\n"
            "Content-Type: %s\r\n\r\n" % (boundary, field, filename, ctype)).encode()
    return head + data + ("\r\n--%s--\r\n" % boundary).encode()


def is_duplicate(row, live):
    """True when the live queue already has this row: same account and same UTC
    minute, or same account and same first 60 characters of text."""
    ref = str(row.get("ref"))
    minute = utc_minute(row["when_utc"])
    text60 = plain((row.get("content") or {}).get("text"))[:60]
    for e in live:
        if str(e["ref"]) != ref:
            continue
        if e["when"] is not None and e["when"].strftime("%Y-%m-%dT%H:%M") == minute:
            return True
        if text60 and plain(e["text"])[:60] == text60:
            return True
    return False


# ---------- receipts ----------

def read_receipts(path):
    rows = []
    if path and os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    rows.append(json.loads(line))
    return rows


def created_ids(rows, backend):
    return {str(r["post_id"]) for r in rows
            if r.get("action") == "create" and r.get("backend") == backend and r.get("post_id")}


def append_receipt(path, rec):
    rec = dict(rec, at=dt.datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"))
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(redact(rec), ensure_ascii=False) + "\n")


# ---------- clients ----------

def _json(text):
    try:
        return json.loads(text or "null")
    except ValueError:
        return None


class Postiz:
    name = "postiz"

    def __init__(self, cfg, transport):
        self.cfg = cfg
        self.t = transport
        self.base = need(cfg, "STS_POSTIZ_URL")[0].rstrip("/")
        self.logged_in = False

    def _public(self, method, path, body=None, raw=None, ctype="application/json"):
        key = need(self.cfg, "STS_POSTIZ_API_KEY")[0]
        h = {"Authorization": key, "User-Agent": PUBLIC_UA}
        data = raw
        if body is not None:
            data = json.dumps(body).encode()
        if data is not None:
            h["Content-Type"] = ctype
        return self.t.request(method, self.base + "/api/public/v1" + path, h, data)

    def _internal(self, method, path, body=None):
        if not self.logged_in:
            self.login()
        h = {"User-Agent": BROWSER_UA, "showorg": "true", "Content-Type": "application/json"}
        data = json.dumps(body).encode() if body is not None else None
        return self.t.request(method, self.base + path, h, data)

    def login(self):
        email, pw = need(self.cfg, "STS_POSTIZ_EMAIL", "STS_POSTIZ_PASSWORD")
        h = {"User-Agent": BROWSER_UA, "showorg": "true", "Content-Type": "application/json"}
        st, _ = self.t.request("POST", self.base + "/api/auth/login", h,
                               json.dumps({"email": email, "password": pw, "provider": "LOCAL"}).encode())
        if st not in (200, 201):
            raise Stop("login failed: HTTP %s" % st)  # never the body
        self.logged_in = True

    def queue(self, start, end):
        q = urllib.parse.urlencode({"startDate": start.strftime("%Y-%m-%dT%H:%M:%S.000Z"),
                                    "endDate": end.strftime("%Y-%m-%dT%H:%M:%S.000Z")})
        st, text = self._public("GET", "/posts?" + q)
        if st != 200:
            raise Stop("queue read failed: HTTP %s %s" % (st, safe_body(text, 200)))
        d = _json(text)
        items = d.get("posts", []) if isinstance(d, dict) else (d or [])
        return items

    @staticmethod
    def flat(p):
        integ = p.get("integration")
        ref = integ.get("id") if isinstance(integ, dict) else (integ or p.get("integrationId"))
        when = p.get("publishDate")
        return {"id": p.get("id"), "ref": ref, "when": parse_utc(when) if when else None,
                "text": p.get("content") or "", "state": p.get("state"),
                "release_url": p.get("releaseURL"), "raw": p}

    def fetch(self, pid):
        st, text = self._internal("GET", "/api/posts/" + urllib.parse.quote(str(pid)))
        return st, _json(text) if st == 200 else text


class Blotato:
    name = "blotato"

    def __init__(self, cfg, transport):
        self.cfg = cfg
        self.t = transport
        self.base, self.key = need(cfg, "STS_BLOTATO_URL", "STS_BLOTATO_API_KEY")
        self.base = self.base.rstrip("/")

    def call(self, method, path, body=None):
        h = {"blotato-api-key": self.key, "user-agent": BLOTATO_UA}
        data = None
        if body is not None:
            h["content-type"] = "application/json"
            data = json.dumps(body).encode()
        return self.t.request(method, self.base + path, h, data)

    def schedules(self):
        out, cursor = [], None
        for _ in range(20):
            path = "/schedules" + ("?cursor=" + urllib.parse.quote(str(cursor)) if cursor else "")
            st, text = self.call("GET", path)
            if st != 200:
                raise Stop("schedules read failed: HTTP %s %s" % (st, safe_body(text, 200)))
            d = _json(text)
            if isinstance(d, list):
                items, cursor = d, None
            else:
                d = d or {}
                items = d.get("items") or d.get("schedules") or d.get("data") or []
                cursor = d.get("cursor") or d.get("nextCursor")
            out += items
            if not cursor:
                break
        return out

    def queue(self, start=None, end=None):
        return self.schedules()

    @staticmethod
    def flat(s):
        draft = s.get("draft") or s.get("post") or {}
        content = draft.get("content") or {}
        when = s.get("scheduledAt") or s.get("scheduledTime") or s.get("scheduled_time")
        return {"id": s.get("id"), "ref": str(draft.get("accountId") or s.get("accountId") or ""),
                "when": parse_utc(when) if when else None, "text": content.get("text") or "",
                "state": "QUEUE", "release_url": None, "raw": s}


# ---------- commands ----------

class Ctx:
    def __init__(self, client, out, receipts, go, group_factory):
        self.client = client
        self.out = out
        self.receipts = receipts
        self.go = go
        self.group = group_factory

    def say(self, s):
        self.out.write(redact_text(s) + "\n")

    def say_view(self, item):
        self.say(json.dumps(public_view(item), ensure_ascii=False))


def cmd_state(ctx, a):
    c = ctx.client
    now = dt.datetime.now(UTC)
    start = parse_utc(a.from_) if a.from_ else now
    end = parse_utc(a.to) if a.to else now + dt.timedelta(days=30)
    items = [c.flat(x) for x in c.queue(start, end)]
    if not a.all:
        items = [e for e in items if not e["release_url"] and e["state"] in ("QUEUE", None)]
    items.sort(key=lambda e: (e["when"] or dt.datetime.min.replace(tzinfo=UTC), str(e["id"])))
    for e in items:
        ctx.say_view(e["raw"])
    ctx.say("%d posts" % len(items))


def cmd_show(ctx, a):
    c = ctx.client
    if c.name == "postiz":
        st, d = c.fetch(a.post_id)
        if st != 200 or not isinstance(d, dict):
            raise Stop("show %s: HTTP %s %s" % (a.post_id, st, safe_body(d if isinstance(d, str) else "", 200)))
        ctx.say(json.dumps({"group": d.get("group")}, ensure_ascii=False))
        for p in d.get("posts", []):
            ctx.say_view(p)
        return
    for s in c.schedules():
        if str(s.get("id")) == str(a.post_id):
            ctx.say_view(s)
            return
    raise Stop("show %s: not in the queue" % a.post_id)


def cmd_upload(ctx, a):
    c = ctx.client
    if c.name != "postiz":
        raise Stop("upload is for postiz; Blotato takes a media URL in the plan row")
    with open(a.file, "rb") as f:
        data = f.read()
    ctype = mimetypes.guess_type(a.file)[0] or "application/octet-stream"
    boundary = "sts" + uuid.uuid4().hex
    body = build_multipart("file", os.path.basename(a.file), data, ctype, boundary)
    st, text = c._public("POST", "/upload", raw=body, ctype="multipart/form-data; boundary=" + boundary)
    if st not in (200, 201):
        raise Stop("upload failed: HTTP %s %s" % (st, safe_body(text)))
    d = _json(text) or {}
    ctx.say(json.dumps(redact({"id": d.get("id"), "path": d.get("path")}), ensure_ascii=False))


def _queue_window(rows, caps):
    times = [parse_utc(r["when_utc"]) for r in rows]
    pad = dt.timedelta(hours=max([float(c.get("window_hours", 24)) for c in caps] + [24]))
    return min(times) - pad, max(times) + pad


def cmd_create(ctx, a):
    c = ctx.client
    with open(a.plan, encoding="utf-8") as f:
        plan = json.load(f)
    allrows = plan.get("posts", [])
    nob = [r for r in allrows if not r.get("backend")]
    if nob:
        ctx.say("%d rows without a backend skipped" % len(nob))
    rows = [r for r in allrows if r.get("backend") == c.name]
    if not rows:
        ctx.say("no %s rows in the plan" % c.name)
        return
    caps = plan.get("caps", [])
    done = {(r.get("clip"), r.get("account")) for r in read_receipts(ctx.receipts)
            if r.get("action") == "create" and r.get("backend") == c.name}
    start, end = _queue_window(rows, caps)
    live = [c.flat(x) for x in c.queue(start, end)]
    times = {}
    for e in live:
        if e["when"] is not None:
            times.setdefault(str(e["ref"]), []).append(e["when"])
    n = 0
    for r in rows:
        tag = "%s %s %s %s" % (r.get("when_utc"), r.get("platform"), r.get("account"), r.get("clip"))
        if (r.get("clip"), r.get("account")) in done:
            ctx.say(tag + " skip: in receipts")
            continue
        if r.get("ref") is None:
            ctx.say(tag + " skip: no ref")
            continue
        if is_duplicate(r, live):
            ctx.say(tag + " skip: already in the queue")
            continue
        t = parse_utc(r["when_utc"])
        over = None
        for cap in caps:
            refs = [str(x) for x in cap.get("refs", [])]
            if str(r["ref"]) not in refs:
                continue
            ts = [x for ref in refs for x in times.get(ref, [])]
            if not window_ok(ts, t, dt.timedelta(hours=float(cap["window_hours"])), int(cap["max"])):
                over = cap.get("name")
                break
        if over:
            ctx.say(tag + " skip: cap %s would be exceeded" % over)
            continue
        n += 1
        if n > a.only:
            break
        if not ctx.go:
            ctx.say(tag + " dry-run")
            times.setdefault(str(r["ref"]), []).append(t)
            continue
        made = _create_postiz(ctx, r, tag) if c.name == "postiz" else _create_blotato(ctx, r, tag)
        if made:
            times.setdefault(str(r["ref"]), []).append(t)


def _create_postiz(ctx, r, tag):
    body = build_create_body(r, ctx.group())
    try:
        st, text = ctx.client._public("POST", "/posts", body)
    except TransportError as e:
        raise Stop("%s: network error %s: %s" % (tag, e, UNKNOWN))
    if st >= 500:
        ctx.say(tag + " FAILED %s %s" % (st, safe_body(text)))
        raise Stop("%s: HTTP %s: %s" % (tag, st, UNKNOWN))
    if st not in (200, 201):
        ctx.say(tag + " FAILED %s %s" % (st, safe_body(text)))
        append_receipt(ctx.receipts, {"action": "create_failed", "backend": "postiz", "clip": r.get("clip"),
                                      "account": r.get("account"), "http": st, "body": safe_body(text)})
        return False
    d = _json(text)
    pid = d[0].get("postId") if isinstance(d, list) and d else (d.get("postId") if isinstance(d, dict) else None)
    append_receipt(ctx.receipts, {"action": "create", "backend": "postiz", "post_id": pid,
                                  "ref": r["ref"], "account": r.get("account"), "clip": r.get("clip"),
                                  "platform": r.get("platform"), "when_utc": body["date"],
                                  "group": body["posts"][0]["group"]})
    ctx.say(tag + " created %s" % pid)
    return True


def _create_blotato(ctx, r, tag):
    c = ctx.client
    media = (r.get("content") or {}).get("media")
    url = media.get("url") if isinstance(media, dict) else media
    if not url:
        ctx.say(tag + " skip: no media url")
        return False
    try:
        st, text = c.call("POST", "/media", {"url": url})
    except TransportError as e:
        raise Stop("%s: network error on media %s" % (tag, e))
    murl = (_json(text) or {}).get("url") if st in (200, 201) else None
    if not murl:
        ctx.say(tag + " media failed %s %s" % (st, safe_body(text)))
        append_receipt(ctx.receipts, {"action": "media_failed", "backend": "blotato", "clip": r.get("clip"),
                                      "account": r.get("account"), "http": st, "body": safe_body(text)})
        return False
    body = build_blotato_body(r, murl)
    try:
        st, text = c.call("POST", "/posts", body)
    except TransportError as e:
        raise Stop("%s: network error %s: %s" % (tag, e, UNKNOWN))
    if st >= 500:
        ctx.say(tag + " FAILED %s %s" % (st, safe_body(text)))
        raise Stop("%s: HTTP %s: %s" % (tag, st, UNKNOWN))
    if st not in (200, 201):
        ctx.say(tag + " FAILED %s %s" % (st, safe_body(text)))
        append_receipt(ctx.receipts, {"action": "create_failed", "backend": "blotato", "clip": r.get("clip"),
                                      "account": r.get("account"), "http": st, "body": safe_body(text)})
        return False
    d = _json(text) or {}
    pid = d.get("id") or d.get("postSubmissionId") or d.get("scheduleId") if isinstance(d, dict) else None
    append_receipt(ctx.receipts, {"action": "create", "backend": "blotato", "post_id": pid,
                                  "ref": r["ref"], "account": r.get("account"), "clip": r.get("clip"),
                                  "platform": r.get("platform"), "when_utc": body["scheduledTime"],
                                  "media": murl})
    ctx.say(tag + " created %s" % pid)
    return True


def _queued(p, pid):
    return (str(p.get("id")) == str(pid) and not p.get("releaseURL")
            and p.get("state", "QUEUE") in ("QUEUE", None))


def _check_own(ids, mine):
    for pid in ids:
        if str(pid) not in mine:
            raise Stop("REFUSED %s: not created by this batch (not in the receipts)" % pid)


def cmd_update(ctx, a):
    c = ctx.client
    if c.name != "postiz":
        raise Stop("update is for postiz only")
    with open(a.changes, encoding="utf-8") as f:
        changes = json.load(f)
    _check_own([x["post_id"] for x in changes], created_ids(read_receipts(ctx.receipts), "postiz"))
    for ch in changes:
        pid = ch["post_id"]
        st, d = c.fetch(pid)
        if st != 200 or not isinstance(d, dict) or not d.get("posts"):
            raise Stop("fetch %s: HTTP %s" % (pid, st))
        p = d["posts"][0]
        if not _queued(p, pid):
            ctx.say("SKIP %s: not queued (state %s)" % (pid, p.get("state")))
            continue
        body = build_update_body(d, ch)
        what = [k for k in ("media", "title", "content", "replace", "date") if k in ch]
        ctx.say("%s %s %s %s" % (pid, p.get("publishDate"), ",".join(what), "APPLY" if ctx.go else "dry-run"))
        if not ctx.go:
            continue
        st, text = c._internal("POST", "/api/posts", body)
        ok = st in (200, 201) and str(pid) in (text or "")
        st2, after = c.fetch(pid)
        a2 = after["posts"][0] if isinstance(after, dict) and after.get("posts") else {}
        g2 = after.get("group") if isinstance(after, dict) else None
        rec = {"action": "update_in_place", "backend": "postiz", "post_id": pid, "why": ch.get("why"),
               "http": st, "same_id": ok, "changed": what,
               "date_before": p.get("publishDate"), "date_after": a2.get("publishDate"),
               "date_unchanged": a2.get("publishDate") == p.get("publishDate"),
               "group_before": d.get("group"), "group_after": g2,
               "group_unchanged": g2 == d.get("group"), "state_after": a2.get("state")}
        append_receipt(ctx.receipts, rec)
        ctx.say("  HTTP %s same_id=%s date_unchanged=%s group_unchanged=%s" % (
            st, ok, rec["date_unchanged"], rec["group_unchanged"]))
        if not ok:
            ctx.say("  " + safe_body(text))
            raise Stop("update of %s failed: stopping" % pid)


def cmd_delete(ctx, a):
    c = ctx.client
    with open(a.ids, encoding="utf-8") as f:
        items = json.load(f)
    _check_own([x["post_id"] for x in items], created_ids(read_receipts(ctx.receipts), c.name))
    for it in items:
        pid = it["post_id"]
        if c.name == "postiz":
            st, d = c.fetch(pid)
            ps = d.get("posts", []) if isinstance(d, dict) else []
            if st != 200 or len(ps) != 1 or not _queued(ps[0], pid):
                ctx.say("SKIP %s: not a single queued post" % pid)
                continue
            ctx.say("%s %s %s" % (pid, ps[0].get("publishDate"), "DELETE" if ctx.go else "dry-run"))
            if not ctx.go:
                continue
            st, _ = c._internal("DELETE", "/api/posts/" + urllib.parse.quote(str(d["group"])))
            st2, d2 = c.fetch(pid)
            gone = st2 != 200 or not (isinstance(d2, dict) and d2.get("posts"))
            date_was = ps[0].get("publishDate")
        else:
            found = [s for s in c.schedules() if str(s.get("id")) == str(pid)]
            if not found:
                ctx.say("SKIP %s: not in the queue (published or gone)" % pid)
                continue
            date_was = Blotato.flat(found[0])["when"]
            date_was = date_was.strftime("%Y-%m-%dT%H:%M:%SZ") if date_was else None
            ctx.say("%s %s %s" % (pid, date_was, "DELETE" if ctx.go else "dry-run"))
            if not ctx.go:
                continue
            st, _ = c.call("DELETE", "/schedules/" + urllib.parse.quote(str(pid)))
            gone = not [s for s in c.schedules() if str(s.get("id")) == str(pid)]
        append_receipt(ctx.receipts, {"action": "delete", "backend": c.name, "post_id": pid,
                                      "why": it.get("why"), "http": st, "gone": gone,
                                      "date_was": date_was})
        ctx.say("  HTTP %s %s" % (st, "gone" if gone else "STILL THERE"))
        if not gone:
            raise Stop("delete of %s not confirmed: stopping" % pid)


def build_parser():
    # --backend, --env-file and --receipts work before or after the command.
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--backend", choices=("postiz", "blotato"), default=argparse.SUPPRESS)
    common.add_argument("--env-file", default=argparse.SUPPRESS)
    common.add_argument("--receipts", default=argparse.SUPPRESS,
                        help="receipts ledger (default receipts.jsonl)")
    ap = argparse.ArgumentParser(description="Scheduler helper. Dry run unless --go.", parents=[common])
    sub = ap.add_subparsers(dest="cmd")
    s = sub.add_parser("state", parents=[common])
    s.add_argument("--from", dest="from_")
    s.add_argument("--to")
    s.add_argument("--all", action="store_true", help="include published and failed posts")
    s = sub.add_parser("show", parents=[common])
    s.add_argument("post_id")
    s = sub.add_parser("upload", parents=[common])
    s.add_argument("file")
    s = sub.add_parser("create", parents=[common])
    s.add_argument("plan")
    s.add_argument("--go", action="store_true")
    s.add_argument("--only", type=int, default=10 ** 6)
    s = sub.add_parser("update", parents=[common])
    s.add_argument("changes")
    s.add_argument("--go", action="store_true")
    s = sub.add_parser("delete", parents=[common])
    s.add_argument("ids")
    s.add_argument("--go", action="store_true")
    return ap


COMMANDS = {"state": cmd_state, "show": cmd_show, "upload": cmd_upload,
            "create": cmd_create, "update": cmd_update, "delete": cmd_delete}


def main(argv=None, transport=None, env=None, out=None, err=None, group_factory=None):
    out = out or sys.stdout
    err = err or sys.stderr
    a = build_parser().parse_args(argv)
    if not a.cmd:
        err.write("posts: a command is required (state, show, upload, create, update, delete)\n")
        return 2
    if not getattr(a, "backend", None):
        err.write("posts: --backend postiz or --backend blotato is required\n")
        return 2
    a.receipts = getattr(a, "receipts", "receipts.jsonl")
    a.env_file = getattr(a, "env_file", None)
    try:
        cfg = config(os.environ if env is None else env, a.env_file)
        t = transport or UrllibTransport()
        client = Postiz(cfg, t) if a.backend == "postiz" else Blotato(cfg, t)
        ctx = Ctx(client, out, a.receipts, getattr(a, "go", False),
                  group_factory or (lambda: str(uuid.uuid4())))
        COMMANDS[a.cmd](ctx, a)
    except Stop as e:
        err.write("posts: " + redact_text(str(e))[:300] + "\n")
        return 1
    except TransportError as e:
        err.write("posts: network error " + redact_text(str(e))[:200] + "\n")
        return 1
    except Exception as e:  # one line, redacted, never a traceback with data in it
        err.write("posts: %s: %s\n" % (type(e).__name__, redact_text(str(e))[:200]))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
