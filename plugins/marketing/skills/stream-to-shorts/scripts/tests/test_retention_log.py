import os, sys; sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))  # noqa: E401,E702

import csv
import io
import json
import shutil
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout

import retention_log as rl

B = 1000  # baseline views


def row(clip="a01-demo", platform="youtube", account="yt-main", **kw):
    names = {"views": "views", "vvs": "viewed vs swiped (YouTube)", "drop": "second of the steepest drop",
             "length": "length s", "skip": "3 s skip rate (Instagram)", "read72": "read at 72 h"}
    r = {c: "" for c in rl.COLUMNS}
    r.update({"clip id": clip, "platform": platform, "account": account})
    for k, v in kw.items():
        r[names[k]] = str(v)
    return r


class Verdict(unittest.TestCase):
    def test_winner(self):
        self.assertEqual(rl.verdict(row(views=3000, vvs=70), B), "winner")

    def test_breakout(self):
        self.assertEqual(rl.verdict(row(views=10000, vvs=75), B), "breakout")

    def test_blank_vvs_on_platform_without_it(self):
        self.assertEqual(rl.verdict(row(platform="tiktok", account="tiktok-main", views=3500), B), "winner")
        self.assertEqual(rl.verdict(row(platform="tiktok", account="tiktok-main", views=12000), B), "breakout")

    def test_blank_vvs_on_youtube_is_not_a_winner(self):
        self.assertEqual(rl.verdict(row(views=3500), B), "keep")

    def test_loser_on_vvs_beats_views(self):
        self.assertEqual(rl.verdict(row(views=10000, vvs=55), B), "loser")
        self.assertEqual(rl.verdict(row(views=3000, vvs=59.9), B), "loser")

    def test_loser_on_views(self):
        self.assertEqual(rl.verdict(row(views=740, vvs=80), B), "loser")
        self.assertEqual(rl.verdict(row(platform="tiktok", views=700), B), "loser")

    def test_keep(self):
        self.assertEqual(rl.verdict(row(views=3000, vvs=65), B), "keep")
        self.assertEqual(rl.verdict(row(views=750, vvs=60), B), "keep")
        self.assertEqual(rl.verdict(row(views=2999, vvs=90), B), "keep")

    def test_no_read(self):
        self.assertEqual(rl.verdict(row(), B), "no read yet")

    def test_number_formats(self):
        self.assertEqual(rl.verdict(row(views="3,100", vvs="71%"), B), "winner")


class Diagnosis(unittest.TestCase):
    def test_open_failed(self):
        self.assertEqual(rl.diagnose(row(drop=1.5, length=30)), rl.OPEN_FAILED)
        self.assertEqual(rl.diagnose(row(drop=5, length=30)), rl.OPEN_FAILED)

    def test_payoff_late_about_30(self):
        self.assertEqual(rl.diagnose(row(drop=29, length=60)), rl.PAYOFF_LATE)
        self.assertEqual(rl.diagnose(row(drop=27, length=60)), rl.PAYOFF_LATE)

    def test_payoff_late_past_60_percent(self):
        self.assertEqual(rl.diagnose(row(drop=13, length=20)), rl.PAYOFF_LATE)

    def test_middle_drop_no_diagnosis(self):
        self.assertIsNone(rl.diagnose(row(drop=10, length=40)))
        self.assertIsNone(rl.diagnose(row(drop=26, length=60)))
        self.assertIsNone(rl.diagnose(row()))


class Variants(unittest.TestCase):
    ACCS = ["yt-main", "tiktok-main", "x-main"]

    def test_hold_without_72h_read(self):
        base = [row(views=500, vvs=50)]
        self.assertTrue(rl.release_call("a01-demo-b", "a01-demo", base, "loser", self.ACCS).startswith("hold"))

    def test_release_after_72h_read_when_loser_or_keep(self):
        base = [row(views=500, vvs=50, read72="yes")]
        out = rl.release_call("a01-demo-b", "a01-demo", base, "loser", self.ACCS)
        self.assertTrue(out.startswith("release a01-demo-b on tiktok-main, x-main"), out)
        out = rl.release_call("a01-demo-b", "a01-demo", base, "keep", self.ACCS)
        self.assertTrue(out.startswith("release"))

    def test_no_release_for_winner(self):
        base = [row(views=5000, vvs=80, read72="yes")]
        self.assertIn("keep the first version",
                      rl.release_call("a01-demo-b", "a01-demo", base, "winner", self.ACCS))

    def test_no_account_left(self):
        base = [row(account=a, read72="yes", views=100) for a in self.ACCS]
        self.assertIn("every account", rl.release_call("v", "a01-demo", base, "loser", self.ACCS))


class PerAccount(unittest.TestCase):
    def test_account_filter_reads_one_account_but_release_sees_all(self):
        rows = [row("a01-demo", "youtube", "yt-main", views=400, vvs=80),
                row("a01-demo", "tiktok", "tiktok-main", views=9000)]
        rows[0]["read at 72 h"] = "yes"
        plan = {"posts": [{"clip": "a01-demo", "account": "yt-main"}, {"clip": "a01-demo", "account": "tiktok-main"},
                          {"clip": "a02-limit", "account": "x-main"}],
                "held": [{"clip": "a01-demo-b", "base": "a01-demo"}]}
        every = rl.decide(rows, B, plan)
        self.assertTrue(every[0].startswith("a01-demo: winner"))          # the TikTok row carries it
        one = rl.decide(rows, B, plan, account="yt-main")
        self.assertTrue(one[0].startswith("a01-demo: loser (yt-main loser)"), one[0])
        release = [x for x in one if x.startswith("release")][0]
        self.assertIn("x-main", release)
        self.assertNotIn("tiktok-main", release)                          # the base ran there


class AB(unittest.TestCase):
    def test_too_few_plays(self):
        a = row(views=299, skip=40)
        b = row(clip="a01-demo-b", views=5000, skip=20)
        self.assertTrue(rl.ab_call(a, b).startswith("no difference: keep A"))

    def test_small_gap(self):
        a = row(views=400, skip=40)
        b = row(clip="a01-demo-b", views=400, skip=32.5)
        self.assertEqual(rl.ab_call(a, b), "no difference: keep A")

    def test_winner(self):
        a = row(views=400, skip=40)
        b = row(clip="a01-demo-b", views=400, skip=32)
        self.assertTrue(rl.ab_call(a, b).startswith("winner: a01-demo-b"))
        self.assertTrue(rl.ab_call(b, a).startswith("winner: a01-demo-b"))

    def test_custom_thresholds(self):
        a = row(views=150, skip=40)
        b = row(clip="a01-demo-b", views=150, skip=36)
        self.assertTrue(rl.ab_call(a, b, min_plays=100, min_diff=4).startswith("winner"))


class FormatReview(unittest.TestCase):
    def test_needs_ten_reads(self):
        rows = [row(clip="a%02d-demo" % i, views=100, vvs=40) for i in range(9)]
        self.assertIsNone(rl.format_review(rows))

    def test_low_median_stops(self):
        rows = [row(clip="a%02d-demo" % i, views=100, vvs=50 + i) for i in range(10)]
        self.assertIn(rl.FORMAT_STOP, rl.format_review(rows))

    def test_ok_median(self):
        rows = [row(clip="a%02d-demo" % i, views=100, vvs=65) for i in range(10)]
        rows += [row(platform="tiktok", views=100) for _ in range(5)]
        out = rl.format_review(rows)
        self.assertNotIn(rl.FORMAT_STOP, out)


def plan_fixture():
    return {"posts": [
        {"clip": "a01-demo", "account": "yt-main", "platform": "youtube", "when_local": "2026-12-01T10:00:00-05:00",
         "meta": {"hook": "outcome first", "length_s": 24.5, "first_word_s": 0.2, "silence_ratio": 0.04,
                  "series": "series-a"}, "content": {"title": "A title"}},
        {"clip": "a01-demo", "account": "tiktok-main", "platform": "tiktok", "when_local": "2026-12-01T10:30:00-05:00"},
        {"clip": "a02-limit", "account": "yt-main", "platform": "youtube", "when_local": "2026-12-01T17:00:00-05:00"},
    ], "held": [{"clip": "a01-demo-b", "base": "a01-demo"}],
        "skipped": [{"clip": "a01-demo", "account": "x-main", "reason": "tags"}]}


class InitAndMerge(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        self.plan = os.path.join(self.d, "plan.json")
        self.log = os.path.join(self.d, "log.csv")
        with open(self.plan, "w") as f:
            json.dump(plan_fixture(), f)

    def tearDown(self):
        shutil.rmtree(self.d, ignore_errors=True)

    def read(self):
        with open(self.log, newline="") as f:
            rd = csv.DictReader(f)
            return rd.fieldnames, list(rd)

    def quiet(self, argv):
        with redirect_stdout(io.StringIO()) as buf:
            code = rl.main(argv)
        return code, buf.getvalue()

    def test_init_columns_and_rows(self):
        self.assertEqual(self.quiet(["init", self.plan, self.log])[0], 0)
        cols, rows = self.read()
        self.assertEqual(cols, rl.COLUMNS)
        self.assertEqual(len(rows), 3)
        r = rows[0]
        self.assertEqual((r["clip id"], r["account"], r["hook type"], r["length s"], r["series"], r["status"]),
                         ("a01-demo", "yt-main", "outcome first", "24.5", "series-a", "planned"))
        self.assertEqual(r["title wording"], "A title")

    def test_merge_keeps_existing_rows(self):
        self.quiet(["init", self.plan, self.log])
        cols, rows = self.read()
        rows[0]["views"] = "4321"
        rows[0]["status"] = "live"
        rows[0]["post time"] = "moved by hand"
        with open(self.log, "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=cols + ["my note"])
            w.writeheader()
            for r in rows:
                w.writerow(dict(r, **{"my note": "n"}))
        p = plan_fixture()
        p["posts"].append({"clip": "a03-demo", "account": "yt-main", "platform": "youtube", "when_local": "x"})
        with open(self.plan, "w") as f:
            json.dump(p, f)
        code, out = self.quiet(["init", self.plan, self.log])
        self.assertEqual(code, 0)
        self.assertIn("1 rows added, 3 kept", out)
        cols2, rows2 = self.read()
        self.assertIn("my note", cols2)
        self.assertEqual(len(rows2), 4)
        self.assertEqual((rows2[0]["views"], rows2[0]["status"], rows2[0]["post time"]), ("4321", "live", "moved by hand"))
        self.assertEqual(rows2[3]["clip id"], "a03-demo")

    def test_merge_pure(self):
        old = [{"clip id": "a01-demo", "account": "yt-main", "views": "9"}]
        new = [dict(rl.row_from_post({"clip": "a01-demo", "account": "yt-main"})),
               dict(rl.row_from_post({"clip": "a01-demo", "account": "x-main"}))]
        merged, added = rl.merge(old, new)
        self.assertEqual(added, 1)
        self.assertEqual(merged[0], old[0])

    def test_decide_cli(self):
        self.quiet(["init", self.plan, self.log])
        cols, rows = self.read()
        rows[0].update({"views": "400", "viewed vs swiped (YouTube)": "52", "second of the steepest drop": "2",
                        "read at 72 h": "yes"})
        rows[1].update({"views": "3600"})
        with open(self.log, "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=cols)
            w.writeheader()
            w.writerows(rows)
        code, out = self.quiet(["decide", self.log, "--baseline-views", "1000", "--plan", self.plan])
        self.assertEqual(code, 0)
        self.assertIn("a01-demo: winner (yt-main loser, tiktok-main winner)", out)
        self.assertIn(rl.OPEN_FAILED, out)
        self.assertIn("a02-limit: no read yet", out)
        # base a01-demo is a winner on one account: the alternate opening stays held
        self.assertIn("hold a01-demo-b", out)

    def test_decide_release_lists_accounts_where_base_did_not_run(self):
        rows = [row(views=400, vvs=52, read72="yes"), row(platform="tiktok", account="tiktok-main", views=900)]
        lines = rl.decide(rows, 1000, plan_fixture())
        self.assertIn("release a01-demo-b on x-main (a01-demo is keep after its 72 hour read)", lines)

    def test_decide_ab_pairs(self):
        p = plan_fixture()
        p["held"] = []
        p["posts"].append({"clip": "a01-demo-b", "account": "ig-trial", "platform": "instagram",
                           "variant_of": "a01-demo"})
        rows = [row(platform="instagram", account="ig-main", views=500, skip=40),
                row(clip="a01-demo-b", platform="instagram", account="ig-trial", views=500, skip=30)]
        lines = rl.decide(rows, 1000, p)
        self.assertTrue(any(l.startswith("A/B a01-demo vs a01-demo-b on instagram: winner: a01-demo-b") for l in lines),
                        lines)

    def test_decide_bad_baseline(self):
        self.quiet(["init", self.plan, self.log])
        with redirect_stderr(io.StringIO()) as err:
            self.assertEqual(rl.main(["decide", self.log, "--baseline-views", "0"]), 1)
        self.assertIn("baseline-views", err.getvalue())


if __name__ == "__main__":
    unittest.main()
