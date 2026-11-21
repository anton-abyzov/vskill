import os, sys; sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))  # noqa: E401,E702

import copy
import datetime as dt
import json
import random
import subprocess
import tempfile
import unittest
from zoneinfo import ZoneInfo

import plan_schedule as ps

TZ = "America/New_York"
Z = ZoneInfo(TZ)
UTC = dt.timezone.utc


def wjson(path, obj):
    with open(path, "w") as f:
        json.dump(obj, f)


def rtext(path):
    with open(path) as f:
        return f.read()


def utc(s):
    return dt.datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=UTC)


def to_utc_any(s):
    t = s.replace("Z", "+00:00")
    d = dt.datetime.fromisoformat(t)
    if d.tzinfo is None:
        d = d.replace(tzinfo=Z)
    return d.astimezone(UTC)


def base_accounts():
    return [
        {"key": "yt-main", "platform": "youtube", "backend": "postiz", "wave": "lead",
         "offset_minutes": 0, "min_gap_hours": 6, "ref": "REF_YT"},
        {"key": "tiktok-main", "platform": "tiktok", "backend": "blotato", "wave": "lead",
         "offset_minutes": 30, "min_gap_hours": 6, "max_per_day": 2, "ref": "REF_TT"},
        {"key": "x-main", "platform": "x", "backend": "blotato", "wave": "follow",
         "min_gap_hours": 4, "exclude_tags": ["game"]},
        {"key": "yt-es", "platform": "youtube", "backend": "postiz", "wave": "follow",
         "offset_minutes": 30, "lang": "es", "require_tags": ["product"], "max_per_day": 1},
    ]


CAPS = [{"name": "short-video plan", "accounts": ["yt-main", "tiktok-main"], "max": 3,
         "window_hours": 24}]


def gen_clips(n, seed, dense=False):
    rnd = random.Random(seed)
    clips = []
    day = dt.datetime(2026, 12, 1, 9, 0)
    for i in range(n):
        lead = day + dt.timedelta(hours=(1 if dense else rnd.choice([3, 6, 8, 20])) * i)
        tags = rnd.sample(["product", "game", "tech"], rnd.randint(0, 2))
        clips.append({"id": "a%02d-demo" % (i + 1), "tags": tags,
                      "lead": lead.strftime("%Y-%m-%d %H:%M")})
    return clips


def gen_busy(seed):
    rnd = random.Random(seed)
    rows = []
    for i in range(4):
        t = dt.datetime(2026, 12, 1, 8, 0) + dt.timedelta(hours=rnd.randint(0, 72))
        if rnd.random() < 0.5:
            rows.append({"account": "yt-main", "when": t.strftime("%Y-%m-%d %H:%M")})
        else:
            rows.append({"account": "REF_TT",
                         "when": t.replace(tzinfo=Z).astimezone(UTC).strftime("%Y-%m-%dT%H:%M:00Z")})
    return rows


# ----- independent property checkers (brute force, no planner helpers) -----

def all_times(result, accounts):
    """account key -> list of (utc datetime, planned?)"""
    refs = {a.get("ref"): a["key"] for a in accounts if a.get("ref")}
    keys = {a["key"] for a in accounts}
    out = {a["key"]: [] for a in accounts}
    for b in result["busy"]:
        k = b["account"] if b["account"] in keys else refs.get(b["account"])
        if k:
            out[k].append((to_utc_any(b["when"]), False))
    for p in result["posts"]:
        out[p["account"]].append((utc(p["when_utc"]), True))
    return out


class Props:
    def check_all(self, result, accounts, caps, earliest="07:00", latest="22:00"):
        times = all_times(result, accounts)
        accs = {a["key"]: a for a in accounts}
        # spacing, including busy
        for k, ts in times.items():
            gap = dt.timedelta(hours=accs[k].get("min_gap_hours", 6))
            for i in range(len(ts)):
                for j in range(i + 1, len(ts)):
                    if ts[i][1] or ts[j][1]:
                        self.assertGreaterEqual(abs(ts[i][0] - ts[j][0]), gap, (k, ts[i], ts[j]))
        # quiet hours (local) and both time fields agree
        e = int(earliest[:2]) * 60 + int(earliest[3:])
        la = int(latest[:2]) * 60 + int(latest[3:])
        for p in result["posts"]:
            loc = dt.datetime.fromisoformat(p["when_local"])
            self.assertEqual(loc.astimezone(UTC), utc(p["when_utc"]))
            self.assertEqual(loc.utcoffset(), loc.astimezone(Z).utcoffset())
            m = loc.hour * 60 + loc.minute
            self.assertTrue(e <= m <= la, p)
        # max per day (local calendar day), busy included
        for k, ts in times.items():
            mpd = accs[k].get("max_per_day")
            if mpd is None:
                continue
            days = {}
            for t, planned in ts:
                days.setdefault(t.astimezone(Z).date(), []).append(planned)
            for d, flags in days.items():
                if any(flags):
                    self.assertLessEqual(len(flags), mpd, (k, d))
        # rolling caps: every post as a window start
        for c in caps:
            w = dt.timedelta(hours=c["window_hours"])
            ts = sorted(t for k in c["accounts"] for t in times[k])
            for s, _ in ts:
                inside = [pl for t, pl in ts if s <= t < s + w]
                if any(inside):
                    self.assertLessEqual(len(inside), c["max"], (c["name"], s))
            # windows that end at a planned post also hold
            for e_t, pl in ts:
                if pl:
                    inside = [1 for t, _ in ts if e_t - w < t <= e_t]
                    self.assertLessEqual(len(inside), c["max"])
        # tag routing
        clips = {p["clip"] for p in result["posts"]}
        self.assertTrue(clips is not None)

    def check_routing(self, result, clips, accounts):
        tags = {c["id"]: set(c.get("tags") or []) for c in clips}
        accs = {a["key"]: a for a in accounts}
        for p in result["posts"]:
            a = accs[p["account"]]
            t = tags[p["clip"]]
            self.assertTrue(set(a.get("require_tags") or []).issubset(t), p)
            self.assertFalse(set(a.get("exclude_tags") or []) & t, p)


class PlanProperties(unittest.TestCase, Props):
    def run_case(self, n, seed, dense=False, busy=True):
        clips = gen_clips(n, seed, dense)
        accounts = base_accounts()
        b = gen_busy(seed) if busy else []
        b_before = copy.deepcopy(b)
        r = ps.plan(clips, accounts, b, TZ, None, None, caps=CAPS)
        self.check_all(r, accounts, CAPS)
        self.check_routing(r, clips, accounts)
        # busy rows unchanged and present
        self.assertEqual(r["busy"], b_before)
        self.assertEqual(b, b_before)
        return r, clips, accounts, b

    def test_many_inputs(self):
        for seed in range(8):
            with self.subTest(seed=seed):
                self.run_case(10, seed)

    def test_dense_inputs(self):
        for seed in range(4):
            with self.subTest(seed=seed):
                r, clips, accounts, _ = self.run_case(18, 100 + seed, dense=True)
                self.assertTrue(r["posts"])
                self.assertLessEqual(r["cap_report"]["short-video plan"], 3)

    def test_routing_reported_as_skipped(self):
        clips = [{"id": "a01-demo", "tags": ["game"], "lead": "2026-12-01 10:00"}]
        r = ps.plan(clips, base_accounts(), [], TZ, caps=CAPS)
        accs = {p["account"] for p in r["posts"]}
        self.assertEqual(accs, {"yt-main", "tiktok-main"})
        reasons = {s["account"]: s["reason"] for s in r["skipped"]}
        self.assertIn("excludes", reasons["x-main"])
        self.assertIn("requires", reasons["yt-es"])

    def test_follow_offset_is_added_to_the_next_day(self):
        clips = [{"id": "a01-demo", "tags": [], "lead": "2026-12-01 10:00"}]
        accs = [{"key": "x-main", "platform": "x", "wave": "follow", "offset_minutes": 0},
                {"key": "pro-main", "platform": "linkedin", "wave": "follow", "offset_minutes": 90},
                {"key": "yt-main", "platform": "youtube", "wave": "lead", "offset_minutes": 90}]
        w = {p["account"]: p["when_local"][:16] for p in ps.plan(clips, accs, [], TZ)["posts"]}
        self.assertEqual(w, {"x-main": "2026-12-02T10:00", "pro-main": "2026-12-02T11:30",
                             "yt-main": "2026-12-01T11:30"})

    def test_wanted_time_and_follow_default(self):
        clips = [{"id": "a01-demo", "tags": ["product"], "lead": "2026-12-01 10:00"}]
        r = ps.plan(clips, base_accounts(), [], TZ)
        w = {p["account"]: p["when_local"][:16] for p in r["posts"]}
        self.assertEqual(w["yt-main"], "2026-12-01T10:00")
        self.assertEqual(w["tiktok-main"], "2026-12-01T10:30")
        self.assertEqual(w["x-main"], "2026-12-02T10:00")
        self.assertEqual(w["yt-es"], "2026-12-02T10:30")

    def test_busy_never_moved_and_pushes_slot(self):
        clips = [{"id": "a01-demo", "lead": "2026-12-01 10:00"}]
        busy = [{"account": "yt-main", "when": "2026-12-01T16:00:00Z", "note": "keep me"}]
        accs = [base_accounts()[0]]
        r = ps.plan(clips, accs, busy, TZ)
        self.assertEqual(r["busy"], busy)
        # 16:00Z is 11:00 local; 6 h gap pushes 10:00 to 17:00 local
        self.assertEqual(r["posts"][0]["when_local"][:16], "2026-12-01T17:00")
        self.assertEqual(r["posts"][0]["moved_minutes"], 420)

    def test_quiet_hours_custom(self):
        clips = [{"id": "a01-demo", "lead": "2026-12-01 05:00"},
                 {"id": "a02-limit", "lead": "2026-12-01 23:30"}]
        accs = [{"key": "yt-main", "platform": "youtube", "min_gap_hours": 1}]
        r = ps.plan(clips, accs, [], TZ, None, {"earliest": "08:00", "latest": "20:00"})
        self.check_all(r, accs, [], "08:00", "20:00")
        w = sorted(p["when_local"][:16] for p in r["posts"])
        self.assertEqual(w, ["2026-12-01T08:00", "2026-12-02T08:00"])

    def test_max_per_day_zero_skips_without_hanging(self):
        clips = [{"id": "a01-demo", "lead": "2026-12-01 10:00"}]
        accs = [{"key": "yt-main", "platform": "youtube", "max_per_day": 0}]
        r = ps.plan(clips, accs, [], TZ, None, {"horizon_days": 3})
        self.assertEqual(r["posts"], [])
        self.assertIn("no slot", r["skipped"][0]["reason"])

    def test_cap_counts_busy_on_other_account(self):
        busy = [{"account": "tiktok-main", "when": "2026-12-01 08:00"},
                {"account": "tiktok-main", "when": "2026-12-01 14:00"},
                {"account": "tiktok-main", "when": "2026-12-01 20:00"}]
        clips = [{"id": "a01-demo", "lead": "2026-12-01 10:00"}]
        accs = base_accounts()[:2]
        r = ps.plan(clips, accs, busy, TZ, caps=CAPS)
        self.check_all(r, accs, CAPS)
        yt = [p for p in r["posts"] if p["account"] == "yt-main"][0]
        # the window starting 08:00 holds 3 already: the slot lands at 08:00 next day or later
        self.assertGreaterEqual(yt["when_local"][:16], "2026-12-02T08:00")


class Variants(unittest.TestCase, Props):
    def test_variant_held(self):
        clips = [{"id": "a02-limit-b", "variant_of": "a02-limit"},
                 {"id": "a02-limit", "lead": "2026-12-01 10:00"}]
        r = ps.plan(clips, base_accounts(), [], TZ)
        self.assertFalse([p for p in r["posts"] if p["clip"] == "a02-limit-b"])
        self.assertEqual(len(r["held"]), 1)
        h = r["held"][0]
        self.assertEqual(h["reason"], "alternate opening of a02-limit: hold until the 72 hour read")
        self.assertEqual(h["not_before_local"][:16], "2026-12-04T10:00")
        self.assertEqual(h["not_before_utc"], "2026-12-04T15:00:00Z")

    def test_released_variant_only_where_base_did_not_run(self):
        clips = [{"id": "a02-limit", "tags": ["game"], "lead": "2026-12-01 10:00"},
                 {"id": "a02-limit-b", "variant_of": "a02-limit", "release": True}]
        accounts = base_accounts()
        busy = [{"account": "REF_TT", "when": "2026-11-30T15:00:00Z", "clip": "a02-limit"}]
        r = ps.plan(clips, accounts, busy, TZ)
        base_accs = {p["account"] for p in r["posts"] if p["clip"] == "a02-limit"}
        base_accs |= {"tiktok-main"}  # busy row for the base
        var = [p for p in r["posts"] if p["clip"] == "a02-limit-b"]
        self.assertTrue(var)
        for p in var:
            self.assertNotIn(p["account"], base_accs)
            self.assertEqual(p["variant_of"], "a02-limit")
            self.assertGreaterEqual(p["when_local"][:16], "2026-12-04T10:00")
        self.assertEqual(r["held"], [])

    def test_random_variants_property(self):
        for seed in range(5):
            clips = gen_clips(8, 200 + seed)
            rnd = random.Random(seed)
            for c in list(clips):
                if rnd.random() < 0.5:
                    clips.append({"id": c["id"] + "-b", "tags": c["tags"], "variant_of": c["id"],
                                  "release": rnd.random() < 0.5})
            accounts = base_accounts()
            r = ps.plan(clips, accounts, gen_busy(seed), TZ, caps=CAPS)
            self.check_all(r, accounts, CAPS)
            by = {c["id"]: c for c in clips}
            ran = {(p["clip"], p["account"]) for p in r["posts"]}
            for p in r["posts"]:
                c = by[p["clip"]]
                if c.get("variant_of"):
                    self.assertTrue(c.get("release"))
                    self.assertNotIn((c["variant_of"], p["account"]), ran)
            held = {h["clip"] for h in r["held"]}
            self.assertEqual(held, {c["id"] for c in clips if c.get("variant_of") and not c.get("release")})


class DST(unittest.TestCase, Props):
    def test_fall_back_week(self):
        # US clocks go back November 1, 2026 at 02:00
        clips = [{"id": "a%02d-demo" % i, "lead": "2026-10-30 %02d:00" % (9 + i)} for i in range(6)]
        accounts = base_accounts()
        r = ps.plan(clips, accounts, [], TZ, caps=CAPS)
        self.check_all(r, accounts, CAPS)
        offs = {dt.datetime.fromisoformat(p["when_local"]).utcoffset() for p in r["posts"]}
        self.assertEqual(offs, {dt.timedelta(hours=-4), dt.timedelta(hours=-5)})

    def test_follow_wave_keeps_clock_time_across_change(self):
        clips = [{"id": "a01-demo", "lead": "2026-10-31 10:00"}]
        accs = [{"key": "x-main", "platform": "x", "wave": "follow"}]
        r = ps.plan(clips, accs, [], TZ)
        p = r["posts"][0]
        self.assertEqual(p["when_local"], "2026-11-01T10:00:00-05:00")
        self.assertEqual(p["when_utc"], "2026-11-01T15:00:00Z")

    def test_spring_forward_week(self):
        # US clocks go forward March 14, 2027 at 02:00
        clips = [{"id": "a%02d-demo" % i, "lead": "2027-03-13 %02d:00" % (8 + 2 * i)} for i in range(6)]
        accounts = base_accounts()
        busy = [{"account": "yt-main", "when": "2027-03-14 07:00"}]
        r = ps.plan(clips, accounts, busy, TZ, caps=CAPS, options={"earliest": "00:00", "latest": "23:30"})
        self.check_all(r, accounts, CAPS, "00:00", "23:30")

    def test_gap_is_elapsed_time_across_change(self):
        # two posts 6 h apart in elapsed time across the fall-back hour
        busy = [{"account": "yt-main", "when": "2026-11-01 00:30"}]
        clips = [{"id": "a01-demo", "lead": "2026-11-01 00:30"}]
        accs = [{"key": "yt-main", "platform": "youtube"}]
        r = ps.plan(clips, accs, busy, TZ, None, {"earliest": "00:00", "latest": "23:30"})
        p = r["posts"][0]
        # 00:30 EDT = 04:30Z; +6 h = 10:30Z = 05:30 EST
        self.assertEqual(p["when_utc"], "2026-11-01T10:30:00Z")
        self.assertEqual(p["when_local"], "2026-11-01T05:30:00-05:00")


class Determinism(unittest.TestCase):
    def test_same_input_same_output(self):
        clips = gen_clips(12, 7, dense=True)
        clips.append({"id": "a01-demo-b", "variant_of": "a01-demo"})
        a = ps.plan(copy.deepcopy(clips), base_accounts(), gen_busy(7), TZ, caps=CAPS)
        b = ps.plan(copy.deepcopy(clips), base_accounts(), gen_busy(7), TZ, caps=CAPS)
        self.assertEqual(json.dumps(a, sort_keys=True), json.dumps(b, sort_keys=True))

    def test_passthrough_ref_content_meta(self):
        clips = [{"id": "a01-demo", "lead": "2026-12-01 10:00",
                  "content": {"default": {"text": "hello"}, "es": {"text": "hola"}},
                  "meta": {"hook": "outcome first", "length_s": 21}}]
        accs = [dict(base_accounts()[0], settings={"__type": "youtube"}),
                {"key": "yt-es", "platform": "youtube", "lang": "es", "offset_minutes": 0}]
        r = ps.plan(clips, accs, [], TZ)
        by = {p["account"]: p for p in r["posts"]}
        self.assertEqual(by["yt-main"]["ref"], "REF_YT")
        self.assertEqual(by["yt-main"]["content"], {"text": "hello"})
        self.assertEqual(by["yt-es"]["content"], {"text": "hola"})
        self.assertEqual(by["yt-main"]["settings"], {"__type": "youtube"})
        self.assertEqual(by["yt-main"]["meta"]["length_s"], 21)


class CLI(unittest.TestCase):
    def test_cli_writes_plan_calendar_report(self):
        d = tempfile.mkdtemp()
        p = lambda n: os.path.join(d, n)  # noqa: E731
        wjson(p("clips.json"), gen_clips(5, 3))
        wjson(p("accounts.json"), {"accounts": base_accounts(), "caps": CAPS})
        wjson(p("busy.json"), gen_busy(3))
        script = os.path.join(os.path.dirname(__file__), "..", "plan_schedule.py")
        out = subprocess.run([sys.executable, script, p("clips.json"), p("accounts.json"),
                              "--busy", p("busy.json"), "--tz", TZ, "--out", p("plan.json"),
                              "--calendar", p("cal.csv"), "--report", p("s.md")],
                             capture_output=True, text=True)
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertIn("cap short-video plan: max", out.stdout)
        self.assertIn("yt-main", out.stdout)
        plan = json.loads(rtext(p("plan.json")))
        self.assertTrue(plan["posts"])
        self.assertEqual(plan["caps"][0]["refs"], ["REF_YT", "REF_TT"])
        self.assertTrue(rtext(p("cal.csv")).startswith("when_local"))
        self.assertIn("# Schedule plan", rtext(p("s.md")))

    def test_cli_bad_zone_fails(self):
        d = tempfile.mkdtemp()
        wjson(os.path.join(d, "c.json"), [])
        wjson(os.path.join(d, "a.json"), [])
        script = os.path.join(os.path.dirname(__file__), "..", "plan_schedule.py")
        out = subprocess.run([sys.executable, script, os.path.join(d, "c.json"),
                              os.path.join(d, "a.json"), "--tz", "Nowhere/City",
                              "--out", os.path.join(d, "p.json")], capture_output=True, text=True)
        self.assertNotEqual(out.returncode, 0)
        self.assertIn("unknown time zone", out.stderr)


class Round3(unittest.TestCase, Props):
    """Third review round: the repeated autumn hour, the hold of a variant
    whose base has no lead, posting hours to the second, cap input."""

    ALLDAY = {"earliest": "00:00", "latest": "23:59"}

    def one(self, lead, offset=0, wave="lead", start="2026-10-31 09:00"):
        clips = [{"id": "a01-demo", "lead": lead}]
        accs = [{"key": "yt-main", "platform": "youtube", "wave": wave, "offset_minutes": offset}]
        return ps.plan(clips, accs, [], TZ, start, self.ALLDAY)["posts"][0]

    def test_lead_in_the_second_pass_of_the_repeated_hour_is_kept(self):
        # 2026-11-01 06:30Z is 01:30 for the second time that night in New York.
        p = self.one("2026-11-01T06:30:00Z")
        self.assertEqual(p["when_utc"], "2026-11-01T06:30:00Z")
        self.assertEqual(p["moved_minutes"], 0)

    def test_offset_from_the_second_pass_never_lands_before_the_lead(self):
        self.assertEqual(self.one("2026-11-01T06:30:00Z", offset=10)["when_utc"], "2026-11-01T06:40:00Z")
        self.assertEqual(self.one("2026-11-01T06:30:00Z", offset=45)["when_utc"], "2026-11-01T07:15:00Z")

    def test_offset_from_the_first_pass_stays_in_the_first_pass(self):
        self.assertEqual(self.one("2026-11-01T05:30:00Z", offset=10)["when_utc"], "2026-11-01T05:40:00Z")

    def test_follow_wave_from_the_second_pass_is_the_same_clock_time_next_day(self):
        self.assertEqual(self.one("2026-11-01T06:30:00Z", wave="follow")["when_local"][:16], "2026-11-02T01:30")

    def test_no_planned_post_is_ever_before_its_clip_lead(self):
        for lead in ("2026-11-01T05:30:00Z", "2026-11-01T06:00:00Z", "2026-11-01T06:59:00Z", "2026-03-08T07:30:00Z"):
            for off in (0, 1, 29, 60, 61, 1440):
                p = self.one(lead, offset=off, start="2026-03-01 09:00")
                self.assertGreaterEqual(utc(p["when_utc"]), utc(lead), (lead, off))

    def test_hold_counts_from_the_start_when_the_base_has_no_lead(self):
        clips = [{"id": "a02-limit"}, {"id": "a02-limit-b", "variant_of": "a02-limit"}]
        accs = [{"key": "yt-main", "platform": "youtube"}]
        r = ps.plan(clips, accs, [], TZ, "2026-12-01 10:00")
        self.assertEqual(r["posts"][0]["when_utc"], "2026-12-01T15:00:00Z")
        self.assertEqual(r["held"][0]["not_before_utc"], "2026-12-04T15:00:00Z")
        self.assertEqual(r["held"][0]["not_before_local"][:16], "2026-12-04T10:00")

    def test_released_variant_of_a_base_without_a_lead_waits_72_hours(self):
        clips = [{"id": "a02-limit", "tags": ["game"]},
                 {"id": "a02-limit-b", "variant_of": "a02-limit", "release": True}]
        accs = [{"key": "yt-main", "platform": "youtube", "exclude_tags": []},
                {"key": "x-main", "platform": "x", "exclude_tags": ["game"]}]
        r = ps.plan(clips, accs, [], TZ, "2026-12-01 10:00")
        v = [p for p in r["posts"] if p["clip"] == "a02-limit-b"]
        self.assertEqual([p["account"] for p in v], ["x-main"])
        self.assertEqual(v[0]["when_utc"], "2026-12-04T15:00:00Z")

    def test_released_variant_cannot_set_a_lead_inside_the_hold(self):
        clips = [{"id": "a02-limit", "tags": ["game"], "lead": "2026-12-01 10:00"},
                 {"id": "a02-limit-b", "variant_of": "a02-limit", "release": True, "lead": "2026-12-02 12:00"}]
        accs = [{"key": "yt-main", "platform": "youtube"},
                {"key": "x-main", "platform": "x", "exclude_tags": ["game"]}]
        r = ps.plan(clips, accs, [], TZ)
        v = [p for p in r["posts"] if p["clip"] == "a02-limit-b"][0]
        self.assertGreaterEqual(utc(v["when_utc"]), utc("2026-12-04T15:00:00Z"))
        clips[1]["lead"] = "2026-12-06 12:00"                # a later lead of its own is kept
        v = [p for p in ps.plan(clips, accs, [], TZ)["posts"] if p["clip"] == "a02-limit-b"][0]
        self.assertEqual(v["when_local"][:16], "2026-12-06T12:00")

    def test_hold_counts_from_the_first_post_already_in_the_queue(self):
        clips = [{"id": "a02-limit", "lead": "2026-12-01 10:00"},
                 {"id": "a02-limit-b", "variant_of": "a02-limit"}]
        accs = [{"key": "yt-main", "platform": "youtube"}]
        busy = [{"account": "yt-main", "when": "2026-12-02T15:00:00Z", "clip": "a02-limit"}]
        r = ps.plan(clips, accs, busy, TZ)
        self.assertEqual(r["posts"], [])
        self.assertEqual(r["held"][0]["not_before_utc"], "2026-12-05T15:00:00Z")

    def test_posting_hours_count_seconds(self):
        day = lambda h, m, s: dt.datetime(2026, 12, 1, h, m, s, tzinfo=Z)      # noqa: E731
        self.assertTrue(ps.in_posting_hours(day(22, 0, 0), Z, 7 * 60, 22 * 60))
        self.assertFalse(ps.in_posting_hours(day(22, 0, 30), Z, 7 * 60, 22 * 60))
        self.assertTrue(ps.in_posting_hours(day(7, 0, 0), Z, 7 * 60, 22 * 60))
        self.assertFalse(ps.in_posting_hours(day(6, 59, 59), Z, 7 * 60, 22 * 60))

    def test_cap_without_a_window_is_refused(self):
        clips = [{"id": "a01-demo", "lead": "2026-12-01 10:00"}]
        accs = [{"key": "yt-main", "platform": "youtube"}]
        for cap in ({"window_hours": 0, "max": 3}, {"window_hours": -1, "max": 3}, {"window_hours": 24, "max": -1},
                    {"window_hours": 24}, {"max": 3}, {"window_hours": "x", "max": 3}):
            with self.assertRaises(ps.PlanError, msg=cap):
                ps.plan(clips, accs, [], TZ, caps=[dict({"name": "c", "accounts": ["yt-main"]}, **cap)])
        t = utc("2026-12-01T15:00:00Z")
        self.assertFalse(ps.window_ok([], t, dt.timedelta(0), 0))
        self.assertFalse(ps.window_ok([], t, dt.timedelta(0), 5))


class Round4(unittest.TestCase):
    def test_cap_numbers_must_be_real_numbers(self):
        clips = [{"id": "a01-demo", "lead": "2026-12-01 10:00"}]
        accs = [{"key": "yt-main", "platform": "youtube"}]
        for cap in ({"window_hours": float("inf"), "max": 3}, {"window_hours": float("nan"), "max": 3},
                    {"window_hours": 1e300, "max": 3}, {"window_hours": True, "max": 3},
                    {"window_hours": 24, "max": 2.5}, {"window_hours": 24, "max": True},
                    {"window_hours": "24", "max": 3}, {"window_hours": 24, "max": "3"}):
            with self.assertRaises(ps.PlanError, msg=cap):
                ps.plan(clips, accs, [], TZ, caps=[dict({"name": "c", "accounts": ["yt-main"]}, **cap)])
        for cap in ({"window_hours": 24, "max": 3}, {"window_hours": 0.5, "max": 0}, {"window_hours": 168, "max": 1}):
            ps.plan(clips, accs, [], TZ, caps=[dict({"name": "c", "accounts": ["yt-main"]}, **cap)])


if __name__ == "__main__":
    unittest.main()
