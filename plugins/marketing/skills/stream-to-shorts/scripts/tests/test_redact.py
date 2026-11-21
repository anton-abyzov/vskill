import os, sys; sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))  # noqa: E401,E702

import json
import subprocess
import unittest

import redact as redact_mod
from redact import MASK, public_view, redact, redact_text

TOK = "tok_" + "x" * 32
JWT = ".".join(["eyJ" + "a" * 14, "b" * 22, "c" * 22])
OPAQUE = "q" * 12 + "7" * 12  # no vendor prefix, no shape: only the key name gives it away
SCRIPT = os.path.join(os.path.dirname(__file__), "..", "redact.py")


class RedactObj(unittest.TestCase):
    def test_masks_by_key_name(self):
        names = ["Authorization", "access_token", "refreshToken", "id_token", "client_secret",
                 "password", "passwd", "cookie", "Set-Cookie", "api_key", "apiKey", "API-KEY",
                 "key", "credentials", "sessionId", "bearer", "signature", "privateKey", "TOKEN"]
        src = {n: OPAQUE for n in names}
        out = redact(src)
        for n in names:
            self.assertEqual(out[n], MASK, n)
        self.assertNotIn(OPAQUE, json.dumps(out))

    def test_masks_short_values_too(self):
        self.assertEqual(redact({"password": "a"})["password"], MASK)
        self.assertEqual(redact({"token": 12345})["token"], MASK)
        self.assertEqual(redact({"token": {"nested": "x"}})["token"], MASK)

    def test_keeps_ordinary_fields(self):
        src = {"post_id": "p1", "account": "yt-main", "monkey": "banana", "privacyLevel": "PUBLIC",
               "keyword": "ai", "group": "g1", "when_utc": "2026-12-01T15:00:00Z"}
        self.assertEqual(redact(src), src)

    def test_deep_and_lists(self):
        src = {"a": [{"b": {"accessToken": OPAQUE, "name": "n"}}, "plain"]}
        out = redact(src)
        self.assertEqual(out["a"][0]["b"]["accessToken"], MASK)
        self.assertEqual(out["a"][0]["b"]["name"], "n")
        self.assertEqual(src["a"][0]["b"]["accessToken"], OPAQUE)  # input untouched

    def test_integration_collapsed(self):
        src = {"posts": [{"id": "p1", "integration": {"id": "REF_YT", "name": "x", "picture": "u",
                                                      "customer": {"token": OPAQUE}, "internalId": "9"}}],
               "integrations": [{"id": "A", "token": OPAQUE}, {"id": "B"}]}
        out = redact(src)
        self.assertEqual(out["posts"][0]["integration"], {"id": "REF_YT", "redacted": True})
        self.assertEqual(out["integrations"], [{"id": "A", "redacted": True}, {"id": "B", "redacted": True}])

    def test_integration_id_string_kept(self):
        self.assertEqual(redact({"integration": "REF_YT"}), {"integration": "REF_YT"})

    def test_secret_shapes_in_string_values(self):
        out = redact({"note": "header was Bearer " + "y" * 30, "detail": JWT})
        self.assertNotIn("y" * 30, json.dumps(out))
        self.assertNotIn(JWT, json.dumps(out))


class RedactText(unittest.TestCase):
    def check_gone(self, s, secret):
        out = redact_text(s)
        self.assertNotIn(secret, out, out)
        return out

    def test_bearer(self):
        out = self.check_gone("Authorization: Bearer " + OPAQUE, OPAQUE)
        self.assertIn("Authorization", out)

    def test_jwt(self):
        self.check_gone("got " + JWT + " back", JWT)

    def test_key_value_forms(self):
        for s in ["token=" + OPAQUE, "access_token=" + OPAQUE + "&x=1", "api_key: " + OPAQUE,
                  '{"refreshToken": "' + OPAQUE + '"}', "{'password': '" + OPAQUE + "'}",
                  "password=\"" + OPAQUE + "\"", "Authorization: " + OPAQUE,
                  'blotato-api-key: ' + OPAQUE, '"key": "' + OPAQUE + '"', "secret = " + OPAQUE]:
            with self.subTest(s=s):
                self.check_gone(s, OPAQUE)

    def test_cookie_header_whole_line(self):
        out = self.check_gone("Set-Cookie: auth=" + OPAQUE + "; Path=/; HttpOnly", OPAQUE)
        self.assertTrue(out.startswith("Set-Cookie: "))

    def test_vendor_prefixes(self):
        for s in [TOK, "sk-proj-" + "A1" * 12, "ghp_" + "B2" * 12, "blt_" + "C3" * 12,
                  "xoxb-" + "1" * 20, "AKIA" + "Z" * 16]:
            with self.subTest(s=s[:5]):
                self.check_gone("value " + s + " end", s)

    def test_ordinary_text_unchanged(self):
        s = "Posted at 10:00, key moments: the limit card. monkey=banana https://example.invalid/a01-demo.mp4"
        out = redact_text(s)
        self.assertIn("monkey=banana", out)
        self.assertIn("a01-demo.mp4", out)
        self.assertIn("Posted at 10:00", out)


class PublicView(unittest.TestCase):
    def test_postiz_shape(self):
        post = {"id": "p1", "content": "<p>" + "word " * 40 + "</p>", "publishDate": "2026-12-01T15:00:00.000Z",
                "state": "QUEUE", "releaseURL": None, "group": "g1", "organizationId": "org",
                "integration": {"id": "REF_YT", "providerIdentifier": "youtube", "token": TOK,
                                "refreshToken": TOK},
                "image": json.dumps([{"id": "m1", "path": "https://cdn.example.invalid/up/a01-demo.mp4"}]),
                "settings": json.dumps({"title": "A title", "__type": "youtube"}), "apiKey": TOK}
        v = public_view(post)
        self.assertEqual(set(v), {"id", "account", "platform", "state", "when", "text", "media",
                                  "title", "release_url"})
        self.assertEqual(v["account"], "REF_YT")
        self.assertEqual(v["platform"], "youtube")
        self.assertEqual(v["media"], "a01-demo.mp4")
        self.assertEqual(v["title"], "A title")
        self.assertLessEqual(len(v["text"]), 80)
        self.assertNotIn(TOK, json.dumps(v))

    def test_blotato_shape(self):
        s = {"id": "s1", "scheduledAt": "2026-12-01T15:00:00Z", "secretThing": TOK,
             "draft": {"accountId": "REF_TT", "content": {"text": "hello there", "platform": "tiktok",
                                                          "mediaUrls": ["https://m.example.invalid/x/a02-limit.mp4?sig=1"]}}}
        v = public_view(s)
        self.assertEqual(v["account"], "REF_TT")
        self.assertEqual(v["platform"], "tiktok")
        self.assertEqual(v["media"], "a02-limit.mp4")
        self.assertEqual(v["when"], "2026-12-01T15:00:00Z")
        self.assertNotIn(TOK, json.dumps(v))

    def test_unknown_fields_dropped_and_field_subset(self):
        v = public_view({"id": "p1", "whatever": "x", "customer": {"name": "c"}}, fields=("id", "state"))
        self.assertEqual(v, {"id": "p1", "state": None})

    def test_text_with_secret_masked(self):
        v = public_view({"id": "p1", "content": "debug " + TOK})
        self.assertNotIn(TOK, v["text"])


class Hardening(unittest.TestCase):
    """Cases an independent review found open in the first version."""

    def tearDown(self):
        redact_mod.clear_known()

    def test_public_view_never_passes_a_nested_value(self):
        v = public_view({"id": {"id": 7, "auth": OPAQUE}, "account": {"id": 3, "auth": OPAQUE},
                         "platform": {"accessToken": OPAQUE}, "title": [OPAQUE], "state": {"x": OPAQUE},
                         "publishDate": [OPAQUE], "releaseURL": {"u": OPAQUE}})
        self.assertNotIn(OPAQUE, json.dumps(v))
        self.assertEqual((v["id"], v["account"], v["platform"], v["title"], v["state"]), (7, 3, None, None, None))
        for value in v.values():
            self.assertNotIsInstance(value, (dict, list))

    def test_body_cut_off_inside_a_quoted_value(self):
        for cut in ('{"a": 1, "accessToken": "' + OPAQUE[:14], '"apiKey":"' + OPAQUE[:8],
                    "{'refresh_token': '" + OPAQUE[:10]):
            out = redact_text(cut)
            self.assertNotIn(OPAQUE[:8], out, cut)
            self.assertIn(MASK, out)

    def test_more_key_names(self):
        d = {k: OPAQUE for k in ("accessKey", "access_key", "auth", "oauth", "jwt", "sig", "pwd", "pass",
                                 "passphrase", "otp", "x-auth", "idToken")}
        self.assertNotIn(OPAQUE, json.dumps(redact(d)))
        kept = redact({"author": "Jane", "authors": ["Jane"], "passage": "text", "design": "x"})
        self.assertEqual(kept, {"author": "Jane", "authors": ["Jane"], "passage": "text", "design": "x"})

    def test_name_value_pair(self):
        out = redact({"headers": [{"name": "X-Api-Key", "value": OPAQUE}, {"name": "Accept", "value": "text/html"}]})
        self.assertEqual(out["headers"][0]["value"], MASK)
        self.assertEqual(out["headers"][1]["value"], "text/html")

    def test_query_names_and_url_userinfo(self):
        url = "https://user:%s@host.example.invalid/f.mp4?sig=%s&auth=%s&pwd=%s&code=%s&w=1080" % ((OPAQUE,) * 5)
        out = redact_text(url)
        self.assertNotIn(OPAQUE, out)
        self.assertIn("w=1080", out)
        self.assertIn("host.example.invalid/f.mp4", out)

    def test_long_opaque_strings(self):
        hex40 = "0123456789abcdef" * 2 + "01234567"
        b64 = "Zm9v" * 13 + "9"
        self.assertNotIn(hex40, redact_text("id %s end" % hex40))
        self.assertNotIn(b64, redact_text("blob=%s" % b64))
        ordinary = "post cmf3k2x9a0001abcd is at 2026-12-01T15:00:00.000Z, uuid 123e4567-e89b-12d3-a456-426614174000"
        self.assertEqual(redact_text(ordinary), ordinary)

    def test_known_values_masked_anywhere(self):
        redact_mod.add_known([OPAQUE, "abc"])            # 3 characters: ignored
        self.assertEqual(redact_text("Invalid header value b'%s'" % OPAQUE), "Invalid header value b'%s'" % MASK)
        self.assertEqual(redact({"note": "x %s y" % OPAQUE})["note"], "x %s y" % MASK)
        self.assertEqual(redact_text("abc"), "abc")

    def test_ordinary_words_with_short_names_inside(self):
        text = "bypass=1 passage=2 keyboard=3 design=4 error code=400 the key is here author: Jane"
        self.assertEqual(redact_text(text), text)


class CLI(unittest.TestCase):
    def run_cli(self, data):
        return subprocess.run([sys.executable, SCRIPT], input=data, capture_output=True, text=True)

    def test_json_stdin(self):
        r = self.run_cli(json.dumps({"access_token": OPAQUE, "id": "p1"}))
        self.assertEqual(r.returncode, 0)
        self.assertEqual(json.loads(r.stdout), {"access_token": MASK, "id": "p1"})

    def test_text_stdin(self):
        r = self.run_cli("HTTP 401 Authorization: Bearer " + OPAQUE + "\n")
        self.assertEqual(r.returncode, 0)
        self.assertNotIn(OPAQUE, r.stdout)
        self.assertIn("HTTP 401", r.stdout)


if __name__ == "__main__":
    unittest.main()
