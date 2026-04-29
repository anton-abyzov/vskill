---
version: "1.0.0"
name: remotion-best-practices
description: "Best practices for Remotion video creation in React — scaffolding, compositions, animations, transitions — PLUS hard-won rules for high-fidelity product-demo videos: real logos/icons, precise YouTube-reference matching, full-screen camera zooms, click-targets that actually hit, content-tight rectangle highlights, voiceover regeneration discipline, and the editorial polish that makes a demo feel like the product, not a slideshow."
metadata:
  tags: remotion, video, react, animation, composition, demo-videos, product-demos, voiceover
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
> attribution) are vSkill Studio specifics — translate, do not copy.

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

#### I3. Audio boost the rendered MP4

Remotion's volume mixing tends to render audio quieter than expected (mean ~–20 dB, max ~–6 dB). **Always post-process** with a +8 dB volume boost so playback hits a normal listening level:

```bash
ffmpeg -y -i hackathon-demo.mp4 \
  -c:v copy \
  -af "volume=8dB" \
  -c:a aac -b:a 192k \
  hackathon-demo-loud.mp4
```

Target: mean −10 to −12 dB, max 0 dB.

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
    AuthorEditAndPublish.tsx, ConsumeSyncUpdate.tsx,
    UpdateButton.tsx, Outro.tsx
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
