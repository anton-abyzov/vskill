import os, sys; sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import array
import base64
import json
import math
import tempfile
import unittest

import audio_check
import caption_check
import fill_check
import music_check
import privacy_scan


def at(user, host):
    """Build address-like fixtures at run time."""
    return user + "@" + host


def profile(n=480, detail=8.0, empty_from=None, bottom=None):
    """Synthetic row profile: detail everywhere, optional dead rows from a
    fraction of the height, optional bottom-third level."""
    rows = [detail] * n
    if bottom is not None:
        for y in range(2 * n // 3, n):
            rows[y] = bottom
    if empty_from is not None:
        for y in range(int(n * empty_from), n):
            rows[y] = 0.3
    return rows


class FillCheckTest(unittest.TestCase):
    def test_row_detail(self):
        w, h = 4, 2
        buf = bytearray([0, 10, 0, 10, 5, 5, 5, 5])
        self.assertEqual(fill_check.row_detail(buf, w, h), [10.0, 0.0])

    def test_merge_max(self):
        self.assertEqual(fill_check.merge_max([[1, 5], [3, 2], []]), [3, 5])

    def test_content_floor_full_frame(self):
        self.assertEqual(fill_check.content_floor(profile()), 479)

    def test_content_floor_needs_two_rows(self):
        rows = [5.0] * 100
        for y in range(80, 100):
            rows[y] = 0.0
        rows[95] = 9.0  # one noisy row below the panel
        self.assertEqual(fill_check.content_floor(rows), 79)

    def test_content_floor_none(self):
        self.assertEqual(fill_check.content_floor([0.0] * 50), -1)

    def test_letterboxed_panel_fails(self):
        # First renders of the run had their floor between 66 and 89 percent.
        for frac in (0.67, 0.80, 0.89):
            v = fill_check.verdict(profile(empty_from=frac))
            self.assertFalse(v["ok"], frac)
            self.assertIn("no detail", v["reason"])

    def test_fixed_render_passes(self):
        # Fixed renders reached 97 to 100 percent.
        for frac in (0.975, 0.99, None):
            self.assertTrue(fill_check.verdict(profile(empty_from=frac))["ok"], frac)

    def test_flat_screen_with_dock_passes(self):
        # A mostly white app window: low detail, but a dock near the bottom edge.
        rows = profile(detail=6.0, bottom=1.0)
        for y in range(450, 476):
            rows[y] = 12.0
        v = fill_check.verdict(rows)
        self.assertTrue(v["ok"], v)

    def test_dim_bottom_third_fails_on_ratio(self):
        rows = profile(detail=20.0, bottom=2.1)
        v = fill_check.verdict(rows)
        self.assertFalse(v["ok"])
        self.assertIn("middle third", v["reason"])

    def test_floor_percent(self):
        v = fill_check.verdict(profile(empty_from=0.5))
        self.assertAlmostEqual(v["floor_pct"], 50.0, places=1)


class PrivacyPatternTest(unittest.TestCase):
    def assertFlag(self, text, flag):
        self.assertIn(flag, privacy_scan.risk_flags(text), text)

    def assertClean(self, text):
        self.assertEqual(privacy_scan.risk_flags(text), [], text)

    def test_hits(self):
        self.assertFlag("mail me at " + at("someone", "example.org"), "email")
        self.assertFlag("follow " + at("", "fixture_user"), "handle")
        self.assertFlag("open https://example.org/x", "url")
        self.assertFlag("see example.net for more", "domain")
        self.assertFlag("/" + "Users" + "/someone/Projects", "home-path")
        self.assertFlag("/home/someone/.config", "home-path")
        self.assertFlag("C:\\Users\\someone\\Desktop", "home-path")
        self.assertFlag("~/notes/today.md", "home-path")
        self.assertFlag("server 203.0.113.7 ready", "ipv4")
        self.assertFlag("router 192.168.1", "lan-ip")
        self.assertFlag("host 10.0.0.12", "lan-ip")
        self.assertFlag("host 172.20.4.1", "lan-ip")
        self.assertFlag("order 1234567", "digits")
        self.assertFlag("pair code AB12-CD34", "code")
        self.assertFlag("Token expired", "secret-word")
        self.assertFlag("enter password", "secret-word")
        self.assertFlag("the secret", "secret-word")
        self.assertFlag("API key", "secret-word")
        self.assertFlag("tok_" + "x" * 32, "base64-like")
        self.assertFlag("id_" + "x" * 16 + "-Ab3" * 3, "base64-like")
        self.assertFlag(base64.b64encode(b"fixture bytes for the scan").decode(), "base64-like")

    def test_non_hits(self):
        for text in ("Usage limit reached", "Working for 2m 14s", "version 3.5",
                     "Exit Vehicle", "keyboard shortcuts", "real-time sync",
                     "PRESS START", "12:45 PM", "score 12345", at("a", " b"),
                     "e.g. this", "172.15.0", "3.14159265",
                     "internationalisation_settings"):
            self.assertClean(text)

    def test_extra_pattern(self):
        extra = privacy_scan.compile_extra([r"\bacme\b"])
        self.assertIn("extra", privacy_scan.risk_flags("Built at ACME labs", extra))
        self.assertNotIn("extra", privacy_scan.risk_flags("Built at home", extra))

    def test_no_product_names_in_defaults(self):
        self.assertClean("Claude GitHub Gmail OBS")

    def test_add_lines_and_report(self):
        seen = {}
        privacy_scan.add_lines(seen, ["  hello   world ", "ok", "-_?=", at("x", "y.io")], 0.5)
        privacy_scan.add_lines(seen, ["hello world", "later line"], 1.25)
        self.assertEqual(seen, {"hello world": 0.5, at("x", "y.io"): 0.5, "later line": 1.25})
        rows = privacy_scan.build_report(seen)
        self.assertEqual([r["text"] for r in rows], ["hello world", at("x", "y.io"), "later line"])
        self.assertIn("email", rows[1]["flags"])
        txt = privacy_scan.format_txt("a01-demo", "tesseract", 4, 10, rows)
        self.assertIn("RISK[", txt)
        self.assertIn("later line", txt)


class AudioPureTest(unittest.TestCase):
    RATE = 1000

    def tone(self, seconds, amp):
        n = int(seconds * self.RATE)
        return [int(amp * math.sin(2 * math.pi * 50 * i / self.RATE)) for i in range(n)]

    def test_rms_windows(self):
        samples = self.tone(0.1, 16384) + [0] * 50
        rms = audio_check.rms_windows(array.array("h", samples), self.RATE)
        self.assertEqual(len(rms), 3)
        self.assertAlmostEqual(rms[0], 20 * math.log10(0.5 / math.sqrt(2)), delta=0.3)
        self.assertLess(rms[2], -150)

    def test_peak_stats(self):
        peak, clipped = audio_check.peak_stats([0, 100, -32768, 32767, 32740])
        self.assertAlmostEqual(peak, 0.0, delta=0.01)
        self.assertEqual(clipped, 3)
        peak, clipped = audio_check.peak_stats([16384, -100])
        self.assertAlmostEqual(peak, -6.02, delta=0.05)
        self.assertEqual(clipped, 0)

    def test_dipped_words(self):
        rms = [-20.0] * 20
        rms[6] = -60.0  # 0.30 to 0.35 s
        words = [{"word": "one", "start": 0.0, "end": 0.25},
                 {"word": "two", "start": 0.26, "end": 0.5},
                 {"word": "three", "start": 0.55, "end": 0.9}]
        self.assertEqual(audio_check.dipped_words(words, rms), [("two", 0.26, -60.0)])

    def test_gaps_and_stats(self):
        words = [{"word": "a", "start": 0.1, "end": 0.4},
                 {"word": "b", "start": 0.8, "end": 1.0},
                 {"word": "c", "start": 1.7, "end": 2.1}]
        self.assertEqual(audio_check.word_gaps(words), [(0.4, 0.8, 0.4), (1.0, 1.7, 0.7)])
        s = audio_check.speech_stats(words)
        self.assertEqual(s["first_word"], 0.1)
        self.assertEqual(s["wpm"], 90.0)

    def test_normalise_words(self):
        data = {"segments": [{"words": [{"word": " hi", "start": 0.5, "end": 0.7}]},
                             {"words": [{"text": "there", "start": 0.1, "end": 0.3}]}]}
        out = audio_check.normalise_words(data)
        self.assertEqual([w["word"] for w in out], ["there", "hi"])
        flat = [{"w": "cut", "s": 0.2, "e": 0.4}]
        self.assertEqual(audio_check.normalise_words(flat),
                         [{"word": "cut", "start": 0.2, "end": 0.4}])

    def test_verdicts(self):
        good = {"lufs": -14.4, "true_peak": -1.2, "clipped": 0, "silences": [],
                "speech": {"first_word": 0.12}, "gaps": [], "dipped": []}
        levels = [lv for lv, _ in audio_check.verdicts(good)]
        self.assertNotIn("FAIL", levels)
        self.assertNotIn("WARN", levels)
        bad = {"lufs": -16.2, "true_peak": -0.3, "clipped": 4, "silences": [(3.0, 3.8)],
               "speech": {"first_word": 0.6},
               "gaps": [(1.0, 1.4, 0.4), (2.0, 2.7, 0.7)], "dipped": [("two", 0.26, -60.0)]}
        v = audio_check.verdicts(bad)
        text = "\n".join("%s %s" % x for x in v)
        self.assertEqual(sum(1 for lv, _ in v if lv == "FAIL"), 3)
        self.assertIn("CHECK pauses over 0.35 s: 1.00-1.40", text)
        self.assertIn("WARN pauses over 0.5", text)
        self.assertIn("WARN first word", text)
        self.assertIn("two@0.26", text)


class DropoutTest(unittest.TestCase):
    def test_hole_between_speech_is_a_dropout(self):
        rms = [-25.0] * 20 + [-90.0] * 6 + [-25.0] * 20      # 0.3 s hole at 1.0 s
        self.assertEqual(audio_check.dropouts(rms), [(1.0, 1.3, -90.0)])

    def test_short_hole_is_ignored(self):
        rms = [-25.0] * 20 + [-90.0] * 3 + [-25.0] * 20      # 0.15 s
        self.assertEqual(audio_check.dropouts(rms), [])

    def test_room_tone_pause_is_not_a_dropout(self):
        rms = [-25.0] * 20 + [-58.0] * 10 + [-25.0] * 20     # quiet, but tone is there
        self.assertEqual(audio_check.dropouts(rms), [])

    def test_silence_at_the_edges_is_not_a_dropout(self):
        rms = [-90.0] * 8 + [-25.0] * 20 + [-90.0] * 8
        self.assertEqual(audio_check.dropouts(rms), [])

    def test_hole_inside_a_quiet_stretch_is_not_a_dropout(self):
        rms = [-60.0] * 20 + [-90.0] * 8 + [-60.0] * 20      # nothing audible around it
        self.assertEqual(audio_check.dropouts(rms), [])

    def test_verdict_lines(self):
        base = {"lufs": -14.0, "true_peak": -1.5, "clipped": 0}
        v = audio_check.verdicts(dict(base, dropouts=[(1.0, 1.3, -90.0)]))
        self.assertIn(("WARN", "1 dropout(s) near digital silence (listen): 1.00-1.30"), v)
        v = audio_check.verdicts(dict(base, dropouts=[]))
        self.assertTrue(any(lv == "PASS" and "no dropout" in t for lv, t in v))


class MusicPureTest(unittest.TestCase):
    def test_parse_range(self):
        self.assertEqual(music_check.parse_range("12.5-40"), (12.5, 40.0))
        for bad in ("40-12", "abc", "5"):
            with self.assertRaises(ValueError):
                music_check.parse_range(bad)

    def test_music_score(self):
        cats = [("Speech", 0.9), ("Music", 0.2), ("Video game music", 0.31)]
        self.assertEqual(music_check.music_score(cats), 0.31)
        self.assertEqual(music_check.music_score([("Speech", 0.9)]), 0.0)


def words(text, start=0.0, step=0.4):
    return [{"word": w, "start": round(start + i * step, 2), "end": round(start + i * step + 0.3, 2)}
            for i, w in enumerate(text.split())]


class CaptionCheckTest(unittest.TestCase):
    def test_identical_after_normalising(self):
        cap = words("WE SHIP IT TODAY, RIGHT?")
        ind = words("We ship it today right")
        diffs, ratio = caption_check.compare(cap, ind)
        self.assertEqual(diffs, [])
        self.assertEqual(ratio, 0.0)

    def test_kinds_and_times(self):
        cap = words("WE BUILT A TOOL THAT SORTS FILES NOW")
        ind = words("We built a new tool that saves files")
        diffs, ratio = caption_check.compare(cap, ind)
        kinds = [(d["kind"], d["captions"], d["spoken"]) for d in diffs]
        self.assertEqual(kinds, [("missing from captions", "", "new"),
                                 ("replaced", "SORTS", "saves"),
                                 ("extra in captions", "NOW", "")])
        self.assertEqual(diffs[0]["time"], 1.2)
        self.assertAlmostEqual(ratio, 3 / 8.0)

    def test_check_by_ear(self):
        cap = words("UPDATED TO VERSION 4.1")
        ind = words("updated to version 4.7")
        diffs, _ = caption_check.compare(cap, ind)
        self.assertEqual(len(diffs), 1)
        self.assertTrue(diffs[0]["check_by_ear"])
        diffs, _ = caption_check.compare(words("IT WAS FAST"), words("it was slow"))
        self.assertFalse(diffs[0]["check_by_ear"])
        diffs, _ = caption_check.compare(words("I MET DANA"), words("I met Dina"))
        self.assertTrue(diffs[0]["check_by_ear"])

    def test_load_words_splits_events(self):
        data = {"words": [{"text": "two words", "start": 1.0, "end": 2.0},
                          {"word": "...", "start": 2.0, "end": 2.1}]}
        out = caption_check.load_words(data)
        self.assertEqual([(w["word"], w["start"]) for w in out], [("two", 1.0), ("words", 1.5)])
        flat = caption_check.load_words([{"w": "Cut", "s": 0.2, "e": 0.4}])
        self.assertEqual(flat, [{"word": "Cut", "start": 0.2, "end": 0.4}])

    def test_cli_exit_codes(self):
        with tempfile.TemporaryDirectory() as d:
            a, b = os.path.join(d, "cap.json"), os.path.join(d, "ind.json")
            with open(a, "w") as fh:
                json.dump(words("one two three four five six seven eight nine ten"), fh)
            with open(b, "w") as fh:
                json.dump(words("one two three four five six seven eight nine then"), fh)
            out = sys.stdout
            sys.stdout = open(os.devnull, "w")
            try:
                self.assertEqual(caption_check.main([a, b]), 1)
                self.assertEqual(caption_check.main([a, b, "--max-ratio", "0.1"]), 0)
            finally:
                sys.stdout.close()
                sys.stdout = out


if __name__ == "__main__":
    unittest.main()
