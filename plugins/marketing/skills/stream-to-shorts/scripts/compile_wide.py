#!/usr/bin/env python3
"""16:9 "best moments" compilation from the same cut specs as the vertical shorts.

    compile_wide.py <out-id> <title> spec1.json [spec2.json ...] --out DIR
                    [--lang es] [--words words.json] [--transcribe-cmd CMD]
                    [--ffmpeg PATH] [--ffprobe PATH] [--fontconfig FILE]

Layout on a 1920x1080 canvas: the screen or game window fills x 0..1400 edge to
edge, the face sits in a 520x520 square at the top right, and each moment's
title bar text and its number ("2 / 5") sit in the white panel under the face.
Word captions run along the bottom of the screen area. Each spec is cut with
its main segments (no variant), so only windows already checked in the
vertical clips are shown. The windows are wider than the vertical ones: look
at the result before using it.

Optional spec key "facecam_frame": [x, y, w, h] is the stream's own facecam
overlay. When set, the screen window is moved off it and the face square is
taken from inside it.

Writes DIR/<out-id>.mp4, marks.json (start, end, title per moment),
words.json, cap.ass and metrics.json. <title> is stored as the file's title
metadata. Exit 0 on success, 1 with a one-line reason on failure.
"""
import argparse
import json
import os
import subprocess
import sys
import textwrap

import captions
import cut_short
import cutplan
from cut_short import CutError

WIDE = {
    "width": 1920, "height": 1080,
    "screen_w": 1400,          # screen area x 0..1400
    "panel_w": 520,            # right column: face square 520x520, title panel below
    "bar_y": 750,              # moment title centre (panel_w + 230)
    "num_y": 990,              # moment number centre (panel_w + 470)
    "cap_y": 1000,             # captions centre (height - 80)
    "bar_wrap": 16,
    "frame_margin": 4,         # gap kept between the screen window and the facecam overlay
}


def wide_windows(shot, layout_name, src_w, src_h, facecam, frame=None, layout=cutplan.DEFAULT_LAYOUT, wide=WIDE):
    """Source windows for one shot of the wide layout.

    Returns ((x, y, w, h) screen window, (x, y, size) face square).
    """
    SW, OH = wide["screen_w"], wide["height"]
    lay = shot.get("layout", layout_name)
    z = shot.get("z", 1.0)
    if lay == "full":
        c = shot.get("crop") or cutplan.full_default_crop(src_w, src_h)
        x, y, w, h = cutplan.cover(c, SW, OH, z, OH / layout["max_zoom"], shot.get("focus"), src_w, src_h)
    else:
        st = layout["stack"]
        c = shot.get("win") or shot.get("crop") or cutplan.screen_default_crop(src_w, src_h, layout)
        x3, y3, w3, h3 = cutplan.cover(c, layout["width"], st["screen_h"], z,
                                       st["screen_h"] / shot.get("max_zoom", layout["max_zoom"]),
                                       shot.get("focus"), src_w, src_h)
        h = h3
        w = int(min(src_w, h * SW / float(OH)) / 2) * 2
        y = y3
        x = int(min(max(0, x3 + w3 / 2 - w / 2), src_w - w))
        if frame:
            edge = frame[0] - wide["frame_margin"]
            if x3 + w3 <= edge and x + w > edge and y + h > frame[1]:
                x = max(0, edge - w)            # keep the stream's own facecam overlay out
    f = shot.get("face") or facecam
    if not f:
        raise cutplan.PlanError("the wide layout needs a facecam box: set spec \"facecam\": [x, y, w, h]")
    if frame and frame[0] <= f[0] and f[0] + f[2] <= frame[0] + frame[2]:
        fs = min(frame[2], frame[3])
        fx = int(min(max(frame[0], f[0] + f[2] / 2 - fs / 2), frame[0] + frame[2] - fs))
        fy = int(min(max(frame[1], f[1] + f[3] / 2 - fs / 2), frame[1] + frame[3] - fs))
    else:
        fs = int(min(max(f[2], f[3]), src_w, src_h) / 2) * 2
        fx = int(min(max(0, f[0] + f[2] / 2 - fs / 2), src_w - fs))
        fy = int(min(max(0, f[1] + f[3] / 2 - fs / 2), src_h - fs))
    return (x, y, w, h), (fx, fy, fs)


def wide_video_filter(shot, screen, face, wide=WIDE):
    x, y, w, h = screen
    fx, fy, fs = face
    SW, OW, OH, PW = wide["screen_w"], wide["width"], wide["height"], wide["panel_w"]
    gin = "g_in" in shot
    grid = cutplan.shot_grid(shot)      # before crop and scale: see cutplan.shot_grid
    return ((("[1:v]setpts=PTS-STARTPTS%s[g]" if gin else "[0:v]setpts=PTS-STARTPTS%s,split=2[g][f]") % grid) + ";"
            + "[g]crop=%d:%d:%d:%d,scale=%d:%d:flags=lanczos,pad=%d:%d:0:0:white[t];" % (w, h, x, y, SW, OH, OW, OH)
            + (("[0:v]setpts=PTS-STARTPTS%s," % grid) if gin else "[f]")
            + "crop=%d:%d:%d:%d,scale=%d:%d:flags=lanczos[ff];" % (fs, fs, fx, fy, PW, PW)
            + "[t][ff]overlay=%d:0,setsar=1[v]" % SW
            + cutplan.SHOT_VIDEO_OUT)


def build_wide_ass(marks, words, mark_specs=None, lang=None, wide=WIDE):
    """ASS for the compilation. marks: [(t0, t1, bar)]. With lang, each moment's
    translated bar and caps (offset to the moment's start) replace the words.
    A moment's bar and number change on the frame of the cut between moments."""
    OW, OH, SW, PW = wide["width"], wide["height"], wide["screen_w"], wide["panel_w"]
    font = (mark_specs[0].get("font") if mark_specs else None) or captions.DEFAULT_FONT
    head = """[Script Info]
ScriptType: v4.00+
PlayResX: {OW}
PlayResY: {OH}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,{F},54,&H00FFFFFF,&H00FFFFFF,&H00000000,&H96000000,0,0,0,0,100,100,0,0,1,5,2,5,40,40,0,1
Style: Bar,{F},44,&H00000000,&H00000000,&H00FFFFFF,&H00FFFFFF,0,0,0,0,100,100,0,0,3,14,0,5,20,20,0,1
Style: Num,{F},30,&H00FFFFFF,&H00FFFFFF,&H001E1EE6,&H001E1EE6,0,0,0,0,100,100,0,0,3,10,0,5,20,20,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
""".format(OW=OW, OH=OH, F=font)
    A = captions.ass_time

    def C(t):   # a moment starts and ends on a cut
        return captions.cut_time(int(round(t * cutplan.FPS)))
    ev = []
    for i, (a, b, bar) in enumerate(marks):
        if lang and mark_specs:
            bar = captions.translation(mark_specs[i], lang).get("bar", bar).replace("\n", " ")
        ev.append("Dialogue: 5,%s,%s,Bar,,0,0,0,,{\\pos(%d,%d)}" % (C(a), C(b), SW + PW // 2, wide["bar_y"])
                  + "\\N".join(captions.ass_text(x) for x in textwrap.wrap(bar.upper(), wide["bar_wrap"])))
        ev.append("Dialogue: 5,%s,%s,Num,,0,0,0,,{\\pos(%d,%d)}%d / %d" % (C(a), C(b), SW + PW // 2, wide["num_y"], i + 1, len(marks)))
    if lang and mark_specs:
        for (a, b, _), spec in zip(marks, mark_specs):
            for t0, t1, txt in captions.translation(spec, lang).get("caps", []):
                ev.append("Dialogue: 3,%s,%s,Cap,,0,0,0,,{\\pos(%d,%d)}" % (A(a + t0), A(min(b, a + t1)), SW // 2, wide["cap_y"])
                          + "\\N".join(captions.ass_text(x) for x in textwrap.wrap(txt, 40)))
        return head + "\n".join(ev) + "\n"
    chunks = captions.chunk_words(words, max_words=4, max_chars=None)
    for ci, ch in enumerate(chunks):
        nxt = chunks[ci + 1][0]["s"] if ci + 1 < len(chunks) else 1e9
        ev.append("Dialogue: 3,%s,%s,Cap,,0,0,0,,{\\pos(%d,%d)}" % (A(ch[0]["s"]), A(min(ch[-1]["e"] + 0.3, nxt)), SW // 2, wide["cap_y"])
                  + " ".join(captions.ass_text(captions.caption_word(x["w"])) for x in ch))
    return head + "\n".join(ev) + "\n"


def fix_by_moment(words, marks, specs):
    """Apply each spec's "fix" map to the words inside its moment."""
    out = []
    for w in words:
        for (a, b, _), spec in zip(marks, specs):
            if a <= w["s"] < b:
                out.extend(captions.apply_fixes([w], spec.get("fix", {})))
                break
        else:
            out.append(w)
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description="16:9 compilation from cut specs.",
                                 formatter_class=argparse.RawDescriptionHelpFormatter, epilog=__doc__)
    ap.add_argument("out_id")
    ap.add_argument("title")
    ap.add_argument("specs", nargs="+")
    ap.add_argument("--out", required=True)
    ap.add_argument("--lang")
    ap.add_argument("--words", help="caption words in compilation time")
    ap.add_argument("--transcribe-cmd")
    ap.add_argument("--ffmpeg")
    ap.add_argument("--ffprobe")
    ap.add_argument("--fontconfig")
    args = ap.parse_args(argv)
    ff, fp = cut_short.tool_paths(args)
    env = dict(os.environ)
    if args.fontconfig:
        env["FONTCONFIG_FILE"] = os.path.abspath(args.fontconfig)
    od = os.path.abspath(args.out)
    try:
        os.makedirs(od, exist_ok=True)
        specs = [cut_short.load_spec(p) for p in args.specs]
        if args.lang:
            for s in specs:
                captions.translation(s, args.lang)
        cut_short.preflight_ass(ff, env)
        parts, marks, mapped, t = [], [], [], 0.0
        mapped_ok = True
        beds = [s["bed"] for s in specs if s.get("bed") is not None]
        for spec in specs:
            transcripts = cut_short.Transcripts(spec)
            shots = cut_short.plan_shots(spec, None, transcripts)
            t0 = t
            sizes = {}
            for line in cut_short.past_end_warnings(spec, shots, fp):
                print(line)
            for s in shots:
                src = spec["sources"][s["src"]]
                if s["src"] not in sizes:
                    if not os.path.exists(src):
                        raise CutError("source %r not found: %s" % (s["src"], src))
                    sizes[s["src"]] = cut_short.probe_size(fp, src)
                sw, sh = sizes[s["src"]]
                d = s["out"] - s["in"]
                screen, face = wide_windows(s, spec.get("layout", "stack"), sw, sh, spec.get("facecam"), spec.get("facecam_frame"))
                g = wide_video_filter(s, screen, face)
                af = cutplan.shot_audio_filter(s)
                ain = []
                if "g_in" in s:
                    ain = ["-ss", "%.3f" % s["g_in"], "-t", "%.3f" % cutplan.read_length(s), "-i", src]
                elif "a_in" in s:
                    ain = ["-ss", "%.3f" % s["a_in"], "-t", "%.3f" % cutplan.read_length(s), "-i", spec["sources"][s.get("a_src", s["src"])]]
                p = os.path.join(od, "p%03d.nut" % len(parts))
                cut_short.run([ff, "-v", "error", "-y", "-ss", "%.3f" % s["in"], "-t", "%.3f" % cutplan.read_length(s), "-i", src] + ain
                              + ["-filter_complex", g + ";" + af, "-map", "[v2]", "-map", "[a2]", "-r", str(cutplan.FPS)]
                              + cut_short.frame_limit(s) + cut_short.INTERMEDIATE
                              + ["-crf", "14", "-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2", "-f", "nut", p],
                              "ffmpeg part %d" % len(parts), env=env)
                parts.append(p)
                t += s["frames"] / float(cutplan.FPS) if "frames" in s else d / s.get("speed", 1.0)
            marks.append((round(t0, 3), round(t, 3), spec["bar"].replace("\n", " ")))
            keys = set(cutplan.audio_source(s)[0] for s in shots)
            if all(transcripts.has(k) for k in keys):
                for w in cutplan.map_words({k: transcripts.words(k) for k in keys}, shots):
                    mapped.append(dict(w, s=round(w["s"] + t0, 2), e=round(w["e"] + t0, 2)))
            else:
                mapped_ok = False
        if not parts:
            raise CutError("the specs give no shots")
        base = os.path.join(od, "base.nut")
        ins = []
        for p in parts:
            ins += ["-i", p]
        cut_short.run([ff, "-v", "error", "-y"] + ins
                      + ["-filter_complex", "".join("[%d:v][%d:a]" % (i, i) for i in range(len(parts))) + "concat=n=%d:v=1:a=1[v][a]" % len(parts),
                         "-map", "[v]", "-map", "[a]"] + cut_short.INTERMEDIATE
                      + ["-crf", "14", "-c:a", "pcm_s16le", "-f", "nut", base], "ffmpeg concat", env=env)
        for p in parts:
            os.remove(p)
        words, how = None, None
        if args.words:
            words, how = captions.load_words(args.words), "words-file"
        else:
            template = args.transcribe_cmd or os.environ.get("STS_TRANSCRIBE") or cut_short.default_transcribe_cmd()
            if template and template.strip().lower() not in ("off", "none", "no"):
                wav = os.path.join(od, "base.wav")
                cut_short.run([ff, "-v", "error", "-y", "-i", base, "-ac", "1", "-ar", "16000", wav], "ffmpeg audio", env=env)
                try:
                    words = cut_short.transcribe(template, wav, od, "transcript", specs[0].get("language", "en"))
                    words = fix_by_moment(words, marks, specs)
                    how = "transcribed"
                except CutError as e:
                    print("WARN %s; using the source transcripts instead" % e)
                finally:
                    if os.path.exists(wav):
                        os.remove(wav)
            if words is None:
                if not mapped_ok:
                    raise CutError("no caption words: pass --words, a working --transcribe-cmd, or \"transcripts\" in every spec")
                words, how = fix_by_moment(mapped, marks, specs), "source-transcript"
        with open(os.path.join(od, "words.json"), "w") as f:
            json.dump(words, f)
        with open(os.path.join(od, "marks.json"), "w") as f:
            json.dump(marks, f)
        with open(os.path.join(od, "cap.ass"), "w") as f:
            f.write(build_wide_ass(marks, words, specs, args.lang))
        dur = cut_short.probe_duration(fp, base)
        out_name = "%s.mp4" % args.out_id
        pre = "highpass=f=70,afftdn=nr=8:nf=-45"
        m = subprocess.run([ff, "-hide_banner", "-nostats", "-i", base, "-af", pre + ",loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json",
                            "-f", "null", "-"], capture_output=True, text=True, env=env, errors="replace").stderr
        try:
            j = json.loads(m[m.rfind("{"):m.rfind("}") + 1])
        except ValueError:
            raise CutError("loudnorm first pass gave no measurement")
        cut_short.check_measured(j, dur)
        ln = ("loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=%s:measured_TP=%s:measured_LRA=%s:measured_thresh=%s:offset=%s:linear=false"
              % (j["input_i"], j["input_tp"], j["input_lra"], j["input_thresh"], j["target_offset"]))
        # The compilation gets a room-tone bed when one of its specs asks for one.
        extra, audio = cut_short.audio_args(ff, max(beds) if beds else None, "%s,%s" % (pre, ln),
                                            "alimiter=limit=0.89:level=false,afade=t=out:st=%.2f:d=0.1" % max(0.0, dur - 0.1),
                                            dur, env)
        cut_short.run([ff, "-v", "error", "-y", "-i", "base.nut"] + extra + ["-vf", "ass=cap.ass"] + audio
                      + ["-c:v", "libx264", "-profile:v", "high", "-crf", "18", "-preset", "slow", "-pix_fmt", "yuv420p",
                       "-r", "30", "-g", "60", "-c:a", "aac", "-b:a", "256k", "-ar", "48000",
                       "-metadata", "title=%s" % args.title, "-movflags", "+faststart", out_name],
                      "ffmpeg finish", cwd=od, env=env)
        out = os.path.join(od, out_name)
        met = {"file": out_name, "duration_s": round(dur, 1), "moments": len(marks), "shots": len(parts),
               "words": len(words), "words_source": how, "loudness": cut_short.loudness(ff, out, env),
               "size_mb": round(os.path.getsize(out) / 1e6, 1), "marks": marks}
        with open(os.path.join(od, "metrics.json"), "w") as f:
            json.dump(met, f, indent=1)
        print(json.dumps(met))
    except (CutError, cutplan.PlanError, ValueError, KeyError, OSError) as e:
        print("compile_wide: %s" % e, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
