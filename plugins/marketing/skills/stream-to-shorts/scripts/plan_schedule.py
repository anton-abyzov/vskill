#!/usr/bin/env python3
"""Plan post slots for many clips across many accounts. Never calls an API.

Usage:
  plan_schedule.py clips.json accounts.json --tz America/New_York --out plan.json
      [--busy busy.json] [--start "YYYY-MM-DD HH:MM"] [--earliest 07:00]
      [--latest 22:00] [--step 30] [--horizon-days 30]
      [--calendar calendar.csv] [--report schedule.md]

clips.json: an ordered list (or {"clips": [...]}) of
  {"id": "a01-demo", "tags": ["product"], "lead": "2026-12-01 10:00",
   "variant_of": "a01-demo" (optional), "release": false (optional),
   "content": {...} (optional, copied to each post: text, media, title, settings,
               or one such object per language code under "default", "es", ...),
   "meta": {...} (optional, copied to each post: hook, title, length_s, ...)}

accounts.json: a list of accounts, or {"accounts": [...], "caps": [...]}
  account: {"key": "yt-main", "platform": "youtube", "backend": "postiz",
            "lang": "en", "wave": "lead"|"follow", "offset_minutes": 0,
            "min_gap_hours": 6, "max_per_day": 3, "require_tags": [...],
            "exclude_tags": [...], "ref": "<scheduler account id, copied as is>",
            "settings": {...} (copied to each post)}
  cap: {"name": "short-video plan", "accounts": ["yt-main", "tiktok-main"],
        "max": 3, "window_hours": 24}   a rolling window, not a calendar day

busy.json: a list (or {"busy": [...]}) of existing posts and receipts:
  {"account": "<key or ref>", "when": "2026-12-01T15:00:00Z" or local
   "2026-12-01 10:00", "clip": "a01-demo" (optional)}
  Busy rows count for spacing and caps. They are never moved or dropped.

Rules: a slot starts at the clip lead plus the account offset (a follow
account adds 24 h first: the same clock time next day, then its offset) and
moves forward in --step
minute steps until it is min_gap_hours from every post on that account,
inside quiet hours, under max_per_day for that local day and under every
rolling cap. Spacing and windows use elapsed time, so a plan across a
daylight-saving change stays correct. A hook variant (variant_of) is held
until the base clip's 72 hour read; with "release": true it gets slots only on
accounts where the base has no post.
"""
import argparse
import csv
import datetime as dt
import json
import sys

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover
    ZoneInfo = None

UTC = dt.timezone.utc
DEFAULTS = {"earliest": "07:00", "latest": "22:00", "step": 30,
            "horizon_days": 30, "follow_offset_minutes": 24 * 60,
            "min_gap_hours": 6, "hold_hours": 72}


class PlanError(Exception):
    pass


def get_zone(name):
    if ZoneInfo is None:
        raise PlanError("zoneinfo needs Python 3.9 or later")
    try:
        return ZoneInfo(name)
    except Exception:
        raise PlanError("unknown time zone: %s" % name)


def localize(naive, tz):
    """Attach tz to a naive local time; a time inside a spring-forward gap
    moves to the real time it maps to."""
    aware = naive.replace(tzinfo=tz, fold=0)
    return aware.astimezone(UTC).astimezone(tz)


def parse_when(s, tz):
    """Parse 'YYYY-MM-DD HH:MM' (local) or ISO with offset or Z. Returns UTC."""
    if isinstance(s, dt.datetime):
        d = s
    else:
        t = str(s).strip().replace("Z", "+00:00")
        try:
            d = dt.datetime.fromisoformat(t)
        except ValueError:
            raise PlanError("bad time: %s" % s)
    if d.tzinfo is None:
        d = localize(d, tz)
    return d.astimezone(UTC).replace(microsecond=0)


def parse_hhmm(s):
    h, m = str(s).split(":")
    return int(h) * 60 + int(m)


def iso_utc(d):
    return d.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def iso_local(d, tz):
    return d.astimezone(tz).isoformat()


def in_quiet_hours(d, tz, earliest, latest):
    loc = d.astimezone(tz)
    m = loc.hour * 60 + loc.minute
    return earliest <= m <= latest


def window_ok(times, cand, window, cap_max):
    """True when adding cand keeps every rolling window of length `window`
    that contains cand at or under cap_max. Windows are [s, s + window)."""
    allt = sorted([x for x in times if abs(x - cand) < window] + [cand])
    for s in allt:
        if s > cand or s <= cand - window:
            continue
        if sum(1 for x in allt if s <= x < s + window) > cap_max:
            return False
    return True


def max_window_count(times, window):
    """Largest number of times inside any rolling window [s, s + window)."""
    allt = sorted(times)
    best = 0
    for s in allt:
        best = max(best, sum(1 for x in allt if s <= x < s + window))
    return best


def _content_for(clip, lang):
    c = clip.get("content")
    if not isinstance(c, dict):
        return None
    if lang and isinstance(c.get(lang), dict):
        return c[lang]
    if isinstance(c.get("default"), dict):
        return c["default"]
    return c


def _routes(clip, acc):
    tags = set(clip.get("tags") or [])
    req = set(acc.get("require_tags") or [])
    exc = set(acc.get("exclude_tags") or [])
    if req and not req.issubset(tags):
        return "account requires tags: " + ", ".join(sorted(req - tags))
    if exc & tags:
        return "account excludes tags: " + ", ".join(sorted(exc & tags))
    return None


def plan(clips, accounts, busy, tz, start=None, options=None, caps=None):
    """Return {"posts", "held", "skipped", "busy", "caps", "cap_report"}.

    clips, accounts, busy: lists of dicts as described in the module docstring.
    tz: zone name or tzinfo. start: earliest allowed slot (local string, ISO or
    datetime); defaults to the earliest clip lead.
    """
    opt = dict(DEFAULTS)
    opt.update(options or {})
    if isinstance(tz, str):
        tz = get_zone(tz)
    earliest, latest = parse_hhmm(opt["earliest"]), parse_hhmm(opt["latest"])
    step = dt.timedelta(minutes=int(opt["step"]))
    if step <= dt.timedelta(0):
        raise PlanError("step must be positive")
    horizon = dt.timedelta(days=float(opt["horizon_days"]))
    caps = list(caps or [])

    acc_by_key = {}
    for a in accounts:
        if "key" not in a or "platform" not in a:
            raise PlanError("every account needs key and platform")
        if a["key"] in acc_by_key:
            raise PlanError("duplicate account key: %s" % a["key"])
        acc_by_key[a["key"]] = a
    ref_to_key = {str(a["ref"]): a["key"] for a in accounts if a.get("ref") is not None}
    for c in caps:
        for k in c.get("accounts", []):
            if k not in acc_by_key:
                raise PlanError("cap %s names unknown account %s" % (c.get("name"), k))

    clip_by_id = {}
    for c in clips:
        if "id" not in c:
            raise PlanError("every clip needs an id")
        if c["id"] in clip_by_id:
            raise PlanError("duplicate clip id: %s" % c["id"])
        clip_by_id[c["id"]] = c

    leads = {c["id"]: parse_when(c["lead"], tz) for c in clips if c.get("lead")}
    if start is not None:
        start_utc = parse_when(start, tz)
    elif leads:
        start_utc = min(leads.values())
    else:
        raise PlanError("no clip has a lead time: pass --start")

    # Occupied times per account key: busy rows plus planned posts.
    occupied = {k: [] for k in acc_by_key}
    ran = set()  # (clip, account) pairs that already exist or are planned
    busy_out = []
    for b in busy:
        busy_out.append(b)
        key = b.get("account")
        key = key if key in acc_by_key else ref_to_key.get(str(key))
        if key is None:
            continue  # a post on an account outside this plan
        occupied[key].append(parse_when(b["when"], tz))
        if b.get("clip"):
            ran.add((b["clip"], key))

    posts, held, skipped = [], [], []

    def find_slot(acc, want):
        gap = dt.timedelta(hours=float(acc.get("min_gap_hours", opt["min_gap_hours"])))
        per_day = acc.get("max_per_day")
        my_caps = [c for c in caps if acc["key"] in c.get("accounts", [])]
        t = max(want, start_utc)
        limit = t + horizon
        while t <= limit:
            ok = in_quiet_hours(t, tz, earliest, latest)
            if ok and any(abs(t - x) < gap for x in occupied[acc["key"]]):
                ok = False
            if ok and per_day is not None:
                day = t.astimezone(tz).date()
                n = sum(1 for x in occupied[acc["key"]] if x.astimezone(tz).date() == day)
                ok = n < int(per_day)
            if ok:
                for c in my_caps:
                    times = [x for k in c["accounts"] for x in occupied[k]]
                    w = dt.timedelta(hours=float(c["window_hours"]))
                    if not window_ok(times, t, w, int(c["max"])):
                        ok = False
                        break
            if ok:
                return t
            t += step
        return None

    def wanted(clip_lead_local_naive, acc):
        off = float(acc.get("offset_minutes") or 0)
        if acc.get("wave") == "follow":
            off += opt["follow_offset_minutes"]
        # Offsets are wall clock: +24 h is the same clock time the next day.
        return localize(clip_lead_local_naive + dt.timedelta(minutes=float(off)), tz).astimezone(UTC)

    def place(clip, lead_utc, variant_base=None):
        lead_naive = lead_utc.astimezone(tz).replace(tzinfo=None)
        for acc in accounts:
            why = _routes(clip, acc)
            if why:
                skipped.append({"clip": clip["id"], "account": acc["key"], "reason": why})
                continue
            if variant_base and (variant_base, acc["key"]) in ran:
                skipped.append({"clip": clip["id"], "account": acc["key"],
                                "reason": "base clip %s already runs on this account" % variant_base})
                continue
            if (clip["id"], acc["key"]) in ran:
                skipped.append({"clip": clip["id"], "account": acc["key"],
                                "reason": "already in the queue or receipts"})
                continue
            want = wanted(lead_naive, acc)
            t = find_slot(acc, want)
            if t is None:
                skipped.append({"clip": clip["id"], "account": acc["key"],
                                "reason": "no slot within %s days" % opt["horizon_days"]})
                continue
            occupied[acc["key"]].append(t)
            ran.add((clip["id"], acc["key"]))
            row = {"clip": clip["id"], "account": acc["key"], "platform": acc["platform"],
                   "backend": acc.get("backend"), "lang": acc.get("lang"),
                   "wave": acc.get("wave", "lead"),
                   "when_local": iso_local(t, tz), "when_utc": iso_utc(t),
                   "wanted_local": iso_local(want, tz),
                   "moved_minutes": int((t - want).total_seconds() // 60)}
            if acc.get("ref") is not None:
                row["ref"] = acc["ref"]
            if variant_base:
                row["variant_of"] = variant_base
            content = _content_for(clip, acc.get("lang"))
            if content is not None:
                row["content"] = content
            if acc.get("settings") is not None:
                row["settings"] = acc["settings"]
            if clip.get("meta") is not None:
                row["meta"] = clip["meta"]
            posts.append(row)

    bases = [c for c in clips if not c.get("variant_of")]
    variants = [c for c in clips if c.get("variant_of")]
    for c in bases:
        lead = leads.get(c["id"], start_utc)
        place(c, lead)
    hold = dt.timedelta(hours=float(opt["hold_hours"]))
    for c in variants:
        base = c["variant_of"]
        if base not in clip_by_id:
            raise PlanError("clip %s is a variant of unknown clip %s" % (c["id"], base))
        base_lead = leads.get(base)
        nb = base_lead + hold if base_lead else None
        if not c.get("release"):
            held.append({"clip": c["id"], "base": base,
                         "reason": "alternate opening of %s: hold until the 72 hour read" % base,
                         "not_before_local": iso_local(nb, tz) if nb else None,
                         "not_before_utc": iso_utc(nb) if nb else None})
            continue
        lead = leads.get(c["id"]) or nb or start_utc
        place(c, lead, variant_base=base)

    posts.sort(key=lambda p: (p["when_utc"], p["account"], p["clip"]))
    caps_out, cap_report = [], {}
    for c in caps:
        w = dt.timedelta(hours=float(c["window_hours"]))
        times = [x for k in c["accounts"] for x in occupied[k]]
        cap_report[c["name"]] = max_window_count(times, w)
        co = dict(c)
        co["refs"] = [acc_by_key[k]["ref"] for k in c["accounts"] if acc_by_key[k].get("ref") is not None]
        caps_out.append(co)
    return {"tz": getattr(tz, "key", str(tz)), "posts": posts, "held": held,
            "skipped": skipped, "busy": busy_out, "caps": caps_out,
            "cap_report": cap_report}


# ---------- CLI ----------

def _load(path, key):
    with open(path, encoding="utf-8") as f:
        d = json.load(f)
    if isinstance(d, dict):
        return d.get(key, [])
    return d


def summary_lines(result):
    lines = []
    by_acc = {}
    for p in result["posts"]:
        by_acc.setdefault(p["account"], []).append(p)
    for k in sorted(by_acc):
        ps = by_acc[k]
        lines.append("%-16s %3d posts  first %s  last %s" % (
            k, len(ps), ps[0]["when_local"][:16], ps[-1]["when_local"][:16]))
    for c in result["caps"]:
        lines.append("cap %s: max %d in any %s h window (limit %s)" % (
            c["name"], result["cap_report"][c["name"]], c["window_hours"], c["max"]))
    lines.append("%d planned, %d held, %d skipped" % (
        len(result["posts"]), len(result["held"]), len(result["skipped"])))
    return lines


def write_calendar(result, path):
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["when_local", "when_utc", "account", "platform", "clip", "wave", "status"])
        for p in result["posts"]:
            w.writerow([p["when_local"], p["when_utc"], p["account"], p["platform"],
                        p["clip"], p["wave"], "planned"])
        for h in result["held"]:
            w.writerow([h["not_before_local"] or "", h["not_before_utc"] or "", "", "",
                        h["clip"], "", "held"])


def write_report(result, path):
    out = ["# Schedule plan", "", "Time zone: %s." % result["tz"], ""]
    out += ["| Local time | Account | Platform | Clip | Wave | Moved (min) |",
            "|---|---|---|---|---|---|"]
    for p in result["posts"]:
        out.append("| %s | %s | %s | `%s` | %s | %d |" % (
            p["when_local"][:16].replace("T", " "), p["account"], p["platform"],
            p["clip"], p["wave"], p["moved_minutes"]))
    if result["held"]:
        out += ["", "## Held", ""]
        for h in result["held"]:
            out.append("- `%s`: %s (not before %s)" % (h["clip"], h["reason"], h["not_before_local"]))
    if result["skipped"]:
        out += ["", "## Skipped", ""]
        for s in result["skipped"]:
            out.append("- `%s` on %s: %s" % (s["clip"], s["account"], s["reason"]))
    out += ["", "## Caps", ""] + ["- " + l for l in summary_lines(result) if l.startswith("cap ")]
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(out) + "\n")


def main(argv=None):
    ap = argparse.ArgumentParser(description="Plan post slots. Never calls an API.")
    ap.add_argument("clips")
    ap.add_argument("accounts")
    ap.add_argument("--busy")
    ap.add_argument("--tz", required=True)
    ap.add_argument("--start")
    ap.add_argument("--earliest", default=DEFAULTS["earliest"])
    ap.add_argument("--latest", default=DEFAULTS["latest"])
    ap.add_argument("--step", type=int, default=DEFAULTS["step"])
    ap.add_argument("--horizon-days", type=float, default=DEFAULTS["horizon_days"])
    ap.add_argument("--out", required=True)
    ap.add_argument("--calendar")
    ap.add_argument("--report")
    a = ap.parse_args(argv)
    try:
        clips = _load(a.clips, "clips")
        accounts = _load(a.accounts, "accounts")
        with open(a.accounts, encoding="utf-8") as f:
            raw = json.load(f)
        caps = raw.get("caps", []) if isinstance(raw, dict) else []
        busy = _load(a.busy, "busy") if a.busy else []
        result = plan(clips, accounts, busy, a.tz, a.start,
                      {"earliest": a.earliest, "latest": a.latest, "step": a.step,
                       "horizon_days": a.horizon_days}, caps=caps)
    except (OSError, ValueError, KeyError, PlanError) as e:
        print("plan_schedule: %s" % e, file=sys.stderr)
        return 1
    try:
        with open(a.out, "w", encoding="utf-8") as f:
            json.dump(result, f, indent=1, ensure_ascii=False)
        if a.calendar:
            write_calendar(result, a.calendar)
        if a.report:
            write_report(result, a.report)
    except OSError as e:
        print("plan_schedule: cannot write output: %s" % e, file=sys.stderr)
        return 1
    for line in summary_lines(result):
        print(line)
    return 0


if __name__ == "__main__":
    sys.exit(main())
