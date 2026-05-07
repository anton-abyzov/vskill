---
version: "1.0.0"
name: hyperframes-best-practices
description: "Production-grade HyperFrames workflow for turning a raw screencast or talking-head recording into a polished product video. Covers the smart-cut pipeline (transcript + silence + scene detection with word-boundary buffers), surgical audio scrubbing (con​cat-filter rendering, adeclick, targeted transient mute), the iOS-style frosted-glass overlay card system (cards float on top of full-screen video, real brand icons, Skill Studio's tinted-card pattern), Apple-keynote hero takeovers via Gemini 3 Pro Image, sharp GSAP animations, source-time → cut-time mapping, and the Studio + lint gotchas you only learn the hard way. Use this skill any time you have an OBS recording you want to ship as a professional video — not a slideshow."
metadata:
  tags: hyperframes, video, screencast, ffmpeg, whisper, smart-cuts, audio-scrubbing, beeps, overlays, brand-icons, gsap, animation, gemini-image, ios-card, frosted-glass
---

# /hyperframes-best-practices

Use this skill any time you are turning a raw screencast, talking-head recording, or OBS export into a polished HyperFrames product video. It bundles **two layers** of knowledge:

1. **HyperFrames fundamentals** — the upstream rule files maintained by HeyGen at `github.com/heygen-com/hyperframes` (composition authoring, GSAP timelines, `data-*` attributes, the dev-loop CLI). Install via `npx vskill i heygen-com/hyperframes`.
2. **Production-craft rules** — lessons captured from a long iteration cycle building a real SpecWeave product video from a single 8:47 OBS recording. These are the rules that, when followed, produce a video the user can actually ship — and, when broken, leave you with beeps, mid-word clips, blank takeover scenes, and overlays that block the speaker's face cam.

Read both layers before authoring.

---

## Scope and applicability

> **The Layer 2 craft rules below were derived from one specific project: turning an 8:47 SpecWeave intro recording (Anton Abyzov, OBS capture, talking-head + screen-share, May 2026) into a 6:00 production-ready promo video.** They reflect the look-and-feel of *that* product — Studio's tinted-card aesthetic, SpecWeave's purple/green palette, an iOS-card overlay style, and the technical realities of OBS recordings (start/stop ticks, recording-resume transients, duplicate takes from re-recording the same line three times).
>
> **The exact constants are project-specific** — overlay positions for that face-cam location, the `Boris Cherny / Anthropic` correction text, the `600+/500+/3K+` stats — translate, do not copy.
>
> **Use this layer as a reference for the underlying technique:** the transcript-driven smart-cut algorithm, the per-clip fade-in for transient suppression, the `con​cat`-filter render pipeline that avoids con​cat-demuxer clicks, the surgical-mute beep scrubber, the iOS-card overlay pattern, the source-time → cut-time mapping, the Studio waveform-cache invalidation gotcha — those generalize.

---

## When to use

Trigger this skill when ANY of these apply:

- A user has a raw screencast or OBS recording and wants a tightened, captioned, branded video.
- The source has dead air, paused silences, or duplicate "let me try that again" takes.
- The source has clicks, beeps, or transient artifacts at recording boundaries.
- The user wants graphic overlays (callouts, stat cards, brand reveals, tool logos) that **don't cover the speaker's face cam**.
- The user said the words "make this production-ready" or "ready to ship".
- The user mentioned wanting "Apple-keynote style" or "iOS hover cards" or "frosted glass".

If ANY of those signals are present, follow this workflow. If the user just wants a quick title card on a clean source, the upstream `hyperframes` skill alone is enough.

---

## The pipeline (10 phases)

```
┌──────────────────────────────────────────────────────────────────┐
│  Phase 0  Inventory tools                                         │
│  Phase 1  Probe the source (duration, codec, audio sample rate)   │
│  Phase 2  Transcribe with Whisper (word-level timestamps)         │
│  Phase 3  Detect silences + scene changes                         │
│  Phase 4  Build the smart cut list (with word-boundary buffers)   │
│  Phase 5  Scrub transient beeps (surgical mute + adeclick)        │
│  Phase 6  Render the master via con​cat filter (single pass)       │
│  Phase 7  Generate hero imagery (Gemini 3 Pro Image)              │
│  Phase 8  Author the HyperFrames composition (iOS cards)          │
│  Phase 9  Lint + verify in Studio                                 │
└──────────────────────────────────────────────────────────────────┘
```

Run the phases sequentially. **Iterate inside a phase, not across phases** — a bad cut list breaks every overlay timing downstream, and you'll spend an hour re-resolving anchors. Get cut list right first, then render once, then build overlays against the final timeline.

---

# Phase 0 — Inventory tools

Before starting, confirm these are available. The skill assumes macOS / Linux; on Windows use WSL.

| Tool | Used for | Install |
|---|---|---|
| `ffmpeg` (>= 6.0) | All video/audio processing | `brew install ffmpeg` |
| `ffprobe` | Stream inspection | bundled with ffmpeg |
| `whisper` (OpenAI Python pkg) | Transcription with word timestamps | `pip install openai-whisper` |
| `python3` | Cut list / beep scrubber scripts | system |
| `npx hyperframes@latest` | Composition CLI (preview, render, lint) | `npx hyperframes init <project>` |
| Gemini 3 Pro Image API | Hero images (optional) | `GEMINI_API_KEY` env var |
| `vskill` (>= 1.0) | Skill installation | `npm i -g vskill` |

If Whisper isn't installed, `pip install openai-whisper` brings it in. **Do not** use `large-v3` or `large-v3-turbo` on CPU — they take 10–15 minutes for an 8-minute audio. **Use `base.en`** for English tech monologue: ~30s, plenty accurate for word boundaries.

If a user's machine has `auto-editor` installed, ignore it — it does silence cuts but **not** beep scrubbing or word-boundary buffering, and it generates choppy 50+ segment cuts. We do better by hand.

---

# Phase 1 — Probe the source

Before doing anything else, learn the file's shape:

```bash
ffprobe -v error -show_entries stream=index,codec_type,codec_name,width,height,r_frame_rate,duration,sample_rate,channels \
  -show_entries format=duration,size,bit_rate -of json "$SRC" | tee source_meta.json
```

Things you must know:

- **Total duration** — drives all cut math.
- **Frame rate** — OBS often records at 60 fps; HyperFrames Studio plays at 30 fps internally for scrubbing. **Multiply seconds × 30 to get studio frame numbers**, not seconds × source-fps. This trips people up.
- **Audio codec & sample rate** — OBS commonly records `pcm_s24le` at 48 kHz. Re-encode to AAC 192k for delivery; keep 48 kHz to match all downstream tools.
- **Container** — `.mov` from DaVinci, `.mkv` from OBS — both fine, ffmpeg reads either.

Save the probe to disk so later phases can re-read it without re-probing.

---

# Phase 2 — Transcribe with Whisper

Word-level timestamps are the foundation. Without them you can't:

- Snap cut boundaries to word edges (avoiding mid-word clips).
- Detect duplicate takes (same line said 2-3 times).
- Place overlay anchors against speech moments instead of cut times that drift.

**Extract audio first** so Whisper gets a clean mono 16 kHz WAV (saves 80% of CPU vs full-quality):

```bash
mkdir -p .work
ffmpeg -hide_banner -y -i "$SRC" -vn -ac 1 -ar 16000 -c:a pcm_s16le .work/source.wav
```

**Run Whisper with word timestamps and JSON output:**

```bash
whisper .work/source.wav \
  --model base.en \
  --language en \
  --word_timestamps True \
  --output_dir .work \
  --output_format json \
  --verbose False
```

⚠️ **Whisper CLI gotcha**: passing `--output_format json --output_format srt` keeps **only the last** flag in older versions. If you need multiple, use `--output_format all` (writes JSON + SRT + VTT + TSV + TXT).

Validate the output: `.work/source.json` should contain `segments[].words[]` with `start`, `end`, `word`. If `words` is empty, you forgot `--word_timestamps True`.

**Read the full transcript at this stage.** Don't skip it. You'll spot:

- **Brand-name miss-hearings.** Whisper hears "Claude Code at Anthropic" as "Cloud Code at Infropic" 90% of the time. "SpecWeave" comes out as "spec with" or "specs". These need overlay corrections, not re-recording.
- **Duplicate takes.** Look for the same sentence repeated verbatim. In our project, *"And those systems cannot produce skills as you work"* appeared three times at 01:14, 01:30, 01:47. Drop two of them.
- **Filler restarts.** Single-word fragments like "And…", "And…" preceding the actual sentence. The cut script catches these as "ghost" segments — we drop them in phase 4.

---

# Phase 3 — Detect silences and scene changes

Two parallel detections feed the cut algorithm:

### 3a. Silence detection

```bash
ffmpeg -hide_banner -nostats -i "$SRC" -af "silencedetect=noise=-30dB:duration=1.2" -f null - 2>&1 \
  | grep -E "silence_(start|end)"
```

`-30 dB` and `1.2s` are the sweet spot. Looser (`-25 dB`, `0.8s`) catches breath gaps you don't want to cut. Tighter (`-35 dB`, `2s`) misses real dead air.

Parse start/end pairs into `[(s, e, dur), ...]` and write to `silences.json`. See [scripts/build_cuts.py](scripts/build_cuts.py).

### 3b. Scene-change detection

```bash
ffmpeg -hide_banner -nostats -i "$SRC" -filter:v "select='gt(scene,0.05)',showinfo" -f null - 2>&1 \
  | grep "showinfo" | grep -oE "pts_time:[0-9.]+" | sed 's/pts_time://' > scenes.txt
```

`scene>0.05` is sensitive enough to catch the speaker bringing up a new browser tab, switching apps, scrolling significantly. Don't go below `0.03` — you'll get false positives from cursor blinks.

These two together let you make the **smart cut decision**: silence + no scene change = pure dead air, cut it. Silence + scene change = the speaker is showing something on screen, **keep it** (the audience is supposed to look at the screen, not hear narration).

---

# Phase 4 — Build the smart cut list

The cut algorithm has **5 hard rules** earned the painful way:

### Rule 1 — Pure dead air gets cut, but not all of it

For each silent segment > `MIN_CUT_LEN` (1.5s) with no scene change inside: cut everything except a `BREATH` of 0.30s. The breath preserves natural rhythm — eliminating 100% of silence makes speech sound machine-edited.

```python
if not in_scenes and (cut_end - cut_start) > MIN_CUT_LEN:
    cuts.append((cut_start + 0.30, cut_end, f"dead air {dur:.1f}s"))
```

### Rule 2 — Silences with screen activity stay (capped at 3.5s)

If the silence has scene changes, the speaker is letting the audience read. Keep the window from `first_scene - 0.4s` to `last_scene + 0.8s`, but never longer than 3.5s — staring at one frame past 3.5s loses people.

### Rule 3 — Snap to word boundaries

After computing the rough keep ranges, snap each boundary to the nearest word edge from Whisper, within a 0.4s tolerance:

```python
def snap(t, words):
    best, bd = t, 0.4
    for s, e, _ in words:
        for cand in (s, e):
            if abs(cand - t) < bd:
                best, bd = cand, abs(cand - t)
    return best
```

This is what stops cuts from clipping mid-word. Without it, every other cut clips a trailing 's' or breath consonant.

### Rule 4 — Add word-boundary buffers (this is the one users notice)

Even with word-edge snapping, **trailing consonants extend slightly past Whisper's reported word-end timestamp**. Whisper times the *vowel onset to vowel offset*, not the consonant tail. So a literal cut at `word.end` clips the trailing 's', breath, or 'k'.

The fix: extend each keep range:

- **End:** `+ 0.30s` past the last word's end, capped at half the gap to the next keep.
- **Start:** `- 0.10s` before the first word's start, capped at half the gap to the previous keep.

```python
END_BUF, START_BUF = 0.30, 0.10
for i, (s, e) in enumerate(keep):
    gap_next = keep[i+1][0] - e if i+1 < len(keep) else TOTAL - e
    gap_prev = s - keep[i-1][1] if i > 0 else s
    add_end   = min(END_BUF,   max(0, gap_next * 0.5))
    add_start = min(START_BUF, max(0, gap_prev * 0.5))
    if gap_next < 0.6: add_end   = max(add_end,   gap_next - 0.05)  # eat tiny gaps
    if gap_prev < 0.6: add_start = max(add_start, gap_prev - 0.05)
    final.append([s - add_start, e + add_end])
```

**The result**: cut "find the tickets" extends from src 08:09.26 to 08:09.56 — the trailing 's' survives. Without this, the user will tell you the audio "feels rushed" or "swallows endings".

### Rule 5 — Manual duplicate-take removal

Programmatic dedup of identical n-grams is fragile and dangerous (it can drop legitimate repetitions). Instead: read the transcript, find verbatim duplicates yourself, and add explicit drop ranges in source-time:

```python
DUP_RANGES = [
    (78.86, 113.82),   # 01:18.86 - 01:53.82: 2 of 3 takes of "skills as you work"
]
for ds, de in DUP_RANGES:
    # trim each keep that overlaps this range
    ...
```

Reduces the cut from 35% saved to 32% saved (the duplicates are silenced gaps + speech), but the result reads cleanly.

### Output

The script writes:

- `cuts.json` — keep ranges + cut ranges + summary stats + source-time mapping (used by Phase 8 for overlay anchors).
- `edl.txt` — human-readable EDL with transcript snippets per keep (eyeball-check this before rendering).

See [scripts/build_cuts.py](scripts/build_cuts.py) for the full implementation.

---

# Phase 5 — Scrub transient beeps

OBS recordings often contain short transient artifacts — boot beeps, key-switch clicks, mic plosives that hit a hot input. These ride along through silence-cut decisions because they're loud (so silence detection ignores them) and they're surrounded by quiet. They sound like a "tick" in the final video at 4:11 or 0:52 or wherever.

**Don't try to fix this with a global noise gate or de-noiser.** You'll smear consonants and make speech sound underwater. Instead: detect transients and surgically silence each 60–100ms window.

### Detection algorithm (the one that doesn't mute speech)

A transient is a "beep" iff:

```
RMS(window 5ms)  > BEEP_RMS_MIN     (e.g., > 800)
RMS(preceding 150ms) < PRE_QUIET    (e.g., < 200)
RMS(following 200ms) < POST_QUIET   (e.g., < 350)
```

The third condition is critical. Without it, you'll catch consonant onsets ('p', 't', 'k') of speech, because they look identical in the first 5ms — *but speech is followed by a sustained vowel*, while a beep returns to silence. Filter on `post_avg < 350` and you only ever silence isolated transients.

Also cap the silenced span at 0.30s — a misclassification can never wipe out a word.

### Apply the surgical mutes

Build an ffmpeg `volume` filter expression with the targeted ranges:

```
volume=enable='between(t,52.110,52.180)+between(t,169.850,169.920)+between(t,251.245,251.315)+between(t,268.780,268.845)':volume=0,adeclick
```

The trailing `adeclick` catches anything else click-shaped that the surgical pass missed. Keep both — they're complementary.

See [scripts/scrub_beeps.py](scripts/scrub_beeps.py) for the full implementation.

### Why per-clip fade-in DOESN'T work

You'd think: "just fade in the start of every kept clip and the boundary clicks disappear." That works for **boundary** clicks (con​cat artifacts). It does **NOT** work for transients sitting deeper inside the clip — e.g., 0.7s into the segment, in a silence. We had a beep at cut 4:11.245 that was 0.74s into keep[26] — no fade-in reaches that.

The right fix is **the right tool for each problem**:

| Problem | Fix |
|---|---|
| Boundary click between two re-encoded clips | Use `con​cat` filter, not `con​cat` demuxer (Phase 6) |
| OBS start tick at t=0 | 0.4s `afade=t=in:st=0:d=0.4` |
| Click-type spikes anywhere | `adeclick` filter (broad, low cost, no audible side effects) |
| Transient pip in a silence (the hard one) | Detection + surgical `volume=0:enable='between(t,a,b)'` |

---

# Phase 6 — Render the master via con​cat filter

The single most important rendering rule: **use the `con​cat` filter, not the `con​cat` demuxer.**

### Why

The con​cat demuxer (`-f con​cat -i list.txt`) requires every clip to have identical codec params. Even when they do, the demuxer can introduce **audible boundary clicks** because it stitches packets at container level without aligning audio samples. We saw clicks at every clip join — sounded like the OBS tick we tried to remove, which is what made the user think we hadn't fixed the beep.

The con​cat filter (`filter_complex … con​cat=n=N:v=1:a=1`) does sample-accurate con​catenation through the audio path. No boundary clicks. Single pass.

### The full ffmpeg command

```bash
# Build filter_complex string from cuts.json keeps
python3 - <<'PY' > filter_complex.txt
import json
keep = json.load(open('cuts.json'))['keep']
total_out = sum(e-s for s,e in keep)
parts = []
for i,(s,e) in enumerate(keep):
    parts.append(f"[0:v]trim=start={s:.4f}:end={e:.4f},setpts=PTS-STARTPTS[v{i}]")
    parts.append(f"[0:a]atrim=start={s:.4f}:end={e:.4f},asetpts=PTS-STARTPTS[a{i}]")
inter = "".join(f"[v{i}][a{i}]" for i in range(len(keep)))
parts.append(f"{inter}concat=n={len(keep)}:v=1:a=1[vc][ac0]")
parts.append(f"[ac0]adeclick,afade=t=in:st=0:d=0.4,afade=t=out:st={total_out-0.5:.2f}:d=0.5[ac]")
print(";".join(parts))
PY

ffmpeg -hide_banner -y -i "$SRC" \
  -/filter_complex filter_complex.txt \
  -map "[vc]" -map "[ac]" \
  -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p \
  -c:a aac -b:a 192k -ar 48000 \
  -movflags +faststart \
  master.mp4
```

### Rendering checks

After rendering, verify both streams have matching durations:

```bash
ffprobe -v error -show_entries stream=codec_type,duration,nb_frames \
  -show_entries format=duration -of json master.mp4
```

Video and audio durations should match within 0.05s. If they don't, your filter_complex has a bug — usually because the audio passed through `aselect` instead of `atrim` and got time-shifted. Use `atrim`, not `aselect`, for cut-list rendering.

After surgical beep mute (Phase 5), the audio has been re-encoded — copy the video stream, replace the audio:

```bash
ffmpeg -y -i master.mp4 -c:v copy -af "volume=enable='...':volume=0,adeclick" \
  -c:a aac -b:a 192k -ar 48000 master_clean.mp4
```

---

# Phase 7 — Generate hero imagery

For dramatic full-takeover scenes (the "Apple keynote moment") you want a single hero image — something the audience will remember. Don't use stock photos; generate one with Gemini 3 Pro Image.

### Prompt anatomy that works

A reliable Apple-keynote prompt has these **6 elements**:

1. **Subject + framing** — "exploded view of an Apple Watch, components floating in 3D space"
2. **Lighting** — "soft volumetric studio lighting, specular highlights, rim light"
3. **Background** — "dark gradient (deep navy to black, subtle teal rim glow)"
4. **Style** — "photorealistic ray-traced metals and glass, ultra sharp"
5. **Layout** — "front-3/4 angle, cinematic 16:9 keynote slide composition, generous negative space, no text"
6. **Mood** — "premium product photography"

The "no text" is critical — image-gen models love adding gibberish text. Always say no.

### API call

```bash
curl -s -X POST \
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=$GEMINI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "contents": [{"parts": [{"text": "<your prompt>"}]}],
    "generationConfig": {
      "responseModalities": ["TEXT", "IMAGE"],
      "imageConfig": {"aspectRatio": "16:9"}
    }
  }' > resp.json
```

Decode the inline-base64 image:

```python
import json, base64
d = json.load(open('resp.json'))
for p in d['candidates'][0]['content']['parts']:
    if 'inlineData' in p:
        open('hero.png','wb').write(base64.b64decode(p['inlineData']['data']))
```

### When you can't use Gemini

If `GEMINI_API_KEY` isn't available, fall back to:
- Anton's project: paid-tier `EasyChamp` Gemini key (per `~/.zshrc`) — see `reference_gemini_api_keys.md` for the user's existing keys
- Free fallback: Pollinations.ai (lower quality, but free)
- Don't ask the user for an API key — check their environment first

Keep the resulting PNG in `assets/`. Reference it from the composition with `<img src="assets/hero.png">`.

---

# Phase 8 — Author the HyperFrames composition

This is where most visual quality lives. The Layer 2 lessons here are dense — read them all before writing HTML.

## 8.1 — The iOS-card overlay system (NOT the PiP layout)

> **The mistake**: shrinking the underlying video to a corner PiP and filling the rest with graphics.
> **The lesson**: real product videos keep the speaker visible at full screen and float overlays *on top* like iOS notification cards.

### Why "PiP corner" feels wrong

A PiP shrinks the speaker to ~480×270 in a corner. Three problems:
1. The user can no longer see what they're showing on screen at full detail.
2. PiP transitions are jarring — content snaps from full-screen to thumbnail and back.
3. It looks like a Zoom call, not a product video.

### The iOS card pattern that works

The card is a **frosted-glass surface** that drops in on top of the full-screen video. The video keeps playing. The card stays for 4–11 seconds, then dismisses.

```css
.card {
  position: absolute;
  background: linear-gradient(180deg, rgba(28,30,38,0.82) 0%, rgba(18,20,26,0.82) 100%);
  backdrop-filter: blur(28px) saturate(140%);
  -webkit-backdrop-filter: blur(28px) saturate(140%);
  border: 1px solid rgba(255,255,255,0.10);
  border-radius: 28px;
  box-shadow:
    0 1px 0 rgba(255,255,255,0.06) inset,
    0 24px 60px rgba(0,0,0,0.55),
    0 8px 16px rgba(0,0,0,0.35);
  overflow: hidden;
}
.card::before {
  /* Top accent stripe — Skill Studio FEATURES card pattern */
  content: ""; position: absolute; left: 0; right: 0; top: 0;
  height: 4px; background: var(--card-accent, #06b6d4);
  opacity: 0.85;
}
```

The four ingredients:

1. **`backdrop-filter: blur(28px) saturate(140%)`** — the frosted-glass effect that makes the card legible against any underlying video frame. `saturate(140%)` keeps colors punchy through the blur.
2. **Tinted gradient surface** — not pure black. `rgba(28,30,38,0.82)` lets enough of the video bleed through to feel layered, not pasted-on.
3. **Inset highlight + drop shadow stack** — the `0 1px 0 inset` rim catches light, the doubled drop shadow gives depth without looking heavy.
4. **Top accent stripe** — 4px colored bar tied to the scene's brand color. Single visual anchor.

### Card placement — avoid the speaker's face cam

Find where the face cam lives in the source. For most OBS configs, it's bottom-right at ~480×270. Place cards anywhere else:

| Card position | When to use |
|---|---|
| Top, full width | Quote opener, eyebrow + title scenes |
| Top-left | Big-number stats |
| Center | Hero brand reveal (one-shot, dramatic) |
| Bottom-left chip | Small contextual annotations (name corrections) |
| Bottom, full width | CTA, terminal command |

**Never** place a card in the bottom-right unless the speaker isn't there. **Never** make a full-screen card cover the screen content unless the moment is specifically designed as a "takeover" beat (e.g., the Apple Watch hero in our project).

## 8.2 — Real brand icons, not text labels

The project's `docs-site/src/components/ui/Icon/brands/` directory ships with 10 brand SVGs:

- `claude.svg` (#D97757 terra-cotta)
- `github.svg` (#6e40c9)
- `copilot.svg` (#6E5494)
- `cursor.svg` (orange tetrahedron, multi-fill)
- `jira.svg` (#2684FF)
- `azure.svg` (#0078D4)
- `windsurf.svg`, `discord.svg`, `linear.svg`, `youtube.svg`

Copy them into your composition's `assets/brands/` and **inline them as SVG inside cards**, not via `<img>`. Inlining lets you control the icon's container size and respect the design language. Use the SVGs verbatim — these are the canonical brand marks; do not recolor.

```html
<div class="brand-icon">
  <svg viewBox="0 0 24 24" fill="#D97757" xmlns="http://www.w3.org/2000/svg">
    <path d="…"/>
  </svg>
</div>
```

```css
.brand-icon { width: 64px; height: 64px; flex: 0 0 64px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 16px;
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.10);
}
.brand-icon svg { width: 38px; height: 38px; }
```

## 8.3 — Mirror Skill Studio's tinted-card pattern

Skill Studio (vskill-platform) uses this pattern for feature cards. Our overlays should match:

```js
// Each scene gets a brand color; that color drives the entire card's tint
const SCENE_COLORS = {
  opener:    "#06b6d4",   // cyan
  problem:   "#ef4444",   // red
  solution:  "#22c55e",   // green
  cta:       "#22c55e",
  brand:     "#a855f7",   // purple
  info:      "#3b82f6",   // blue
};
```

Pill labels follow the exact pattern from `vskill-platform/src/app/studio/page.tsx`:

```css
.pill {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 6px 14px; border-radius: 999px;
  font-family: 'Geist Mono', 'SF Mono', monospace;
  font-size: 16px; font-weight: 600;
  letter-spacing: 1.5px; text-transform: uppercase;
  /* Per-color: */
  color: var(--c);
  background: rgba(<c-rgb>, 0.10);   /* ${color}10 */
  border: 1px solid rgba(<c-rgb>, 0.40);  /* ${color}40 */
}
.pill .swatch {
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--c);
  box-shadow: 0 0 10px var(--c);
}
```

This is the **exact** pattern from the platform — borders at 40% alpha, surfaces at 10% alpha, body text at full color. Mirror it for overlay legibility against any video frame.

## 8.4 — Sharp animations, not "fade in"

Plain `opacity 0 → 1` looks flat. Every card uses a four-property entry:

```js
function cardIn(sel, start) {
  tl.fromTo(sel,
    { opacity: 0, y: 60, scale: 0.96, filter: "blur(8px)" },
    { opacity: 1, y: 0, scale: 1, filter: "blur(0px)",
      duration: 0.7, ease: "power3.out", overwrite: "auto" }, start);
}
```

The four properties layered:
- **Opacity** — `0 → 1`
- **Y offset** — `60 → 0` (slide up from below)
- **Scale** — `0.96 → 1` (subtle pop)
- **Blur** — `8px → 0` (focus-in)

Plus per-element flourishes:

| Element | Animation | Why |
|---|---|---|
| Stat numbers | `scale 0.5 → 1` with `back.out(1.5)` | Big-number "Apple keynote pop" |
| Tool icons | `stagger 0.08s` with `back.out(1.4)` | Each one snaps in |
| Brand wordmark | `scale 0.7 → 1` with `blur(20px) → 0` | Reveal moment |
| Live dot, terminal cursor | `@keyframes blink` 1.4s | Lived-in feel |
| Hero image (Apple Watch) | Continuous gentle `y bob` 4s sine yoyo | Floats in space |

Always use `overwrite: "auto"` on tweens that share a property — the lint catches it otherwise.

## 8.5 — Source-time → cut-time mapping (the silent killer)

You wrote overlay anchors against the **original source timestamps** ("when he says 'SpecWeave' at src 03:28"). The cut master plays at **cut timestamps** (the same speech moment is at cut 02:19.5).

After every re-cut, the cumulative durations shift slightly. **Recompute the mapping and re-resolve every overlay anchor** before rendering:

```python
mapping = []
cum = 0.0
for s, e in keep_ranges:
    mapping.append({"src_start": s, "src_end": e, "cut_start": cum})
    cum += (e - s)

def src_to_cut(src_t):
    for m in mapping:
        if m['src_start'] <= src_t <= m['src_end']:
            return m['cut_start'] + (src_t - m['src_start'])
    return None  # source moment was cut
```

Skip overlays whose source moments got cut — don't try to "place them somewhere reasonable." Drop them.

Save the mapping to `cuts.json` and have the overlay-author script read it. See [scripts/build_cuts.py](scripts/build_cuts.py) for the full version.

## 8.6 — Concise text, big and structured

Cards follow the **eyebrow-pill + headline + structured content** pattern (Apple keynote):

```
┌────────────────────────────────────────┐
│ ● PILL LABEL                           │
│                                        │
│ The Big Headline.                      │
│                                        │
│ Tool · Tool · Tool   (or: 3 cards)     │
└────────────────────────────────────────┘
```

Rules:
- **Headline**: 56–96px, `font-weight: 800`, `letter-spacing: -1.5px`. One sentence. No more.
- **Eyebrow pill**: 16px mono, all-caps, tracked +1.5px. ≤ 4 words.
- **Body**: short structured units — bullets (3 max), tool tiles, stat tiles. Never a paragraph.
- **Numbers**: huge. 140–320px is normal. Numbers are the visual anchor of every stat scene.

Bad: `"With more than 600 increments, 500 NPM releases, and over 3000 commits, SpecWeave is battle-tested."`
Good: `● BATTLE-TESTED` / **Real numbers.** / 3 stat tiles: `600+` / `500+` / `3K+`

---

# Phase 9 — Lint + verify in Studio

## 9.1 — HyperFrames lint gotchas

Run `npx hyperframes lint` after every edit. The five errors/warnings we hit and how to fix:

| Lint message | Cause | Fix |
|---|---|---|
| `overlapping_clips_same_track` | Two `data-track-index` clips on the same track overlap in time | Move one to a different track. Audio especially — give it `data-track-index="-1"`. |
| `overlapping_gsap_tweens` | Two GSAP tweens animate the same property on the same selector | Add `overwrite: "auto"` to all but the first. |
| `gsap_exit_missing_hard_kill` | Exit fade ends near a clip start boundary; non-linear seek can land mid-fade | After the exit, add `tl.set(sel, { opacity: 0 }, end_time);` |
| `composition_file_too_large` | Single `index.html` exceeds ~500 lines | Move scenes into `compositions/sceneN.html` and mount with `data-composition-src`. Cosmetic when timing is fluid; do it once timing is locked. |
| `timeline_track_too_dense` | More than ~6 elements on one track | Same fix as above — split into sub-comps. |

## 9.2 — Studio gotchas

| Symptom | Cause | Fix |
|---|---|---|
| New audio plays correctly but waveform display still shows old version | `.waveform-cache/` holds stale per-asset JSON | `rm -rf .waveform-cache/` then refresh the studio. |
| Frame-jump number doesn't match expected seconds | Studio internally runs at 30fps regardless of source frame rate | Multiply `seconds × 30` to get the studio frame number. |
| `<audio>` element conflicts with `<video>` on same track | Both clips on `data-track-index="0"` overlap | Audio gets `data-track-index="-1"` (background, never visible). |
| Hot-reload doesn't pick up new asset | The file replaced has the same name as before | Refresh the browser tab. Studio polls but is occasionally lazy. |
| `npm run dev` fails on second run with port conflict | Previous studio still running on port 3002 | `lsof -nP -iTCP:3002` then kill the process. |

## 9.3 — Verify scenes by jumping to known cut times

The studio has an "Jump to frame" input. Compute the frame for each scene:

```python
scenes = {
  "quote_opener":      0.5,   # cut 0:00.5
  "boris_correction":  10.4,
  "brownfield":        53.88,
  "apple_watch":       91.4,
  "specweave_reveal":  139.51,
  ...
}
for name, cut_sec in scenes.items():
    print(f"{name}: frame {int(cut_sec * 30)}")
```

Jump to a frame just past each scene's start (so the entry animation has settled), screenshot, eyeball, iterate.

---

# Reference: full pipeline scripts

Three Python scripts handle the heavy lifting. Read them, copy them, adapt them. Don't reinvent.

- [scripts/build_cuts.py](scripts/build_cuts.py) — Phase 4: smart cut list with word-boundary buffers + dup removal + source→cut mapping.
- [scripts/scrub_beeps.py](scripts/scrub_beeps.py) — Phase 5: detect transient beeps (loud + quiet on both sides) + emit ffmpeg volume-gate filter.
- [scripts/render_master.py](scripts/render_master.py) — Phase 6: build the `con​cat`-filter `filter_complex` and run ffmpeg single-pass.

# Reference: HTML composition starter

- [references/composition-starter.html](references/composition-starter.html) — minimal HyperFrames composition with the iOS-card primitives, brand-icon container, pill labels, and the standard `cardIn`/`cardOut` GSAP helpers. Drop in your scene content; ship.

---

# Anti-patterns — never do these

1. **Don't shrink the video to a PiP corner during overlays.** Float overlays on top instead. The user said "those animations must be on top, like phone hover style" — they meant it.
2. **Don't fade between cuts with a slow crossfade.** Hard cuts (snapped to word edges with buffers) read as professional. Crossfades read as amateur.
3. **Don't use `auto-editor` to do silence cuts.** It's choppy, doesn't snap to word boundaries, doesn't handle duplicate takes, doesn't scrub beeps. Use the smart-cut algorithm.
4. **Don't use the `con​cat` demuxer for re-encoded clips.** Use the `con​cat` filter — it sample-aligns audio. Boundary clicks are not OBS ticks; they're con​cat artifacts.
5. **Don't fade-in every clip** to suppress beeps. Beeps inside silences (deep into a clip) won't be reached. Use surgical detection + targeted mute instead.
6. **Don't write paragraphs in cards.** Headline + 3 bullets max. If you need more, you need more cards.
7. **Don't reinvent brand marks.** Inline the official SVGs from `docs-site/src/components/ui/Icon/brands/`. Don't ask Gemini to "draw a Claude logo".
8. **Don't author overlays before the cut master is finalized.** Every recut shifts cut times — you'll waste hours re-resolving anchors. Lock the cut, then build overlays.
9. **Don't trust Whisper on brand names.** "Claude Code at Anthropic" → "Cloud Code at Infropic". Read the transcript and add overlay corrections. Don't re-record.
10. **Don't render with `large-v3-turbo` Whisper on CPU.** 15+ minutes for an 8-minute audio. `base.en` is 30 seconds and equally good for English tech monologue word-boundary work.

---

# Verification checklist

Before declaring the video ready:

- [ ] Total duration matches the cut summary (within 0.05s).
- [ ] Video and audio stream durations are equal in `ffprobe` output.
- [ ] No mid-word clips on the EDL transcript snippets — read each keep's snippet end-to-end.
- [ ] Surgical beep ranges all 60–300ms, never longer.
- [ ] At every kept-segment boundary, listen for the trailing consonant on the previous segment and the leading consonant on the next.
- [ ] Lint reports 0 errors (warnings are fine — they're cosmetic).
- [ ] Each overlay scene has been screenshotted in the studio and visually checked for coverage of the speaker face cam.
- [ ] Brand icons render correctly (inline SVG, not broken `<img>`).
- [ ] Hero takeover scene (if any) has the underlying video opacity animated to 0 during the takeover, then back to 1 after.
- [ ] Final render plays end-to-end without audio glitches; specifically check the cut times where you previously heard beeps.

---

# Glossary

- **Smart cut** — keep ranges built from silence + scene-change correlation, not just silence. Dead air with screen activity is kept; dead air without it is cut.
- **Word-boundary buffer** — extending a keep range past the word's reported end to preserve trailing consonants (Whisper times vowels, not tails).
- **Surgical mute** — silencing a sub-100ms window via `volume=0:enable='between(t,a,b)'`, applied only to detected transients in dead air.
- **Hero takeover** — a full-screen graphic scene that briefly replaces the video entirely (e.g., Apple Watch), then returns. Use sparingly — once or twice per video.
- **iOS card** — frosted-glass overlay primitive (backdrop-blur + tinted gradient + inset highlight + drop shadow) that floats on top of full-screen video without shrinking it.

---

# Provenance

This skill encodes lessons from one specific project: turning Anton Abyzov's 8:47 SpecWeave intro recording (May 2026 OBS capture) into a 6:00 production-ready video. The smart-cut algorithm, beep scrubber, and iOS-card design system were iterated through five render passes (v1 PiP layout → v2 word-boundary buffers → v3 con​cat-filter render → v4 surgical beep mute → v5 iOS-card overlay redesign) before reaching production quality. The Apple-Watch hero image was generated via Gemini 3 Pro Image with the exploded-product-photography prompt template.

Author: Anton Abyzov (`anton.abyzov@gmail.com`)
Iteration log preserved in `~/Projects/Obsidian/personal-docs/` under `004 Archive/specweave-video-2026-05`.
