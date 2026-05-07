---
version: "1.1.0"
name: remotion-best-practices
description: "Best practices for Remotion video creation in React — scaffolding, compositions, animations, transitions — PLUS hard-won rules for high-fidelity product-demo videos: real logos/icons, precise YouTube-reference matching, full-screen camera zooms, click-targets that actually hit, content-tight rectangle highlights, voiceover regeneration discipline, audio-level normalization (no double-boost), per-scene voice-sync math, Studio detail-page mirror patterns, bold-not-subtle connection lines, and the YouTube publication kit (chapters, description, thumbnail, hashtags) that turns a render into a shipped video."
metadata:
  tags: remotion, video, react, animation, composition, demo-videos, product-demos, voiceover, audio-normalization, youtube-publishing
---

# /remotion-best-practices

Use this skill any time you are writing a Remotion composition — animated demo videos, product walkthroughs, hackathon submissions, narrated presentations — anything rendered to MP4 via `npx remotion render`.

The skill bundles two layers of knowledge:

1. **Remotion fundamentals** — the upstream rule files maintained by the Remotion team at `github.com/remotion-dev/skills` (compositions, animations, fonts, audio, transitions, FFmpeg, captions, etc.).
2. **Demo-video craft rules** — lessons captured from a long iteration cycle building the vskill / Skill Studio hackathon demo. These are the rules that, when broken, produce a "slideshow" instead of a believable product walkthrough.

Read both layers before authoring.

---

## Scope and applicability

> **The Layer 2 craft rules below were derived from one specific project: the
> vskill / Skill Studio hackathon demo (Anthropic / Claude Code "Built with
> Opus" hackathon, April 2026).** They reflect the look-and-feel of *that*
> product — Studio chrome with breadcrumb header, sidebar tree, dark
> verified-skill.com pages with mono fonts, terminal scenes, an editorial
> "Inter is AI-slop, distinctive serif is excellence" thesis.
>
> **Do not apply these rules verbatim to unrelated demos.** A
> consumer-mobile, a finance dashboard, a game, or a B2B SaaS pitch will
> have its own visual language, its own pacing, and its own audience
> expectations. A Save-then-Publish flow, a `verified-skill.com/queue` page,
> or a Studio sidebar with PROJECT/PERSONAL/PLUGINS counts is *content*, not
> *craft*.
>
> **Use this layer as a reference for the underlying technique:**
> the camera-zoom pattern, the cursor-targeting discipline, the
> content-tight highlight rectangle, the in-place state transitions, the
> voiceover/script.ts coupling, the render+audio-boost pipeline — those
> generalize. The exact constants (1.72× zoom, x=1488 button center,
> v1.0.0 → v1.0.1 version pill, "Tier-1 patterns · Tier-2 LLM · Socket"
> attribution) are Skill Studio specifics — translate, do not copy.

---

## Layer 1 — Remotion fundamentals

Mirrors the upstream `remotion-best-practices` skill at `https://github.com/remotion-dev/skills/blob/HEAD/skills/remotion/SKILL.md`.

### New project setup

When in an empty folder or workspace with no existing Remotion project, scaffold one using:

```bash
npx create-video@latest --yes --blank --no-tailwind my-video
```

### Starting preview

Start the Remotion Studio to preview a video. **Studio HMR live-reloads as files change** — you do NOT need a separate `preview_start` mechanism, and `Bash` `run_in_background` is the right way to keep it alive across edits.

```bash
npx remotion studio --port=3030
```

### Rendering

```bash
# Entry point must be the file that calls registerRoot() (usually src/remotion/index.ts)
npx remotion render src/remotion/index.ts <CompositionId> out/video.mp4 --concurrency=8 --log=info
```

Common gotchas:

- Passing `Root.tsx` as entry → error: *"this file does not contain registerRoot"*. Use `index.ts`.
- `TransitionSeries` does prop introspection on direct children; do **not** wrap children in `<React.Fragment>`. Use `flatMap` returning a flat array of `<TransitionSeries.Sequence>` and `<TransitionSeries.Transition>` elements.
- `interpolate(frame, [a, b], …)` requires `a < b` strictly. If you derive `b` from constants, sanity-check at scene-budget design time — Remotion throws *"inputRange must be strictly monotonically increasing"* on the very first evaluated frame and the whole composition fails to load.

### One-frame render check

```bash
npx remotion still <composition-id> --scale=0.25 --frame=30
```

### Subjects covered by the upstream rule files

(Load on demand from the upstream skill repo — `github.com/remotion-dev/skills/tree/HEAD/skills/remotion/rules/`.)

- `compositions.md` — Defining compositions, stills, folders, default props, dynamic metadata
- `animations.md` — `interpolate`, `spring`, easing, frame-based math
- `transitions.md` — `@remotion/transitions` (fade, slide, wipe), how to chain them inside `TransitionSeries`
- `assets.md` — `staticFile()`, `Img`, `Audio`, `Video`, font loading
- `fonts.md` — `@remotion/google-fonts` and local font registration
- `audio.md` — Importing, trimming, volume, speed, pitch
- `captions.md`, `subtitles.md` — Caption tracks and sync
- `ffmpeg.md` — Trimming, concat, audio operations via FFmpeg shell-out
- `silence-detection.md`, `extract-frames.md`, `get-audio-duration.md`, `get-video-duration.md` — Mediabunny utilities
- `charts.md`, `gifs.md`, `light-leaks.md`, `3d.md` — Specialized rendering recipes

---

## Layer 2 — Demo-video craft rules

These are the rules earned over a long iteration cycle. **Treat them as defaults, not optional polish** — most of them came from "this looks weird, fix it" feedback that took multiple rounds to resolve.

### A. Reference fidelity

#### A1. Always pull the real reference

If the user says "make it look like 2:43 of this YouTube video," extract the frame and study it. **Don't approximate from memory.**

```bash
SOURCE="/Users/antonabyzov/Movies/.../Source.mov"
DEST_DIR=".specweave/.../assets/keyframes"
for t in 102 105 108 110 112; do
  ffmpeg -y -ss "$t" -i "$SOURCE" -frames:v 1 -q:v 2 "$DEST_DIR/at-${t}s.jpg" -loglevel error
done
```

Then `Read` each JPG and design from what's actually on screen — typography, exact button labels, badge colors, sidebar tree layout, search-input positioning, count values (e.g. `PROJECT (1)`, `PERSONAL (0 of 12)`, `PLUGINS (0 of 50)`, `AVAILABLE (62)`).

#### A2. Use real logos and icons, not approximations

- **Bell-badge `skill-studio-logo.png`** — copy into every Studio scene as `<Img src={staticFile("...")} />`. Don't render a `✷` glyph and call it a logo.
- **Provider icons** — fetch the real SVG/PNG for Claude, Anthropic, OpenAI, OpenRouter, Ollama, LM Studio (e.g., from `lobehub/static-png`). Don't substitute emoji.
- **Mascots** — draw with styled divs to match shape exactly. The Claude Code mascot is a peach-`#e08160` body with two square eyes, **two side hand-nubs at mid-body**, and **two pairs of legs underneath** (`▪ ▪    ▪ ▪`). Not ASCII art.
- **App-window chrome** — when showing a website in a "Chrome browser", render a real Chrome browser frame: rounded corners, traffic-light dots, ‹ › ↻ nav, locked-padlock URL bar with a real URL (`localhost:3000/hero`, no extra spaces, no middle dot).

#### A3. Match YouTube reference layouts pixel-for-pixel

Before redesigning a scene from imagination, list the visible elements in the reference frame and check each one against your output:

- Banner text — exact wording (`Submit skills for verification`, not `Submit a Skill`)
- Tab order — `Overview · Edit · Tests · Run · Trigger · Versions`
- Trust badges — `T1 UNSCANNED`, `Security-Scanned —`, `Trusted Publisher`
- Filter input — always above `AVAILABLE` in the sidebar
- Counts — keep them consistent across slides (`PERSONAL (0 of 12)` everywhere, not `(11)` on one slide and `(0 of 12)` on another)
- Header right-side controls (in this order): `🔍 Find skills [⌘K]` · `+ New Skill` · `● Model selector` · `🔔 bell`

### B. Camera zoom

#### B1. Camera zoom is full-canvas, not section-scaled

Do **not** scale a single panel inside the chrome. Wrap the **entire chrome (top bar + body)** in a transform div and scale + translate that:

```tsx
<div
  style={{
    width: "100%",
    height: "100%",
    transform: `translate(${cameraTx}px, ${cameraTy}px) scale(${cameraScale})`,
    transformOrigin: "50% 50%",
    willChange: "transform",
  }}
>
  {/* TOP BAR + BODY */}
</div>
```

Cursor + click-ripple SVGs go **inside** this wrapper so they scale with the chrome and stay glued to their target.

#### B2. Click first, then zoom

The viewer needs to see the click target in context, then be transported in for the consequence. Ordering:

```
frame 130   cursor approaches button
frame 174   click ripple
frame 184   button shows "Running…"
frame 188   camera zoom-in starts (1.0 → 1.55+ over ~30 frames)
frame 220+  zoom held — pass cascade / results / scroll-up reveal happens here
```

Zooming first then clicking feels like a presentation slide. Clicking first then zooming feels like the user did the action and the camera followed.

#### B3. Pick a scale that actually pushes chrome off canvas

A modest 1.1× barely changes anything. For "the top bar leaves the canvas top," you need ≥ 1.5× combined with a translate that brings the focal point to canvas center. Compute target ≥ `(canvasHalfHeight) / (distance from focal point to top bar)` — for a row at y=540 and a 64-px top bar, that's ≥ ~1.5×. Use **1.55–1.85×** as defaults for "fill the viewport."

### C. Cursor click targets

#### C1. Hit the actual element

When the cursor lands on the wrong button (`+ New Skill` vs the model-selector pill), the viewer thinks the demo is broken. **Re-derive the target from the layout each time** — don't guess pixel values.

For a flex right-aligned controls strip with `padding: "0 22px"`:

```
// Right edge → 22 pad → bell (32) → 14 → model (~290) → 14 → New Skill (~120) → 14 → Find skills (~150)
NEW_SKILL_PILL_X = 1920 - 22 - 32 - 14 - 290 - 14 - 60   // = 1488 (button center)
FIND_PILL_X      = 1920 - 22 - 32 - 14 - 290 - 14 - 120 - 14 - 75  // = 1339
```

Once you have the constant, **use it from both the cursor approach interpolation and the cursor leave interpolation** so the click ripple lands exactly on the pill, not 200 px to the right of it.

#### C2. Highlight the target as the cursor approaches

Add a `*Active` prop on shared header components (e.g., `findActive`, `newSkillActive` on `StudioHeader`) that the cursor scene flips on for the approach + click window. The button gets:

- 1.08× scale
- Soft indigo or purple ring via `box-shadow: 0 0 0 4px rgba(99,102,241,0.30)`
- `transition: all 0.15s ease`

### D. Highlights and rectangles

#### D1. Highlight rectangles are content-width, not full-line

When the user wants a red rectangle around two terminal lines, do **not** wrap the parent flex column — that stretches across the row. Use:

```tsx
<div
  style={{
    display: "inline-flex",
    flexDirection: "column",
    alignSelf: "flex-start",
    width: "fit-content",
    border: "2px solid #dc2626",
    borderRadius: 6,
    padding: "10px 16px",
    backgroundColor: "transparent",
  }}
>
  {/* the two lines, nothing more */}
</div>
```

Anything that should be **outside** the rectangle (e.g., the third "Generating component…" line) must be a sibling, not a child.

#### D2. Annotations: prefer rectangles over ellipses

A hand-drawn-style rectangle stroke around a row reads as "highlighter on the canvas," which is what most users mean by "highlight this." An ellipse can feel decorative.

```tsx
<svg viewBox="0 0 1000 100" preserveAspectRatio="none">
  <rect
    x="6" y="6" width="988" height="88" rx="6" ry="6"
    fill="none"
    stroke="#ea580c"
    strokeWidth="3.6"
    strokeDasharray="2160"
    strokeDashoffset={2160 * (1 - progress)}
  />
</svg>
```

#### D3. Use orange (#ea580c) for "this is what's new" and red (#dc2626) for "this is the bug"

The same demo can carry both. Don't mix.

### E. Layout patterns for product chrome

#### E1. Studio header is a single shared component

Use one `StudioHeader.tsx` with this canonical layout, called from every Studio scene:

- **Left**: logo image (40 × 40 PNG) + "Skill Studio" wordmark + breadcrumb `[Authoring|Available] / [scope] / [folder] / [skill]`
- **Right**: 🔍 Find skills `[⌘K]` · ✦ + New Skill · ● Model selector · 🔔 Bell

Pass `breadcrumb`, `bellBadge`, `findActive`, `newSkillActive` as props. Every scene's header is then pixel-stable.

#### E2. Sidebar has a constant filter input above AVAILABLE

Every Studio sidebar — Browse, Update, AuthorEvals, ConsumeInstall, AuthorEditAndPublish — gets the same `Filter skills…` input above the AVAILABLE tree. Pre-fill with the in-context query (`frontend-design`) on slides where the user has already searched.

#### E3. Sidebar widths and typography

- Width: **400 px** (or **460 px** on slides with deep nested trees)
- Outer padding: **24–30 px**
- Group headers (`AVAILABLE`, `AUTHORING`): **18–19 pt**, letter-spacing 1.6, weight 700
- Sub-headers (`SKILLS`, `.CLAUDE`): **15–16 pt**, letter-spacing 1.4
- Row text: **17–19 pt**
- Version pill: **13–14 pt** mono with 1 px border, padded 3/10
- Vertical gaps: 12–14 px between sections, 22–36 px above section headers

Skinny dense sidebars feel like Settings panels. Wide-open sidebars feel like real product UI.

### F. State transitions in-place

#### F1. Don't slide-left between scenes that should feel like one screen

If "click Install → tree updates with new skill" should read as one continuous interaction:

- Set `transitionType: null` on the next scene **or** merge the two scenes into one
- Keep the chrome identical between the scenes
- Animate the changing element (counter flip, chevron rotate, row slide-in) — don't full-fade

#### F2. Highlight new items strongly

A peach background + 2 px solid orange ring + drop-shadow + `✓ Just installed` callout pill is the right intensity for "this just landed." A subtle background tint reads as default-state and the viewer doesn't notice.

```tsx
backgroundColor: "#fff5ee",
boxShadow: `0 0 0 2px ${ORANGE}, 0 8px 22px rgba(234,88,12,0.22)`,
```

#### F3. Counter flips: pulse halo + chevron rotation

When a count changes (`PROJECT (0) → (1)`):

- Rotate the chevron `▸ → ▼` (200 ms transition)
- Render a brief orange halo behind the count: opacity `0.45 → 0`, scale `0.4 → 2.2` over 18 frames
- Slide in the new children rows from `translateY: -12 → 0` over 24 frames

### G. Editor / SKILL.md edit patterns

#### G1. Replace, never remove, required fields

A skill must always have a `description`. To upgrade the description: **strikethrough the primitive line in red, slide the new description in below in green**. The skill is never description-less, even mid-animation.

#### G2. Keep version metadata out of editor content

`version` lives in **two** places only:

1. The sidebar pill on the skill row (with optional `↑` sync indicator)
2. The top-right pill in the main-pane skill-detail header

Do **not** render `version: "..."` inside the SKILL.md editor view — that's not where versions are stored, and showing it both there and in the pills creates "which one is real?" confusion.

#### G3. Save before Publish, with explanation

Always: **Save first → version bumps locally → ↑ sync indicator appears in sidebar → user clicks Publish → ✓ replaces ↑**.

After the Publish click, render an explanation toast (bottom-right) so the viewer knows what Publish actually does:

> **✓ Publishing — what this does:**
> 1. `git push → github.com/<owner>/<repo>`
> 2. Opens verified-skill.com / Submit — same repo, re-runs the scan pipeline
> 3. *v1.0.1 published — registry will index in ~30 s*

Stagger the lines: line 2 fades in ~1 s after the click, line 3 ~2 s.

### H. Terminal scenes

#### H1. Real prompt format

```
antonabyzov@Mac-1255 frontend-design % claude
```

No `(base)` conda prefix. Hostname is fine to keep. Use the user's actual workdir name — `~/Projects/TestLab/frontend-design` — not a placeholder.

#### H2. Claude Code section cards

Real Claude Code groups tool-call output in subtle cards. Use the canonical style:

```
●  Skill(frontend-design)
       ⌐ Successfully loaded skill
```

Wrapped in a content-width rectangle (`width: fit-content`, `align-self: flex-start`) — **do not stretch** the rectangle to the full row width.

#### H3. Show the rendered output, not just the code

After Claude finishes typing the markup, fade in a Chrome browser overlay showing what that markup actually renders to. Use the existing `site-good.png` / `site-excellent.png` assets and a verdict ribbon: `● v1.0.0 output — good, but not excellent`. The "what does AI-slop actually look like" payoff is the rendered page, not the code block.

#### H4. Larger window, larger type

Default terminal-window size: **1620–1720 px** wide, **30 pt** mono body text, **44 / 48 / 72 / 48** padding. Title bar: **17 pt**. Traffic dots: **14 px**. Cursor block: **14 × 32 px**. Anything smaller and the viewer can't read prompts at video distance.

### I. Voiceover discipline

#### I1. Regenerate voiceover whenever script.ts changes

The voiceover is generated from the joined `voiceText` fields of `HACKATHON_SCRIPT`. **If you edit any voiceText, run the generator again** before the next render:

```bash
ELEVENLABS_API_KEY=... node scripts/generate-hackathon-voiceover.mjs --voice sarah
ffmpeg -y -i public/hackathon-demo/voiceover-raw.mp3 \
  -af "loudnorm=I=-16:TP=-1.5:LRA=11" \
  -codec:a libmp3lame -b:a 192k \
  public/hackathon-demo/voiceover.mp3
```

Forgetting this step → the rendered MP4's narration doesn't match what's on screen.

#### I2. Voice: Sarah for ElevenLabs

Sarah (`EXAVITQu4vr4xnSDxMaL`) reads tech demos cleanly. Stable across long voiceovers. Lock it in:

```js
const VOICES = {
  sarah: { id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah" },
  // ...
};
```

#### I3. Audio levels — normalize to −16 LUFS, do NOT double-boost

The trap: it's tempting to apply `loudnorm` AND `volume=+8dB` to the voiceover.mp3, then ALSO apply `volume=+8dB` to the rendered MP4 "to be safe". That's ~16 dB of stacked boost on top of normalization — the result is harsh, peaks clip, and the user will tell you it's "too loud."

**Correct pipeline** (single normalization pass on the voiceover, no post-render boost):

```bash
# 1. Generate voiceover-raw.mp3 from ElevenLabs
# 2. Normalize ONLY (target -16 LUFS, the YouTube/podcast standard):
ffmpeg -y -i voiceover-raw.mp3 \
  -af "loudnorm=I=-16:TP=-1.5:LRA=11" \
  -ar 44100 -b:a 128k voiceover.mp3
# 3. Render with Remotion — voiceover plays at volume:1.0 in the composition,
#    bgm at volume:0.08. Mix sounds natural at -16 LUFS reference.
# 4. Do NOT post-process the rendered MP4 with volume=+8dB.
#    Just copy it to public/hackathon-demo/out/.
```

If you used to apply `+8dB` on the voiceover.mp3 AND `+8dB` on the rendered MP4, drop both. The single `loudnorm` pass is the correct level.

Target: voice mean ~−16 LUFS, max ~−1.5 dBTP. Music bed at 0.08 volume in Remotion. If the user says "too loud", you double-boosted — re-process voiceover.mp3 with `loudnorm` only and re-render (or just copy the un-boosted MP4).

#### I4. Voice end-sync with video — calculate from words, not vibes

The other voice trap: voice that overflows scenes (drift) or under-fills the video (silent tail). Both feel wrong.

**The math** for ElevenLabs Sarah on `eleven_v3` with em-dash-heavy narration:

```
sarah_wpm ≈ 122           # measured from prior renders, em-dashes slow it
target_voice_seconds = video_seconds − 5  # 5s buffer at end for clean fade
target_words = target_voice_seconds × sarah_wpm / 60
```

For a 184.5s video: target voice ~179s = ~365 words. Distribute proportionally per scene:

```
scene_word_budget = scene_seconds × sarah_wpm / 60
                  = scene_seconds × 2.04
```

A 12s scene gets ~24 words, a 24s scene gets ~49 words. Stay UNDER budget per scene — voice that ends slightly early in a scene reads as breathing room; voice that overflows into the NEXT scene reads as broken.

After regenerating, ElevenLabs reports `[done] duration=Xs`. Compare against video duration:
- If voice > video: you over-wrote. Trim 10-15 words and regen.
- If voice < video − 8s: you under-wrote. Voice will end too early. Add 10-15 words to the closing scenes.
- If voice within [video − 8s, video − 2s]: you're in the sweet spot.

**Per-scene drift detection:** if the user says "voice is way behind by AuthorPublish" or any mid-video scene, your earlier scenes have too many words. Voice text per scene must each fit within its visual scene duration — no scene's text should take longer to speak than that scene plays.

### J. Render workflow

#### J1. Background-render with a wait-loop

A full-length 1920×1080 demo at 30 fps takes 2–4 minutes. Don't busy-wait inside the agent:

```bash
nohup npx remotion render src/remotion/index.ts <Comp> out/video.mp4 \
  --concurrency=8 --log=info > /tmp/render.log 2>&1 &
```

Then a polling wait-loop in another `Bash` `run_in_background: true`:

```bash
until [ -f out/video.mp4 ] && ! pgrep -f "remotion render" > /dev/null; do sleep 5; done
echo "RENDER DONE"
```

Inside the wait-loop, immediately apply the audio boost so the next status report has the final levels.

#### J2. Always type-check after edits

```bash
npx tsc --noEmit --jsx preserve --target esnext --module esnext \
  --moduleResolution bundler --skipLibCheck --allowSyntheticDefaultImports \
  src/remotion/scenes/<edited-files>.tsx
```

A clean tsc run is cheaper than a 4-minute render that then crashes at frame 286 because of an inverted `interpolate` range.

### K. Things that cost time when skipped

- Letting `interpolate(frame, [a, b], …)` end up with `a > b` from constant arithmetic
- Setting `position: sticky` on a flex-column child without `width: 100%` (it collapses to content width and the nav looks centered mid-canvas)
- Forgetting to `Img` import + use `staticFile()` for image assets — direct `src="/..."` paths break in production renders
- Using `transform-origin: 50% 50%` on a scaled element when `50% 0%` would have been the right anchor for "grow toward viewer's eye"
- Editing `script.ts` without regenerating the voiceover
- Adding a new scene without updating `HackathonDemo.tsx`'s `SCENE_COMPONENTS` map (renders crash at runtime: `no component registered for scene id "X"`)
- Forgetting to swap `ConsumeInstalled` (or any mid-flow scene) `transitionType` to `null` when it's meant to feel continuous with the previous scene

---

### L. Workflow discipline (render budget)

#### L1. Render only when the user asks for it (HARD RULE)

A full 1920×1080 30 fps demo costs **3–5 minutes of wall-clock + ~5,000 frames of compute + nontrivial tokens** for status updates, frame extractions, and re-verification. **Do NOT render after every edit.** The user pays for every render.

**The rule:**
- Edit → type-check (`npx tsc --noEmit`) → batch more edits → STOP.
- Render only when the user explicitly says "render", "let's see it", "make a new video", or similar.
- During a long iteration, expect to make 5–15 edits between renders. This is normal.

**Why this isn't optional:** Studio HMR (`npx remotion studio`) live-reloads in the browser, so the user can preview specific frames or scenes at zero cost. The full-length render exists for delivery, not for verification of every micro-change.

**The signals to watch for:**
- ✅ "render it", "render the video", "let's see it", "ship it", "make a new MP4" → render now.
- ✅ A long batch of changes lands, tests pass, the user says "ok" or moves on → ask before rendering ("Render now?").
- ❌ "Add another rule to the skill" → do NOT render. Edit only.
- ❌ "Fix the cursor position" → do NOT render until they ask. Studio HMR shows the fix immediately in their browser.
- ❌ Any time the user explicitly says "don't render", "save tokens", "I'll ask when I'm ready" → respect it for the rest of the session.

**Anti-pattern:**
```
User: "Move the popup 20px to the left."
You: <edit + render full 167s video>
```
This burns minutes and tokens for a 1-pixel adjustment that the user could have verified in Studio in 1 second.

**Correct pattern:**
```
User: "Move the popup 20px to the left."
You: <edit + tsc + done — wait for next instruction>
```

#### L2. Batch edits between renders

When the user dictates several changes in a row, hold all of them in queue. Land them as edits, type-check, and render once at the end of the batch (and only if the user asks). A typical good cadence:

```
edit edit edit edit  →  tsc  →  user says "render"  →  render once  →  show results
```

#### L3. Voiceover regeneration is also a "render" — only when asked

Regenerating the ElevenLabs voiceover costs API credits and takes ~30s. Same rule applies: only when the user is ready for a new render or explicitly asks to refresh narration.

If the user makes a script.ts change that affects narration timing, note in the response "voiceover will need regeneration before next render" — but do not call ElevenLabs yet.

---

### M. Demo arc — before/after with the same prompt

The strongest demo shape is **same prompt, different output, mediated by a state change in your product**. For Skill Studio that's:

```
Slide N    : terminal — prompt "design a hero" → skill v1.0.0 → AI-slop output
Slide N+1  : browser — site-good.png with verdict "v1.0.0 — good, but not excellent"
…author edits + publishes v1.0.1…
Slide M    : terminal — SAME prompt → skill v1.0.1 → editorial output
Slide M+1  : browser — site-excellent.png with verdict "v1.0.1 — design has taste"
```

**Rules for the after-pair (M, M+1):**

1. **Pixel-mirror the chrome from the before-pair.** Same MacOsMenuBar, same window size, same title-bar tabs, same browser frame dimensions, same URL pattern (`localhost:3000/hero`). The viewer should read "this is the same page from earlier" — only the *content* should differ.

2. **Flip the highlight color.** Where the before-pair had `border: 2px solid #dc2626` (red, "this is the bug"), the after-pair uses `border: 2px solid #16a34a` (green, "this is the fix"). Keep the rectangle the same shape — content-tight, `display: inline-flex`, `width: fit-content` — so the geometry feels unchanged.

3. **Highlight the new version chip.** The new version (`v1.0.1`) gets a pulsing green pill next to the skill name. Use a slow sine-wave glow `boxShadow: 0 0 ${20 * pulse}px rgba(22,163,74,${0.5 * pulse})` so it reads as "this is what changed" without being shouty.

4. **Skip the typing animation for the prompt on the second take.** The viewer recognizes the prompt; making them watch it type a second time is wasted seconds. Render it pre-typed in the highlight block.

5. **Pair with a green verdict ribbon on the browser slide.** Match the red ribbon from the before-state position (bottom-center, pill shape, same typography). Just flip it to green and update the copy: "v1.0.1 output — design has taste". The visual rhyme with the earlier ribbon is what makes the payoff land.

6. **Editorial reply tokens get a green underline pulse, the inverse of the red AI-slop pulse.** Pick 3-5 design-system tokens from the new code (`font-serif`, `tracking-widest`, `bg-stone-50`, `font-light`) and pulse them in green — same animation pattern as the bug-red pulse, opposite color, opposite meaning.

The whole arc reads in one beat: *same prompt + new version → completely different product*. That's the whole product, condensed.

---

### N. Outro polish — feature pills should not look like a bullet list

A flat row of pills with single-glyph icons (`❤ ⌂ ⛨`) reads as "PowerPoint slide." Make them look like a product page:

1. **Inline SVG icons, not unicode glyphs.** Custom 44×44 line-art SVGs in a 84×84 round-square tile. Examples:
   - Open Source → git-branch (two circles connected by a curved path)
   - 100% Local → shield with a checkmark
   - Enterprise-Ready → three stacked diamonds (SSO + audit + scoped)

2. **Each tile gets a colored gradient + glow halo that pulses.** Slow sine wave, slightly out of phase per pill, so they don't bob in unison.

   ```ts
   const glowPhase = (frame / 75 + i * 0.4) * Math.PI * 2;
   const glowAmount = (Math.sin(glowPhase) + 1) / 2;
   boxShadow: `0 0 ${24 * glowAmount}px ${color}66, 0 0 ${48 * glowAmount}px ${color}33`;
   ```

3. **Hairline accent stripe at the top edge of each card** in the brand color, fading to transparent at both ends with `linear-gradient(90deg, transparent 0%, ${color} 18%, ${color} 82%, transparent 100%)`. This makes the card feel "tagged" rather than generic.

4. **Continuous gentle float on each card.** A 3-pixel sine bob with phase offset:
   ```ts
   const floatY = Math.sin((frame / 90 + i * 0.5) * Math.PI * 2) * 3;
   ```
   This animation alone makes a static slide feel premium.

5. **Soft outer halo ring** behind the icon tile — `radial-gradient(circle, ${color}22, transparent 70%)` at `inset: -8`, opacity tied to the same glow pulse. Subtle but the eye reads it as "this is real."

6. **Bigger, heavier label typography.** `fontSize: 26, fontWeight: 800, letterSpacing: -0.4` — the label should feel as confident as the wordmark above it.

The trap to avoid: animations that distract from the wordmark and tagline above. Keep the float amplitude ≤ 4px and the glow `0.3 → 1.0` (don't go to zero — it reads as flicker). The pills are a closing reassurance, not the focal point.

---

### O. Reference verification — the screenshot wins over the timestamp

When the user says **"make it like at 3:40 of the YouTube video"** AND attaches a screenshot in the same message, the **screenshot is the authoritative reference**, not the YouTube timestamp.

In one session: the user said "use like it was displayed here — on 3:40 on YouTube" and pasted a screenshot of their actual Skill Studio detail page. The agent extracted YouTube at 3:40 and got a "Claude Managed Agents" slide from a totally unrelated talk — and faithfully copied THAT slide's labels and bullets into the demo. The user was furious: "Stop hallucinating. You see the image? Or grab the same image from the YouTube video on 3:40."

**The rule:**
1. If the user pasted/attached an image in the message, that's the reference. Read it carefully (Read tool on the temp file path).
2. If the user only gave a timestamp, extract that frame from the source video with `ffmpeg -ss N -i ... -frames:v 1 -update 1 -y out.png`.
3. If both — the **image they pasted** wins. The timestamp may be approximate / a different video / mis-remembered.
4. If you're unsure which is right, ASK — don't pick the wrong one and copy faithfully.

This single mistake cost ~15 minutes of round-tripping and one section that had to be completely rewritten. Always check the actual image before adopting "reference content".

---

### P. Studio detail-page mirror — the 8-card stats grid pattern

Real product demos benefit from showing the actual product UI as the user sees it. For Skill Studio, that means the **detail page** of an installed skill — not a presentation slide. The pattern (verified against the user's screenshot of the live product):

**Top section (above tabs):**
```
.claude › ● PROJECT
frontend-design                                      v1.0.0
anton-abyzov  SKILL.md ↗
INSTALL METHOD  Copied (independent)
[ /Users/antonabyzov/.claude/skills/frontend-design  📋 Copy ]
🔒 This is an installed copy of the skill. Editing, …  Uninstall
Check now
```

**Tab strip:** Overview · Trigger · Versions (only three on this consumer view; the authoring view adds Tests · Run).

**Overview content:**
```
frontend-design  v1.0.0  COPIED
— frontend-design · Updated just now
```

**Stats grid — 4 columns × 2 rows = 8 cards:**

| BENCHMARK | TESTS         | ACTIVATIONS | LAST RUN |
|-----------|---------------|-------------|----------|
| —         | 0             | 0           | —        |
| Never run | 0 assertions  | Never       |          |

| MCP DEPS | SKILL DEPS | SIZE   | LAST MODIFIED            |
|----------|------------|--------|--------------------------|
| 0        | 0          | 1.9 KB | just now                 |
| None     | None       |        | 2026-04-27T02:11:22.424Z |

Each card: tracked-uppercase label (11pt, +1.4 letter-spacing) · mono value (26pt, 700 weight) · sub-line (12pt, muted). LAST MODIFIED uses mono for the timestamp sub-line. Card padding "16px 18px", radius 10, surface bg, 1px border, min-height 110.

This is "the product, not a slide" — the viewer sees a real Studio page they could navigate to themselves. Use this pattern any time the user shows you a screenshot of the live product they want mirrored.

---

### Q. Cursor-meets-button geometry — re-derive, don't guess

Cursor click moments fail visually when the cursor floats near but doesn't TOUCH the button. The fix is geometry, not iteration:

**1. Derive button position from layout, not from a render.**

Layout math example (Generate Skill button in AuthorCreate, behind a 1.18× camera zoom anchored at bottom-center):

```
sidebar_width = 320
main_pane_padding_left = 36
button_left_unzoomed   = 320 + 36 = 356
button_width           = 244       # padding(22) + ✨(20) + gap(8) + text + padding(22)
button_center_unzoomed_x = 356 + 122 = 478

# Camera transform: scale(1.18) transformOrigin: 50% 100%
button_center_x_zoomed = 960 + (478 − 960) × 1.18 = 391
button_center_y_zoomed = 1080 + (button_y_unzoomed − 1080) × 1.18
```

**2. Account for the cursor SVG tip offset.**

The standard arrow-cursor SVG has its visible tip at offset `(3, 2)` within its 26×32 bounding box. To land the tip ON the button center, the SVG top-left must be at `(button_cx − 3, button_cy − 2)`.

**3. Rule of thumb for camera-zoomed scenes:** put the cursor OUTSIDE the camera-zoom wrapper (so its coordinates are canvas-space), and apply the inverse-of-zoom math above to find the canvas-space landing target.

**4. Verify with one frame extraction**, not a full render. Once you've placed the cursor:

```bash
ffmpeg -ss <click_seconds> -i video.mp4 -frames:v 1 -update 1 -y check.png
```

Read the PNG. If cursor isn't ON the button, fix the math BEFORE re-rendering the whole video.

---

### R. Connection-line aesthetics — bold, not subtle

Lines that represent "X is connected to Y" (install arrows, sync indicators, anything edge-like) should be **bold and energized** when active, not 1-2 pixels of 50% alpha. Subtle reads as "this might be a hairline gridline" — exactly the wrong message.

**Active / connected (green):**
- Height: **4px** (not 2px)
- Color: `rgba(34, 197, 94, 0.95)` (not 0.55)
- borderRadius: 2
- Glow: double-stack `boxShadow: 0 0 10px rgba(34, 197, 94, 0.65), 0 0 20px rgba(34, 197, 94, 0.35)`

**Broken / disconnected (red, dashed):**
- Same height
- Repeating linear-gradient for dash effect: `repeating-linear-gradient(90deg, rgba(239,68,68,0.6) 0 8px, transparent 8px 16px)`
- Glow that grows with the break-progress: `0 0 8px rgba(239, 68, 68, 0.6)`

The contrast between bold-green-active and dashed-red-broken is the visual story. If the active line is too thin, the break doesn't read as dramatic — it reads as "the line just got slightly redder."

---

### S. YouTube publication kit — what to add when shipping a hackathon demo

When the demo is rendered, the next step is publishing. Before uploading, prepare:

#### S1. Chapter timestamps from script.ts

Compute chapters by walking `HACKATHON_SCRIPT` and accumulating effective frames (raw frames minus `HACKATHON_TRANSITION_FRAMES` per non-null transition):

```ts
let runningEffective = 0;
for (const scene of HACKATHON_SCRIPT) {
  const startSec = runningEffective / HACKATHON_FPS;
  // emit "M:SS  <chapter title from scene.caption or visualNotes>"
  runningEffective += scene.durationFrames;
  if (scene.transitionType !== null && !isLast) {
    runningEffective -= HACKATHON_TRANSITION_FRAMES;
  }
}
```

YouTube chapter rules:
- First chapter MUST be `0:00`
- Minimum 3 chapters
- Each chapter ≥ 10 seconds — merge or drop short scenes (e.g., a 4s BrandReveal merges into the previous Hook chapter; an 8s Outro can be dropped from the chapter list since the description still ends with the CTA)
- Title format: action-oriented, present tense, ≤40 chars ("Edit, save, publish v1.0.1" beats "AuthorEditAndPublish scene")

#### S2. Description structure (1500–2500 chars)

```
[Hook line 1 — punchy problem statement, ≤80 chars]
[Hook line 2 — the fix, ≤80 chars]

[3-4 lines: what this is, why it matters]

Try it now:
$ npx vskill@latest studio
Web: https://verified-skill.com

🔗 Links
GitHub:        https://github.com/<owner>/<repo>
Registry:      https://verified-skill.com
…

⏱️ Chapters
0:00 …
0:21 …
…

🛠️ Built with
Anthropic Skills API · Claude Opus 4.7 · Remotion 4.0 · ElevenLabs · Next.js · Cloudflare Workers · Prisma

About the author
[1-line author bio]

#ClaudeCode #AnthropicSkills #DevTools #OpenSource #BuiltWithClaude
```

The first two lines must fit in YouTube's above-fold preview (~150 chars).

#### S3. Title, tags, hashtags

- **Title** ≤60 chars, dev-direct (not clickbait): `I built a Claude Code Skills manager with Opus 4.7` works; `🤯 You won't BELIEVE what I made…` doesn't.
- **Tags** (15-20): primary keyword first ("claude code"), then variants, then long-tail.
- **Hashtags** (3-5 above title): `#ClaudeCode #Opus47 #BuiltWithClaude #AITools #OpenSource`. Verify any hackathon-mandated hashtag from the official submission portal — don't invent.

#### S4. Thumbnail

- 1920×1080
- Left third: face (mid-expression, not exaggerated). Dev-tool demos with builder face still outperform faceless thumbnails in 2026.
- Right two-thirds: hero UI screenshot
- Primary text overlay ≤4 words, top-right, white with black stroke
- Brand color accent (e.g., Anthropic-adjacent #D97757) on a small badge
- Keep face + text out of the bottom 15% (player overlays cover that)

#### S5. Hackathon submission verification

Before submitting:
- Confirm the deadline UTC inside the official participant portal — don't trust third-party recaps
- Confirm any mandated hashtag (and use it verbatim in social posts)
- Verify judge handles before tagging — don't fabricate

If the hackathon page is gated to authenticated viewers, say so honestly in the publish kit and ask the user to copy details from their dashboard.

---

## Appendix — File-shape cheat sheet for a hackathon demo

```
src/remotion/
  index.ts                   ← entry point (calls registerRoot)
  Root.tsx                   ← <Composition id="..." component={...} />
  HackathonDemo.tsx          ← top-level: TransitionSeries + Audio (bgm + voiceover)
  scenes/hackathon/
    script.ts                ← single source of truth: id, durationFrames,
                               transitionType, voiceText, caption, visualNotes
    StudioHeader.tsx         ← shared canonical Studio chrome
    Hook.tsx, Brand.tsx,
    Browse.tsx, AuthorCreate.tsx, AuthorEvals.tsx, AuthorPublish.tsx,
    ConsumeInstall.tsx, ConsumeBugSurface.tsx,
    AuthorEditAndPublish.tsx,
    Update.tsx (= UpdateButton scene with bell-popup prelude),
    ConsumeReuseUpdated.tsx, ConsumeBrowserExcellent.tsx, Outro.tsx
    uiTokens.ts              ← STUDIO_LIGHT, VERIFIED_DARK, TERMINAL_UI, FONTS
public/hackathon-demo/
  skill-studio-logo.png      ← bell-badge logo, used by every Studio scene
  bgm.mp3                    ← background music
  voiceover.mp3              ← normalized + boosted, generated from script.ts
  voiceover-raw.mp3          ← raw output from ElevenLabs (kept for re-normalization)
  site-good.png, site-excellent.png  ← rendered-page screenshots for browser overlays
  provider-icons/*.png       ← real Claude/Anthropic/OpenAI/etc. icons
scripts/
  generate-hackathon-voiceover.mjs   ← reads script.ts voiceTexts, joins them,
                                       calls ElevenLabs, writes voiceover-raw.mp3
out/
  hackathon-demo.mp4         ← final, audio-boosted MP4
```

The script.ts entry shape:

```ts
{
  id: "AuthorEditAndPublish",
  durationFrames: 450,        // 15 s @ 30 fps
  transitionType: "fade",     // "fade" | "slide-left" | "slide-right" | null
  voiceText:
    "The author opens the Edit tab on frontend-design, strikes the primitive description, and pastes real design rules…",
  caption: "Edit · Save (local) · Publish (registry)",
  visualNotes:
    "Mirrors at-243s. Studio chrome with breadcrumb Authoring/skills/frontend-design...",
}
```

Keep `voiceText` and `visualNotes` honest — they regenerate the audio and document the design intent. Future iterations rely on them.

---

## Final reminder

The thing that turns a Remotion composition from "looks like a slideshow" into "looks like the product" is **fidelity to references and consistency across scenes**. Don't approximate. Pull the keyframe, study it, match it. Reuse the same `StudioHeader`, the same sidebar widths, the same counts, the same logo, the same red-for-bug / orange-for-new color discipline. When you do that, the viewer's brain stops noticing the video as a video and starts watching the product.
