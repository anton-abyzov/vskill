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
There is no default host. The URL must be https (http only for localhost, or
with STS_ALLOW_HTTP=1). A redirect is refused: the key is never sent on to
another host.

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
created by this batch on this host, and skip a post the scheduler does not
report as queued (state QUEUE, no release URL, the only post in its group).
create never sends a post id, skips a row that already exists, skips a time
that is not in the future and re-checks the plan's rolling caps against the
live queue. A 5xx, a network error or a success with no post id on create
stops the run: the outcome is unknown. Everything printed goes through
public_view or redact_text; every receipt goes through redact(); the
configured key, password and login are masked wherever they appear.
"""
import argparse
import datetime as dt
import http.client
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
from redact import (add_known, add_known_pair, clear_known, ident, public_view,  # noqa: E402
                    redact, redact_text, scalar)

UTC = dt.timezone.utc
PUBLIC_UA = "Mozilla/5.0 stream-to-shorts"
BROWSER_UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
BLOTATO_UA = "curl/8.7.1"
UNKNOWN = "outcome unknown: read the queue and match (account, UTC time) before any retry"
BLOTATO_PLATFORM = {"tiktok": "tiktok", "x": "twitter", "twitter": "twitter"}
ENV_KEYS = ("STS_POSTIZ_URL", "STS_POSTIZ_API_KEY", "STS_POSTIZ_EMAIL",
            "STS_POSTIZ_PASSWORD", "STS_BLOTATO_URL", "STS_BLOTATO_API_KEY",
            "STS_ALLOW_HTTP")
SECRET_KEYS = ("STS_POSTIZ_API_KEY", "STS_POSTIZ_EMAIL", "STS_POSTIZ_PASSWORD",
               "STS_BLOTATO_API_KEY")
API_KEY_KEYS = ("STS_POSTIZ_API_KEY", "STS_BLOTATO_API_KEY")
URL_KEYS = ("STS_POSTIZ_URL", "STS_BLOTATO_URL")
BODY_LIMIT = 65536          # bytes of an error body kept by the transport
REDACT_LIMIT = 8192         # characters of free text given to the redaction rules
# Receipt fields that later runs match on. They are stored exact (see ident()).
IDENT_FIELDS = ("action", "backend", "host", "post_id", "ref", "clip", "account",
                "platform", "group", "when_utc")
BLOTATO_PAGES = 20
BLOTATO_QUEUED = ("QUEUE", "QUEUED", "SCHEDULED", "PENDING")
FUTURE_MARGIN = dt.timedelta(minutes=2)


class Stop(Exception):
    """Stop the run with a one-line reason."""


class TransportError(Exception):
    pass


# ---------- transport ----------

class NoRedirect(urllib.request.HTTPRedirectHandler):
    """Never follow a redirect: urllib would send the key on to the new host
    and turn a POST into a GET. The 3xx comes back as the response."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class UrllibTransport:
    """request(method, url, headers, body) -> (status, text). Keeps cookies.
    Errors carry the exception's type name only, never its message."""

    def __init__(self, timeout=120):
        self.timeout = timeout
        self.opener = urllib.request.build_opener(
            NoRedirect(), urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def request(self, method, url, headers, body=None):
        try:
            req = urllib.request.Request(url, data=body, method=method, headers=headers or {})
            with self.opener.open(req, timeout=self.timeout) as r:
                return r.status, r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            return e.code, e.read()[:BODY_LIMIT].decode("utf-8", "replace")
        except (urllib.error.URLError, http.client.HTTPException, OSError, ValueError) as e:
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
    """Settings from the environment and the env file. Values are trimmed, a
    control character is refused (by variable name only), and a URL must be
    https with no user:password part."""
    cfg = {k: env.get(k) for k in ENV_KEYS if env.get(k)}
    if env_file:
        cfg.update({k: v for k, v in load_env_file(env_file).items() if k in ENV_KEYS and v})
    cfg = {k: v.strip() for k, v in cfg.items() if isinstance(v, str) and v.strip()}
    clear_known()
    add_known(cfg.get(k) for k in SECRET_KEYS)
    add_known((cfg.get(k) for k in API_KEY_KEYS), parts=True)
    add_known_pair(cfg.get("STS_POSTIZ_EMAIL"), cfg.get("STS_POSTIZ_PASSWORD"))
    for k, v in cfg.items():
        if any(ord(ch) < 32 or ord(ch) == 127 for ch in v):
            raise Stop("%s has a control character in it" % k)
    for k in URL_KEYS:
        if k not in cfg:
            continue
        try:
            u = urllib.parse.urlsplit(cfg[k])
            host = u.hostname
        except ValueError:
            raise Stop("%s is not a URL" % k)
        if u.username or u.password:
            add_known([u.password])
            raise Stop("%s must not carry a login (user:password@)" % k)
        local = host in ("localhost", "127.0.0.1", "::1")
        if u.scheme != "https" and not (u.scheme == "http" and (local or cfg.get("STS_ALLOW_HTTP") == "1")):
            raise Stop("%s must be https (http only for localhost, or with STS_ALLOW_HTTP=1)" % k)
        if not host:
            raise Stop("%s has no host" % k)
    return cfg


def host_of(url):
    return (urllib.parse.urlsplit(url).hostname or "").lower()


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
    """An error body made safe to print. JSON is redacted as an object. Free
    text is cut to REDACT_LIMIT before the rules run (a value the cut leaves
    open is masked to the end), and the result is cut to limit afterwards."""
    try:
        s = json.dumps(redact(json.loads(text)), ensure_ascii=False)
    except (ValueError, TypeError):
        s = text if isinstance(text, str) else str(text)
    return redact_text(s[:REDACT_LIMIT])[:limit]


def http_note(st):
    """Why a status is not what it seems: a redirect was refused on purpose."""
    try:
        return " (redirect refused: set the final https URL)" if 300 <= int(st) < 400 else ""
    except (TypeError, ValueError):
        return ""


def in_future(when, now):
    """True when a schedule time is safely after now. A time in the past would
    publish at once on most schedulers."""
    return parse_utc(when) > now + FUTURE_MARGIN


def path_id(pid):
    """A post or group id as one URL path segment."""
    return urllib.parse.quote(str(pid), safe="")


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
    date = p["publishDate"]
    if "date" in change:    # always sent as UTC, never as a time the scheduler could read as local
        date = parse_utc(change["date"]).strftime("%Y-%m-%dT%H:%M:00.000Z")
    return {"type": "schedule", "date": date,
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


def created_ids(rows, backend, host=None):
    """Post ids this batch created on this backend. A receipt that names a
    host counts only for that host."""
    return {str(r["post_id"]) for r in rows
            if r.get("action") == "create" and r.get("backend") == backend and r.get("post_id")
            and (not r.get("host") or not host or r["host"] == host)}


def append_receipt(path, rec):
    """One receipt line. Everything is redacted, then the fields later runs
    match on are written exact, with only registered secrets masked: a shape
    rule that rewrote a host or a clip id would lose this batch's ownership."""
    rec = dict(rec, at=dt.datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"))
    safe = redact(rec)
    for k in IDENT_FIELDS:
        if k in rec:
            safe[k] = ident(rec[k])
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(safe, ensure_ascii=False) + "\n")


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
        self.host = host_of(self.base)
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
            raise Stop("login failed: HTTP %s%s" % (st, http_note(st)))  # never the body
        self.logged_in = True

    def queue(self, start, end):
        q = urllib.parse.urlencode({"startDate": start.strftime("%Y-%m-%dT%H:%M:%S.000Z"),
                                    "endDate": end.strftime("%Y-%m-%dT%H:%M:%S.000Z")})
        st, text = self._public("GET", "/posts?" + q)
        if st != 200:
            raise Stop("queue read failed: HTTP %s%s %s" % (st, http_note(st), safe_body(text, 200)))
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

    @staticmethod
    def in_queue(e):
        """For listing only: a flat() entry with no release URL and state QUEUE
        or none. Writes use the stricter _queued()."""
        return not e["release_url"] and e["state"] in ("QUEUE", None)

    def fetch(self, pid):
        st, text = self._internal("GET", "/api/posts/" + path_id(pid))
        return st, _json(text) if st == 200 else text


class Blotato:
    name = "blotato"

    def __init__(self, cfg, transport):
        self.cfg = cfg
        self.t = transport
        self.base, self.key = need(cfg, "STS_BLOTATO_URL", "STS_BLOTATO_API_KEY")
        self.base = self.base.rstrip("/")
        self.host = host_of(self.base)

    def call(self, method, path, body=None):
        h = {"blotato-api-key": self.key, "user-agent": BLOTATO_UA}
        data = None
        if body is not None:
            h["content-type"] = "application/json"
            data = json.dumps(body).encode()
        return self.t.request(method, self.base + path, h, data)

    def schedules(self):
        out, cursor = [], None
        for _ in range(BLOTATO_PAGES):
            path = "/schedules" + ("?cursor=" + urllib.parse.quote(str(cursor)) if cursor else "")
            st, text = self.call("GET", path)
            if st != 200:
                raise Stop("schedules read failed: HTTP %s%s %s" % (st, http_note(st), safe_body(text, 200)))
            d = _json(text)
            if isinstance(d, list):
                items, cursor = d, None
            else:
                d = d or {}
                items = d.get("items") or d.get("schedules") or d.get("data") or []
                cursor = d.get("cursor") or d.get("nextCursor")
            out += items
            if not cursor:
                return out
        # A partial list would pass the duplicate, cap and ownership checks.
        raise Stop("schedules list did not end after %d pages: the queue read is incomplete" % BLOTATO_PAGES)

    def queue(self, start=None, end=None):
        return self.schedules()

    @staticmethod
    def flat(s):
        draft = s.get("draft") or s.get("post") or {}
        content = draft.get("content") or {}
        when = s.get("scheduledAt") or s.get("scheduledTime") or s.get("scheduled_time")
        # An entry counts as queued unless it says otherwise: when it carries
        # a status or a public link they are read, so a published or failed
        # entry is not deleted as if it were waiting.
        state = s.get("status") or s.get("state")
        url = s.get("publicUrl") or s.get("postUrl") or s.get("releaseUrl") or s.get("releaseURL")
        return {"id": s.get("id"), "ref": str(draft.get("accountId") or s.get("accountId") or ""),
                "when": parse_utc(when) if when else None, "text": content.get("text") or "",
                "state": "QUEUE" if state is None else str(state), "release_url": url or None, "raw": s}

    @staticmethod
    def queued(e):
        """True when a flat() entry is still waiting to be published."""
        return not e["release_url"] and e["state"].upper() in BLOTATO_QUEUED

    in_queue = queued


# ---------- commands ----------

class Ctx:
    def __init__(self, client, out, receipts, go, group_factory, now=None):
        self.client = client
        self.out = out
        self.receipts = receipts
        self.go = go
        self.group = group_factory
        self.now = now or (lambda: dt.datetime.now(UTC))

    def say(self, s):
        self.out.write(redact_text(s) + "\n")

    def say_view(self, item):
        self.say(json.dumps(public_view(item), ensure_ascii=False))


def cmd_state(ctx, a):
    c = ctx.client
    now = ctx.now()
    start = parse_utc(a.from_) if a.from_ else now
    end = parse_utc(a.to) if a.to else now + dt.timedelta(days=30)
    items = [c.flat(x) for x in c.queue(start, end)]
    if not a.all:
        items = [e for e in items if c.in_queue(e)]
    items.sort(key=lambda e: (e["when"] or dt.datetime.min.replace(tzinfo=UTC), str(e["id"])))
    for e in items:
        ctx.say_view(e["raw"])
    ctx.say("%d posts" % len(items))


def cmd_show(ctx, a):
    c = ctx.client
    if c.name == "postiz":
        st, d = c.fetch(a.post_id)
        if st != 200 or not isinstance(d, dict):
            raise Stop("show %s: HTTP %s%s %s" % (a.post_id, st, http_note(st),
                                                 safe_body(d if isinstance(d, str) else "", 200)))
        ctx.say(json.dumps({"group": scalar(d.get("group"))}, ensure_ascii=False))
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
    if not isinstance(d, dict):
        d = {}
    ctx.say(json.dumps({"id": scalar(d.get("id")), "path": scalar(d.get("path"))}, ensure_ascii=False))


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
    for cap in caps:
        try:
            dt.timedelta(hours=float(cap["window_hours"]))
            int(cap["max"])
        except (KeyError, TypeError, ValueError, OverflowError):
            raise Stop("plan cap %s has no usable window_hours and max" % scalar((cap or {}).get("name")
                                                                             if isinstance(cap, dict) else None))
    recs = read_receipts(ctx.receipts)
    # A post this batch deleted (confirmed gone) may be created again.
    deleted = {str(r["post_id"]) for r in recs
               if r.get("action") == "delete" and r.get("gone") is True
               and r.get("backend") == c.name and r.get("post_id")
               and (not r.get("host") or r["host"] == c.host)}
    done = {(r.get("clip"), r.get("account")) for r in recs
            if r.get("action") == "create" and r.get("backend") == c.name
            and r.get("post_id") and r.get("clip") is not None
            and (not r.get("host") or r["host"] == c.host)
            and str(r["post_id"]) not in deleted}
    now = ctx.now()
    start, end = _queue_window(rows, caps)
    live = [c.flat(x) for x in c.queue(start, end)]
    times = {}
    for e in live:
        if e["when"] is not None:
            times.setdefault(str(e["ref"]), []).append(e["when"])
    n = 0
    for r in rows:
        tag = "%s %s %s %s" % (r.get("when_utc"), r.get("platform"), r.get("account"), r.get("clip"))
        if r.get("clip") is not None and (r["clip"], r.get("account")) in done:
            ctx.say(tag + " skip: in receipts")
            continue
        if r.get("ref") is None:
            ctx.say(tag + " skip: no ref")
            continue
        if not in_future(r["when_utc"], now):
            ctx.say(tag + " skip: the time is not in the future")
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
                over = cap.get("name") or "(unnamed)"     # a cap with no name still applies
                break
        if over is not None:
            ctx.say(tag + " skip: cap %s would be exceeded" % scalar(over))
            continue
        n += 1
        if n > a.only:
            break
        if ctx.go:
            made = _create_postiz(ctx, r, tag) if c.name == "postiz" else _create_blotato(ctx, r, tag)
        else:
            ctx.say(tag + " dry-run")
            made = True
        if made:
            # Later rows of the same run are checked against this one too: a
            # plan with the same row twice must not create it twice.
            times.setdefault(str(r["ref"]), []).append(t)
            if r.get("clip") is not None:       # rows with no clip id are told apart by the queue check only
                done.add((r["clip"], r.get("account")))
            live.append({"id": None, "ref": str(r["ref"]), "when": t,
                         "text": (r.get("content") or {}).get("text") or "",
                         "state": "QUEUE", "release_url": None})


def _no_id(ctx, r, tag, backend, st):
    """A success status with no post id is not a create: stop, outcome unknown."""
    append_receipt(ctx.receipts, {"action": "create_unconfirmed", "backend": backend, "clip": r.get("clip"),
                                  "account": r.get("account"), "http": st})
    raise Stop("%s: HTTP %s with no post id: %s" % (tag, st, UNKNOWN))


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
        ctx.say(tag + " FAILED %s%s %s" % (st, http_note(st), safe_body(text)))
        append_receipt(ctx.receipts, {"action": "create_failed", "backend": "postiz", "clip": r.get("clip"),
                                      "account": r.get("account"), "http": st, "body": safe_body(text)})
        return False
    d = _json(text)
    first = d[0] if isinstance(d, list) and d else d
    pid = first.get("postId") if isinstance(first, dict) else None
    if not isinstance(pid, (str, int)) or isinstance(pid, bool) or pid == "":
        _no_id(ctx, r, tag, "postiz", st)
    append_receipt(ctx.receipts, {"action": "create", "backend": "postiz", "post_id": pid,
                                  "host": ctx.client.host,
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
    md = _json(text) if st in (200, 201) else None
    murl = md.get("url") if isinstance(md, dict) else None
    if not isinstance(murl, str) or not murl:
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
    if not isinstance(pid, (str, int)) or isinstance(pid, bool):
        _no_id(ctx, r, tag, "blotato", st)
    append_receipt(ctx.receipts, {"action": "create", "backend": "blotato", "post_id": pid,
                                  "host": c.host,
                                  "ref": r["ref"], "account": r.get("account"), "clip": r.get("clip"),
                                  "platform": r.get("platform"), "when_utc": body["scheduledTime"],
                                  "media": murl})
    ctx.say(tag + " created %s" % pid)
    return True


def _queued(p, pid):
    """True only when the scheduler says the post is queued. A post with no
    state is not treated as queued: a published post must never be edited."""
    return (isinstance(p, dict) and str(p.get("id")) == str(pid) and not p.get("releaseURL")
            and str(p.get("state") or "").upper() == "QUEUE")


def _ids(items):
    """Post ids of a changes or ids file. An entry without one is refused."""
    if not isinstance(items, list):
        raise Stop("expected a JSON list of {\"post_id\": ...}")
    out = []
    for n, x in enumerate(items, 1):
        pid = x.get("post_id") if isinstance(x, dict) else None
        if not isinstance(pid, (str, int)) or isinstance(pid, bool) or pid == "":
            raise Stop("REFUSED entry %d: no post_id" % n)
        out.append(pid)
    return out


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
    _check_own(_ids(changes), created_ids(read_receipts(ctx.receipts), "postiz", c.host))
    for ch in changes:
        pid = ch["post_id"]
        st, d = c.fetch(pid)
        if st != 200 or not isinstance(d, dict) or not d.get("posts"):
            raise Stop("fetch %s: HTTP %s%s" % (pid, st, http_note(st)))
        if len(d["posts"]) != 1:
            ctx.say("SKIP %s: its group holds %d posts; an update would rewrite all of them" % (pid, len(d["posts"])))
            continue
        p = d["posts"][0]
        if not _queued(p, pid):
            ctx.say("SKIP %s: not queued (state %s)" % (pid, scalar(p.get("state")) if isinstance(p, dict) else None))
            continue
        if "date" in ch and not in_future(ch["date"], ctx.now()):
            ctx.say("SKIP %s: the new time is not in the future" % pid)
            continue
        body = build_update_body(d, ch)
        what = [k for k in ("media", "title", "content", "replace", "date") if k in ch]
        ctx.say("%s %s %s %s" % (pid, scalar(p.get("publishDate")), ",".join(what), "APPLY" if ctx.go else "dry-run"))
        if not ctx.go:
            continue
        st, text = c._internal("POST", "/api/posts", body)
        ok = st in (200, 201) and str(pid) in (text or "")
        st2, after = c.fetch(pid)
        a2 = after["posts"][0] if isinstance(after, dict) and after.get("posts") else {}
        if not isinstance(a2, dict):
            a2 = {}
        g2 = after.get("group") if isinstance(after, dict) else None
        rec = {"action": "update_in_place", "backend": "postiz", "post_id": pid, "why": ch.get("why"),
               "http": st, "same_id": ok, "changed": what,
               "date_before": scalar(p.get("publishDate")), "date_after": scalar(a2.get("publishDate")),
               "date_unchanged": a2.get("publishDate") == p.get("publishDate"),
               "group_before": scalar(d.get("group")), "group_after": scalar(g2),
               "group_unchanged": g2 == d.get("group"), "state_after": scalar(a2.get("state"))}
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
    _check_own(_ids(items), created_ids(read_receipts(ctx.receipts), c.name, c.host))
    for it in items:
        pid = it["post_id"]
        if c.name == "postiz":
            st, d = c.fetch(pid)
            ps = d.get("posts", []) if isinstance(d, dict) else []
            if st != 200 or len(ps) != 1 or not _queued(ps[0], pid):
                state = scalar(ps[0].get("state")) if ps and isinstance(ps[0], dict) else None
                ctx.say("SKIP %s: not a single queued post (HTTP %s%s, %d in its group, state %s)"
                        % (pid, st, http_note(st), len(ps), state))
                continue
            ctx.say("%s %s %s" % (pid, scalar(ps[0].get("publishDate")), "DELETE" if ctx.go else "dry-run"))
            if not ctx.go:
                continue
            if not d.get("group"):
                ctx.say("SKIP %s: the post has no group id" % pid)
                continue
            st, _ = c._internal("DELETE", "/api/posts/" + path_id(d["group"]))
            st2, d2 = c.fetch(pid)
            gone = st2 != 200 or not (isinstance(d2, dict) and d2.get("posts"))
            date_was = scalar(ps[0].get("publishDate"))
        else:
            found = [s for s in c.schedules() if str(s.get("id")) == str(pid)]
            if not found:
                ctx.say("SKIP %s: not in the queue (published or gone)" % pid)
                continue
            entry = Blotato.flat(found[0])
            if not Blotato.queued(entry):
                ctx.say("SKIP %s: not queued (state %s)" % (pid, scalar(entry["state"])))
                continue
            date_was = entry["when"]
            date_was = date_was.strftime("%Y-%m-%dT%H:%M:%SZ") if date_was else None
            ctx.say("%s %s %s" % (pid, date_was, "DELETE" if ctx.go else "dry-run"))
            if not ctx.go:
                continue
            st, _ = c.call("DELETE", "/schedules/" + path_id(pid))
            gone = not [s for s in c.schedules() if str(s.get("id")) == str(pid)]
        append_receipt(ctx.receipts, {"action": "delete", "backend": c.name, "host": c.host, "post_id": pid,
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


def main(argv=None, transport=None, env=None, out=None, err=None, group_factory=None, now=None):
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
                  group_factory or (lambda: str(uuid.uuid4())), now)
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
