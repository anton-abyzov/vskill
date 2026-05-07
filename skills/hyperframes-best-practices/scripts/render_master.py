"""Render master_tight_v4.mp4 from v4 cut list using concat filter (no concat-demux clicks)
Audio: adeclick filter for tick removal + 0.4s start fade-in + 0.5s end fade-out.
"""
import json, subprocess, sys
from pathlib import Path

W = Path('.work')
SRC = "<SOURCE>"

cuts = json.load(open(W/'cuts_v4.json'))
keep = cuts['keep']
total_out = cuts['summary']['total_out']

# Build filter_complex: trim+atrim each segment, then concat
parts = []
labels_v = []
labels_a = []
for i, (s, e) in enumerate(keep):
    parts.append(f"[0:v]trim=start={s:.4f}:end={e:.4f},setpts=PTS-STARTPTS[v{i}]")
    parts.append(f"[0:a]atrim=start={s:.4f}:end={e:.4f},asetpts=PTS-STARTPTS[a{i}]")
    labels_v.append(f"[v{i}]")
    labels_a.append(f"[a{i}]")

# Interleave [v0][a0][v1][a1]... for concat=v=1:a=1
inter = "".join(v + a for v, a in zip(labels_v, labels_a))
parts.append(f"{inter}concat=n={len(keep)}:v=1:a=1[vc][ac0]")
# Audio post: declick + start fade-in (kills OBS tick) + end fade-out
parts.append(f"[ac0]adeclick,afade=t=in:st=0:d=0.4,afade=t=out:st={total_out-0.5:.2f}:d=0.5[ac]")

filter_complex = ";".join(parts)
(W/'filter_complex.txt').write_text(filter_complex)
print(f"filter_complex: {len(filter_complex)} chars, {len(keep)} segments")

cmd = [
    "ffmpeg", "-hide_banner", "-y", "-loglevel", "warning",
    "-i", SRC,
    "-filter_complex_script", str(W/'filter_complex.txt'),
    "-map", "[vc]", "-map", "[ac]",
    "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
    "-movflags", "+faststart",
    str(W/'master_tight_v4.mp4'),
]
print("running ffmpeg...")
r = subprocess.run(cmd)
sys.exit(r.returncode)
