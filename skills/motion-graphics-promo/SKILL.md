---
name: motion-graphics-promo
description: "After Effects-style motion graphics for short product promos (15-45 s, vertical or landscape), built as code with HyperFrames + GSAP instead of Adobe After Effects. Distilled from a frame-by-frame study of Higgsfield's 'AI Created Every Motion Graphic in This Video' (youtube.com/watch?v=W3-RIZ-Ps64) plus a product-overview structure analysis. Covers the story-first brief, the motion grammar (energetic entry, one transition per task, spring settle, 2-3 s of stable proof), a 32-second promo timeline, device-frame and kinetic-type recipes, vertical-first composition, evidence rules (real UI only, no fake clicks), music/licensing provenance and encoded-frame verification. Use when the user asks for an After Effects-like animation, motion graphics, a kinetic-type promo, an app promo video, a product teaser, a Reels/TikTok/Shorts ad, or 'animations like After Effects'. Also covers short explainer/tutorial videos and 15-second vertical ads: a proven design kit (footage beds, condensed caps with a marker box, white device frames, falling stickers, voice-over with music ducking) and the HyperFrames render traps that silently break output. Pairs with hyperframes-best-practices (screencast pipeline) and remotion-best-practices."
metadata:
  version: "1.1.0"
  author: Anton Abyzov
  tags: after-effects, motion-graphics, promo-video, hyperframes, gsap, kinetic-typography, vertical-video, ads
---

# motion-graphics-promo

After Effects-quality motion, authored as HTML/GSAP compositions and rendered deterministically with HyperFrames. You get editable source, exact native-screen fidelity and a reproducible render, which a hand-keyed After Effects project does not give an agent.

Source study: Higgsfield AI, "AI Created Every Motion Graphic in This Video" (YouTube `W3-RIZ-Ps64`, 11:33, Sep 2026), inspected at 720p with contact sheets, plus the pacing of a 4-minute official SaaS product overview. Use them for grammar and pacing only. **Never reuse their pixels, music, voice, logos or UI.**

## 1. Brief before motion (lock the story first)

The tutorial spends its first minutes turning a brief into asset choices and a storyboard before anything moves. Do the same, in five lines:

1. **Audience and moment**: who is watching, on which platform, sound on or off.
2. **One product, two jobs, one next step**: the viewer should remember exactly that.
3. **Proof inventory**: real screenshots and screen recordings you actually have, with source build/date. Anything not in this list cannot appear on screen.
4. **Palette and type**: the brand's own identity. Borrow the reference's *contrast level* (bold condensed type over saturated fields), not its exact colors.
5. **Aspect**: design vertical (1080x1920) as its own composition; don't crop landscape.

## 2. Motion grammar

| Beat | Rule | Why |
|---|---|---|
| Entry (0-3 s) | Energetic: a label falls, rotates, bounces and **settles once**; or a device drops in with weight. | Hooks the scroll-stop without hiding the product. |
| Transition | **One main transition per task.** A phone slides or tilts between color fields, or navigation hands off to the next real screen. | Motion should explain grouping or movement between actual product states. |
| Settle | Short spring (GSAP `back.out(1.4)` or `elastic.out(1, 0.6)`, 0.4-0.7 s). The device settles *before* the screen needs reading. | Physical weight reads as premium; wobble during reading reads as noise. |
| Proof hold | **At least 2-3 s of stable, readable screen** after each transition. | Screens need more reading time than decorative labels. |
| Accents | Masked/clip-reveal typography, rectangular color accents, collage or color-field handoffs. Use sparingly. | This is the "After Effects look"; overuse turns into a template. |

Timing defaults: 60 fps; entries 0.5-0.9 s; label staggers 60-90 ms; never animate text the viewer must read while they read it.

## 3. The 32-second promo timeline

| Time | Purpose | Evidence rule |
|---|---|---|
| 0-4.4 s | Recognizable user problem, one concise line over licensed B-roll or a bold color field. | No invented testimonial or customer identity. |
| 4.4-13.3 s | Real screen sequence for the first job, with navigation continuity. | Actual supported path; no fake clicks or synthetic UI. |
| 13.3-22.2 s | A second complementary job with a visible outcome the recording proves. | Select from verified footage; don't import a competitor's claims. |
| 22.2-26.7 s | Return to the payoff and product identity. | Phrase as purpose or invitation, not unmeasured time or revenue savings. |
| 26.7-32 s | Single CTA with URL and truthful availability; musical release. | Match the live destination and exact release status. Keep the music credit. |

For longer consideration-stage videos, follow the official-overview structure instead: human context first, then one workflow per chapter, return to the people between tools, brand close.

## 4. Build it (HyperFrames + GSAP)

1. Scaffold a HyperFrames composition (see the `hyperframes-best-practices` skill for CLI, lint and render gotchas). Pin the HyperFrames version and a local GSAP 3 build in the project; don't load animation runtimes from a CDN at render time.
2. **Device frame**: a dimensional graphite shell (soft top light, 1-2 px bevel highlight, contact shadow) holding a real screenshot or a muted `<video>` of a screen recording. Animate the shell with `translate3d`/`rotate`, keep the screen content upright and unscaled once settled.
3. **Kinetic type**: split headline into words; `gsap.from(words, {yPercent: 110, rotate: 4, stagger: 0.07, ease: "back.out(1.6)"})` inside an `overflow: hidden` mask. One headline per beat.
4. **Color-field handoff**: full-bleed rectangles wipe (`clip-path: inset()` tween) between beats; the incoming field carries the next device position.
5. **Timeline**: one master `gsap.timeline({paused: true})` with labels per beat (`"problem"`, `"job1"`, `"job2"`, `"payoff"`, `"cta"`), so HyperFrames can seek any frame deterministically.
6. **Music**: licensed track only (e.g. CC BY with credit). Record source URL, license, credit line and file hash in `audio-provenance.json`; edit to a composed ending on the CTA beat.
7. Render at the target resolution/fps; H.264 + stereo AAC for social.

## 5. Explainer and ad design kit (proven in production)

This kit shipped a series of product explainers and 15-second vertical ads. The first version used dark backgrounds and was rejected as "too black". What worked:

- **Real footage behind every scene**: licensed stock footage of the product's real-world context (e.g. match footage for a sports app), graded with a brand-color gradient (`linear-gradient(180deg, brand 74% → transparent → ink 50%)`), plus `saturate(1.3) brightness(1.12)` on the bed.
- **Palette**: one saturated brand color plus one high-energy accent (e.g. violet `#6c4cff` + lime `#d7ff3c`), with sky/coral as stickers only and ink `#16132e` for text on the accent.
- **Type**: condensed display caps (Archivo, `font-stretch` 75-80%, weight 900, 74-96 px on 1080-wide). The key word of each headline sits in an accent **marker box** rotated -2°. Check glyph coverage per language: Archivo has no Cyrillic, so switch to Inter for ru/uk/bg.
- **Device frames**: white/silver phone and browser frames with a 3D perspective stage (`perspective: 1800px`) showing real screenshots or real screen recordings. Every screen must show real content (people, logos and data), not empty states.
- **Falling stickers**: 2-3 short uppercase labels drop in, rotate and settle next to the device (one per beat).
- **Transitions**: an angled accent-color wipe or a 2-frame white flash between beats.
- **Voice-over** (TTS or recorded) with music ducked under it, then the final mix normalized to **-14 LUFS** (`ffmpeg -af loudnorm=I=-14:TP=-1.5:LRA=11`).
- **Real device capture** (macOS): iPhone Mirroring plus `screencapture -v -V <secs> -R<x,y,w,h>` records a real app. Activate the mirroring window before sending taps. The phone must be locked for Mirroring to connect.
- **Localized variants**: keep one template with `{{placeholders}}` and generate a copy per language with a small script (see `references/vertical-ad-15s.template.html`).
- **UTM on every link** in captions and bios: `?utm_source=<platform>&utm_medium=organic&utm_campaign=<video-slug>`.

### Render traps (each one nearly shipped a broken video)

- **HyperFrames can silently drop every overlay partway through the render** when a composition has many `<video>` clips (6+ beds, or beds plus phone clips). Preview snapshots still look fine. Pre-concatenate footage beds into **one** video, keep clip count low, and always inspect a contact sheet of the **rendered MP4** before scheduling.
- GSAP `fromTo` with `autoAlpha: 1` in the *from* vars shows elements at authoring time. Use `tl.set(el, {autoAlpha: 1})` and then `fromTo` without it.
- Uploads to social schedulers sometimes return an empty body. Retry, and confirm the hosted file's byte size matches before scheduling.
- Real people's faces and names on screen (players, customers) need their consent before paid or public use. Flag it if it's missing.

## 6. Verify the encoded file, not the preview

- Extract frames from the **delivered MP4** (e.g. `ffmpeg -i out.mp4 -vf fps=2 frames/%03d.png`) and read them: is every screen readable during its hold, does any caption overlap the platform UI safe zones, does text ever appear mid-animation when it must be read?
- Check decode completes, duration, fps, frame count, loudness and peak; record the SHA-256 of the final file.
- Run HyperFrames lint/layout checks and a contrast sample on caption frames.
- Keep a manifest binding every source asset (screens with build/date, B-roll license, music license) to the final hash.

## 7. Boundaries

- Real UI only. If a flow cannot be recorded (sign-in stalls, feature not shipped), cut it; never mock it.
- Downloaded reference videos, contact sheets and transcripts are private analysis material; never upload them with the creative.
- No popularity, ROI or time-saved claims unless measured and sourced.
- Creative approval is not publication: scheduling and posting are separate, confirmed steps.
