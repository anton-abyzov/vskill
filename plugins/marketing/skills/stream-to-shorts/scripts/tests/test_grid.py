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
        for bad in (0, -1, True, "2", None):
            with self.assertRaises(cutplan.PlanError):
                expand_shots(spec({"in": 1.0, "out": 2.0, "speed": bad}))

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
        self.assertEqual(snap_label(-3, 0.1, self.CUTS), (0, 14))
        self.assertEqual(snap_label(99, 5, self.CUTS), (87, 130))               # never starts at the end
        self.assertEqual(snap_label(0.0, 9999, self.CUTS), (0, 130))
        self.assertEqual(snap_label(0.5, 1, [0, 30]), (0, 30))
        self.assertEqual(snap_label(7 / 30.0, 0, [0, 14, 28]), (0, 14))         # a tie goes to the earlier cut

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
                           "on_cuts": True}])
        self.assertFalse(cut_short.label_report(sp, [{"in": 0, "out": 1}])[0]["on_cuts"])
        self.assertEqual(cut_short.label_report({}, shots), [])

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
        for bad in ([], {"shots": 1}, [{"in": 1}], [{"in": "a", "out": 1, "t0": 0, "t1": 1}]):
            code, _, err = self.run_cli([cap, ind, "--shots", put("bad.json", bad)])
            self.assertEqual(code, 2, bad)
            self.assertIn("caption_check", err)


if __name__ == "__main__":
    unittest.main()
