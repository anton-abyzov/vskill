import os, sys; sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import io
import shutil
import subprocess
import tempfile
import unittest
from contextlib import redirect_stdout

import export

PRESETS = export.load_presets()


def opt(cmd, flag):
    return cmd[cmd.index(flag) + 1]


class BitrateTest(unittest.TestCase):
    def test_sheet_example_p5_75s(self):
        # 48 x 8000 / 75 = 5120, minus 128 = 4992, minus 5% = 4742.4 kbps
        self.assertAlmostEqual(export.capped_kbps(75, 48, 128, 0.05), 4742.4, places=1)

    def test_p5_60s_and_120s(self):
        self.assertAlmostEqual(export.capped_kbps(60, 48, 128) / 1000, 5.96, places=2)
        self.assertLess(export.capped_kbps(120, 48, 128), 3000)

    def test_p6_30s(self):
        self.assertAlmostEqual(export.capped_kbps(30, 9.5, 96), 2315.47, places=1)  # about 2.3 Mbps

    def test_does_not_fit(self):
        with self.assertRaises(ValueError):
            export.capped_kbps(4000, 9.5, 96)
        with self.assertRaises(ValueError):
            export.capped_kbps(0, 48, 128)

    def test_presets_have_basis(self):
        for pid in ("P1", "P2", "P3", "P4", "P5", "P6", "C1"):
            self.assertIn(pid, PRESETS)
            self.assertIn("2026", PRESETS[pid]["basis"], pid)


class BuildCommandTest(unittest.TestCase):
    def test_p1_60fps(self):
        [cmd] = export.build_command(PRESETS["P1"], "m.mp4", "o.mp4", 40, 60)
        self.assertEqual(opt(cmd, "-b:v"), "10M")
        self.assertEqual(opt(cmd, "-maxrate"), "16M")
        self.assertEqual(opt(cmd, "-g"), "120")
        self.assertEqual(opt(cmd, "-level"), "4.2")
        self.assertEqual(opt(cmd, "-b:a"), "256k")
        self.assertNotIn("fps=", opt(cmd, "-vf"))
        self.assertIn("+faststart", cmd)
        joined = " ".join(cmd)
        self.assertNotIn("loudnorm", joined)
        self.assertNotIn("drawtext", joined)
        self.assertNotIn("overlay", joined)

    def test_p1_30fps(self):
        [cmd] = export.build_command(PRESETS["P1"], "m.mp4", "o.mp4", 40, 30)
        self.assertEqual(opt(cmd, "-b:v"), "8M")
        self.assertEqual(opt(cmd, "-g"), "60")

    def test_p1_too_long(self):
        with self.assertRaises(ValueError):
            export.build_command(PRESETS["P1"], "m.mp4", "o.mp4", 200, 30)

    def test_p2_forces_30(self):
        [cmd] = export.build_command(PRESETS["P2"], "m.mp4", "o.mp4", 40, 60)
        self.assertIn("scale=720:1280", opt(cmd, "-vf"))
        self.assertIn("fps=30", opt(cmd, "-vf"))
        self.assertEqual(opt(cmd, "-b:v"), "5M")

    def test_p3_crop_default_and_given(self):
        [cmd] = export.build_command(PRESETS["P3"], "m.mp4", "o.mp4", 40, 30)
        vf = opt(cmd, "-vf")
        self.assertIn("crop=1080:1350:0:93", vf)
        self.assertNotIn("pad", vf)
        [cmd] = export.build_command(PRESETS["P3"], "m.mp4", "o.mp4", 40, 30, crop_y=900)
        self.assertIn("crop=1080:1350:0:570", opt(cmd, "-vf"))  # clamped to the frame
        [cmd] = export.build_command(PRESETS["P3"], "m.mp4", "o.mp4", 40, 30, crop_y=200)
        self.assertIn("crop=1080:1350:0:200", opt(cmd, "-vf"))

    def test_p4(self):
        [cmd] = export.build_command(PRESETS["P4"], "w.mp4", "o.mp4", 900, 60)
        self.assertIn("scale=1920:1080", opt(cmd, "-vf"))
        self.assertEqual(opt(cmd, "-b:v"), "12M")
        self.assertEqual(opt(cmd, "-b:a"), "384k")

    def test_p5_two_pass(self):
        p1, p2 = export.build_command(PRESETS["P5"], "m.mp4", "out/m.P5.mp4", 75, 60)
        self.assertEqual(opt(p1, "-pass"), "1")
        self.assertEqual(opt(p2, "-pass"), "2")
        self.assertEqual(opt(p1, "-b:v"), "4742k")
        self.assertEqual(opt(p2, "-b:v"), "4742k")
        self.assertIn("-an", p1)
        self.assertEqual(p1[-1], os.devnull)
        self.assertIn("scale=1080:1920", opt(p2, "-vf"))
        self.assertIn("fps=30", opt(p2, "-vf"))
        self.assertEqual(opt(p2, "-g"), "60")
        self.assertEqual(opt(p2, "-b:a"), "128k")

    def test_p5_drops_to_720(self):
        _, p2 = export.build_command(PRESETS["P5"], "m.mp4", "o.mp4", 120, 30)
        self.assertIn("scale=720:1280", opt(p2, "-vf"))
        self.assertNotIn("fps=", opt(p2, "-vf"))

    def test_short_clip_held_at_max_kbps(self):
        _, p2 = export.build_command(PRESETS["P5"], "m.mp4", "o.mp4", 19, 30)
        self.assertEqual(opt(p2, "-b:v"), "8000k")
        _, p2 = export.build_command(PRESETS["P6"], "m.mp4", "o.mp4", 10, 30)
        self.assertEqual(opt(p2, "-b:v"), "5000k")

    def test_fps_source_keeps_60(self):
        [cmd] = export.build_command(PRESETS["P2"], "m.mp4", "o.mp4", 40, 60, keep_source_fps=True)
        self.assertNotIn("fps=", opt(cmd, "-vf"))
        self.assertEqual(opt(cmd, "-g"), "120")
        buf = io.StringIO()
        with redirect_stdout(buf):
            code = export.main(["a01-demo.mp4", "--preset", "P2", "--out", "out", "--fps-source",
                                "--duration", "20", "--fps", "60", "--dry-run"])
        self.assertEqual(code, 0)
        self.assertIn("-g 120", buf.getvalue())

    def test_p6_trims_to_30(self):
        p1, p2 = export.build_command(PRESETS["P6"], "m.mp4", "o.mp4", 55, 60)
        self.assertEqual(opt(p2, "-t"), "30")
        self.assertEqual(opt(p2, "-b:v"), "%dk" % int(export.capped_kbps(30, 9.5, 96)))
        self.assertEqual(opt(p2, "-b:a"), "96k")

    def test_c1(self):
        [cmd] = export.build_command(PRESETS["C1"], "m.mp4", "o.jpg", 40, 30, cover_time=2.5)
        self.assertEqual(opt(cmd, "-ss"), "2.5")
        self.assertEqual(opt(cmd, "-frames:v"), "1")
        self.assertIn("scale=1080:1920", opt(cmd, "-vf"))

    def test_aspect_problem(self):
        self.assertIsNone(export.aspect_problem(PRESETS["P1"], 1080, 1920))
        self.assertIsNone(export.aspect_problem(PRESETS["P4"], 1920, 1080))
        self.assertIn("never letterbox", export.aspect_problem(PRESETS["P4"], 1080, 1920))

    def test_dry_run_cli(self):
        buf = io.StringIO()
        with redirect_stdout(buf):
            code = export.main(["a01-demo.mp4", "--preset", "p5", "--out", "out",
                                "--duration", "75", "--fps", "30", "--dry-run"])
        self.assertEqual(code, 0)
        lines = buf.getvalue().strip().splitlines()
        self.assertEqual(len(lines), 2)
        self.assertIn("-b:v 4742k", lines[1])
        self.assertIn("a01-demo.P5.mp4", lines[1])


FFMPEG = os.environ.get("STS_FFMPEG") or shutil.which("ffmpeg")
FFPROBE = os.environ.get("STS_FFPROBE") or shutil.which("ffprobe")


@unittest.skipUnless(FFMPEG and FFPROBE, "ffmpeg and ffprobe not found")
class RenderSmokeTest(unittest.TestCase):
    def test_p6_render_under_cap(self):
        with tempfile.TemporaryDirectory() as d:
            src = os.path.join(d, "a01-demo.mp4")
            gen = [FFMPEG, "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=1080x1920:r=30:d=3",
                   "-f", "lavfi", "-i", "sine=f=440:d=3", "-shortest",
                   "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", src]
            if subprocess.run(gen).returncode != 0:
                self.skipTest("ffmpeg could not make a test source")
            with redirect_stdout(io.StringIO()):
                code = export.main([src, "--preset", "P6", "--out", d,
                                    "--ffmpeg", FFMPEG, "--ffprobe", FFPROBE])
            self.assertEqual(code, 0)
            out = os.path.join(d, "a01-demo.P6.mp4")
            self.assertLess(os.path.getsize(out), 10 * 1000 * 1000)
            self.assertFalse([f for f in os.listdir(d) if "2pass" in f])


if __name__ == "__main__":
    unittest.main()
