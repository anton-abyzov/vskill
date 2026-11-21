import os, sys; sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))  # noqa: E401,E702

import io
import json
import shutil
import tempfile
import unittest
import urllib.parse

import posts

# Fake secrets, built at run time.
API_KEY = "tok_" + "k" * 32
TOK = "tok_" + "x" * 32
TOK2 = "tok_" + "r" * 32
JWT = ".".join(["eyJ" + "h" * 14, "p" * 24, "s" * 24])
PASSWORD = "pw_" + "z" * 20
EMAIL = "user" + chr(64) + "example.invalid"
BLT_KEY = "blt_" + "b" * 32
# No vendor prefix and no token shape: only masking by key name catches it.
OPAQUE = "q" * 12 + "7" * 12
SECRETS = [API_KEY, TOK, TOK2, JWT, PASSWORD, BLT_KEY, OPAQUE]

# Fixed clock: the fixtures' post times stay in the future whenever the tests run.
NOW = posts.parse_utc("2026-11-21T12:00:00Z")

BASE = "https://postiz.example.invalid"
BBASE = "https://blotato.example.invalid/v2"


def env_postiz():
    return {"STS_POSTIZ_URL": BASE, "STS_POSTIZ_API_KEY": API_KEY,
            "STS_POSTIZ_EMAIL": EMAIL, "STS_POSTIZ_PASSWORD": PASSWORD}


def env_blotato():
    return {"STS_BLOTATO_URL": BBASE, "STS_BLOTATO_API_KEY": BLT_KEY}


def leaky_integration(ref="REF_YT"):
    return {"id": ref, "providerIdentifier": "youtube", "name": "Main", "token": OPAQUE,
            "refreshToken": TOK2, "customer": {"apiKey": API_KEY}, "internalId": "1",
            "access_token": OPAQUE}


class FakeTransport:
    """Routes (method, path) to a handler. Records every call."""

    def __init__(self, base):
        self.base = base
        self.calls = []
        self.routes = []

    def on(self, method, path, fn):
        self.routes.append((method, path, fn))
        return self

    def request(self, method, url, headers, body=None):
        path = url[len(self.base):] if url.startswith(self.base) else url
        self.calls.append((method, path, headers, body))
        for m, p, fn in self.routes:
            if m == method and (path == p or (p.endswith("*") and path.startswith(p[:-1]))):
                r = fn(path, body)
                if isinstance(r, Exception):
                    raise r
                st, payload = r
                return st, payload if isinstance(payload, str) else json.dumps(payload)
        return 404, '{"error": "no route"}'

    def writes(self):
        return [(m, p) for m, p, _, _ in self.calls if m != "GET" and p != "/api/auth/login"]


def login_ok(path, body):
    return 201, {"user": {"id": "u1"}, "accessToken": JWT, "session": OPAQUE}


class Base(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        self.receipts = os.path.join(self.d, "receipts.jsonl")

    def tearDown(self):
        shutil.rmtree(self.d, ignore_errors=True)
        posts.clear_known()

    def path(self, name):
        return os.path.join(self.d, name)

    def write(self, name, obj):
        with open(self.path(name), "w") as f:
            json.dump(obj, f)
        return self.path(name)

    def add_receipt(self, rec):
        with open(self.receipts, "a") as f:
            f.write(json.dumps(rec) + "\n")

    def run_main(self, args, transport, env, backend="postiz"):
        out, err = io.StringIO(), io.StringIO()
        code = posts.main(["--backend", backend, "--receipts", self.receipts] + args,
                          transport=transport, env=env, out=out, err=err,
                          group_factory=lambda: "GROUP-1", now=lambda: NOW)
        self.out, self.err = out.getvalue(), err.getvalue()
        self.assert_no_secrets(self.out + self.err)
        if os.path.exists(self.receipts):
            with open(self.receipts) as f:
                self.assert_no_secrets(f.read())
        return code

    def assert_no_secrets(self, text):
        for s in SECRETS:
            self.assertNotIn(s, text)
        self.assertNotIn(EMAIL, text)


# ---------- pure body builders against the original request shapes ----------

class Bodies(unittest.TestCase):
    def test_create_body_youtube(self):
        row = {"clip": "a01-demo", "account": "yt-main", "platform": "youtube", "ref": "REF_YT",
               "when_utc": "2026-12-01T15:00:00Z",
               "settings": {"__type": "youtube", "type": "public", "tags": [], "title_max": 60},
               "content": {"text": "Caption text\n\n#Shorts", "title": "T" * 70,
                           "media": {"id": "m1", "path": "https://cdn.example.invalid/a01-demo.mp4"}}}
        expected = {"type": "schedule", "date": "2026-12-01T15:00:00.000Z", "shortLink": False, "tags": [],
                    "posts": [{"integration": {"id": "REF_YT"}, "group": "G",
                               "value": [{"content": "Caption text\n\n#Shorts",
                                          "image": [{"id": "m1", "path": "https://cdn.example.invalid/a01-demo.mp4"}]}],
                               "settings": {"__type": "youtube", "title": "T" * 60, "type": "public", "tags": []}}]}
        body = posts.build_create_body(row, "G")
        self.assertEqual(body, expected)
        self.assertNotIn("id", body["posts"][0]["value"][0])

    def test_create_body_other_platforms(self):
        base = {"clip": "a01-demo", "account": "a", "ref": "R", "when_utc": "2026-12-01T10:00:00-05:00",
                "content": {"text": "t", "media": {"id": "m", "path": "p"}}}
        ig = dict(base, platform="instagram-standalone",
                  settings={"__type": "instagram-standalone", "post_type": "post"})
        self.assertEqual(posts.build_create_body(ig, "G")["posts"][0]["settings"],
                         {"__type": "instagram-standalone", "post_type": "post"})
        dc = dict(base, platform="discord", settings={"__type": "discord", "channel": "CHANNEL_ID"})
        self.assertEqual(posts.build_create_body(dc, "G")["posts"][0]["settings"],
                         {"__type": "discord", "channel": "CHANNEL_ID"})
        th = dict(base, platform="threads")
        b = posts.build_create_body(th, "G")
        self.assertEqual(b["posts"][0]["settings"], {"__type": "threads"})
        self.assertEqual(b["date"], "2026-12-01T15:00:00.000Z")

    def test_update_body_in_place(self):
        fetched = {"group": "G0", "posts": [{
            "id": "p1", "content": "old text", "publishDate": "2026-12-01T15:00:00.000Z",
            "integration": {"id": "REF_YT"}, "state": "QUEUE",
            "image": json.dumps([{"id": "m0", "path": "old.mp4"}]),
            "settings": json.dumps({"__type": "youtube", "title": "Old", "type": "public"})}]}
        change = {"post_id": "p1", "media": {"id": "m1", "path": "new.mp4"}, "title": "N" * 70,
                  "title_max": 60}
        expected = {"type": "schedule", "date": "2026-12-01T15:00:00.000Z", "shortLink": False, "tags": [],
                    "posts": [{"integration": {"id": "REF_YT"}, "group": "G0",
                               "value": [{"id": "p1", "content": "old text",
                                          "image": [{"id": "m1", "path": "new.mp4"}]}],
                               "settings": {"__type": "youtube", "title": "N" * 60, "type": "public"}}]}
        self.assertEqual(posts.build_update_body(fetched, change), expected)

    def test_update_body_replace_and_date_and_integration_forms(self):
        fetched = {"group": "G0", "integration": "REF_TOP", "posts": [{
            "id": "p1", "content": "a 15 b", "publishDate": "2026-12-01T15:00:00.000Z", "image": []}]}
        b = posts.build_update_body(fetched, {"post_id": "p1", "replace": ["15", "16"],
                                              "date": "2026-12-02T15:00:00.000Z"})
        self.assertEqual(b["posts"][0]["value"][0]["content"], "a 16 b")
        self.assertEqual(b["posts"][0]["integration"], {"id": "REF_TOP"})
        self.assertEqual(b["date"], "2026-12-02T15:00:00.000Z")
        fetched2 = {"group": "G0", "posts": [{"id": "p1", "content": "x", "publishDate": "d",
                                              "integrationId": "REF_ID"}]}
        self.assertEqual(posts.build_update_body(fetched2, {"post_id": "p1"})["posts"][0]["integration"],
                         {"id": "REF_ID"})
        with self.assertRaises(posts.Stop):
            posts.build_update_body(fetched, {"post_id": "p1", "replace": ["nope", "x"]})

    def test_blotato_body(self):
        row = {"clip": "a01-demo", "account": "tiktok-main", "platform": "tiktok", "ref": "REF_TT",
               "when_utc": "2026-12-01T10:30:00-05:00", "content": {"text": "caption #ai"},
               "settings": {"privacyLevel": "PUBLIC_TO_EVERYONE", "disabledComments": False,
                            "disabledDuet": False, "disabledStitch": False, "isBrandedContent": False,
                            "isYourBrand": False, "isAiGenerated": False}}
        expected = {"post": {"accountId": "REF_TT",
                             "content": {"text": "caption #ai", "mediaUrls": ["https://m.example.invalid/1.mp4"],
                                         "platform": "tiktok"},
                             "target": {"targetType": "tiktok", "privacyLevel": "PUBLIC_TO_EVERYONE",
                                        "disabledComments": False, "disabledDuet": False,
                                        "disabledStitch": False, "isBrandedContent": False,
                                        "isYourBrand": False, "isAiGenerated": False}},
                    "scheduledTime": "2026-12-01T15:30:00Z"}
        self.assertEqual(posts.build_blotato_body(row, "https://m.example.invalid/1.mp4"), expected)
        x = dict(row, platform="x", settings={})
        b = posts.build_blotato_body(x, "u")
        self.assertEqual(b["post"]["target"], {"targetType": "twitter"})
        self.assertEqual(b["post"]["content"]["platform"], "twitter")

    def test_multipart(self):
        b = posts.build_multipart("file", "a01-demo.mp4", b"DATA", "video/mp4", "BND")
        self.assertEqual(b, b'--BND\r\nContent-Disposition: form-data; name="file"; filename="a01-demo.mp4"\r\n'
                            b'Content-Type: video/mp4\r\n\r\nDATA\r\n--BND--\r\n')


# ---------- commands through a fake transport ----------

def queued_post(pid="p1", group="G0", state="QUEUE", release=None):
    return {"group": group, "accessToken": JWT, "posts": [{
        "id": pid, "content": "<p>old text</p>", "publishDate": "2026-12-01T15:00:00.000Z",
        "state": state, "releaseURL": release, "integration": leaky_integration(),
        "image": json.dumps([{"id": "m0", "path": "https://cdn.example.invalid/old.mp4"}]),
        "settings": json.dumps({"__type": "youtube", "title": "Old", "type": "public"})}]}


class Show(Base):
    def test_show_prints_no_credential(self):
        t = FakeTransport(BASE).on("POST", "/api/auth/login", login_ok).on(
            "GET", "/api/posts/p1", lambda p, b: (200, queued_post()))
        code = self.run_main(["show", "p1"], t, env_postiz())
        self.assertEqual(code, 0, self.err)
        self.assertIn('"id": "p1"', self.out)
        self.assertIn("REF_YT", self.out)
        self.assertNotIn("refreshToken", self.out)
        self.assertNotIn("internalId", self.out)

    def test_login_body_never_printed_and_failure_is_status_only(self):
        t = FakeTransport(BASE).on("POST", "/api/auth/login", lambda p, b: (401, {"token": TOK, "msg": EMAIL}))
        code = self.run_main(["show", "p1"], t, env_postiz())
        self.assertEqual(code, 1)
        self.assertIn("login failed: HTTP 401", self.err)

    def test_blotato_show(self):
        sched = {"items": [{"id": "s1", "scheduledAt": "2026-12-01T15:00:00Z", "apiKey": BLT_KEY,
                            "draft": {"accountId": "REF_TT", "content": {"text": "hi", "platform": "tiktok"}}}]}
        t = FakeTransport(BBASE).on("GET", "/schedules", lambda p, b: (200, sched))
        self.assertEqual(self.run_main(["show", "s1"], t, env_blotato(), "blotato"), 0, self.err)
        self.assertIn("REF_TT", self.out)
        self.assertEqual(t.calls[0][2]["blotato-api-key"], BLT_KEY)


class State(Base):
    def test_error_body_with_token_redacted(self):
        body = json.dumps({"error": "bad", "access_token": OPAQUE, "refreshToken": OPAQUE})
        t = FakeTransport(BASE).on("GET", "/api/public/v1/posts*", lambda p, b: (401, body))
        code = self.run_main(["state"], t, env_postiz())
        self.assertEqual(code, 1)
        self.assertIn("HTTP 401", self.err)

    def test_state_lists_only_queued_with_public_fields(self):
        listing = {"posts": [
            dict(queued_post("p1")["posts"][0]),
            dict(queued_post("p2", state="PUBLISHED", release="https://v.example.invalid/1")["posts"][0])]}
        t = FakeTransport(BASE).on("GET", "/api/public/v1/posts*", lambda p, b: (200, listing))
        self.assertEqual(self.run_main(["state", "--from", "2026-11-30T00:00:00Z",
                                        "--to", "2026-12-05T00:00:00Z"], t, env_postiz()), 0, self.err)
        self.assertIn('"p1"', self.out)
        self.assertNotIn('"p2"', self.out)
        self.assertEqual(t.calls[0][2]["Authorization"], API_KEY)
        q = urllib.parse.parse_qs(t.calls[0][1].split("?", 1)[1])
        self.assertEqual(q["startDate"], ["2026-11-30T00:00:00.000Z"])

    def test_missing_config_names_variable_only(self):
        t = FakeTransport(BASE)
        self.assertEqual(self.run_main(["state"], t, {}), 1)
        self.assertIn("not set: STS_POSTIZ_URL", self.err)
        self.assertEqual(t.calls, [])

    def test_env_file(self):
        p = self.path("sts.env")
        with open(p, "w") as f:
            f.write("# comment\nexport STS_POSTIZ_URL=%s\nSTS_POSTIZ_API_KEY='%s'\nOTHER=1\n" % (BASE, API_KEY))
        t = FakeTransport(BASE).on("GET", "/api/public/v1/posts*", lambda p_, b: (200, {"posts": []}))
        out, err = io.StringIO(), io.StringIO()
        code = posts.main(["--backend", "postiz", "--env-file", p, "--receipts", self.receipts, "state"],
                          transport=t, env={}, out=out, err=err)
        self.assertEqual(code, 0, err.getvalue())
        self.assertEqual(t.calls[-1][2]["Authorization"], API_KEY)
        self.assert_no_secrets(out.getvalue() + err.getvalue())

    def test_env_file_bad_line_names_line_not_content(self):
        p = self.path("bad.env")
        with open(p, "w") as f:
            f.write("STS_POSTIZ_URL=%s\n%s\n" % (BASE, TOK))
        out, err = io.StringIO(), io.StringIO()
        code = posts.main(["--backend", "postiz", "--env-file", p, "state"], transport=FakeTransport(BASE),
                          env={}, out=out, err=err)
        self.assertEqual(code, 1)
        self.assertIn("env file line 2", err.getvalue())
        self.assertNotIn(TOK, err.getvalue())


def plan_rows():
    rows = []
    for i, (clip, when, text) in enumerate([
            ("a01-demo", "2026-12-01T15:00:00Z", "first caption"),
            ("a02-limit", "2026-12-01T21:00:00Z", "second caption"),
            ("a03-demo", "2026-12-02T15:00:00Z", "third caption"),
            ("a04-demo", "2026-12-03T15:00:00Z", "fourth caption")]):
        rows.append({"clip": clip, "account": "yt-main", "platform": "youtube", "backend": "postiz",
                     "ref": "REF_YT", "when_utc": when,
                     "settings": {"__type": "youtube", "type": "public", "tags": []},
                     "content": {"text": text, "title": "Title %d" % i, "media": {"id": "m%d" % i, "path": "p%d" % i}}})
    return {"posts": rows, "caps": [{"name": "plan", "accounts": ["yt-main"], "refs": ["REF_YT"],
                                     "max": 3, "window_hours": 24}]}


class Create(Base):
    def live(self, items):
        return lambda p, b: (200, {"posts": items})

    def test_dry_run_sends_nothing_but_reads(self):
        t = FakeTransport(BASE).on("GET", "/api/public/v1/posts*", self.live([]))
        code = self.run_main(["create", self.write("plan.json", plan_rows())], t, env_postiz())
        self.assertEqual(code, 0, self.err)
        self.assertEqual({m for m, _, _, _ in t.calls}, {"GET"})
        self.assertEqual(self.out.count("dry-run"), 4)
        self.assertFalse(os.path.exists(self.receipts))

    def test_dedupe_and_cap_recheck(self):
        live = [
            {"id": "e1", "integration": leaky_integration(), "publishDate": "2026-12-01T15:00:00.000Z",
             "content": "unrelated", "state": "QUEUE"},  # same account and minute as a01
            {"id": "e2", "integration": leaky_integration(), "publishDate": "2026-12-05T15:00:00.000Z",
             "content": "<p>second   caption</p>", "state": "QUEUE"},  # same text as a02
            {"id": "e3", "integration": leaky_integration(), "publishDate": "2026-12-02T08:00:00.000Z",
             "content": "x", "state": "QUEUE"},
            {"id": "e4", "integration": leaky_integration(), "publishDate": "2026-12-02T10:00:00.000Z",
             "content": "y", "state": "QUEUE"},
            {"id": "e5", "integration": leaky_integration(), "publishDate": "2026-12-02T12:00:00.000Z",
             "content": "z", "state": "QUEUE"},
        ]
        t = FakeTransport(BASE).on("GET", "/api/public/v1/posts*", self.live(live))
        t.on("POST", "/api/public/v1/posts", lambda p, b: (201, [{"postId": "new1", "integration": TOK}]))
        code = self.run_main(["create", self.write("plan.json", plan_rows()), "--go"], t, env_postiz())
        self.assertEqual(code, 0, self.err)
        lines = self.out.splitlines()
        self.assertIn("skip: already in the queue", lines[0])
        self.assertIn("skip: already in the queue", lines[1])
        self.assertIn("skip: cap plan would be exceeded", lines[2])  # a03 with e3, e4, e5 in 24 h
        self.assertIn("created new1", lines[3])
        self.assertEqual(t.writes(), [("POST", "/api/public/v1/posts")])
        sent = json.loads(t.calls[-1][3])
        self.assertEqual(sent["posts"][0]["group"], "GROUP-1")
        self.assertNotIn("id", sent["posts"][0]["value"][0])
        with open(self.receipts) as f:
            rec = [json.loads(x) for x in f]
        self.assertEqual(rec[0]["action"], "create")
        self.assertEqual(rec[0]["post_id"], "new1")
        self.assertEqual(rec[0]["account"], "yt-main")
        self.assertEqual(rec[0]["clip"], "a04-demo")

    def test_receipts_skip_rows_already_created(self):
        self.add_receipt({"action": "create", "backend": "postiz", "post_id": "old", "clip": "a01-demo",
                          "account": "yt-main"})
        t = FakeTransport(BASE).on("GET", "/api/public/v1/posts*", self.live([]))
        self.assertEqual(self.run_main(["create", self.write("plan.json", plan_rows()), "--only", "1"],
                                       t, env_postiz()), 0)
        self.assertIn("skip: in receipts", self.out.splitlines()[0])
        self.assertEqual(self.out.count("dry-run"), 1)

    def test_stops_on_500(self):
        t = FakeTransport(BASE).on("GET", "/api/public/v1/posts*", self.live([]))
        t.on("POST", "/api/public/v1/posts",
             lambda p, b: (502, '{"message": "upstream", "refresh_token": "%s"}' % OPAQUE))
        code = self.run_main(["create", self.write("plan.json", plan_rows()), "--go"], t, env_postiz())
        self.assertEqual(code, 1)
        self.assertIn("outcome unknown: read the queue and match (account, UTC time) before any retry", self.err)
        self.assertEqual(len(t.writes()), 1)  # no second attempt

    def test_stops_on_network_error(self):
        t = FakeTransport(BASE).on("GET", "/api/public/v1/posts*", self.live([]))
        t.on("POST", "/api/public/v1/posts", lambda p, b: posts.TransportError("timeout"))
        self.assertEqual(self.run_main(["create", self.write("plan.json", plan_rows()), "--go"], t, env_postiz()), 1)
        self.assertIn("outcome unknown", self.err)

    def test_4xx_is_logged_redacted_and_run_continues(self):
        t = FakeTransport(BASE).on("GET", "/api/public/v1/posts*", self.live([]))
        t.on("POST", "/api/public/v1/posts", lambda p, b: (400, {"error": "bad", "apiKey": OPAQUE, "jwt": JWT,
                                                                 "detail": {"password": OPAQUE}}))
        self.assertEqual(self.run_main(["create", self.write("plan.json", plan_rows()), "--go"], t, env_postiz()), 0)
        self.assertEqual(self.out.count("FAILED 400"), 4)  # a failed create does not count for the cap
        with open(self.receipts) as f:
            data = f.read()
        self.assertIn("create_failed", data)

    def test_blotato_create(self):
        plan = {"posts": [{"clip": "a01-demo", "account": "tiktok-main", "platform": "tiktok",
                           "backend": "blotato", "ref": "REF_TT", "when_utc": "2026-12-01T15:30:00Z",
                           "settings": {"privacyLevel": "PUBLIC_TO_EVERYONE"},
                           "content": {"text": "caption", "media": {"url": "https://m.example.invalid/1.mp4"}}},
                          {"clip": "a01-demo", "account": "yt-main", "platform": "youtube", "backend": "postiz",
                           "ref": "REF_YT", "when_utc": "2026-12-01T15:00:00Z", "content": {"text": "t"}}],
                "caps": []}
        t = FakeTransport(BBASE).on("GET", "/schedules", lambda p, b: (200, {"items": []}))
        t.on("POST", "/media", lambda p, b: (201, {"url": "https://m.example.invalid/hosted.mp4"}))
        t.on("POST", "/posts", lambda p, b: (201, {"postSubmissionId": "sub1", "token": OPAQUE}))
        code = self.run_main(["create", self.write("plan.json", plan), "--go"], t, env_blotato(), "blotato")
        self.assertEqual(code, 0, self.err)
        self.assertEqual(t.writes(), [("POST", "/media"), ("POST", "/posts")])
        body = json.loads(t.calls[-1][3])
        self.assertEqual(body["post"]["content"]["mediaUrls"], ["https://m.example.invalid/hosted.mp4"])
        self.assertEqual(body["post"]["target"]["privacyLevel"], "PUBLIC_TO_EVERYONE")
        with open(self.receipts) as f:
            rec = json.loads(f.readline())
        self.assertEqual((rec["backend"], rec["post_id"]), ("blotato", "sub1"))


class Update(Base):
    def own(self, pid="p1"):
        self.add_receipt({"action": "create", "backend": "postiz", "post_id": pid, "clip": "a01-demo",
                          "account": "yt-main"})

    def transport(self, post, after=None):
        state = {"n": 0}

        def get(p, b):
            state["n"] += 1
            return 200, (after if (after and state["n"] > 1) else post)
        t = FakeTransport(BASE).on("POST", "/api/auth/login", login_ok).on("GET", "/api/posts/p1", get)
        t.on("POST", "/api/posts", lambda p, b: (201, {"id": "p1", "token": TOK}))
        return t

    def test_foreign_id_refused(self):
        self.own("p1")
        t = self.transport(queued_post())
        changes = self.write("c.json", [{"post_id": "p1", "content": "x"},
                                        {"post_id": "someone-else", "content": "y"}])
        code = self.run_main(["update", changes, "--go"], t, env_postiz())
        self.assertEqual(code, 1)
        self.assertIn("REFUSED someone-else", self.err)
        self.assertEqual(t.calls, [])  # refused before any call

    def test_no_receipts_refuses_everything(self):
        t = self.transport(queued_post())
        self.assertEqual(self.run_main(["update", self.write("c.json", [{"post_id": "p1"}]), "--go"],
                                       t, env_postiz()), 1)

    def test_published_post_skipped(self):
        self.own()
        t = self.transport(queued_post(state="PUBLISHED", release="https://v.example.invalid/1"))
        code = self.run_main(["update", self.write("c.json", [{"post_id": "p1", "content": "x"}]), "--go"],
                             t, env_postiz())
        self.assertEqual(code, 0, self.err)
        self.assertIn("SKIP p1", self.out)
        self.assertEqual(t.writes(), [])

    def test_dry_run_reads_and_login_only(self):
        self.own()
        t = self.transport(queued_post())
        code = self.run_main(["update", self.write("c.json", [{"post_id": "p1", "title": "New"}])],
                             t, env_postiz())
        self.assertEqual(code, 0, self.err)
        self.assertIn("dry-run", self.out)
        self.assertEqual(t.writes(), [])
        self.assertEqual({(m, p) for m, p, _, _ in t.calls}, {("POST", "/api/auth/login"), ("GET", "/api/posts/p1")})
        login = [c for c in t.calls if c[1] == "/api/auth/login"][0]
        self.assertEqual(json.loads(login[3]), {"email": EMAIL, "password": PASSWORD, "provider": "LOCAL"})
        self.assertEqual(login[2]["showorg"], "true")

    def test_apply_records_group_change(self):
        self.own()
        after = queued_post(group="G-NEW")
        t = self.transport(queued_post(), after)
        code = self.run_main(["update", self.write("c.json", [{"post_id": "p1", "media": {"id": "m1", "path": "n.mp4"},
                                                               "why": "fix"}]), "--go"], t, env_postiz())
        self.assertEqual(code, 0, self.err)
        sent = json.loads([c for c in t.calls if c[:2] == ("POST", "/api/posts")][0][3])
        self.assertEqual(sent["posts"][0]["value"][0]["id"], "p1")
        self.assertEqual(sent["posts"][0]["group"], "G0")
        with open(self.receipts) as f:
            rec = [json.loads(x) for x in f][-1]
        self.assertEqual(rec["action"], "update_in_place")
        self.assertEqual((rec["group_before"], rec["group_after"], rec["group_unchanged"]), ("G0", "G-NEW", False))
        self.assertTrue(rec["date_unchanged"])


class Delete(Base):
    def own(self, pid, backend="postiz"):
        self.add_receipt({"action": "create", "backend": backend, "post_id": pid, "clip": "a01-demo",
                          "account": "yt-main"})

    def test_delete_confirms_gone(self):
        self.own("p1")
        state = {"deleted": False}

        def get(p, b):
            return (404, "{}") if state["deleted"] else (200, queued_post())

        def delete(p, b):
            state["deleted"] = True
            return 200, "{}"
        t = FakeTransport(BASE).on("POST", "/api/auth/login", login_ok).on("GET", "/api/posts/p1", get)
        t.on("DELETE", "/api/posts/G0", delete)
        code = self.run_main(["delete", self.write("ids.json", [{"post_id": "p1", "why": "dup"}]), "--go"],
                             t, env_postiz())
        self.assertEqual(code, 0, self.err)
        self.assertIn("gone", self.out)
        with open(self.receipts) as f:
            rec = [json.loads(x) for x in f][-1]
        self.assertEqual((rec["action"], rec["gone"]), ("delete", True))

    def test_delete_not_confirmed_stops(self):
        self.own("p1")
        self.own("p2")
        t = FakeTransport(BASE).on("POST", "/api/auth/login", login_ok)
        t.on("GET", "/api/posts/p1", lambda p, b: (200, queued_post()))
        t.on("DELETE", "/api/posts/G0", lambda p, b: (200, "{}"))
        code = self.run_main(["delete", self.write("ids.json", [{"post_id": "p1"}, {"post_id": "p2"}]), "--go"],
                             t, env_postiz())
        self.assertEqual(code, 1)
        self.assertIn("not confirmed", self.err)
        self.assertNotIn(("GET", "/api/posts/p2"), [(m, p) for m, p, _, _ in t.calls])

    def test_delete_refuses_group_with_several_posts(self):
        self.own("p1")
        d = queued_post()
        d["posts"].append(dict(d["posts"][0], id="p9"))
        t = FakeTransport(BASE).on("POST", "/api/auth/login", login_ok).on("GET", "/api/posts/p1", lambda p, b: (200, d))
        code = self.run_main(["delete", self.write("ids.json", [{"post_id": "p1"}]), "--go"], t, env_postiz())
        self.assertEqual(code, 0)
        self.assertIn("SKIP p1", self.out)
        self.assertEqual(t.writes(), [])

    def test_delete_foreign_refused(self):
        t = FakeTransport(BASE)
        self.assertEqual(self.run_main(["delete", self.write("ids.json", [{"post_id": "x"}]), "--go"],
                                       t, env_postiz()), 1)
        self.assertIn("REFUSED x", self.err)
        self.assertEqual(t.calls, [])

    def test_blotato_delete_confirms_gone(self):
        self.own("s1", "blotato")
        items = [{"id": "s1", "scheduledAt": "2026-12-01T15:00:00Z", "draft": {"accountId": "REF_TT"}}]

        def delete(p, b):
            items.clear()
            return 204, ""
        t = FakeTransport(BBASE).on("GET", "/schedules", lambda p, b: (200, {"items": list(items)}))
        t.on("DELETE", "/schedules/s1", delete)
        code = self.run_main(["delete", self.write("ids.json", [{"post_id": "s1"}]), "--go"], t,
                             env_blotato(), "blotato")
        self.assertEqual(code, 0, self.err)
        self.assertIn("gone", self.out)


class Hardening(Base):
    """Cases an independent review found open in the first version."""

    def live(self, items):
        return lambda p, b: (200, {"posts": items})

    def own(self, pid="p1", **extra):
        self.add_receipt(dict({"action": "create", "backend": "postiz", "post_id": pid, "clip": "a01-demo",
                               "account": "yt-main"}, **extra))

    # -- leaks --
    def test_cut_off_error_body_does_not_leak(self):
        body = '{"message": "bad", "integration": {"accessToken": "' + OPAQUE[:16]
        t = FakeTransport(BASE).on("GET", "/api/public/v1/posts*", self.live([]))
        t.on("POST", "/api/public/v1/posts", lambda p, b: (400, body))
        self.run_main(["create", self.write("plan.json", plan_rows()), "--go"], t, env_postiz())
        with open(self.receipts) as f:
            everything = self.out + self.err + f.read()
        self.assertNotIn(OPAQUE[:10], everything)

    def test_own_key_in_an_exception_message_is_masked(self):
        def boom(p, b):
            return ValueError("Invalid header value b'%s'" % API_KEY)
        t = FakeTransport(BASE).on("GET", "/api/public/v1/posts*", boom)
        self.assertEqual(self.run_main(["state"], t, env_postiz()), 1)
        self.assertIn("ValueError", self.err)

    def test_own_opaque_key_echoed_by_the_server_is_masked(self):
        env = dict(env_postiz(), STS_POSTIZ_API_KEY=OPAQUE)       # no prefix, no shape
        t = FakeTransport(BASE).on("GET", "/api/public/v1/posts*",
                                   lambda p, b: (403, "key %s is not allowed" % OPAQUE))
        self.assertEqual(self.run_main(["state"], t, env), 1)
        self.assertIn("HTTP 403", self.err)

    def test_key_with_trailing_newline_is_trimmed_and_control_character_refused(self):
        t = FakeTransport(BASE).on("GET", "/api/public/v1/posts*", self.live([]))
        self.assertEqual(self.run_main(["state"], t, dict(env_postiz(), STS_POSTIZ_API_KEY=API_KEY + "\n")), 0)
        self.assertEqual(t.calls[0][2]["Authorization"], API_KEY)
        t2 = FakeTransport(BASE)
        self.assertEqual(self.run_main(["state"], t2, dict(env_postiz(), STS_POSTIZ_API_KEY="ab\ncd" + API_KEY)), 1)
        self.assertIn("STS_POSTIZ_API_KEY has a control character", self.err)
        self.assertEqual(t2.calls, [])

    def test_url_rules(self):
        for url, msg in (("https://user:%s@postiz.example.invalid" % PASSWORD, "must not carry a login"),
                         ("http://postiz.example.invalid", "must be https"),
                         ("ftp://postiz.example.invalid", "must be https")):
            t = FakeTransport(BASE)
            self.assertEqual(self.run_main(["state"], t, dict(env_postiz(), STS_POSTIZ_URL=url)), 1, url)
            self.assertIn(msg, self.err)
            self.assertEqual(t.calls, [])
        for url, extra in (("http://localhost:5000", {}), ("http://10.0.0.5:5000", {"STS_ALLOW_HTTP": "1"})):
            t = FakeTransport(url).on("GET", "/api/public/v1/posts*", self.live([]))
            self.assertEqual(self.run_main(["state"], t, dict(env_postiz(), STS_POSTIZ_URL=url, **extra)), 0, self.err)

    def test_nested_server_values_are_not_printed(self):
        post = queued_post()
        post["group"] = {"auth": OPAQUE}
        post["posts"][0]["publishDate"] = {"auth": OPAQUE}
        post["posts"][0]["state"] = {"auth": OPAQUE}
        t = FakeTransport(BASE).on("POST", "/api/auth/login", login_ok).on("GET", "/api/posts/p1", lambda p, b: (200, post))
        self.assertEqual(self.run_main(["show", "p1"], t, env_postiz()), 0, self.err)
        self.own()
        self.run_main(["update", self.write("c.json", [{"post_id": "p1", "content": "x"}]), "--go"], t, env_postiz())
        self.assertEqual(t.writes(), [])

    # -- redirects --
    def test_real_transport_refuses_redirects_and_hides_messages(self):
        tr = posts.UrllibTransport()
        self.assertTrue(any(isinstance(h, posts.NoRedirect) for h in tr.opener.handlers))
        req = posts.urllib.request.Request(BASE + "/x", headers={"Authorization": API_KEY})
        self.assertIsNone(posts.NoRedirect().redirect_request(req, None, 302, "Found", {}, "https://other.example.invalid/x"))
        # No network: the opener is replaced by one that raises what http.client raises.
        class Raises:
            def __init__(self, exc):
                self.exc = exc

            def open(self, req, timeout=None):
                raise self.exc
        for exc in (ValueError("Invalid header value b'%s'" % API_KEY),
                    posts.http.client.InvalidURL("nonnumeric port: '%s'" % API_KEY),
                    posts.http.client.BadStatusLine(API_KEY), OSError(API_KEY),
                    posts.urllib.error.URLError(API_KEY)):
            tr.opener = Raises(exc)
            with self.assertRaises(posts.TransportError) as cm:
                tr.request("GET", BASE + "/x", {"Authorization": API_KEY})
            self.assertEqual(str(cm.exception), type(exc).__name__)

    def test_redirect_on_create_is_a_failure_not_a_receipt(self):
        t = FakeTransport(BASE).on("GET", "/api/public/v1/posts*", self.live([]))
        t.on("POST", "/api/public/v1/posts", lambda p, b: (302, "<html>moved</html>"))
        self.assertEqual(self.run_main(["create", self.write("plan.json", plan_rows()), "--go", "--only", "1"],
                                       t, env_postiz()), 0)
        with open(self.receipts) as f:
            rec = [json.loads(x) for x in f]
        self.assertEqual([r["action"] for r in rec], ["create_failed"])

    # -- create --
    def test_success_with_no_post_id_stops_and_is_not_a_create(self):
        for payload in ("<html>ok</html>", [{"postId": None}], {"postId": {"auth": OPAQUE}}, []):
            if os.path.exists(self.receipts):
                os.remove(self.receipts)
            t = FakeTransport(BASE).on("GET", "/api/public/v1/posts*", self.live([]))
            t.on("POST", "/api/public/v1/posts", lambda p, b, payload=payload: (200, payload))
            plan = self.write("plan.json", plan_rows())
            self.assertEqual(self.run_main(["create", plan, "--go"], t, env_postiz()), 1)
            self.assertIn("with no post id", self.err)
            self.assertEqual(len(t.writes()), 1)                    # stopped after the first row
            with open(self.receipts) as f:
                rec = [json.loads(x) for x in f]
            self.assertEqual([r["action"] for r in rec], ["create_unconfirmed"])
            # the next run does not treat the row as created
            t2 = FakeTransport(BASE).on("GET", "/api/public/v1/posts*", self.live([]))
            self.assertEqual(self.run_main(["create", plan, "--only", "1"], t2, env_postiz()), 0)
            self.assertNotIn("skip: in receipts", self.out)

    def test_receipt_without_post_id_or_clip_does_not_mark_rows_done(self):
        self.add_receipt({"action": "create", "backend": "postiz", "post_id": None, "clip": "a01-demo",
                          "account": "yt-main"})
        self.add_receipt({"action": "create", "backend": "postiz", "post_id": "x", "account": "yt-main"})
        rows = plan_rows()
        rows["posts"][1].pop("clip")
        t = FakeTransport(BASE).on("GET", "/api/public/v1/posts*", self.live([]))
        self.assertEqual(self.run_main(["create", self.write("plan.json", rows)], t, env_postiz()), 0)
        self.assertNotIn("skip: in receipts", self.out)

    def test_past_time_is_never_created(self):
        rows = plan_rows()
        rows["posts"][0]["when_utc"] = "2026-11-21T11:00:00Z"       # an hour before the fixed clock
        rows["posts"][1]["when_utc"] = "2026-11-21T12:01:00Z"       # inside the 2 minute margin
        t = FakeTransport(BASE).on("GET", "/api/public/v1/posts*", self.live([]))
        t.on("POST", "/api/public/v1/posts", lambda p, b: (201, [{"postId": "n"}]))
        self.assertEqual(self.run_main(["create", self.write("plan.json", rows), "--go"], t, env_postiz()), 0)
        self.assertEqual(self.out.count("skip: the time is not in the future"), 2)
        self.assertEqual(len(t.writes()), 2)

    def test_create_receipt_names_the_host(self):
        t = FakeTransport(BASE).on("GET", "/api/public/v1/posts*", self.live([]))
        t.on("POST", "/api/public/v1/posts", lambda p, b: (201, [{"postId": "n1"}]))
        self.run_main(["create", self.write("plan.json", plan_rows()), "--go", "--only", "1"], t, env_postiz())
        with open(self.receipts) as f:
            self.assertEqual(json.loads(f.readline())["host"], "postiz.example.invalid")

    # -- update and delete guards --
    def test_post_without_state_is_not_treated_as_queued(self):
        self.own()
        for state in (None, "", "DRAFT", "ERROR"):
            post = queued_post(state=state)
            if state is None:
                del post["posts"][0]["state"]
            t = FakeTransport(BASE).on("POST", "/api/auth/login", login_ok).on("GET", "/api/posts/p1", lambda p, b, post=post: (200, post))
            self.assertEqual(self.run_main(["update", self.write("c.json", [{"post_id": "p1", "content": "x"}]), "--go"],
                                           t, env_postiz()), 0, self.err)
            self.assertIn("SKIP p1", self.out)
            self.assertEqual(self.run_main(["delete", self.write("i.json", [{"post_id": "p1"}]), "--go"],
                                           t, env_postiz()), 0, self.err)
            self.assertIn("SKIP p1", self.out)
            self.assertEqual(t.writes(), [])

    def test_update_refuses_a_group_with_several_posts(self):
        self.own()
        post = queued_post()
        post["posts"].append(dict(post["posts"][0], id="p2"))
        t = FakeTransport(BASE).on("POST", "/api/auth/login", login_ok).on("GET", "/api/posts/p1", lambda p, b: (200, post))
        self.assertEqual(self.run_main(["update", self.write("c.json", [{"post_id": "p1", "content": "x"}]), "--go"],
                                       t, env_postiz()), 0, self.err)
        self.assertIn("its group holds 2 posts", self.out)
        self.assertEqual(t.writes(), [])

    def test_update_refuses_a_past_date(self):
        self.own()
        t = FakeTransport(BASE).on("POST", "/api/auth/login", login_ok).on("GET", "/api/posts/p1", lambda p, b: (200, queued_post()))
        changes = self.write("c.json", [{"post_id": "p1", "date": "2026-11-20T10:00:00.000Z"}])
        self.assertEqual(self.run_main(["update", changes, "--go"], t, env_postiz()), 0, self.err)
        self.assertIn("the new time is not in the future", self.out)
        self.assertEqual(t.writes(), [])

    def test_receipt_from_another_host_or_backend_gives_no_ownership(self):
        for extra in ({"host": "other.example.invalid"}, {"backend": "blotato"}):
            if os.path.exists(self.receipts):
                os.remove(self.receipts)
            self.own(**extra)
            t = FakeTransport(BASE)
            self.assertEqual(self.run_main(["delete", self.write("i.json", [{"post_id": "p1"}]), "--go"],
                                           t, env_postiz()), 1)
            self.assertIn("REFUSED p1", self.err)
            self.assertEqual(t.calls, [])

    def test_post_id_is_one_path_segment(self):
        self.assertEqual(posts.path_id("a/../b?x=1"), "a%2F..%2Fb%3Fx%3D1")
        self.own("a/../other")
        t = FakeTransport(BASE).on("POST", "/api/auth/login", login_ok)
        self.run_main(["delete", self.write("i.json", [{"post_id": "a/../other"}]), "--go"], t, env_postiz())
        gets = [p for m, p, _, _ in t.calls if m == "GET"]
        self.assertEqual(gets, ["/api/posts/a%2F..%2Fother"])
        self.assertEqual(t.writes(), [])


class Round2(Base):
    """Second review round."""

    LONG_HOST = "https://postiz-env.eu-central-1.elasticbeanstalk.example.invalid"
    LONG_CLIP = "stream-2026-11-20-highlight-clip-03-vertical-final-v2"

    def live(self, items):
        return lambda p, b: (200, {"posts": items})

    def own(self, pid="p1", **extra):
        self.add_receipt(dict({"action": "create", "backend": "postiz", "post_id": pid, "clip": "a01-demo",
                               "account": "yt-main"}, **extra))

    def test_long_error_body_does_not_hang(self):
        import time
        t0 = time.time()
        out = posts.safe_body("<html>" + "aZ9" * 20000 + "</html>")
        self.assertLess(time.time() - t0, 2.0)
        self.assertLessEqual(len(out), 500)

    def test_secret_at_the_cuts_is_masked(self):
        for pad in (470, posts.REDACT_LIMIT - 30):
            body = "y" * pad + ' "accessToken": "' + OPAQUE + '" tail'
            self.assertNotIn(OPAQUE[:6], posts.safe_body(body, limit=posts.REDACT_LIMIT))
            self.assertNotIn(OPAQUE[:6], posts.safe_body(body))

    def test_receipt_keeps_host_and_clip_exact_so_ownership_survives(self):
        env = dict(env_postiz(), STS_POSTIZ_URL=self.LONG_HOST)
        rows = plan_rows()
        rows["posts"][0]["clip"] = self.LONG_CLIP
        plan = self.write("plan.json", rows)
        t = FakeTransport(self.LONG_HOST).on("GET", "/api/public/v1/posts*", self.live([]))
        t.on("POST", "/api/public/v1/posts", lambda p, b: (201, [{"postId": "0123456789abcdef" * 3}]))
        self.assertEqual(self.run_main(["create", plan, "--go", "--only", "1"], t, env), 0, self.err)
        with open(self.receipts) as f:
            rec = json.loads(f.readline())
        self.assertEqual(rec["host"], "postiz-env.eu-central-1.elasticbeanstalk.example.invalid")
        self.assertEqual(rec["clip"], self.LONG_CLIP)
        self.assertEqual(rec["post_id"], "0123456789abcdef" * 3)
        # the rerun knows the row is done and sends nothing
        t2 = FakeTransport(self.LONG_HOST).on("GET", "/api/public/v1/posts*", self.live([]))
        self.assertEqual(self.run_main(["create", plan, "--go", "--only", "1"], t2, env), 0, self.err)
        self.assertIn("skip: in receipts", self.out.splitlines()[0])
        # and the post is still this batch's own
        ids = posts.created_ids(posts.read_receipts(self.receipts), "postiz",
                                "postiz-env.eu-central-1.elasticbeanstalk.example.invalid")
        self.assertEqual(ids, {"0123456789abcdef" * 3})

    def test_a_secret_never_lands_in_an_exact_receipt_field(self):
        posts.append_receipt(self.receipts, {"action": "create", "backend": "postiz", "post_id": {"note": OPAQUE},
                                             "clip": ["x", OPAQUE], "account": "yt-main", "host": "h"})
        posts.add_known([OPAQUE])
        posts.append_receipt(self.receipts, {"action": "create", "backend": "postiz", "post_id": "id-" + OPAQUE,
                                             "clip": "a01-demo", "account": "yt-main", "host": "h"})
        with open(self.receipts) as f:
            text = f.read()
        self.assertNotIn(OPAQUE, text)
        first = json.loads(text.splitlines()[0])
        self.assertIsNone(first["post_id"])
        self.assertIsNone(first["clip"])

    def test_receipt_from_another_host_does_not_mark_a_row_done(self):
        self.own(host="other.example.invalid")
        t = FakeTransport(BASE).on("GET", "/api/public/v1/posts*", self.live([]))
        self.assertEqual(self.run_main(["create", self.write("plan.json", plan_rows()), "--only", "1"],
                                       t, env_postiz()), 0)
        self.assertNotIn("skip: in receipts", self.out)
        self.assertEqual(self.out.count("dry-run"), 1)

    def test_state_is_matched_without_case(self):
        self.own()
        t = FakeTransport(BASE).on("POST", "/api/auth/login", login_ok)
        t.on("GET", "/api/posts/p1", lambda p, b: (200, queued_post(state="queue")))
        self.assertEqual(self.run_main(["update", self.write("c.json", [{"post_id": "p1", "content": "x"}])],
                                       t, env_postiz()), 0, self.err)
        self.assertIn("dry-run", self.out)
        self.assertNotIn("SKIP", self.out)

    def test_nested_values_under_ordinary_names_are_not_printed_or_stored(self):
        nested = {"note": OPAQUE}          # an ordinary key name: only scalar() stops it
        post = queued_post()
        post["group"] = nested
        t = FakeTransport(BASE).on("POST", "/api/auth/login", login_ok).on("GET", "/api/posts/p1", lambda p, b: (200, post))
        self.assertEqual(self.run_main(["show", "p1"], t, env_postiz()), 0, self.err)
        self.assertEqual(json.loads(self.out.splitlines()[0]), {"group": None})
        # upload
        t = FakeTransport(BASE).on("POST", "/api/public/v1/upload", lambda p, b: (201, {"id": nested, "path": [OPAQUE]}))
        with open(self.path("m.mp4"), "wb") as f:
            f.write(b"0")
        self.assertEqual(self.run_main(["upload", self.path("m.mp4")], t, env_postiz()), 0, self.err)
        self.assertEqual(json.loads(self.out), {"id": None, "path": None})
        # update: the dry-run line, the skip line and the receipt
        self.own()
        bad_date = queued_post()
        bad_date["posts"][0]["publishDate"] = nested
        after = queued_post(group="G1")
        after["posts"][0]["publishDate"] = nested
        after["posts"][0]["state"] = nested
        state = {"n": 0}

        def get(p, b):
            state["n"] += 1
            return 200, (bad_date if state["n"] == 1 else after)
        t = FakeTransport(BASE).on("POST", "/api/auth/login", login_ok).on("GET", "/api/posts/p1", get)
        t.on("POST", "/api/posts", lambda p, b: (201, {"id": "p1"}))
        self.run_main(["update", self.write("c.json", [{"post_id": "p1", "content": "x"}]), "--go"], t, env_postiz())
        skipped = queued_post()
        skipped["posts"][0]["state"] = nested
        t = FakeTransport(BASE).on("POST", "/api/auth/login", login_ok).on("GET", "/api/posts/p1", lambda p, b: (200, skipped))
        self.run_main(["update", self.write("c.json", [{"post_id": "p1", "content": "x"}]), "--go"], t, env_postiz())
        self.assertIn("SKIP p1", self.out)
        self.run_main(["delete", self.write("i.json", [{"post_id": "p1"}]), "--go"], t, env_postiz())
        self.assertIn("SKIP p1", self.out)

    def test_stop_message_is_redacted(self):
        rows = plan_rows()
        rows["posts"][0]["clip"] = "token=" + OPAQUE
        rows["posts"][0]["content"].pop("text")
        t = FakeTransport(BASE).on("GET", "/api/public/v1/posts*", self.live([]))
        self.assertEqual(self.run_main(["create", self.write("plan.json", rows), "--go"], t, env_postiz()), 1)
        self.assertIn("has no content.text", self.err)

    def test_entry_or_receipt_without_post_id_gives_no_ownership(self):
        self.add_receipt({"action": "create", "backend": "postiz", "post_id": None, "clip": "a", "account": "b"})
        self.add_receipt({"action": "create", "backend": "postiz", "clip": "a", "account": "b"})
        for ids, msg in (([{"post_id": "None"}], "REFUSED None"), ([{"why": "x"}], "REFUSED entry 1: no post_id"),
                         ([{"post_id": {"a": 1}}], "REFUSED entry 1: no post_id"), ({"post_id": "p1"}, "expected a JSON list")):
            for cmd in ("delete", "update"):
                t = FakeTransport(BASE)
                self.assertEqual(self.run_main([cmd, self.write("i.json", ids), "--go"], t, env_postiz()), 1)
                self.assertIn(msg, self.err)
                self.assertEqual(t.calls, [])

    def test_refused_redirect_says_so(self):
        t = FakeTransport(BASE).on("GET", "/api/public/v1/posts*", lambda p, b: (301, "<html>moved</html>"))
        self.assertEqual(self.run_main(["state"], t, env_postiz()), 1)
        self.assertIn("redirect refused: set the final https URL", self.err)
        t = FakeTransport(BASE).on("POST", "/api/auth/login", lambda p, b: (302, ""))
        self.assertEqual(self.run_main(["show", "p1"], t, env_postiz()), 1)
        self.assertIn("login failed: HTTP 302 (redirect refused", self.err)

    def test_delete_skip_says_why(self):
        self.own()
        t = FakeTransport(BASE).on("POST", "/api/auth/login", login_ok)
        t.on("GET", "/api/posts/p1", lambda p, b: (200, queued_post(state="PUBLISHED")))
        self.run_main(["delete", self.write("i.json", [{"post_id": "p1"}]), "--go"], t, env_postiz())
        self.assertIn("1 in its group, state PUBLISHED", self.out)

    def test_update_date_is_sent_as_utc(self):
        body = posts.build_update_body(queued_post(), {"post_id": "p1", "date": "2026-12-05 10:00"})
        self.assertEqual(body["date"], "2026-12-05T10:00:00.000Z")
        body = posts.build_update_body(queued_post(), {"post_id": "p1", "date": "2026-12-05T10:00:00-05:00"})
        self.assertEqual(body["date"], "2026-12-05T15:00:00.000Z")
        self.assertEqual(posts.build_update_body(queued_post(), {"post_id": "p1"})["date"], "2026-12-01T15:00:00.000Z")

    def test_known_values_do_not_leak_between_runs(self):
        t = FakeTransport(BASE).on("GET", "/api/public/v1/posts*", self.live([]))
        self.run_main(["state"], t, dict(env_postiz(), STS_POSTIZ_API_KEY="firstkey2026"))
        self.run_main(["state"], t, env_postiz())
        self.assertEqual(posts.redact_text("date 2026 firstkey2026"), "date 2026 firstkey2026")

    def test_own_key_fragment_echoed_by_the_server_is_masked(self):
        t = FakeTransport(BASE).on("GET", "/api/public/v1/posts*",
                                   lambda p, b: (403, "Invalid key provided: %s***" % API_KEY[:8]))
        self.assertEqual(self.run_main(["state"], t, env_postiz()), 1)
        self.assertNotIn(API_KEY[:8], self.err)
        self.assertIn("HTTP 403", self.err)


class Upload(Base):
    def test_upload_prints_id_and_path_only(self):
        f = self.path("a01-demo.mp4")
        with open(f, "wb") as fh:
            fh.write(b"\x00" * 10)
        t = FakeTransport(BASE).on("POST", "/api/public/v1/upload",
                                   lambda p, b: (201, {"id": "m1", "path": "https://cdn.example.invalid/m1.mp4",
                                                       "organizationId": "org", "token": TOK}))
        self.assertEqual(self.run_main(["upload", f], t, env_postiz()), 0, self.err)
        self.assertEqual(json.loads(self.out), {"id": "m1", "path": "https://cdn.example.invalid/m1.mp4"})
        self.assertTrue(t.calls[0][2]["Content-Type"].startswith("multipart/form-data; boundary="))

    def test_upload_error_redacted(self):
        f = self.path("a01-demo.mp4")
        with open(f, "wb") as fh:
            fh.write(b"\x00")
        t = FakeTransport(BASE).on("POST", "/api/public/v1/upload",
                                   lambda p, b: (413, "too large; cookie=" + OPAQUE + " token: " + OPAQUE))
        self.assertEqual(self.run_main(["upload", f], t, env_postiz()), 1)
        self.assertIn("upload failed: HTTP 413", self.err)


class Receipts(Base):
    def test_append_receipt_masks_by_key_name(self):
        posts.append_receipt(self.receipts, {"action": "create", "backend": "postiz", "post_id": "p1",
                                             "account": "yt-main", "response": {"access_token": OPAQUE,
                                             "integration": leaky_integration(), "note": "Bearer " + OPAQUE}})
        with open(self.receipts) as f:
            data = f.read()
        self.assertNotIn(OPAQUE, data)
        rec = json.loads(data)
        self.assertEqual((rec["post_id"], rec["account"]), ("p1", "yt-main"))
        self.assertEqual(rec["response"]["integration"], {"id": "REF_YT", "redacted": True})
        self.assertEqual(posts.created_ids(posts.read_receipts(self.receipts), "postiz"), {"p1"})

    def test_safe_body_masks_by_key_name(self):
        out = posts.safe_body(json.dumps({"x": {"privateKey": OPAQUE}, "set-cookie": OPAQUE}))
        self.assertNotIn(OPAQUE, out)
        self.assertNotIn(OPAQUE, posts.safe_body("not json: password=" + OPAQUE))


class Flags(Base):
    def test_global_flags_after_command(self):
        t = FakeTransport(BASE).on("GET", "/api/public/v1/posts*", lambda p, b: (200, {"posts": []}))
        out, err = io.StringIO(), io.StringIO()
        code = posts.main(["state", "--backend", "postiz", "--receipts", self.receipts], transport=t,
                          env=env_postiz(), out=out, err=err)
        self.assertEqual(code, 0, err.getvalue())

    def test_backend_required(self):
        out, err = io.StringIO(), io.StringIO()
        self.assertEqual(posts.main(["state"], transport=FakeTransport(BASE), env={}, out=out, err=err), 2)

    def test_rows_without_backend_are_skipped(self):
        plan = plan_rows()
        for r in plan["posts"]:
            r.pop("backend")
        t = FakeTransport(BASE).on("GET", "/api/public/v1/posts*", lambda p, b: (200, {"posts": []}))
        self.assertEqual(self.run_main(["create", self.write("plan.json", plan), "--go"], t, env_postiz()), 0)
        self.assertIn("4 rows without a backend skipped", self.out)
        self.assertEqual(t.calls, [])


def simple_plan(rows):
    out = []
    for clip, account, ref, when, text in rows:
        out.append({"clip": clip, "account": account, "platform": "youtube", "backend": "postiz", "ref": ref,
                    "when_utc": when, "settings": {"__type": "youtube", "type": "public", "tags": []},
                    "content": {"text": text, "title": "T", "media": {"id": "m", "path": "p"}}})
    return {"posts": out, "caps": []}


class Round3(Base):
    """Third review round: rows of one run against each other, delete then
    create, the end of a paged list, and a Blotato entry that is not queued."""

    def postiz(self, live=()):
        n = {"i": 0}

        def post(p, b):
            n["i"] += 1
            return 201, [{"postId": "new%d" % n["i"]}]
        t = FakeTransport(BASE).on("GET", "/api/public/v1/posts*", lambda p, b: (200, {"posts": list(live)}))
        return t.on("POST", "/api/public/v1/posts", post)

    DOUBLED = [("a01-demo", "yt-main", "REF_YT", "2026-12-01T15:00:00Z", "first caption"),
               ("a01-demo", "yt-main", "REF_YT", "2026-12-03T15:00:00Z", "another caption"),     # same clip and account
               ("a02-limit", "yt-main", "REF_YT", "2026-12-01T15:00:30Z", "second caption"),     # same minute
               ("a03-demo", "yt-main", "REF_YT", "2026-12-05T15:00:00Z", "<p>first   caption</p>"),     # same text
               ("a04-demo", "yt-es", "REF_ES", "2026-12-01T15:00:00Z", "first caption")]         # another account

    def test_rows_of_one_run_are_checked_against_each_other(self):
        t = self.postiz()
        code = self.run_main(["create", self.write("plan.json", simple_plan(self.DOUBLED)), "--go"], t, env_postiz())
        self.assertEqual(code, 0, self.err)
        lines = self.out.splitlines()
        self.assertIn("created new1", lines[0])
        self.assertIn("skip: in receipts", lines[1])
        self.assertIn("skip: already in the queue", lines[2])
        self.assertIn("skip: already in the queue", lines[3])
        self.assertIn("created new2", lines[4])
        self.assertEqual(len(t.writes()), 2)

    def test_dry_run_reports_the_same_skips(self):
        t = self.postiz()
        self.assertEqual(self.run_main(["create", self.write("plan.json", simple_plan(self.DOUBLED))],
                                       t, env_postiz()), 0)
        self.assertEqual(self.out.count("dry-run"), 2)
        self.assertEqual(self.out.count("skip:"), 3)
        self.assertEqual(t.writes(), [])

    def test_a_failed_create_does_not_block_the_same_row_later(self):
        t = FakeTransport(BASE).on("GET", "/api/public/v1/posts*", lambda p, b: (200, {"posts": []}))
        t.on("POST", "/api/public/v1/posts", lambda p, b: (400, {"error": "bad"}))
        self.run_main(["create", self.write("plan.json", simple_plan(self.DOUBLED[:2])), "--go"], t, env_postiz())
        self.assertEqual(self.out.count("FAILED 400"), 2)

    def recreate(self, delete_rec):
        self.add_receipt({"action": "create", "backend": "postiz", "host": "postiz.example.invalid",
                          "post_id": "old", "clip": "a01-demo", "account": "yt-main"})
        if delete_rec:
            self.add_receipt(dict({"action": "delete", "backend": "postiz", "post_id": "old"}, **delete_rec))
        t = self.postiz()
        self.assertEqual(self.run_main(["create", self.write("plan.json", simple_plan(self.DOUBLED[:1])), "--go"],
                                       t, env_postiz()), 0, self.err)
        return t

    def test_a_deleted_post_can_be_created_again(self):
        t = self.recreate({"gone": True, "host": "postiz.example.invalid"})
        self.assertIn("created new1", self.out)
        self.assertEqual(len(t.writes()), 1)

    def test_a_delete_receipt_without_a_host_counts(self):
        self.assertEqual(len(self.recreate({"gone": True}).writes()), 1)

    def test_an_unconfirmed_or_foreign_delete_does_not_free_the_row(self):
        for rec in (None, {"gone": False}, {"gone": True, "host": "other.example.invalid"},
                    {"gone": True, "backend": "blotato"}, {"gone": "yes"}):
            if os.path.exists(self.receipts):
                os.remove(self.receipts)
            t = self.recreate(rec)
            self.assertIn("skip: in receipts", self.out, rec)
            self.assertEqual(t.writes(), [], rec)

    def test_delete_then_create_end_to_end(self):
        self.add_receipt({"action": "create", "backend": "postiz", "host": "postiz.example.invalid",
                          "post_id": "p1", "clip": "a01-demo", "account": "yt-main"})
        state = {"deleted": False}
        t = self.postiz().on("POST", "/api/auth/login", login_ok)
        t.on("GET", "/api/posts/p1", lambda p, b: (404, "{}") if state["deleted"] else (200, queued_post()))
        t.on("DELETE", "/api/posts/G0", lambda p, b: (state.update(deleted=True), (200, "{}"))[1])
        self.assertEqual(self.run_main(["delete", self.write("ids.json", [{"post_id": "p1"}]), "--go"],
                                       t, env_postiz()), 0, self.err)
        with open(self.receipts) as f:
            rec = [json.loads(x) for x in f][-1]
        self.assertEqual((rec["action"], rec["host"], rec["gone"]), ("delete", "postiz.example.invalid", True))
        self.assertEqual(self.run_main(["create", self.write("plan.json", simple_plan(self.DOUBLED[:1])), "--go"],
                                       t, env_postiz()), 0, self.err)
        self.assertIn("created new1", self.out)

    def endless(self):
        return FakeTransport(BBASE).on("GET", "/schedules*", lambda p, b: (200, {"items": [
            {"id": "s%d" % len(p), "scheduledAt": "2026-12-01T15:00:00Z", "draft": {"accountId": "REF_TT"}}],
            "cursor": "more"}))

    def test_blotato_list_that_never_ends_stops_create(self):
        plan = {"posts": [{"clip": "a01-demo", "account": "tiktok-main", "platform": "tiktok", "backend": "blotato",
                           "ref": "REF_TT", "when_utc": "2026-12-02T15:30:00Z", "content": {"text": "caption"}}],
                "caps": []}
        t = self.endless()
        self.assertEqual(self.run_main(["create", self.write("plan.json", plan), "--go"], t,
                                       env_blotato(), "blotato"), 1)
        self.assertIn("queue read is incomplete", self.err)
        self.assertEqual(t.writes(), [])
        self.assertEqual(len(t.calls), posts.BLOTATO_PAGES)

    def test_blotato_list_that_never_ends_stops_delete(self):
        self.add_receipt({"action": "create", "backend": "blotato", "post_id": "s1", "clip": "a01-demo",
                          "account": "tiktok-main"})
        t = self.endless()
        self.assertEqual(self.run_main(["delete", self.write("ids.json", [{"post_id": "s1"}]), "--go"], t,
                                       env_blotato(), "blotato"), 1)
        self.assertEqual(t.writes(), [])

    def test_blotato_last_page_exactly_at_the_limit_is_complete(self):
        seen = {"n": 0}

        def page(p, b):
            seen["n"] += 1
            return 200, {"items": [], "cursor": None if seen["n"] == posts.BLOTATO_PAGES else "c%d" % seen["n"]}
        t = FakeTransport(BBASE).on("GET", "/schedules*", page)
        self.assertEqual(self.run_main(["state"], t, env_blotato(), "blotato"), 0, self.err)

    def test_blotato_entry_that_is_not_queued_is_not_deleted(self):
        self.add_receipt({"action": "create", "backend": "blotato", "post_id": "s1", "clip": "a01-demo",
                          "account": "tiktok-main"})
        for extra in ({"status": "published"}, {"state": "FAILED"}, {"publicUrl": "https://v.example.invalid/1"},
                      {"status": "scheduled", "postUrl": "https://v.example.invalid/1"}):
            item = dict({"id": "s1", "scheduledAt": "2026-12-01T15:00:00Z", "draft": {"accountId": "REF_TT"}}, **extra)
            t = FakeTransport(BBASE).on("GET", "/schedules", lambda p, b, item=item: (200, {"items": [item]}))
            self.assertEqual(self.run_main(["delete", self.write("ids.json", [{"post_id": "s1"}]), "--go"], t,
                                           env_blotato(), "blotato"), 0, self.err)
            self.assertIn("SKIP s1: not queued", self.out, extra)
            self.assertEqual(t.writes(), [], extra)

    def test_blotato_flat_reads_status_and_defaults_to_queued(self):
        base = {"id": "s1", "scheduledAt": "2026-12-01T15:00:00Z", "draft": {"accountId": "REF_TT"}}
        self.assertTrue(posts.Blotato.queued(posts.Blotato.flat(base)))
        for st in ("scheduled", "QUEUED", "pending", "queue"):
            self.assertTrue(posts.Blotato.queued(posts.Blotato.flat(dict(base, status=st))), st)
        self.assertFalse(posts.Blotato.queued(posts.Blotato.flat(dict(base, status="published"))))


if __name__ == "__main__":
    unittest.main()
