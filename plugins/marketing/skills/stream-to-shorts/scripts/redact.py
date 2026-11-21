#!/usr/bin/env python3
"""Mask credentials before anything is printed or written.

A scheduler lookup can return the whole account object, with its access
token, refresh token and API key inside. Every path in posts.py that prints
or writes goes through this module first.

Functions:
  redact(obj)          deep copy with every credential-named value masked and
                       every "integration" object collapsed to its id
  redact_text(s)       masks credential shapes inside free text (error bodies)
  public_view(post)    only the allowlisted fields of one post, as scalars
  ident(v)             an id or name kept exact, only registered values masked
  scalar(v)            one printable value: a redacted string, a number, or None
  add_known(values)    exact values to mask wherever they appear (the caller's
                       own key, password and login)

Masking is by key name, by shape and by known value. A secret with an
ordinary key name and no recognisable shape that the caller did not register
is not masked: that is why posts.py prints an allowlist, never a whole object.

Usage:
  python3 redact.py < response.json > safe.json   # JSON in: redact()
  python3 redact.py < error.txt > safe.txt        # anything else: redact_text()
"""
import argparse
import base64
import copy
import json
import os
import re
import sys
import urllib.parse

MASK = "[redacted]"

# A key name is compared after lower-casing and dropping spaces, "_" and "-",
# so "Api Key", "api_key" and "apiKey" are one name.
# It is a credential when that form contains one of these.
_CONTAINS = (
    "auth", "token", "secret", "password", "passwd", "passphrase", "pwd",
    "cookie", "credential", "session", "bearer", "signature", "private", "jwt",
)
# Or is exactly one of these.
_EXACT = ("key", "sig", "pass", "otp", "pin")
# Or ends in "key" (apikey, accesskey, clientkey, signingkey), except these.
_KEY_NOT_SECRET = ("publickey", "pubkey", "monkey", "turkey", "hockey", "jockey",
                   "donkey", "whiskey", "hotkey", "primarykey", "foreignkey",
                   "sortkey", "partitionkey", "cachekey")
# "auth" also sits inside these ordinary names.
_NOT_SECRET = ("author", "authors", "authorname", "authorid")
# In a {"name": ..., "value": ...} pair the value belongs to the name.
_PAIR_NAME = ("name", "header", "field", "key", "k")
_PAIR_VALUE = ("value", "val", "values", "v")

_known = set()        # whole values and their encoded forms
_known_parts = set()  # the start and end of long values
_known_rx = {}        # compiled matchers, rebuilt when the sets change
PART = 8              # length of the start and end fragments
PART_MIN = 20         # only values this long get fragments


def _variants(v):
    out = {v, urllib.parse.quote(v, safe=""), urllib.parse.quote_plus(v),
           json.dumps(v)[1:-1], json.dumps(v, ensure_ascii=False)[1:-1]}
    b = v.encode("utf-8")
    out.add(base64.b64encode(b).decode("ascii").rstrip("="))      # matches with or without padding
    out.add(base64.urlsafe_b64encode(b).decode("ascii").rstrip("="))
    return {x for x in out if len(x) >= 4}


def add_known(values, parts=False):
    """Register values to mask everywhere (the caller's own secrets): the
    value itself in any letter case, URL-encoded, JSON-escaped and base64.
    With parts, a value of 20 or more characters also gives its first and
    last 8, because an error message that echoes part of a key is how the
    source run leaked one. Use parts for random keys only: the start or end
    of a login or a password made of words would mask ordinary text.
    Values under 4 characters are ignored: masking them would shred the text."""
    for v in values or ():
        if not isinstance(v, str) or len(v.strip()) < 4:
            continue
        v = v.strip()
        _known.update(_variants(v))
        if parts and len(v) >= PART_MIN:
            _known_parts.update((v[:PART], v[-PART:]))
    _known_rx.clear()


def add_known_pair(user, password):
    """Register base64 of user:password, the form of a Basic header."""
    if isinstance(user, str) and isinstance(password, str) and user and password:
        pair = base64.b64encode(("%s:%s" % (user.strip(), password.strip())).encode("utf-8")).decode("ascii")
        _known.update((pair, pair.rstrip("=")))
        _known_rx.clear()


def clear_known():
    _known.clear()
    _known_parts.clear()
    _known_rx.clear()


def _rx(which):
    if which not in _known_rx:
        vals = set(_known) | (_known_parts if which == "all" else set())
        _known_rx[which] = (re.compile("|".join(re.escape(v) for v in sorted(vals, key=len, reverse=True)),
                                       re.IGNORECASE) if vals else None)
    return _known_rx[which]


def mask_known(s, parts=False):
    """Mask only the registered values. With parts, their fragments too."""
    rx = _rx("all" if parts else "whole")
    return rx.sub(MASK, s) if rx else s


def ident(v):
    """An id, host, clip or account name as it must be stored to be found
    again: a short plain value with registered secrets masked and no shape
    rule applied. Anything else becomes None."""
    if isinstance(v, bool) or v is None:
        return None
    if isinstance(v, int):
        return v
    if isinstance(v, str) and len(v) <= 300 and not any(ord(ch) < 32 for ch in v):
        return mask_known(v)
    return None

DEFAULT_FIELDS = ("id", "account", "platform", "state", "when", "text",
                  "media", "title", "release_url")


def is_secret_key(name):
    """True when a dict key names a credential."""
    if not isinstance(name, str):
        return False
    k = re.sub(r"[\s_\-]+", "", name.lower())
    if k in _EXACT:
        return True
    if k in _NOT_SECRET or k in _KEY_NOT_SECRET:
        return False
    return k.endswith("key") or any(part in k for part in _CONTAINS)


def _collapse(value):
    if isinstance(value, dict):
        return {"id": value.get("id"), "redacted": True}
    return value  # a bare id string stays as it is


def redact(obj):
    """Deep copy of obj with credential values masked by key name."""
    if isinstance(obj, dict):
        out = {}
        named = any(isinstance(k, str) and k.lower() in _PAIR_NAME and is_secret_key(v)
                    for k, v in obj.items() if isinstance(v, str))
        for k, v in obj.items():
            lk = k.lower() if isinstance(k, str) else k
            if is_secret_key(k) or (named and lk in _PAIR_VALUE):
                out[k] = MASK
            elif lk == "integration":
                out[k] = _collapse(v)
            elif lk == "integrations" and isinstance(v, list):
                out[k] = [_collapse(x) for x in v]
            else:
                out[k] = redact(v)
        return out
    if isinstance(obj, (list, tuple)):
        if len(obj) == 2 and isinstance(obj[0], str) and is_secret_key(obj[0]) \
                and not isinstance(obj[1], (dict, list, tuple)):
            return [obj[0], MASK]      # a ["X-Secret", "value"] header pair
        return [redact(x) for x in obj]
    if isinstance(obj, str):
        return redact_text(obj)
    return copy.deepcopy(obj)


_W = r"(?<![A-Za-z0-9_\-])"          # a name can only start at the start of a word
_NAMES = (r"(?:" + _W + r"[A-Za-z0-9_\-]*(?:authorization|token|secret|password|passwd|passphrase|pwd|cookie|"
          r"api[ _\-]?key|access[ _\-]?key|credential|session|signature|private|jwt)[A-Za-z0-9_\-]*"
          r"|" + _W + r"[A-Za-z0-9]+[_\-]key(?![A-Za-z0-9_\-])"
          r"|" + _W + r"(?-i:[a-z0-9]+Key)(?![A-Za-z0-9_\-])"
          r"|" + _W + r"(?:[A-Za-z0-9]+[_\-])?auth(?![A-Za-z0-9])"
          r"|" + _W + r"(?:key|sig|pass|otp|pin|bearer)(?![A-Za-z0-9_\-]))")

_TEXT_RULES = [
    # Cookie and Authorization headers: the whole value to the end of the line,
    # every cookie pair and any scheme (Basic, Bearer, a raw key).
    (re.compile(r"(?i)\b((?:set-)?cookie\s*:\s*)(?![\"'\s])[^\r\n]+"), r"\1" + MASK),
    (re.compile(r"(?i)\b(authorization\s*[:=]\s*)(?![\"'\s])[^\r\n\"']+"), r"\1" + MASK),
    # Bearer <token>
    (re.compile(r"(?i)\b(bearer)\s+[A-Za-z0-9._~+/=\-]{4,}"), r"\1 " + MASK),
    # JWT: three base64url parts joined by dots, the first starting "eyJ" (a
    # JSON header). Without that anchor a host name of three long labels matched.
    (re.compile(_W + r"eyJ[A-Za-z0-9_\-]{5,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}"), MASK),
    # Vendor prefixes followed by a long token.
    (re.compile(r"\b(?:sk|pk|rk|ghp|gho|ghu|ghs|ghr|github_pat|glpat|xox[abprs]|"
                r"blt|tok|key|ya29)[\-_.][A-Za-z0-9_\-.+/=]{16,}"), MASK),
    (re.compile(r"\bAKIA[0-9A-Z]{16}\b"), MASK),
    # name: "value", "name": "value", name='value'
    (re.compile(r"(?i)([\"']?)(" + _NAMES + r")\1(\s*[:=]\s*)\"(?:[^\"\\]|\\.)*\""),
     r'\1\2\1\3"' + MASK + '"'),
    (re.compile(r"(?i)([\"']?)(" + _NAMES + r")\1(\s*[:=]\s*)'[^']*'"),
     r"\1\2\1\3'" + MASK + "'"),
    # The same with no closing quote: a body that was cut off mid-value.
    (re.compile(r"(?i)([\"']?)(" + _NAMES + r")\1(\s*[:=]\s*)\"(?!\[redacted\]\")[^\"]*\Z"),
     r'\1\2\1\3"' + MASK),
    (re.compile(r"(?i)([\"']?)(" + _NAMES + r")\1(\s*[:=]\s*)'(?!\[redacted\]')[^']*\Z"),
     r"\1\2\1\3'" + MASK),
    # name: value, name=value (headers, query strings, env lines)
    (re.compile(r"(?i)(" + _NAMES + r")(\s*[:=]\s*)(?![\"'\[{]|\s|\[redacted\])"
                r"[^\s\"',;&}\]]+"), r"\1\2" + MASK),
    # An OAuth code in a query string.
    (re.compile(r"(?i)([?&]code=)(?!\[redacted\])[^&\s\"']+"), r"\1" + MASK),
    # user:password@ inside a URL.
    (re.compile(r"(://)[^/\s:@\"']+:[^/\s@\"']+@"), r"\1" + MASK + "@"),
    # Long opaque strings: 40 or more hex characters, or 48 or more base64 characters.
    (re.compile(r"(?<![A-Za-z0-9])[0-9a-fA-F]{40,}(?![A-Za-z0-9])"), MASK),
    # (not a file name: a run followed by .ext is left alone)
    (re.compile(r"(?<![A-Za-z0-9+/_\-])(?=[A-Za-z0-9+/_\-]*[0-9])(?=[A-Za-z0-9+/_\-]*[A-Za-z])"
                r"[A-Za-z0-9+/_\-]{48,}={0,2}(?![A-Za-z0-9+/_\-])(?!\.[A-Za-z0-9]{2,4}(?![A-Za-z0-9]))"), MASK),
]


def redact_text(s):
    """Mask credential shapes inside free text."""
    if not isinstance(s, str):
        s = str(s)
    s = mask_known(s, parts=True)
    for rx, rep in _TEXT_RULES:
        s = rx.sub(rep, s)
    return s


def scalar(v):
    """A printable scalar or None. A dict gives its id; nothing nested passes."""
    if isinstance(v, dict):
        v = v.get("id")
    if isinstance(v, bool) or v is None:
        return v
    if isinstance(v, (int, float)):
        return v
    if isinstance(v, str):
        return redact_text(v)[:300]
    return None


def _first(d, *paths):
    """First non-empty value found along dotted paths in a nested dict."""
    for p in paths:
        cur = d
        for part in p.split("."):
            if isinstance(cur, dict):
                cur = cur.get(part)
            else:
                cur = None
                break
        if cur not in (None, "", [], {}):
            return cur
    return None


def _loads_maybe(v):
    if isinstance(v, str) and v[:1] in "[{":
        try:
            return json.loads(v)
        except ValueError:
            return v
    return v


def _post_text(post):
    content = post.get("content")
    if isinstance(content, dict):
        content = content.get("text")
    if not content:
        draft = post.get("draft") or post.get("post") or {}
        if isinstance(draft, dict):
            c = draft.get("content")
            content = c.get("text") if isinstance(c, dict) else c
    if not content:
        value = post.get("value")
        if isinstance(value, list) and value and isinstance(value[0], dict):
            content = value[0].get("content")
    if not content:
        content = post.get("text")
    if not isinstance(content, str):
        return None
    return redact_text(" ".join(content.split()))[:80]


def _media_name(post):
    img = _loads_maybe(post.get("image"))
    if not img:
        draft = post.get("draft") or post.get("post") or {}
        c = draft.get("content") if isinstance(draft, dict) else None
        img = (c or {}).get("mediaUrls") if isinstance(c, dict) else None
    if not img:
        img = post.get("mediaUrls") or post.get("media")
    first = img[0] if isinstance(img, list) and img else img
    if isinstance(first, dict):
        first = first.get("path") or first.get("url") or first.get("name")
    if not isinstance(first, str) or not first:
        return None
    return first.split("?")[0].rstrip("/").split("/")[-1]


def public_view(post, fields=DEFAULT_FIELDS):
    """Return only allowlisted fields of a post. Unknown fields are dropped."""
    if not isinstance(post, dict):
        return {}
    settings = _loads_maybe(post.get("settings"))
    if not isinstance(settings, dict):
        settings = {}
    integ = post.get("integration")
    view = {
        "id": _first(post, "id", "postId"),
        "account": (integ if isinstance(integ, str) else None)
        or _first(post, "integration.id", "integrationId", "accountId",
                  "draft.accountId", "post.accountId", "account"),
        "platform": _first(post, "integration.providerIdentifier", "platform",
                           "draft.content.platform", "post.content.platform",
                           "draft.target.targetType", "post.target.targetType"),
        "state": _first(post, "state", "status"),
        "when": _first(post, "publishDate", "scheduledAt", "scheduledTime",
                       "scheduled_time", "when", "when_utc"),
        "text": _post_text(post),
        "media": _media_name(post),
        "title": settings.get("title") or post.get("title"),
        "release_url": _first(post, "releaseURL", "release_url", "publicUrl"),
    }
    out = {}
    for f in fields:
        if f not in view:
            continue
        v = view[f]
        if f in ("id", "account", "media"):     # must stay usable as an id or a file name
            out[f] = ident(v.get("id") if isinstance(v, dict) else v)
        else:
            out[f] = scalar(v)
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description="Mask credentials in JSON or text read from stdin.")
    ap.parse_args(argv)
    data = sys.stdin.read()
    try:
        obj = json.loads(data)
    except ValueError:
        sys.stdout.write(redact_text(data))
        return 0
    sys.stdout.write(json.dumps(redact(obj), ensure_ascii=False, indent=1) + "\n")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit("interrupted")
    except Exception as e:  # one line, never the input
        sys.exit("redact failed: " + type(e).__name__)
