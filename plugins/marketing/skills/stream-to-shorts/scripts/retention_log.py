#!/usr/bin/env python3
"""Retention log for published shorts, and the decisions read from it.

Usage:
  retention_log.py init <plan.json> <log.csv>
      One row per planned post. Existing rows (same clip id and account) are
      kept as they are; only new rows are added.
  retention_log.py decide <log.csv> --baseline-views N [--account KEY]
      [--min-plays 300] [--min-diff 8] [--plan plan.json]
      One decision per clip, a diagnosis from the steepest drop, the release
      call for held alternate openings (needs --plan, which links a variant to
      its base), A/B calls, and the format review.

A baseline belongs to one account: run decide once per account with
--account and that account's baseline. Without --account every row is read
against the one number.

Rules (views against the channel's baseline views per short):
  breakout   views >= 10 x baseline and viewed vs swiped >= 70
  winner     views >= 3 x baseline and viewed vs swiped >= 70
             (a blank viewed vs swiped counts only on platforms without it,
             that is anything but YouTube)
  loser      viewed vs swiped < 60, or views < 0.75 x baseline
  keep       anything else
  A loser test runs first on viewed vs swiped, so 10 x views at 55 is a loser.
  Diagnosis: steepest drop at or before 5 s: the open failed. At 27 s or later
  ("about 30 s"), or later than 60% of the length: the payoff is too late.
"""
import argparse
import csv
import json
import os
import statistics
import sys

COLUMNS = [
    "clip id", "platform", "account", "post time", "hook type", "title wording",
    "length s", "first-word time s", "silence ratio", "views",
    "viewed vs swiped (YouTube)", "average percentage viewed",
    "second of the steepest drop", "3 s skip rate (Instagram)",
    "completion (TikTok)", "likes", "comments", "shares or sends",
    "copyright claim (yes or no, window time)", "series", "post id", "live URL",
    "verified live (yes or no)", "read at 24 h", "read at 72 h", "status",
]

RANK = {"breakout": 4, "winner": 3, "keep": 2, "loser": 1, "no read yet": 0}
OPEN_FAILED = "open failed: change only the first 2 s"
PAYOFF_LATE = "payoff too late: move it earlier"
FORMAT_STOP = "stop cutting new clips, rework the opens first"


# ---------- parsing ----------

def num(v):
    """'1,234' -> 1234.0, '72%' -> 72.0, '' -> None."""
    if v is None:
        return None
    s = str(v).strip().replace(",", "").rstrip("%").strip()
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def is_youtube(row):
    return "youtube" in (row.get("platform") or "").lower()


# ---------- init ----------

def row_from_post(p):
    meta = p.get("meta") or {}
    content = p.get("content") or {}
    r = {c: "" for c in COLUMNS}
    r.update({
        "clip id": p.get("clip", ""), "platform": p.get("platform", ""),
        "account": p.get("account", ""), "post time": p.get("when_local", ""),
        "hook type": meta.get("hook", ""),
        "title wording": meta.get("title") or content.get("title") or "",
        "length s": meta.get("length_s", ""), "first-word time s": meta.get("first_word_s", ""),
        "silence ratio": meta.get("silence_ratio", ""), "series": meta.get("series", ""),
        "post id": p.get("post_id", ""), "status": "planned",
    })
    return {k: "" if v is None else v for k, v in r.items()}


def merge(existing, new_rows):
    """Keep every existing row untouched; add rows whose (clip id, account) is new."""
    seen = {(r.get("clip id"), r.get("account")) for r in existing}
    out = list(existing)
    added = 0
    for r in new_rows:
        k = (r["clip id"], r["account"])
        if k in seen:
            continue
        seen.add(k)
        out.append(r)
        added += 1
    return out, added


def read_log(path):
    if not os.path.exists(path):
        return [], list(COLUMNS)
    with open(path, newline="", encoding="utf-8") as f:
        rd = csv.DictReader(f)
        rows = list(rd)
        cols = list(rd.fieldnames or [])
    for c in COLUMNS:
        if c not in cols:
            cols.append(c)
    return rows, cols


def write_log(path, rows, cols):
    tmp = path + ".tmp"
    with open(tmp, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow({c: r.get(c, "") for c in cols})
    os.replace(tmp, path)


# ---------- decide: pure rules ----------

def verdict(row, baseline):
    views = num(row.get("views"))
    if views is None:
        return "no read yet"
    vvs = num(row.get("viewed vs swiped (YouTube)"))
    if vvs is not None and vvs < 60:
        return "loser"
    vvs_ok = vvs >= 70 if vvs is not None else not is_youtube(row)
    if views >= 10 * baseline and vvs_ok:
        return "breakout"
    if views >= 3 * baseline and vvs_ok:
        return "winner"
    if views < 0.75 * baseline:
        return "loser"
    return "keep"


def diagnose(row):
    drop = num(row.get("second of the steepest drop"))
    if drop is None:
        return None
    length = num(row.get("length s"))
    if drop <= 5:
        return OPEN_FAILED
    if drop >= 27 or (length and drop > 0.6 * length):
        return PAYOFF_LATE
    return None


def clip_verdict(rows, baseline):
    vs = [verdict(r, baseline) for r in rows]
    return max(vs, key=lambda v: RANK[v]) if vs else "no read yet"


NOT_READ = ("", "no", "n", "false", "0", "pending", "todo", "tbd", "not yet", "-", "none", "n/a")


def read_done(value):
    """True when a "read at 24 h" or "read at 72 h" cell says the read was
    taken: a date or "yes". An empty cell, "no", "pending" and the like do not."""
    return str(value or "").strip().lower() not in NOT_READ


def release_call(variant, base, base_rows, base_verdict, accounts, read_rows=None):
    """Release a held alternate opening only after the base's 72 hour read,
    and only when the base is a loser or keep; then only where the base has not run.
    base_rows say where the base ran. read_rows are the rows the verdict was
    read from (one account's, when the caller filtered); the 72 hour read
    must be on those."""
    read_rows = base_rows if read_rows is None else read_rows
    if not any(read_done(r.get("read at 72 h")) for r in read_rows):
        return "hold %s: %s has no 72 hour read yet" % (variant, base)
    if base_verdict not in ("loser", "keep"):
        return "hold %s: %s is a %s, keep the first version" % (variant, base, base_verdict)
    ran = {r.get("account") for r in base_rows}
    where = [a for a in accounts if a not in ran]
    if not where:
        return "hold %s: %s already ran on every account" % (variant, base)
    return "release %s on %s (%s is %s after its 72 hour read)" % (
        variant, ", ".join(where), base, base_verdict)


def ab_call(a_row, b_row, min_plays=300, min_diff=8):
    """A/B on 3 s skip rate. A winner only with enough plays on both and a
    big enough gap; otherwise keep A."""
    pa, pb = num(a_row.get("views")), num(b_row.get("views"))
    sa, sb = num(a_row.get("3 s skip rate (Instagram)")), num(b_row.get("3 s skip rate (Instagram)"))
    if pa is None or pb is None or pa < min_plays or pb < min_plays:
        return "no difference: keep A (fewer than %d plays on one side)" % min_plays
    if sa is None or sb is None:
        return "no difference: keep A (3 s skip rate missing)"
    if abs(sa - sb) < min_diff:
        return "no difference: keep A"
    w = a_row if sa < sb else b_row
    return "winner: %s (3 s skip rate %g vs %g)" % (w.get("clip id"), min(sa, sb), max(sa, sb))


def format_review(rows):
    yt = [r for r in rows if is_youtube(r) and num(r.get("views")) is not None]
    vals = [num(r.get("viewed vs swiped (YouTube)")) for r in yt]
    vals = [v for v in vals if v is not None]
    if len(vals) < 10:              # ten reads that carry the number, not ten rows
        return None
    med = statistics.median(vals)
    if med < 60:
        return "format review: median viewed vs swiped %g over %d YouTube reads: %s" % (med, len(vals), FORMAT_STOP)
    return "format review: median viewed vs swiped %g over %d YouTube reads: no change" % (med, len(vals))


def decide(rows, baseline, plan=None, min_plays=300, min_diff=8, account=None):
    """Return the decision lines for a log. With account, verdicts are read
    from that account's rows only; where a clip already ran still comes from
    every row."""
    all_by_clip = {}
    for r in rows:
        all_by_clip.setdefault(r.get("clip id"), []).append(r)
    if account:
        rows = [r for r in rows if r.get("account") == account]
    by_clip = {}
    for r in rows:
        by_clip.setdefault(r.get("clip id"), []).append(r)
    verdicts = {c: clip_verdict(rs, baseline) for c, rs in by_clip.items()}
    lines = []
    for c in by_clip:
        rs = by_clip[c]
        detail = ", ".join("%s %s" % (r.get("account"), verdict(r, baseline)) for r in rs)
        lines.append("%s: %s (%s)" % (c, verdicts[c], detail))
        for r in rs:
            d = diagnose(r)
            if d:
                lines.append("  %s on %s: %s" % (c, r.get("account"), d))
    if plan:
        accounts = []
        for p in plan.get("posts", []) + plan.get("skipped", []):
            if p.get("account") and p["account"] not in accounts:
                accounts.append(p["account"])
        pairs = [(h["clip"], h["base"]) for h in plan.get("held", [])]
        for v, b in pairs:
            lines.append(release_call(v, b, all_by_clip.get(b, []), verdicts.get(b, "no read yet"), accounts,
                                      read_rows=by_clip.get(b, [])))
        released = sorted({(p["clip"], p["variant_of"]) for p in plan.get("posts", []) if p.get("variant_of")})
        for v, b in pairs + released:
            for rb in by_clip.get(b, []):
                for rv in by_clip.get(v, []):
                    if rv.get("platform") == rb.get("platform") and num(rv.get("views")) is not None \
                            and num(rb.get("views")) is not None:
                        lines.append("A/B %s vs %s on %s: %s" % (
                            b, v, rb.get("platform"), ab_call(rb, rv, min_plays, min_diff)))
    else:
        lines.append("variant calls (release, A/B) need --plan: it links each alternate opening to its base")
    fr = format_review(rows)
    if fr:
        lines.append(fr)
    return lines


# ---------- CLI ----------

def main(argv=None):
    ap = argparse.ArgumentParser(description="Retention log: init from a plan, decide from reads.")
    sub = ap.add_subparsers(dest="cmd")
    s = sub.add_parser("init")
    s.add_argument("plan")
    s.add_argument("log")
    s = sub.add_parser("decide")
    s.add_argument("log")
    s.add_argument("--baseline-views", type=float, required=True)
    s.add_argument("--min-plays", type=int, default=300)
    s.add_argument("--min-diff", type=float, default=8)
    s.add_argument("--plan")
    s.add_argument("--account", help="read only this account's rows")
    a = ap.parse_args(argv)
    if not a.cmd:
        print("retention_log: a command is required (init or decide)", file=sys.stderr)
        return 2
    try:
        if a.cmd == "init":
            with open(a.plan, encoding="utf-8") as f:
                plan = json.load(f)
            rows, cols = read_log(a.log)
            merged, added = merge(rows, [row_from_post(p) for p in plan.get("posts", [])])
            write_log(a.log, merged, cols)
            print("%d rows added, %d kept" % (added, len(rows)))
            return 0
        if a.baseline_views <= 0:
            print("retention_log: --baseline-views must be above 0", file=sys.stderr)
            return 1
        if not os.path.exists(a.log):
            print("retention_log: no such log: %s" % a.log, file=sys.stderr)
            return 1
        rows, _ = read_log(a.log)
        if a.account and not any(r.get("account") == a.account for r in rows):
            print("retention_log: no rows for account %s" % a.account, file=sys.stderr)
            return 1
        plan = None
        if a.plan:
            with open(a.plan, encoding="utf-8") as f:
                plan = json.load(f)
        for line in decide(rows, a.baseline_views, plan, a.min_plays, a.min_diff, a.account):
            print(line)
        return 0
    except (OSError, ValueError, KeyError) as e:
        print("retention_log: %s" % e, file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
