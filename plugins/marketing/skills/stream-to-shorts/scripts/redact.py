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
import copy
import json
import os
import re
import sys

MASK = "[redacted]"

# A key is a credential when its lower-cased name contains one of these.
_CONTAINS = (
    "auth", "token", "secret", "password", "passwd", "passphrase", "pwd",
    "cookie", "apikey", "api_key", "api-key", "accesskey", "access_key",
    "access-key", "credential", "session", "bearer", "signature", "private",
    "jwt",
)
# Or when it is exactly one of these.
_EXACT = ("key", "sig", "pass", "otp", "pin")
# "auth" also sits inside these ordinary names.
_NOT_SECRET = ("author", "authors", "author_name", "authorname", "author_id", "authorid")
# In a {"name": ..., "value": ...} pair the value belongs to the name.
_PAIR_NAME = ("name", "header", "field")
_PAIR_VALUE = ("value", "val", "values")

_known = set()


def add_known(values):
    """Register exact values to mask everywhere (the caller's own secrets).
    Values under 4 characters are ignored: masking them would shred the text."""
    for v in values or ():
        if isinstance(v, str) and len(v.strip()) >= 4:
            _known.add(v.strip())


def clear_known():
    _known.clear()

DEFAULT_FIELDS = ("id", "account", "platform", "state", "when", "text",
                  "media", "title", "release_url")


def is_secret_key(name):
    """True when a dict key names a credential."""
    if not isinstance(name, str):
        return False
    k = name.strip().lower()
    if k in _EXACT:
        return True
    if k in _NOT_SECRET:
        return False
    return any(part in k for part in _CONTAINS)


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
    if isinstance(obj, list):
        return [redact(x) for x in obj]
    if isinstance(obj, tuple):
        return [redact(x) for x in obj]
    if isinstance(obj, str):
        return redact_text(obj)
    return copy.deepcopy(obj)


_NAMES = (r"(?:[A-Za-z0-9_\-]*(?:authorization|token|secret|password|passwd|passphrase|pwd|cookie|"
          r"api[_\-]?key|access[_\-]?key|credential|session|signature|private|jwt)[A-Za-z0-9_\-]*"
          r"|(?<![A-Za-z0-9_\-])(?:[A-Za-z0-9]+[_\-])?auth(?![A-Za-z0-9])"
          r"|(?<![A-Za-z0-9_\-])(?:key|sig|pass|otp|pin|bearer)(?![A-Za-z0-9_\-]))")

_TEXT_RULES = [
    # Cookie and Authorization headers: the whole value to the end of the line,
    # every cookie pair and any scheme (Basic, Bearer, a raw key).
    (re.compile(r"(?i)\b((?:set-)?cookie\s*:\s*)(?![\"'\s])[^\r\n]+"), r"\1" + MASK),
    (re.compile(r"(?i)\b(authorization\s*[:=]\s*)(?![\"'\s])[^\r\n\"']+"), r"\1" + MASK),
    # Bearer <token>
    (re.compile(r"(?i)\b(bearer)\s+[A-Za-z0-9._~+/=\-]{4,}"), r"\1 " + MASK),
    # JWT-like: three base64url parts joined by dots.
    (re.compile(r"\b[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\b"), MASK),
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
    (re.compile(r"(?<![A-Za-z0-9+/_\-])(?=[A-Za-z0-9+/_\-]*[0-9])(?=[A-Za-z0-9+/_\-]*[A-Za-z])"
                r"[A-Za-z0-9+/_\-]{48,}={0,2}(?![A-Za-z0-9+/_\-])"), MASK),
]


def redact_text(s):
    """Mask credential shapes inside free text."""
    if not isinstance(s, str):
        s = str(s)
    for v in sorted(_known, key=len, reverse=True):
        s = s.replace(v, MASK)
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
    return {f: scalar(view[f]) for f in fields if f in view}


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
