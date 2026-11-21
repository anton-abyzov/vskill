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


class Round2(unittest.TestCase):
    """Second review round: speed, key names, encoded known values, exact ids."""

    def tearDown(self):
        redact_mod.clear_known()

    def test_long_runs_are_scanned_in_linear_time(self):
        import time                      # CPU time, so a busy machine does not fail it
        n = 60000
        bodies = ["<html>" + "aZ9" * (n // 3) + "</html>", "a-b_" * (n // 4), "x.y" * (n // 3),
                  "tok" * (n // 3), ("key" * 5 + "=") * (n // 16), "eyJ" * (n // 3), "ab12" * (n // 4) + ".mp4"]
        t = time.process_time()
        for b in bodies:
            redact_text(b)
        self.assertLess(time.process_time() - t, 3.0)

    def test_key_names_with_spaces_and_affixes(self):
        d = redact({"Api Key": OPAQUE, "access key": OPAQUE, "clientKey": OPAQUE, "signing_key": OPAQUE,
                    "X-Auth": OPAQUE, "publicKey": "pk", "monkey": "banana", "sort_key": "name"})
        self.assertNotIn(OPAQUE, json.dumps(d))
        self.assertEqual((d["publicKey"], d["monkey"], d["sort_key"]), ("pk", "banana", "name"))
        for text in ("Api Key: %s" % OPAQUE, "clientKey=%s" % OPAQUE, "signing_key: %s" % OPAQUE):
            self.assertNotIn(OPAQUE, redact_text(text), text)
        self.assertEqual(redact_text("monkey: banana"), "monkey: banana")

    def test_pairs_named_by_key_and_list_pairs(self):
        d = redact({"p": {"key": "X-Custom-Token", "value": OPAQUE}, "q": {"k": "apikey", "v": OPAQUE},
                    "h": [["X-Secret", OPAQUE], ["Accept", "text/html"]]})
        self.assertNotIn(OPAQUE, json.dumps(d))
        self.assertEqual(d["h"][1], ["Accept", "text/html"])

    def test_every_cookie_pair_on_the_line(self):
        out = redact_text("Cookie: theme=dark; sid=%s; lang=en" % OPAQUE)
        self.assertNotIn(OPAQUE, out)
        self.assertNotIn("lang=en", out)

    def test_host_names_and_file_names_are_not_token_shapes(self):
        for text in ("postiz-env.eu-central-1.elasticbeanstalk.example.invalid",
                     "stream-2026-11-20-highlight-clip-03-vertical-final-v2-take-7.mp4"):
            self.assertEqual(redact_text(text), text)
        self.assertEqual(redact_text(JWT), MASK)

    def test_known_value_in_other_forms(self):
        import base64
        import urllib.parse
        key = "Zq8vLm2Xw9pR4tY7uB1n/C3dE"
        redact_mod.add_known([key], parts=True)
        redact_mod.add_known(["User" + chr(64) + "Example.invalid"])
        redact_mod.add_known_pair("user", "pw_word")
        forms = [key.lower(), urllib.parse.quote(key, safe=""), json.dumps(key)[1:-1],
                 base64.b64encode(key.encode()).decode(), "Invalid key provided: %s***" % key[:8],
                 "...%s" % key[-8:], "user" + chr(64) + "example.invalid",
                 base64.b64encode(b"user:pw_word").decode()]
        for f in forms:
            out = redact_text(f)
            self.assertIn(MASK, out, f)
            self.assertNotIn(key[:8], out)
        # a login's own start and end are not fragments: ordinary text survives
        self.assertEqual(redact_text("cdn.example.invalid/user-guide"), "cdn.example.invalid/user-guide")

    def test_ident_keeps_ids_exact_and_masks_only_known_values(self):
        hex48 = "0123456789abcdef" * 3
        host = "postiz-env.eu-central-1.elasticbeanstalk.example.invalid"
        self.assertEqual(redact_mod.ident(hex48), hex48)
        self.assertEqual(redact_mod.ident(host), host)
        self.assertEqual(redact_mod.ident(7), 7)
        for bad in ({"id": 1}, ["a"], True, None, "x" * 301, "a\nb"):
            self.assertIsNone(redact_mod.ident(bad))
        redact_mod.add_known([OPAQUE], parts=True)
        self.assertEqual(redact_mod.ident("id-" + OPAQUE), "id-" + MASK)
        self.assertEqual(redact_mod.ident(OPAQUE[:8] + "-clip"), OPAQUE[:8] + "-clip")   # fragments do not touch ids

    def test_public_view_keeps_id_and_media_usable(self):
        hex48 = "0123456789abcdef" * 3
        v = public_view({"id": hex48, "image": [{"path": "https://cdn.example.invalid/u/%s.mp4?sig=x" % hex48}],
                         "integration": {"id": hex48, "token": OPAQUE}})
        self.assertEqual((v["id"], v["account"], v["media"]), (hex48, hex48, hex48 + ".mp4"))


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


class Round3(unittest.TestCase):
    """Third review round: integration values, escaped JSON, secrets as keys."""

    def tearDown(self):
        redact_mod.clear_known()

    def test_integration_id_is_still_redacted(self):
        self.assertEqual(redact({"integration": {"id": TOK, "name": "Main"}}),
                         {"integration": {"id": "[redacted]", "redacted": True}})
        d = redact({"integration": {"id": {"secret": OPAQUE, "token": OPAQUE, "n": 1}}})
        self.assertEqual(d["integration"]["id"], {"secret": "[redacted]", "token": "[redacted]", "n": 1})
        self.assertNotIn(OPAQUE, json.dumps(d))

    def test_integration_that_is_not_an_object_is_redacted(self):
        d = redact({"integration": "Bearer " + OPAQUE, "integrations": [TOK, {"id": JWT}, "REF_YT"]})
        self.assertEqual(d["integration"], "Bearer [redacted]")
        self.assertEqual(d["integrations"], ["[redacted]", {"id": "[redacted]", "redacted": True}, "REF_YT"])

    def test_known_value_under_integration_is_masked(self):
        redact_mod.add_known([OPAQUE])
        d = redact({"integration": {"id": OPAQUE}, "integrations": [OPAQUE, {"id": "x" + OPAQUE}]})
        self.assertNotIn(OPAQUE, json.dumps(d))

    def test_plain_integration_ids_stay_exact(self):
        ref = "cm4abc123def456ghi789jkl0"
        self.assertEqual(redact({"integration": {"id": ref, "token": OPAQUE}, "integrations": [{"id": 7}, ref]}),
                         {"integration": {"id": ref, "redacted": True},
                          "integrations": [{"id": 7, "redacted": True}, ref]})

    def test_json_inside_a_json_string(self):
        inner = json.dumps({"apiKey": OPAQUE, "name": "clip", "refresh_token": OPAQUE})
        once = json.dumps({"error": inner})                 # quotes escaped once
        twice = json.dumps({"wrapped": once})               # and twice
        for text in (once, twice):
            out = redact_text(text)
            self.assertNotIn(OPAQUE, out, text)
            self.assertIn("clip", out)
            self.assertIn("apiKey", out)
        self.assertNotIn(OPAQUE, redact_text('{\\"password\\": \\"' + OPAQUE))    # cut off mid-value
        self.assertNotIn(OPAQUE, redact_text("{\\'api_key\\': \\'" + OPAQUE + "\\'}"))

    def test_escaped_quote_rule_is_linear(self):
        import time
        n = 60000
        bodies = ['\\"token\\": \\"' + "\\" * n, ('\\"key\\": \\"' + "a\\") * (n // 12), "\\\"" * (n // 2),
                  '\\"' + "a_b-" * (n // 4) + '\\": \\"x']
        t = time.process_time()
        for b in bodies:
            redact_text(b)
        self.assertLess(time.process_time() - t, 3.0)

    def test_a_secret_used_as_a_dict_key(self):
        d = redact({TOK: 1, "Bearer " + OPAQUE: {"n": 2}, "name": "x", 5: "y"})
        self.assertNotIn(TOK, json.dumps(d))
        self.assertNotIn(OPAQUE, json.dumps(d))
        self.assertEqual(d["name"], "x")
        self.assertEqual(d[5], "y")


class Round4(unittest.TestCase):
    def test_secret_in_the_name_of_a_header_pair(self):
        self.assertEqual(redact(["Bearer " + OPAQUE, "value"]), ["Bearer [redacted]", "[redacted]"])
        self.assertEqual(redact(("Authorization: " + OPAQUE, "v")), ["Authorization: [redacted]", "[redacted]"])
        self.assertEqual(redact(["X-Api-Key", OPAQUE]), ["X-Api-Key", "[redacted]"])


if __name__ == "__main__":
    unittest.main()
