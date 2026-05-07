"""Detect and silence transient beeps in master_tight_v4.mp4 → master_tight_v5.mp4.

A "beep" is a transient that:
- Is loud (energy > BEEP_ENERGY_MIN in any 5ms window)
- Sits in a quiet region (preceding 150ms RMS very low)
- Does NOT have sustained energy after it (i.e., not a speech onset)

Speech is preserved because consonant onsets are followed by sustained vowel energy.
"""
import wave, struct, math, json, subprocess
from pathlib import Path

W = Path('.work')
SRC = W / 'master_tight_v4.mp4'

# Decode whole audio to mono 16k WAV for analysis (smaller, faster)
analysis_wav = W / 'master_v4_mono16k.wav'
subprocess.run([
    'ffmpeg', '-hide_banner', '-loglevel', 'error', '-y',
    '-i', str(SRC), '-vn', '-ac', '1', '-ar', '16000',
    str(analysis_wav)
], check=True)

w = wave.open(str(analysis_wav), 'rb')
sr = w.getframerate()
nf = w.getnframes()
samples = struct.unpack(f'<{nf}h', w.readframes(nf))
w.close()

# 5ms windows
win_ms = 5
win = int(sr * win_ms / 1000)
n_win = len(samples) // win

# Compute RMS per window
rms = []
for i in range(n_win):
    chunk = samples[i*win:(i+1)*win]
    if not chunk:
        rms.append(0)
        continue
    sq = sum(s*s for s in chunk) / len(chunk)
    rms.append(math.sqrt(sq))

print(f"Analysed {len(rms)} windows of {win_ms}ms each ({len(rms)*win_ms/1000:.1f}s)")

# Beep detection: a transient with quiet on BOTH sides (genuine beep, not speech)
BEEP_RMS_MIN = 800         # window RMS must exceed this to be considered loud (lowered)
PRE_SILENCE_RMS_MAX = 200  # preceding 150ms must be quieter than this
POST_QUIET_RMS_MAX = 350   # following 200ms must also be quieter than this (i.e., transient returns to silence)
PRE_WINDOWS = 30   # 30 * 5ms = 150ms preceding
POST_WINDOWS = 40  # 40 * 5ms = 200ms following
MAX_BEEP_DUR = 0.30  # cap each silenced span — never mute longer than this

beeps = []
i = PRE_WINDOWS
while i < len(rms) - POST_WINDOWS:
    if rms[i] > BEEP_RMS_MIN:
        pre_avg = sum(rms[i-PRE_WINDOWS:i]) / PRE_WINDOWS
        post_avg = sum(rms[i+1:i+1+POST_WINDOWS]) / POST_WINDOWS
        # Beep iff loud AND surrounded by quiet
        if pre_avg < PRE_SILENCE_RMS_MAX and post_avg < POST_QUIET_RMS_MAX:
            # Determine extent (while elevated above quiet floor)
            j = i
            quiet_floor = max(pre_avg * 4, 200)
            max_j = i + int(MAX_BEEP_DUR / (win_ms/1000))
            while j < min(len(rms), max_j) and rms[j] > quiet_floor:
                j += 1
            t_start = i * win_ms / 1000
            t_end = j * win_ms / 1000
            beep_a = max(0, t_start - 0.020)
            beep_b = min(t_start + MAX_BEEP_DUR, t_end + 0.030)
            beeps.append((beep_a, beep_b, rms[i], pre_avg, post_avg))
            i = j + 5  # skip ahead a tiny bit
            continue
    i += 1

# Merge close beeps (<200ms apart)
merged = []
for b in beeps:
    if merged and b[0] <= merged[-1][1] + 0.20:
        merged[-1] = (merged[-1][0], max(merged[-1][1], b[1]),
                      merged[-1][2], merged[-1][3], merged[-1][4])
    else:
        merged.append(list(b))

print(f"\nFound {len(merged)} beep events to silence:")
for s, e, peak, pre, post in merged:
    m = int(s // 60); ss = s - m*60
    print(f"  cut {m}:{ss:06.3f} -> +{e-s:.3f}s  | peak={peak:.0f}  pre_avg={pre:.0f}  post_avg={post:.0f}")

(W/'beep_events.json').write_text(json.dumps(
    [{"start": round(b[0], 4), "end": round(b[1], 4)} for b in merged], indent=2
))

if not merged:
    print("\nNo beeps detected with current thresholds.")
else:
    # Build ffmpeg volume filter to silence each beep
    # volume=0:enable='between(t,a,b)+between(t,c,d)+...'
    enable = "+".join(f"between(t,{b[0]:.4f},{b[1]:.4f})" for b in merged)
    afilter = f"volume=enable='{enable}':volume=0,adeclick"
    print(f"\nffmpeg filter: ...volume=...:{len(merged)} ranges, +adeclick")

    # Render v5: copy video from v4, replace audio with scrubbed
    out = W / 'master_tight_v5.mp4'
    cmd = [
        'ffmpeg', '-hide_banner', '-loglevel', 'warning', '-y',
        '-i', str(SRC),
        '-c:v', 'copy',
        '-af', afilter,
        '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
        '-movflags', '+faststart',
        str(out)
    ]
    print("\nrunning ffmpeg...")
    r = subprocess.run(cmd)
    print(f"exit code: {r.returncode}")
