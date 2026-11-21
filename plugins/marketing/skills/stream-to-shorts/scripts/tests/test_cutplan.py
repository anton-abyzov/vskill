import os, sys; sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import unittest

import cutplan
from cutplan import cover, expand_shots, map_words, tight_spans, timeline, words_in_window, zoomed


def w(text, s, e):
    return {"w": text, "s": s, "e": e}


FACE = [1500, 650, 300, 180]


class TightSpans(unittest.TestCase):
    def test_not_tight_is_one_span(self):
        self.assertEqual(tight_spans({"in": 10.0, "out": 12.0}, [w("hi", 10.5, 10.8)]), [(10.0, 12.0)])

    def test_no_words_keeps_segment(self):
        self.assertEqual(tight_spans({"in": 10.0, "out": 12.0, "tight": True}, []), [(10.0, 12.0)])

    def test_gap_splits_and_lead_in(self):
        seg = {"in": 10.0, "out": 20.0, "tight": True}
        words = [w("one", 11.0, 11.3), w("two", 11.35, 11.6), w("three", 13.0, 13.4)]
        spans = tight_spans(seg, words)
        self.assertEqual(len(spans), 2)
        self.assertAlmostEqual(spans[0][0], 10.9)          # first group lead-in 0.10 s
        self.assertAlmostEqual(spans[0][1], 11.75)         # last word end + gap / 2
        self.assertAlmostEqual(spans[1][0], 12.85)         # later groups start gap / 2 early
        self.assertAlmostEqual(spans[1][1], 13.55)

    def test_lead_in_clamped_to_segment_start(self):
        spans = tight_spans({"in": 10.95, "out": 12.0, "tight": True}, [w("one", 11.0, 11.3)])
        self.assertEqual(spans[0][0], 10.95)

    def test_fillers_dropped(self):
        seg = {"in": 0.0, "out": 10.0, "tight": True}
        words = [w("go", 1.0, 1.2), w("um", 1.5, 2.5), w("now", 3.0, 3.2)]
        spans = tight_spans(seg, words)
        self.assertEqual(len(spans), 2)
        self.assertLess(spans[0][1], 1.5)

    def test_custom_fillers(self):
        seg = {"in": 0.0, "out": 10.0, "tight": True}
        words = [w("go", 1.0, 1.2), w("like", 1.25, 1.4), w("now", 1.45, 1.6)]
        self.assertEqual(len(tight_spans(seg, words, fillers={"like"})), 1)
        self.assertEqual(tight_spans(seg, words, fillers={"like"})[0][1], round(1.6 + 0.15, 3))

    def test_long_word_held_at_most_0_9(self):
        spans = tight_spans({"in": 0.0, "out": 10.0, "tight": True}, [w("sooo", 1.0, 4.0)])
        self.assertAlmostEqual(spans[0][1], 1.0 + 0.9 + 0.15)

    def test_drop_range_never_bleeds(self):
        seg = {"in": 0.0, "out": 10.0, "tight": True, "drop": [[2.0, 3.0]]}
        words = [w("a", 1.0, 1.95), w("cut", 2.2, 2.6), w("b", 3.02, 3.3)]
        spans = tight_spans(seg, words)
        self.assertEqual(len(spans), 2)
        for s, e in spans:
            self.assertFalse(s < 3.0 and e > 2.0, (s, e))
        self.assertEqual(spans[0][1], 2.0)
        self.assertEqual(spans[1][0], 3.0)

    def test_segment_gap_override(self):
        seg = {"in": 0.0, "out": 10.0, "tight": True}
        words = [w("a", 1.0, 1.2), w("b", 1.45, 1.6)]
        self.assertEqual(len(tight_spans(seg, words)), 1)
        self.assertEqual(len(tight_spans(dict(seg, gap=0.2), words)), 2)

    def test_tiny_spans_dropped(self):
        seg = {"in": 0.0, "out": 0.66, "tight": True, "gap": 0.1}
        words = [w("a", 0.1, 0.4), w("b", 0.6, 0.65)]
        spans = tight_spans(seg, words)
        self.assertEqual(len(spans), 1)

    def test_words_in_window(self):
        ws = [w("a", 9.9, 10.1), w("b", 9.96, 10.2), w("c", 11.9, 12.4), w("d", 12.0, 12.2)]
        self.assertEqual([x["w"] for x in words_in_window(ws, 10.0, 12.0)], ["b", "c"])


class ExpandShots(unittest.TestCase):
    def spec(self, **kw):
        s = {"id": "a01-demo", "src": "main", "facecam": FACE,
             "segments": [{"in": 100.0, "out": 104.0}]}
        s.update(kw)
        return s

    def test_split_to_max_length(self):
        shots = expand_shots(self.spec())
        self.assertEqual(len(shots), 3)                   # 4.0 / 1.45 -> 3
        for s in shots:
            self.assertLessEqual(s["out"] - s["in"], 1.45 + 1e-9)
        self.assertEqual(shots[0]["in"], 100.0)
        self.assertEqual(shots[-1]["out"], 104.0)
        self.assertEqual(shots[0]["src"], "main")

    def test_exact_multiple_is_not_split_further(self):
        self.assertEqual(len(expand_shots(self.spec(segments=[{"in": 0.0, "out": 2.9}]))), 2)

    def test_spec_shot_length(self):
        self.assertEqual(len(expand_shots(self.spec(shot=1.0))), 4)

    def test_alternating_punch_across_segments(self):
        shots = expand_shots(self.spec(segments=[{"in": 0.0, "out": 2.0}, {"in": 10.0, "out": 11.0}]))
        self.assertEqual([s["z"] for s in shots], [1.0, 1.08, 1.0])

    def test_segment_punch_and_fixed_z(self):
        shots = expand_shots(self.spec(segments=[{"in": 0.0, "out": 2.0, "punch": 1.2}, {"in": 5.0, "out": 7.0, "z": 1.5}]))
        self.assertEqual([s["z"] for s in shots], [1.0, 1.2, 1.5, 1.5])

    def test_still(self):
        shots = expand_shots(self.spec(segments=[{"in": 0.0, "out": 5.0, "still": True}]))
        self.assertEqual(len(shots), 1)

    def test_variant_segments(self):
        spec = self.spec(variants={"b": {"segments": [{"in": 50.0, "out": 51.0}]}, "c": {"bar": "x"}})
        self.assertEqual(expand_shots(spec, "b")[0]["in"], 50.0)
        self.assertEqual(expand_shots(spec, "c")[0]["in"], 100.0)
        with self.assertRaises(cutplan.PlanError):
            expand_shots(spec, "zzz")

    def test_a_in_g_in_offsets(self):
        shots = expand_shots(self.spec(segments=[{"in": 10.0, "out": 13.0, "a_in": 500.0, "g_in": 900.0}]))
        self.assertEqual(len(shots), 3)
        self.assertEqual([s["a_in"] for s in shots], [500.0, 501.0, 502.0])
        self.assertEqual([s["g_in"] for s in shots], [900.0, 901.0, 902.0])

    def test_tight_uses_words_for_audio_source(self):
        calls = []

        def words_for(key, a, b):
            calls.append((key, a, b))
            return [w("x", 10.5, 10.8), w("y", 12.0, 12.3)]
        seg = {"in": 10.0, "out": 13.0, "tight": True, "a_src": "voice", "a_in": 10.0}
        shots = expand_shots(self.spec(segments=[seg]), words_for=words_for)
        self.assertEqual(calls, [("voice", 10.0, 13.0)])
        self.assertEqual(len(shots), 2)
        self.assertAlmostEqual(shots[0]["in"], 10.4)

    def test_tight_without_lookup_stays_whole(self):
        self.assertEqual(len(expand_shots(self.spec(segments=[{"in": 0.0, "out": 1.0, "tight": True}]))), 1)

    def test_missing_source(self):
        spec = self.spec()
        del spec["src"]
        with self.assertRaises(cutplan.PlanError):
            expand_shots(spec)


class Timeline(unittest.TestCase):
    def test_speed(self):
        shots = timeline([{"in": 0.0, "out": 1.0}, {"in": 5.0, "out": 6.0, "speed": 2.0}, {"in": 9.0, "out": 9.5}])
        self.assertEqual([(s["t0"], s["t1"]) for s in shots], [(0.0, 1.0), (1.0, 1.5), (1.5, 2.0)])

    def test_does_not_mutate(self):
        src = [{"in": 0.0, "out": 1.0}]
        timeline(src)
        self.assertNotIn("t0", src[0])


class MapWords(unittest.TestCase):
    def test_maps_through_shots(self):
        shots = timeline([{"src": "main", "in": 10.0, "out": 11.0}, {"src": "main", "in": 20.0, "out": 22.0, "speed": 2.0}])
        words = [w("first", 10.1, 10.4), w("gone", 15.0, 15.3), w("second", 20.5, 21.0), w("edge", 21.9, 22.4)]
        out = map_words({"main": words}, shots)
        self.assertEqual([x["w"] for x in out], ["first", "second"])
        self.assertEqual((out[0]["s"], out[0]["e"]), (0.1, 0.4))
        self.assertEqual((out[1]["s"], out[1]["e"]), (1.25, 1.5))

    def test_audio_from_a_in_unless_g_in(self):
        voice = [w("voice", 500.2, 500.5)]
        main = [w("main", 10.2, 10.5)]
        a = timeline([{"src": "main", "in": 10.0, "out": 11.0, "a_src": "voice", "a_in": 500.0}])
        self.assertEqual([x["w"] for x in map_words({"main": main, "voice": voice}, a)], ["voice"])
        g = timeline([{"src": "main", "in": 10.0, "out": 11.0, "a_in": 500.0, "g_in": 900.0}])
        self.assertEqual([x["w"] for x in map_words({"main": main, "voice": voice}, g)], ["main"])

    def test_list_input_and_clipping(self):
        shots = timeline([{"src": "main", "in": 10.0, "out": 11.0}])
        out = map_words([w("long", 10.6, 11.3)], shots)
        self.assertEqual(out[0]["e"], 1.0)


class Cover(unittest.TestCase):
    def test_aspect(self):
        x, y, ww, hh = cover([200, 100, 1200, 800], 1080, 1160, 1.0, 580)
        self.assertAlmostEqual(ww / float(hh), 1080 / 1160.0, places=2)
        self.assertEqual(ww % 2, 0)
        self.assertEqual(hh % 2, 0)

    def test_clamps_to_source(self):
        for c in ([1800, 1000, 400, 400], [-200, -200, 300, 300], [0, 0, 1920, 1080]):
            x, y, ww, hh = cover(c, 1080, 1160, 1.0, 580)
            self.assertGreaterEqual(x, 0)
            self.assertGreaterEqual(y, 0)
            self.assertLessEqual(x + ww, 1920)
            self.assertLessEqual(y + hh, 1080)

    def test_zoom_cap(self):
        # a tiny crop never gives a window under panel_height / max_zoom
        x, y, ww, hh = cover([900, 500, 50, 50], 1080, 1160, 1.0, 1160 / 2.0)
        self.assertGreaterEqual(hh, 580 - 1)

    def test_punch_shrinks_window(self):
        a = cover([200, 100, 1200, 800], 1080, 1160, 1.0, 580)
        b = cover([200, 100, 1200, 800], 1080, 1160, 1.08, 580)
        self.assertLess(b[3], a[3])

    def test_focus(self):
        x, y, ww, hh = cover([0, 0, 600, 600], 1080, 1160, 1.0, 580, focus=(1500, 500))
        self.assertAlmostEqual(x + ww / 2.0, 1500, delta=1)

    def test_face_box_never_wider(self):
        x, y, ww, hh = cover(FACE, 1080, 640)
        self.assertLessEqual(ww, FACE[2])

    def test_other_source_size(self):
        x, y, ww, hh = cover([0, 0, 3840, 2160], 1080, 1920, 1.0, 960, src_w=3840, src_h=2160)
        self.assertEqual(hh, 2160)
        self.assertLessEqual(x + ww, 3840)

    def test_zoomed(self):
        self.assertEqual(zoomed((0, 0, 1000, 500), 2.0), (230, 115, 540, 270))
        self.assertEqual(zoomed((0, 0, 400, 200), 2.0), (0, 0, 400, 200))


class Windows(unittest.TestCase):
    def test_full_default_crop(self):
        self.assertEqual(cutplan.full_default_crop(1920, 1080), [656, 0, 608, 1080])

    def test_stack_needs_facecam(self):
        with self.assertRaises(cutplan.PlanError) as cm:
            cutplan.shot_windows({"in": 0, "out": 1}, "stack", 1920, 1080, None)
        self.assertIn("facecam", str(cm.exception))

    def test_full_needs_no_facecam(self):
        win = cutplan.shot_windows({"in": 0, "out": 1}, "full", 1920, 1080, None)
        self.assertEqual(win["screen"], (656, 0, 606, 1080))       # 9:16 of 1080 rounded down to even

    def test_filter_shapes(self):
        f = cutplan.shot_video_filter({"in": 0, "out": 1, "g_in": 50}, "stack", 1920, 1080, FACE)
        self.assertTrue(f.startswith("[1:v]"))
        self.assertIn("pad=1080:760:0:0:white", f)
        self.assertIn("scale=1080:1160", f)
        a = cutplan.shot_audio_filter({"in": 0, "out": 1, "a_in": 5})
        self.assertTrue(a.startswith("[1:a]"))
        self.assertIn("afade=t=in:d=0.01", a)
        self.assertIn("afade=t=out:st=0.988:d=0.01", a)


class Round3(unittest.TestCase):
    """Third review round: sound taken from another time, drops that leave no
    word, a face window pushed out of the frame."""

    def test_tight_with_a_in_reads_the_transcript_in_sound_time(self):
        asked = []

        def words_for(key, a, b):
            asked.append((key, a, b))
            return words_in_window([w("late", 503.0, 503.4), w("words", 503.5, 503.9), w("picture", 103.0, 103.4)], a, b)
        spec = {"src": "main", "segments": [{"in": 100.0, "out": 110.0, "a_in": 500.0, "a_src": "mic", "tight": True}]}
        shots = expand_shots(spec, words_for=words_for)
        self.assertEqual(asked, [("mic", 500.0, 510.0)])
        self.assertAlmostEqual(shots[0]["in"], 102.9)                 # the word at 503.0 in sound time
        self.assertAlmostEqual(shots[-1]["out"], 104.05)
        for s in shots:
            self.assertAlmostEqual(s["a_in"] - s["in"], 400.0)        # sound and picture stay 400 s apart

    def test_tight_follows_the_sound_the_shot_plays(self):
        asked = []

        def words_for(key, a, b):
            asked.append((key, a, b))
            return []
        segs = [{"in": 100.0, "out": 104.0, "a_in": 500.0, "a_src": "mic", "g_in": 900.0, "tight": True},  # g_in: sound stays at "in"
                {"in": 200.0, "out": 204.0, "a_src": "mic", "tight": True},                                # no a_in: a_src is not used
                {"in": 300.0, "out": 304.0, "a_in": 300.0, "a_src": "mic", "tight": True}]                 # same time, other source
        expand_shots({"src": "main", "segments": segs}, words_for=words_for)
        self.assertEqual(asked, [("main", 100.0, 104.0), ("main", 200.0, 204.0), ("mic", 300.0, 304.0)])

    def test_tight_with_a_in_drops_in_sound_time(self):
        def words_for(key, a, b):
            return words_in_window([w("keep", 501.0, 501.3), w("bad", 503.0, 503.4), w("fine", 505.0, 505.3)], a, b)
        spec = {"src": "main", "segments": [{"in": 100.0, "out": 110.0, "a_in": 500.0, "tight": True, "still": True,
                                             "drop": [[502.5, 504.0]]}]}
        shots = expand_shots(spec, words_for=words_for)
        self.assertEqual([(s["in"], s["out"]) for s in shots], [(100.9, 101.45), (104.85, 105.45)])

    def test_tight_without_a_in_is_unchanged(self):
        def words_for(key, a, b):
            return words_in_window([w("one", 11.0, 11.3), w("two", 13.0, 13.4)], a, b)
        seg = {"in": 10.0, "out": 20.0, "tight": True, "still": True}
        shots = expand_shots({"src": "main", "segments": [seg]}, words_for=words_for)
        self.assertEqual([(s["in"], s["out"]) for s in shots],
                         tight_spans(seg, words_for("main", 10.0, 20.0)))

    def test_drop_that_covers_every_word_removes_the_speech(self):
        seg = {"in": 10.0, "out": 12.0, "tight": True, "drop": [[10.0, 12.0]]}
        self.assertEqual(tight_spans(seg, [w("oops", 10.5, 10.9), w("again", 11.0, 11.4)]), [])

    def test_drop_inside_a_window_with_no_other_word_keeps_the_rest(self):
        seg = {"in": 10.0, "out": 12.0, "tight": True, "drop": [[10.5, 11.5]]}
        self.assertEqual(tight_spans(seg, [w("oops", 10.6, 10.9)]), [(10.0, 10.5), (11.5, 12.0)])
        self.assertEqual(tight_spans(seg, []), [(10.0, 10.5), (11.5, 12.0)])         # no transcript words at all
        seg["drop"] = [[9.0, 10.05], [11.95, 13.0]]                                   # slivers under min_span go
        self.assertEqual(tight_spans(seg, [w("um", 10.6, 10.9)]), [(10.05, 11.95)])

    def test_a_cut_with_nothing_left_is_an_error(self):
        spec = {"src": "main", "segments": [{"in": 10.0, "out": 12.0, "tight": True, "drop": [[10.0, 12.0]]}]}
        with self.assertRaises(cutplan.PlanError) as cm:
            expand_shots(spec, words_for=lambda k, a, b: [w("oops", 10.5, 10.9)])
        self.assertIn("empty", str(cm.exception))

    def test_face_dy_keeps_the_face_window_inside_the_source(self):
        for dy in (0, 40, 500, 5000, -40, -5000):
            win = cutplan.shot_windows({"in": 0, "out": 1, "face_dy": dy}, "stack", 1920, 1080, FACE)
            fx, fy, fw, fh = win["face"]
            self.assertGreaterEqual(fy, 0, dy)
            self.assertLessEqual(fy + fh, 1080, dy)
        low = cutplan.shot_windows({"in": 0, "out": 1}, "stack", 1920, 1080, FACE)["face"][1]
        moved = cutplan.shot_windows({"in": 0, "out": 1, "face_dy": -40}, "stack", 1920, 1080, FACE)["face"][1]
        self.assertEqual(moved, low - 40)                             # a shift that fits is applied as given


if __name__ == "__main__":
    unittest.main()
