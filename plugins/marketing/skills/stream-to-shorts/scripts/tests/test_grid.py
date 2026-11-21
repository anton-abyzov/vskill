import os, sys; sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))  # noqa: E401,E702

import array
import io
import json
import math
import random
import shutil
import stat
import tempfile
import unittest

import audio_check
import caption_check
import captions
import compile_wide
import cut_short
import cutplan
from cutplan import FPS, cut_frames, expand_shots, snap_label, timeline, words_in_window


def w(text, s, e):
    return {"w": text, "s": s, "e": e}


def spec(*segs, **kw):
    s = {"src": "main", "segments": list(segs)}
    s.update(kw)
    return s


def stand_in(folder, name, body):
    """A stand-in for a tool: a script that runs `body`."""
    p = os.path.join(folder, name)
    with open(p, "w") as f:
        f.write("#!%s\n%s" % (sys.executable, body))
    os.chmod(p, os.stat(p).st_mode | stat.S_IXUSR)
    return p


class FrameGrid(unittest.TestCase):
    """Every shot is a whole number of frames, and no shot grows."""

    def test_every_shot_is_whole_frames(self):
        shots = timeline(expand_shots(spec({"in": 100.0, "out": 104.0})))
        self.assertEqual(sum(s["frames"] for s in shots), 120)
        for s in shots:
            self.assertIsInstance(s["frames"], int)
            self.assertGreaterEqual(s["frames"], 1)
            self.assertAlmostEqual(s["out"] - s["in"], s["frames"] / 30.0, delta=0.0011)
        self.assertEqual(shots[0]["in"], 100.0)
        self.assertEqual(shots[-1]["out"], 104.0)

    def test_times_are_counted_in_frames_so_cuts_do_not_drift(self):
        segs = [{"in": 10.0 + 3 * i, "out": 10.0 + 3 * i + 0.317 + 0.071 * i} for i in range(40)]
        shots = timeline(expand_shots(spec(*segs)))
        f = 0
        for s in shots:
            self.assertEqual(s["t0"], round(f / 30.0, 3))
            f += s["frames"]
            self.assertEqual(s["t1"], round(f / 30.0, 3))
        self.assertEqual(cut_frames(shots)[-1], f)

    def test_a_span_is_rounded_down_never_up(self):
        rnd = random.Random(11)
        for _ in range(400):
            a = round(rnd.uniform(0, 5000), 3)
            b = round(a + rnd.uniform(0.04, 9.0), 3)
            sp = rnd.choice([1.0, 1.0, 1.05, 1.1, 0.9, 2])
            seg = {"in": a, "out": b, "speed": sp}
            if rnd.random() < 0.3:
                seg["still"] = True
            shots = expand_shots(spec(seg, shot=rnd.choice([1.45, 1.0, 0.5])))
            self.assertGreaterEqual(shots[0]["in"], a)
            self.assertLessEqual(shots[-1]["out"], b)
            frames = sum(s["frames"] for s in shots)
            self.assertEqual(frames, int((b - a) / sp * 30 + 1e-6))
            self.assertLess((b - a) / sp - frames / 30.0, 1 / 30.0 + 1e-6)      # under one frame is lost
            for x, y in zip(shots, shots[1:]):
                self.assertEqual(x["out"], y["in"])                            # nothing skipped inside a span

    def test_speed_and_sound_from_another_time(self):
        seg = {"in": 200.0, "out": 203.3, "speed": 1.1, "a_in": 900.0, "a_src": "mic"}
        shots = timeline(expand_shots(spec(seg)))
        self.assertEqual(sum(s["frames"] for s in shots), 90)                  # 3.3 / 1.1 = 3.0 s
        self.assertEqual(shots[-1]["t1"], 3.0)
        for s in shots:
            self.assertAlmostEqual(s["a_in"] - s["in"], 700.0)
            self.assertAlmostEqual((s["out"] - s["in"]) / 1.1, s["frames"] / 30.0, delta=0.0011)

    def test_a_tight_span_never_grows_into_a_dropped_range(self):
        def words_for(key, a, b):
            return words_in_window([w("keep", 11.0, 11.31), w("bad", 11.6, 11.9), w("fine", 12.3, 12.61)], a, b)
        seg = {"in": 10.0, "out": 14.0, "tight": True, "drop": [[11.45, 12.2]]}
        shots = expand_shots(spec(seg), words_for=words_for)
        self.assertTrue(shots)
        for s in shots:
            self.assertFalse(s["in"] < 12.2 and s["out"] > 11.45, s)
        spans = cutplan.tight_spans(seg, words_for("main", 10.0, 14.0))
        self.assertEqual(shots[0]["in"], spans[0][0])
        self.assertLessEqual(shots[-1]["out"], spans[-1][1])

    def test_segments_that_carry_on_lose_nothing_between_them(self):
        a, b = {"in": 100.0, "out": 101.01}, {"in": 101.01, "out": 102.5, "win": [0, 0, 960, 540]}
        shots = expand_shots(spec(a, b))
        first = [s for s in shots if "win" not in s]
        second = [s for s in shots if "win" in s]
        self.assertEqual(second[0]["in"], first[-1]["out"])                     # 101.0, not 101.01
        self.assertEqual(sum(s["frames"] for s in shots), 75)                   # 2.5 s: one frame lost in all
        self.assertLessEqual(second[-1]["out"], 102.5)

    def test_no_carry_across_a_change_of_picture_or_sound(self):
        base = {"in": 100.0, "out": 101.01}
        for other in ({"in": 101.01, "out": 102.5, "src": "cam"},
                      {"in": 101.01, "out": 102.5, "a_in": 500.0},
                      {"in": 101.01, "out": 102.5, "g_in": 300.0},
                      {"in": 101.3, "out": 102.5}):
            shots = expand_shots(spec(base, other))
            nxt = [s for s in shots if s["in"] >= 101.0][0]
            self.assertEqual(nxt["in"], other["in"], other)

    def test_a_span_under_one_frame_is_left_out(self):
        shots = expand_shots(spec({"in": 5.0, "out": 5.02}, {"in": 9.0, "out": 10.0}))
        self.assertEqual([(s["in"], s["out"]) for s in shots], [(9.0, 10.0)])
        with self.assertRaises(cutplan.PlanError):
            expand_shots(spec({"in": 5.0, "out": 5.02}))

    def test_speed_must_be_above_zero(self):
        for bad in (0, -1, True, "2", None, float("inf"), float("nan")):
            with self.assertRaises(cutplan.PlanError) as cm:
                expand_shots(spec({"in": 1.0, "out": 2.0, "speed": bad}))
            self.assertIn("speed", str(cm.exception), bad)

    def test_max_shot_must_be_above_zero(self):
        for bad in (0, -1.45, True, "1.45", float("inf"), float("nan")):
            with self.assertRaises(cutplan.PlanError) as cm:
                expand_shots(spec({"in": 1.0, "out": 5.0}, shot=bad))
            self.assertIn("shot", str(cm.exception))

    def test_shots_are_split_by_their_length_on_screen(self):
        slow = expand_shots(spec({"in": 0.0, "out": 1.4, "speed": 0.5}))        # 2.8 s on screen
        self.assertEqual([s["frames"] for s in slow], [42, 42])
        fast = expand_shots(spec({"in": 0.0, "out": 2.8, "speed": 2.0}))        # 1.4 s on screen
        self.assertEqual([s["frames"] for s in fast], [42])
        plain = expand_shots(spec({"in": 0.0, "out": 2.9}))                     # 87 frames: two shots, as before
        self.assertEqual([s["frames"] for s in plain], [44, 43])
        rnd = random.Random(5)
        for _ in range(300):
            sp, mx = rnd.choice([0.5, 0.75, 1.0, 1.1, 1.5, 2.0]), rnd.choice([1.45, 1.0, 0.6])
            shots = expand_shots(spec({"in": 3.0, "out": round(3.0 + rnd.uniform(0.1, 12.0), 3), "speed": sp}, shot=mx))
            for s in shots:
                self.assertLessEqual(s["frames"], int(mx * 30) + 1, (sp, mx))   # at most one frame over

    def test_a_default_written_out_still_carries_on(self):
        base = {"in": 100.0, "out": 101.01}
        for other in ({"in": 101.01, "out": 102.5, "a_src": "main"},
                      {"in": 101.01, "out": 102.5, "a_in": 101.01},
                      {"in": 101.01, "out": 102.5, "a_in": 101.01, "a_src": "main"}):
            shots = expand_shots(spec(base, other))
            self.assertEqual(sum(s["frames"] for s in shots), 75, other)
            self.assertEqual([s for s in shots if s["in"] >= 100.9][0]["in"], 101.0, other)
        shots = expand_shots(spec(base, {"in": 101.01, "out": 102.5, "a_in": 101.01, "a_src": "mic"}))
        self.assertEqual([s for s in shots if s["in"] >= 100.9][0]["in"], 101.01)       # another recording

    def test_the_picture_is_put_on_the_grid_before_crop_and_scale(self):
        grid = ",fps=30:start_time=0,tpad=stop_mode=clone:stop=-1,trim=end_frame=22"
        self.assertEqual(cutplan.shot_grid({"in": 0, "out": 0.733, "frames": 22}), grid)
        self.assertEqual(cutplan.shot_grid({"in": 1.0, "out": 1.7, "frames": 42, "speed": 0.5}),
                         ",setpts=PTS/0.5,fps=30:start_time=0,tpad=stop_mode=clone:stop=-1,trim=end_frame=42")
        self.assertEqual(cutplan.shot_grid({"in": 0, "out": 1}), "")
        self.assertEqual(cutplan.shot_grid({"in": 0, "out": 1, "speed": 1.1}), ",setpts=PTS/1.1")
        shot = {"in": 0, "out": 0.733, "frames": 22}
        full = cutplan.shot_video_filter(shot, "full", 1920, 1080)
        self.assertTrue(full.startswith("[0:v]setpts=PTS-STARTPTS" + grid + ",crop="), full)
        stack = cutplan.shot_video_filter(shot, "stack", 1920, 1080, [1500, 650, 300, 180])
        self.assertTrue(stack.startswith("[0:v]setpts=PTS-STARTPTS" + grid + ",split=2[g][f];"), stack)
        moved = cutplan.shot_video_filter(dict(shot, g_in=40.0), "stack", 1920, 1080, [1500, 650, 300, 180])
        self.assertTrue(moved.startswith("[1:v]setpts=PTS-STARTPTS" + grid + "[g];"), moved)
        self.assertIn("[0:v]setpts=PTS-STARTPTS" + grid + ",crop=", moved)          # both pictures, frame for frame
        for text in (full, stack, moved):
            self.assertLess(text.index("trim=end_frame"), text.index("scale="))
        screen, face = compile_wide.wide_windows(shot, "stack", 1920, 1080, [1500, 650, 300, 180], None)
        wide = compile_wide.wide_video_filter(shot, screen, face)
        self.assertTrue(wide.startswith("[0:v]setpts=PTS-STARTPTS" + grid + ",split=2[g][f];"), wide)
        self.assertTrue(wide.endswith(";[v]null[v2]"), wide)
        wide = compile_wide.wide_video_filter(dict(shot, g_in=40.0), screen, face)
        self.assertEqual(wide.count(grid), 2)

    def test_a_speed_outside_one_atempo_is_reached_in_steps(self):
        self.assertEqual(cutplan.tempo_chain(1.1), "atempo=1.1")
        self.assertEqual(cutplan.tempo_chain(0.5), "atempo=0.5")
        self.assertEqual(cutplan.tempo_chain(0.25), "atempo=0.5,atempo=0.5")
        self.assertEqual(cutplan.tempo_chain(0.3), "atempo=0.5,atempo=0.6")
        self.assertEqual(cutplan.tempo_chain(150), "atempo=100.0,atempo=1.5")
        for sp in (0.01, 0.07, 0.2, 0.49, 0.5, 0.9, 3, 100, 101, 5000):
            parts = [float(x.split("=")[1]) for x in cutplan.tempo_chain(sp).split(",")]
            self.assertTrue(all(0.5 <= x <= 100.0 for x in parts), (sp, parts))
            product = 1.0
            for x in parts:
                product *= x
            self.assertAlmostEqual(product, sp, places=9)
        a = cutplan.shot_audio_filter({"in": 0, "out": 0.2, "frames": 24, "speed": 0.25})
        self.assertIn(",atempo=0.5,atempo=0.5,aresample=48000,apad=whole_len=38400,", a)

    def test_a_shot_past_the_end_of_its_source_is_reported(self):
        shots = [{"src": "main", "in": 5.0, "out": 6.0}, {"src": "main", "in": 9.4, "out": 10.4},
                 {"src": "main", "in": 2.0, "out": 3.0, "g_in": 9.5},
                 {"src": "main", "in": 2.0, "out": 3.0, "a_in": 29.5, "a_src": "mic"},
                 {"src": "main", "in": 2.0, "out": 3.0, "a_in": 28.0, "a_src": "mic"}]
        got = cutplan.past_end(shots, {"main": 10.0, "mic": 30.0})
        self.assertEqual([(shots.index(r["shot"]), r["field"], r["key"], r["start"], r["end"], r["have"], r["nothing"])
                          for r in got],
                         [(1, "in", "main", 9.4, 10.4, 10.0, False), (2, "g_in", "main", 9.5, 10.5, 10.0, False),
                          (3, "a_in", "mic", 29.5, 30.5, 30.0, False)])
        self.assertEqual(cutplan.past_end(shots, {"main": None}), [])            # a length that cannot be read
        self.assertEqual(cutplan.past_end([{"src": "main", "in": 9.0, "out": 10.04}], {"main": 10.0}), [])
        for start in (10.0, 12.5, 9.97):                                         # nothing of the source is left to show
            got = cutplan.past_end([{"src": "main", "in": start, "out": start + 1}], {"main": 10.0})
            self.assertEqual([r["nothing"] for r in got], [True], start)
        got = cutplan.past_end([{"src": "main", "in": 2.0, "out": 3.0, "a_in": 31.0, "a_src": "mic"}], {"mic": 30.0})
        self.assertEqual([(r["key"], r["field"], r["nothing"]) for r in got], [("mic", "a_in", True)])
        both = cutplan.past_end([{"src": "main", "in": 9.5, "out": 10.5, "g_in": 9.8}], {"main": 10.0})
        self.assertEqual([r["field"] for r in both], ["in", "g_in"])             # each read is reported

    def test_a_shot_that_starts_past_its_source_stops_the_run(self):
        d = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, d, ignore_errors=True)
        src = os.path.join(d, "main.mp4")
        open(src, "w").close()
        fp = stand_in(d, "fp", "print('10.0')\n")
        sp = {"sources": {"main": src}}
        lines = cut_short.past_end_warnings(sp, [{"src": "main", "in": 9.5, "out": 10.5}], fp)
        self.assertEqual(len(lines), 1)
        self.assertIn("WARN the shot at 9.50-10.50 reads past the end of source 'main' (10.00 s)", lines[0])
        self.assertEqual(cut_short.past_end_warnings(sp, [{"src": "main", "in": 1.0, "out": 2.0}], fp), [])
        with self.assertRaises(cut_short.CutError) as cm:
            cut_short.past_end_warnings(sp, [{"src": "main", "in": 1.0, "out": 2.0}, {"src": "main", "in": 11.0, "out": 12.0}], fp)
        self.assertIn("the shot at 11.00-12.00 starts past the end of source 'main'", str(cm.exception))
        # A read that is not at "in" is named by its own field and range.
        lines = cut_short.past_end_warnings(sp, [{"src": "main", "in": 0.0, "out": 1.0, "g_in": 9.5}], fp)
        self.assertIn("WARN the shot at 0.00-1.00 (its \"g_in\", 9.50-10.50) reads past the end of source 'main'", lines[0])
        self.assertIn("Fix its \"g_in\" or its length", lines[0])
        with self.assertRaises(cut_short.CutError) as cm:
            cut_short.past_end_warnings(sp, [{"src": "main", "in": 0.0, "out": 1.0, "a_in": 30.0}], fp)
        self.assertIn("(its \"a_in\", 30.00-31.00) starts past the end", str(cm.exception))

    def test_a_shot_is_read_past_its_out(self):
        # The frames after the shot are read too, and cut off by the frame count.
        self.assertAlmostEqual(cutplan.read_length({"in": 7.0, "out": 7.033}), 0.533)
        self.assertGreaterEqual(cutplan.READ_MARGIN, 0.25)

    def test_a_span_over_a_day_long_is_a_typing_error(self):
        for seg in ({"in": 0.0, "out": 1e300}, {"in": 1.0, "out": 2.0, "speed": 1e-300},
                    {"in": 0.0, "out": 90000.0}, {"in": 0.0, "out": 1e308, "speed": 1e-300}):
            with self.assertRaises(cutplan.PlanError) as cm:
                expand_shots(spec(seg))
            self.assertIn("day", str(cm.exception), seg)
        self.assertEqual(sum(s["frames"] for s in expand_shots(spec({"in": 0.0, "out": 3600.0}))), 108000)

    def test_the_plan_printer_answers_a_broken_spec_in_one_line(self):
        d = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, d, ignore_errors=True)
        p = os.path.join(d, "spec.json")
        ok = {"src": "main", "segments": [{"in": 1.0, "out": 2.0}]}
        for bad in (dict(ok, shot=0), dict(ok, shot="x"), [1], dict(ok, segments=[5]),
                    dict(ok, segments=[{"in": "1", "out": 2.0}]), dict(ok, segments=5), {"src": "main"}):
            with open(p, "w") as f:
                json.dump(bad, f)
            err, old = io.StringIO(), sys.stderr
            sys.stderr = err
            try:
                code = cutplan.main([p])
            finally:
                sys.stderr = old
            self.assertEqual(code, 1, bad)
            self.assertTrue(err.getvalue().startswith("cutplan: "), bad)
            self.assertEqual(len(err.getvalue().strip().splitlines()), 1, bad)

    def test_sound_is_cut_to_the_frame_count(self):
        a = cutplan.shot_audio_filter({"in": 0, "out": 0.467, "frames": 14})
        self.assertTrue(a.endswith(",aresample=48000,apad=whole_len=22400,atrim=end_sample=22400[a2]"), a)
        a = cutplan.shot_audio_filter({"in": 0, "out": 2.2, "frames": 60, "speed": 1.1})
        self.assertIn("atempo=1.1,aresample=48000,apad=whole_len=96000,atrim=end_sample=96000[a2]", a)
        self.assertNotIn("apad", cutplan.shot_audio_filter({"in": 0, "out": 1}))
        self.assertEqual(cut_short.frame_limit({"frames": 14}), ["-frames:v", "14"])
        self.assertEqual(cut_short.frame_limit({"in": 0, "out": 1}), [])

    def test_a_hand_made_shot_list_keeps_its_own_lengths(self):
        shots = timeline([{"in": 0.0, "out": 1.1, "speed": 1.1}, {"in": 5.0, "out": 5.5}])
        self.assertEqual([(s["t0"], s["t1"]) for s in shots], [(0.0, 1.0), (1.0, 1.5)])
        self.assertIsNone(cut_frames(shots))
        self.assertIsNone(cut_frames([]))


class LabelsOnCuts(unittest.TestCase):
    CUTS = [0, 14, 43, 87, 130]

    def test_a_label_typed_early_starts_on_its_cut(self):
        self.assertEqual(snap_label(1.35, 1.4, self.CUTS), (43, 87))            # the cut is at 1.433
        self.assertEqual(snap_label(1.5, 1.4, self.CUTS), (43, 87))

    def test_a_label_covers_its_whole_shot(self):
        self.assertEqual(snap_label(1.433, 0.2, self.CUTS), (43, 87))           # typed shorter than the shot
        self.assertEqual(snap_label(1.433, 2.0, self.CUTS), (43, 87))
        self.assertEqual(snap_label(1.433, 2.3, self.CUTS), (43, 130))

    def test_edges(self):
        self.assertEqual(snap_label(0.0, 0.1, self.CUTS), (0, 14))
        self.assertEqual(snap_label(4.3, 5, self.CUTS), (87, 130))              # never starts at the end
        self.assertEqual(snap_label(0.0, 9999, self.CUTS), (0, 130))
        self.assertEqual(snap_label(0.5, 1, [0, 30]), (0, 30))
        self.assertEqual(snap_label(7 / 30.0, 0.01, [0, 14, 28]), (0, 14))      # a tie goes to the earlier cut

    def test_a_label_past_the_end_belongs_to_no_shot(self):
        self.assertIsNone(snap_label(99, 5, self.CUTS))
        self.assertIsNone(snap_label(130 / 30.0, 1, self.CUTS))
        self.assertEqual(snap_label(129 / 30.0, 1, self.CUTS), (87, 130))

    def test_a_label_needs_real_times(self):
        for at, dur in ((-3, 0.1), (0.5, 0), (0.5, -2.0), (float("nan"), 0.5), (0.5, float("nan")),
                        (float("inf"), 1), (0.5, float("inf")), (True, 1), ("0.5", 1), (0.5, None)):
            with self.assertRaises(cutplan.PlanError):
                snap_label(at, dur, self.CUTS)
        with self.assertRaises(cutplan.PlanError):
            snap_label(0.5, 1, [0])

    def test_cut_time_is_on_the_frame_never_on_the_one_before(self):
        for f in range(0, 9000):
            text = captions.cut_time(f)
            h, m, s = text.split(":")
            cs = int(round((int(h) * 3600 + int(m) * 60 + float(s)) * 100))
            shown_at = f * 1000 // 30                 # libass gets the frame time in whole milliseconds
            before = (f - 1) * 1000.0 / 30
            self.assertLessEqual(cs * 10, shown_at, f)
            if f:
                self.assertGreater(cs * 10, before, f)
        self.assertEqual(captions.cut_time(0), "0:00:00.00")
        self.assertEqual(captions.cut_time(3), "0:00:00.09")                    # 0.100 s: not 0.10
        self.assertEqual(captions.cut_time(14), "0:00:00.46")                   # 0.4667 s: 0.47 is a frame late
        self.assertEqual(captions.cut_time(30 * 3661), "1:01:00.99")

    def test_build_ass_puts_labels_on_cuts(self):
        sp = {"id": "a01-demo", "bar": "DEMO", "labels": [{"at": 1.35, "dur": 1.0, "text": "NEXT DAY"}]}
        shots = [{"in": 0, "out": 1, "frames": n} for n in (14, 29, 44, 43)]
        text = captions.build_ass(sp, [], shots=shots)
        line = [x for x in text.splitlines() if ",Label," in x][0]
        self.assertIn("Dialogue: 4,0:00:01.43,0:00:02.89,Label", line)          # frames 43 and 87
        typed = captions.build_ass(sp, [])
        self.assertIn("Dialogue: 4,0:00:01.35,0:00:02.35,Label", typed)
        old = captions.build_ass(sp, [], shots=[{"in": 0, "out": 1}])           # a shot list from before the grid
        self.assertIn("Dialogue: 4,0:00:01.35,0:00:02.35,Label", old)

    def test_translated_labels_sit_on_the_same_cuts(self):
        sp = {"id": "a01-demo", "bar": "DEMO", "labels": [{"at": 1.35, "dur": 1.0, "text": "NEXT DAY"}],
              "translations": {"es": {"bar": "DEMO", "labels": {"0": "AL DIA SIGUIENTE"}}}}
        shots = [{"in": 0, "out": 1, "frames": n} for n in (14, 29, 44, 43)]
        text = captions.build_ass(sp, [], lang="es", shots=shots)
        self.assertIn("Dialogue: 4,0:00:01.43,0:00:02.89,Label,,0,0,0,,{\\pos(476,850)}AL DIA SIGUIENTE", text)

    def test_label_report(self):
        sp = {"labels": [{"at": 1.35, "dur": 1.0, "text": "NEXT DAY"}]}
        shots = [{"in": 0, "out": 1, "frames": n} for n in (14, 29, 44, 43)]
        self.assertEqual(cut_short.label_report(sp, shots),
                         [{"text": "NEXT DAY", "at": 1.433, "end": 2.9, "typed_at": 1.35, "typed_end": 2.35,
                           "on_cuts": True, "shown": True}])
        self.assertFalse(cut_short.label_report(sp, [{"in": 0, "out": 1}])[0]["on_cuts"])
        self.assertEqual(cut_short.label_report({}, shots), [])

    def test_the_report_names_the_text_that_was_burned(self):
        sp = {"labels": [{"at": 0.1, "dur": 0.2, "text": "FIRST"}, {"at": 1.35, "dur": 1.0, "text": "NEXT DAY"}],
              "translations": {"es": {"bar": "DEMO", "labels": {"1": "AL DIA SIGUIENTE"}}}}
        shots = [{"in": 0, "out": 1, "frames": n} for n in (14, 29, 44, 43)]
        self.assertEqual([x["text"] for x in cut_short.label_report(sp, shots, "es")], ["FIRST", "AL DIA SIGUIENTE"])
        self.assertEqual([x["text"] for x in cut_short.label_report(sp, shots)], ["FIRST", "NEXT DAY"])

    def test_a_label_past_the_end_is_left_out_and_keeps_its_number(self):
        # A variant can be shorter than the cut the labels were typed for.
        sp = {"id": "a01-demo", "bar": "DEMO",
              "labels": [{"at": 9.0, "dur": 1.0, "text": "LATER"}, {"at": 0.5, "dur": 0.5, "text": "NOW"}],
              "translations": {"es": {"bar": "DEMO", "labels": {"1": "AHORA"}}}}
        shots = [{"in": 0, "out": 1, "frames": n} for n in (14, 29)]
        rep = cut_short.label_report(sp, shots)
        self.assertEqual([(x["text"], x["shown"], x["at"]) for x in rep], [("LATER", False, None), ("NOW", True, 0.467)])
        text = captions.build_ass(sp, [], shots=shots)
        self.assertNotIn("LATER", text)
        self.assertIn("NOW", text)
        self.assertIn("AHORA", captions.build_ass(sp, [], lang="es", shots=shots))      # still label 1

    def test_wide_moments_change_on_the_cut(self):
        text = compile_wide.build_wide_ass([(0.0, 0.467, "one"), (0.467, 3.0, "two")], [w("hi", 0.1, 0.3)])
        bars = [x for x in text.splitlines() if ",Bar," in x]
        self.assertIn("Dialogue: 5,0:00:00.00,0:00:00.46,Bar", bars[0])
        self.assertIn("Dialogue: 5,0:00:00.46,0:00:02.99,Bar", bars[1])


class Bed(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.d, ignore_errors=True)

    def load(self, bed):
        p = os.path.join(self.d, "spec.json")
        with open(p, "w") as f:
            json.dump({"id": "a01-demo", "sources": {"main": "src.mp4"}, "bar": "MY TEST SUITE WENT RED",
                       "segments": [{"in": 1.0, "out": 3.0}], "bed": bed}, f)
        return cut_short.load_spec(p)

    def test_bed_is_a_level_in_range(self):
        self.assertEqual(self.load(-55)["bed"], -55)
        self.assertEqual(self.load(-52.5)["bed"], -52.5)
        self.assertIsNone(self.load(None).get("bed"))
        for bad in (True, False, "-55", 0, -20, -39.9, -81, 55, [-55], float("nan"), float("-inf")):
            with self.assertRaises(cut_short.CutError) as cm:
                self.load(bad)
            self.assertIn("bed", str(cm.exception))

    def test_labels_are_checked_before_anything_is_rendered(self):
        def load(labels):
            p = os.path.join(self.d, "spec.json")
            with open(p, "w") as f:
                json.dump({"id": "a01-demo", "sources": {"main": "src.mp4"}, "bar": "MY TEST SUITE WENT RED",
                           "segments": [{"in": 1.0, "out": 3.0}], "labels": labels}, f)
            return cut_short.load_spec(p)
        ok = {"at": 0.5, "dur": 1.0, "text": "NEXT DAY"}
        self.assertEqual(load([ok, dict(ok, y=700)])["labels"][1]["y"], 700)
        self.assertEqual(load([])["labels"], [])
        for bad in ({"0": ok}, "NEXT DAY", ["NEXT DAY"], [dict(ok, at="0.5")], [dict(ok, at=-1)], [dict(ok, at=True)],
                    [dict(ok, at=float("nan"))], [dict(ok, dur=0)], [dict(ok, dur=-2.0)], [dict(ok, dur=float("inf"))],
                    [{"at": 0.5, "text": "X"}], [{"dur": 1, "text": "X"}], [dict(ok, text="")], [dict(ok, text="  ")],
                    [dict(ok, text=7)], [{"at": 0.5, "dur": 1.0}], [dict(ok, y="700")], [dict(ok, y=float("nan"))]):
            with self.assertRaises(cut_short.CutError) as cm:
                load(bad)
            self.assertIn("labels", str(cm.exception), bad)

    def test_max_shot_is_checked_in_the_spec(self):
        p = os.path.join(self.d, "spec.json")
        for bad in (0, -1, True, "1.45", float("nan")):
            with open(p, "w") as f:
                json.dump({"id": "a01-demo", "sources": {"main": "src.mp4"}, "bar": "MY TEST SUITE WENT RED",
                           "segments": [{"in": 1.0, "out": 3.0}], "shot": bad}, f)
            with self.assertRaises(cut_short.CutError) as cm:
                cut_short.load_spec(p)
            self.assertIn("shot", str(cm.exception))

    def test_a_base_cut_is_measured_in_frames(self):
        ff = stand_in(self.d, "fp", "import sys\nassert '-count_packets' in sys.argv\nprint('90')\n")
        self.assertEqual(cut_short.probe_duration(ff, "base.nut"), 3.0)
        ff = stand_in(self.d, "fp2", "print('N/A')\n")
        with self.assertRaises(cut_short.CutError):
            cut_short.probe_duration(ff, "base.nut")
        self.assertIn("-bf", cut_short.INTERMEDIATE)                              # no B-frames: the file starts at 0
        ff = stand_in(self.d, "fp3", "print('12.5')\n")
        self.assertEqual(cut_short.probe_length(ff, "src.mp4"), 12.5)
        self.assertIsNone(cut_short.probe_length(stand_in(self.d, "fp4", "print('N/A')\n"), "src.mp4"))
        self.assertIsNone(cut_short.probe_length(os.path.join(self.d, "missing"), "src.mp4"))

    def test_a_cut_too_short_to_measure_says_so(self):
        cut_short.check_measured({"input_i": "-23.10"}, 9.0)
        for bad in ("-inf", "inf", "-Inf"):
            with self.assertRaises(cut_short.CutError) as cm:
                cut_short.check_measured({"input_i": bad}, 0.13)
            self.assertIn("0.13 s", str(cm.exception))

    def test_no_bed_leaves_the_chain_as_it_was(self):
        self.assertEqual(cut_short.audio_args("ffmpeg-not-run", None, "CHAIN", "TAIL", 9.0, None),
                         ([], ["-af", "CHAIN,TAIL"]))

    def test_bed_is_measured_and_mixed_in_before_the_limiter(self):
        ff = stand_in(self.d, "ff", "import sys\nsys.stderr.write('[Parsed_volumedetect_0 @ 0x1] mean_volume: -20.5 dB\\n')\n")
        extra, audio = cut_short.audio_args(ff, -55, "CHAIN", "alimiter=limit=0.89,afade", 9.0, None)
        self.assertEqual(extra[:3], ["-f", "lavfi", "-i"])
        self.assertIn("duration=10.000", extra[3])
        self.assertIn("seed=7", extra[3])
        self.assertEqual(audio[0], "-filter_complex")
        self.assertEqual(audio[2:], ["-map", "0:v", "-map", "[a]"])
        fc = audio[1]
        self.assertIn("[1:a]volume=-34.50dB,", fc)                              # -55 - (-20.5)
        self.assertIn("amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.89,afade[a]", fc)
        self.assertTrue(fc.startswith("[0:a]CHAIN[m];"))

    def test_a_bed_that_cannot_be_measured_stops_the_run(self):
        ff = stand_in(self.d, "ff", "import sys\nsys.stderr.write('No such filter: anoisesrc\\n')\nsys.exit(1)\n")
        with self.assertRaises(cut_short.CutError):
            cut_short.audio_args(ff, -55, "CHAIN", "TAIL", 9.0, None)
        with self.assertRaises(cut_short.CutError):
            cut_short.audio_args(os.path.join(self.d, "missing"), -55, "CHAIN", "TAIL", 9.0, None)


class PausesAndRoomTone(unittest.TestCase):
    """Sound built to the rule passes the audio check; a gated pause does not."""
    RATE = 1000

    def clip(self, fill):
        rnd = random.Random(7)
        out = []
        for i in range(6):
            out += [int(3277 * math.sin(2 * math.pi * 50 * k / self.RATE)) for k in range(600)]     # -20 dBFS word
            if i < 5:
                out += [fill(rnd) for _ in range(350)]                                               # 0.35 s pause
        return audio_check.rms_windows(array.array("h", out), self.RATE)

    def test_a_bed_at_minus_55_fills_every_pause(self):
        level = 32768 * 10 ** (-55 / 20.0)
        rms = self.clip(lambda rnd: int(round(rnd.gauss(0, level))))
        self.assertEqual(audio_check.dropouts(rms), [])
        pause = rms[13:18]                                                      # inside the first pause
        self.assertTrue(all(-60 < x < -50 for x in pause), pause)

    def test_a_gated_pause_is_a_dropout(self):
        rms = self.clip(lambda rnd: 0)
        holes = audio_check.dropouts(rms)
        self.assertEqual(len(holes), 5)
        self.assertEqual(holes[0][:2], (0.6, 0.95))

    def test_pause_cap(self):
        def gaps(g):
            words = [{"word": "a", "start": 0.0, "end": 0.5}, {"word": "b", "start": round(0.5 + g, 3), "end": 1.5}]
            m = {"speech": audio_check.speech_stats(words), "gaps": audio_check.word_gaps(words), "dipped": []}
            return [lv for lv, t in audio_check.verdicts(m) if "pause" in t]
        self.assertEqual(audio_check.PAUSE_CHECK, 0.35)
        self.assertEqual(gaps(0.3), ["PASS"])
        self.assertEqual(gaps(0.35), ["PASS"])
        self.assertEqual(gaps(0.36), ["CHECK"])
        self.assertEqual(gaps(0.51), ["WARN"])
        self.assertLessEqual(cutplan.TIGHT["gap"], audio_check.PAUSE_CHECK)       # the cut's own pause passes


class CaptionDifferencesInTheSource(unittest.TestCase):
    SHOTS = [{"src": "main", "in": 100.0, "out": 101.0, "t0": 0.0, "t1": 1.0},
             {"src": "main", "in": 101.0, "out": 102.0, "t0": 1.0, "t1": 2.0},        # carries on: not an edit
             {"src": "main", "in": 250.0, "out": 251.1, "t0": 2.0, "t1": 3.0, "speed": 1.1},
             {"src": "main", "in": 300.0, "out": 301.0, "t0": 3.0, "t1": 4.0, "a_in": 900.0, "a_src": "mic"},
             {"src": "main", "in": 301.0, "out": 302.0, "t0": 4.0, "t1": 5.0, "a_in": 901.0, "a_src": "mic",
              "g_in": 40.0}]

    def test_edits_are_the_joins_where_the_sound_jumps(self):
        self.assertEqual(caption_check.edits(self.SHOTS), [2.0, 3.0, 4.0])
        self.assertEqual(caption_check.edits(self.SHOTS[:2]), [])
        other_mic = [{"src": "main", "in": 100.0, "out": 101.0, "t0": 0.0, "t1": 1.0},
                     {"src": "main", "in": 50.0, "out": 51.0, "t0": 1.0, "t1": 2.0, "a_in": 101.0, "a_src": "mic"}]
        self.assertEqual(caption_check.edits(other_mic), [1.0])                 # the same second of another recording

    def test_locate(self):
        self.assertEqual(caption_check.locate(self.SHOTS, 0.25), {"key": "main", "time": 100.25})
        self.assertEqual(caption_check.locate(self.SHOTS, 2.5), {"key": "main", "time": 250.55})     # 1.1x
        self.assertEqual(caption_check.locate(self.SHOTS, 3.5), {"key": "mic", "time": 900.5})
        self.assertEqual(caption_check.locate(self.SHOTS, 4.5), {"key": "main", "time": 301.5})      # g_in: sound at "in"
        self.assertEqual(caption_check.locate(self.SHOTS, 5.2), {"key": "main", "time": 302.2})      # past the end
        self.assertIsNone(caption_check.locate(self.SHOTS, -1))

    def test_differences_get_a_place_and_a_cut_mark(self):
        diffs = [{"kind": "replaced", "time": 0.3, "captions": "A", "spoken": "b", "check_by_ear": False},
                 {"kind": "replaced", "time": 1.6, "captions": "C", "spoken": "d", "check_by_ear": True},
                 {"kind": "replaced", "time": 1.4, "captions": "E", "spoken": "f", "check_by_ear": False}]
        caption_check.place_diffs(diffs, self.SHOTS)
        self.assertEqual([d["at_cut"] for d in diffs], [False, True, False])
        self.assertEqual(diffs[1]["source"], {"key": "main", "time": 101.6})
        line = caption_check.format_diff(diffs[1])
        self.assertIn("CHECK BY EAR  source main@101.60  AT A CUT", line)
        self.assertNotIn("AT A CUT", caption_check.format_diff(diffs[0]))

    def run_cli(self, args):
        out, old = io.StringIO(), sys.stdout
        err, old_err = io.StringIO(), sys.stderr
        sys.stdout, sys.stderr = out, err
        try:
            code = caption_check.main(args)
        finally:
            sys.stdout, sys.stderr = old, old_err
        return code, out.getvalue(), err.getvalue()

    def test_cli(self):
        d = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, d, ignore_errors=True)

        def put(name, data):
            p = os.path.join(d, name)
            with open(p, "w") as f:
                json.dump(data, f)
            return p
        words = "one two three four five six seven eight nine ten".split()
        cap = put("cap.json", [{"w": x, "s": i * 0.4, "e": i * 0.4 + 0.3} for i, x in enumerate(words)])
        ind = put("ind.json", [{"w": "free" if x == "three" else x, "s": i * 0.4, "e": i * 0.4 + 0.3}
                               for i, x in enumerate(words)])
        shots = put("shots.json", self.SHOTS)
        code, out, _ = self.run_cli([cap, ind, "--max-ratio", "0.5", "--shots", shots])
        self.assertEqual(code, 0)
        self.assertIn("source main@100.80", out)
        self.assertIn("a question, not a fix", out)
        code, out, _ = self.run_cli([cap, ind, "--max-ratio", "0.5", "--json"])
        self.assertIn("a question, not a fix", json.loads(out)["note"])
        self.assertNotIn("source", json.loads(out)["diffs"][0])
        code, out, _ = self.run_cli([cap, cap])
        self.assertEqual(code, 0)
        self.assertNotIn("question", out)                                        # nothing to ask about
        good = {"src": "main", "in": 5, "out": 6, "t0": 0, "t1": 4}
        for bad in ([], {"shots": 1}, [{"in": 1}], [{"in": "a", "out": 1, "t0": 0, "t1": 1}], ["shot"],
                    [dict(good, a_in="bad")], [dict(good, speed="1.1")], [dict(good, speed=0)],
                    [dict(good, speed=True)], [dict(good, g_in=[1])], [dict(good, src=None)],
                    [{k: v for k, v in good.items() if k != "src"}], [dict(good, a_src=7, a_in=1.0)],
                    [dict(good, t0=float("nan"))], [dict(good, out=float("inf"))], [dict(good, t1="4")]):
            code, out, err = self.run_cli([cap, ind, "--max-ratio", "0.5", "--shots", put("bad.json", bad)])
            self.assertEqual(code, 2, bad)
            self.assertIn("caption_check", err)
            self.assertEqual(out, "")


if __name__ == "__main__":
    unittest.main()
