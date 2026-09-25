---
name: kie-gemini-omni
description: Submit-and-poll harness for Kie AI image + video models. IMAGE generation default is GPT Image v2 (`gpt-image-2-text-to-image` / `gpt-image-2-image-to-image`) — best text rendering, the right tool for X-reply attachments, ad creative, posters/cards, blog hero images, brand visuals; Nano Banana Pro (`nano-banana-pro`) is the fallback. VIDEO generation via `gemini-omni-video` for short-form B-roll. Replaces the deprecated Veo3 path. Handles the safety-filter rejections, Cloudflare CDN 403, duration rounding, and 500 transient errors that bite first-time users. Activate when the user mentions Kie AI, GPT Image, Gemini Omni, Nano Banana, generate-an-image-via-Kie, or wants to produce AI images/short clips through kie.ai's /api/v1/jobs/createTask endpoint.
metadata:
  version: 1.0.0
  author: Anton Abyzov
---

# Kie Gemini Omni — image + video generation harness

You drive Kie AI's job queue (`/api/v1/jobs/createTask` + `/api/v1/jobs/recordInfo`) to produce images and short clips through Google's Gemini-family models. **Veo3 is deprecated** — use Nano Banana Pro for stills, `gemini-omni-video` for clips.

## When to use which model

| Use case | Model ID | Aspect / resolution | Latency |
|---|---|---|---|
| **DEFAULT — X-reply image, blog hero, brand visual, poster, diagram** | **`gpt-image-2-text-to-image`** (GPT Image v2, Anton's pick) | aspect_ratio auto/16:9/1:1/9:16/… , resolution 1K/2K/4K | 30-120 sec |
| Edit / restyle an existing image, or composite with reference images | **`gpt-image-2-image-to-image`** | same; pass refs via `input_urls` (public URLs) | 30-120 sec |
| Fallback if GPT Image v2 errors or rejects the prompt | `nano-banana-pro` (Gemini 3 Pro Image) | 16:9, 1:1, 9:16 — 1080p/2K | 10-30 sec |
| Cheap batch images (~20+ at once) | `nano-banana-2` (Gemini 3.1 Flash Image) | same | 5-15 sec |
| Short-form vertical clip 6-10s (TikTok/Reels/Shorts B-roll) | **`gemini-omni-video`** | 9:16, 16:9, 1:1, up to 10s | 90-300 sec |

**Default still model is `gpt-image-2-text-to-image`** (per Anton, 2026-06-01). It renders on-image text far more reliably than Nano Banana and is the right tool for posters/cards with words. Nano Banana Pro is the fallback only. **Note the param differences vs Nano Banana:** GPT Image v2 uses `resolution: 1K|2K|4K` (NOT `1080p`), takes `aspect_ratio` (default `auto`; `1:1` cannot go `4K`), and does NOT take `output_format` (returns PNG). Result still comes back as `.data.resultJson` → `.resultUrls[0]`, same poller, same Cloudflare-UA download gotcha.

**Never use Veo3** — Kie still exposes the endpoint for backwards compat, but the model is outdated, the prompts you'd write for Veo3 don't translate, and Gemini Omni Video produces equivalent or better output at lower credit cost.

## Pre-flight (every run)

```bash
export KIE_API_KEY=$(security find-generic-password -s 'kie-api-key' -w 2>/dev/null || cat ~/.config/kie/api_key)
test -n "$KIE_API_KEY" || { echo "KIE_API_KEY missing"; exit 1; }
```

API key lookup order:
1. `KIE_API_KEY` env var
2. macOS Keychain `kie-api-key`
3. `~/.config/kie/api_key`
4. Obsidian: `003 Resources/Technical Knowledge/Credentials-Secrets-Passwords/Kie creds.md`

## Pattern A — Image (GPT Image v2, default)

The single most common use. ~30-120 sec end-to-end.

### Submit

```bash
TASK_ID=$(curl -sS -X POST https://api.kie.ai/api/v1/jobs/createTask \
  -H "Authorization: Bearer $KIE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-image-2-text-to-image",
    "input": {
      "prompt": "<your prompt — see prompt-craft section below>",
      "aspect_ratio": "16:9",
      "resolution": "2K"
    }
  }' | jq -r '.data.taskId')

echo "taskId=$TASK_ID"
```

`aspect_ratio`: `auto` (default) | `1:1` | `3:2` | `2:3` | `4:3` | `3:4` | `16:9` | `9:16` | `2:1` | `1:2` | `21:9` | … · `resolution`: `1K` | `2K` | `4K` (`1:1` cannot be `4K`). No `output_format` field — returns PNG. Verified live 2026-06-01: returns 2048×1152 at 2K/16:9.

**Image-to-image / edit / reference compositing** — same endpoint, model `gpt-image-2-image-to-image`, add `"input_urls": ["https://public-url/ref.png"]` (must be public URLs, not local paths or data URIs):

```bash
  -d '{ "model":"gpt-image-2-image-to-image",
        "input": { "prompt":"<edit instruction>", "input_urls":["https://.../ref.png"], "aspect_ratio":"16:9", "resolution":"2K" } }'
```

**Fallback model** if GPT Image v2 errors twice or rejects the prompt — swap `"model":"nano-banana-pro"` and use `"output_format":"png","resolution":"1080p"` (Nano Banana uses `1080p`/`2K`, NOT `1K/2K/4K`).

For batches, send multiple createTask calls in parallel — Kie tolerates concurrent submissions per account.

### Poll

```bash
poll_kie() {
  local tid=$1
  for i in $(seq 1 60); do
    resp=$(curl -sS "https://api.kie.ai/api/v1/jobs/recordInfo?taskId=$tid" \
      -H "Authorization: Bearer $KIE_API_KEY")
    state=$(echo "$resp" | jq -r '.data.state')
    case "$state" in
      success) echo "$resp" | jq -r '.data.resultJson' | jq -r '.resultUrls[0]'; return 0 ;;
      fail)    echo "$resp" >&2; return 1 ;;
      *)       sleep 3 ;;
    esac
  done
  echo "timeout" >&2; return 2
}

URL=$(poll_kie "$TASK_ID")
echo "Got: $URL"
```

### Download (Cloudflare CDN gotcha)

Kie's `tempfile.aiquickdraw.com` CDN **rejects** the default `Python-urllib/3.9` user agent with HTTP 403. Always force a Mozilla UA:

```bash
curl -sS -A 'Mozilla/5.0' -o ./image.png "$URL"
```

In Python:
```python
import urllib.request
req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
with urllib.request.urlopen(req) as r, open(out, "wb") as f:
    f.write(r.read())
```

## Pattern B — Video (`gemini-omni-video`)

Use only for short-form B-roll, ad creative, social clips. 1-2 min latency per clip; submit-and-walk-away.

### Submit

```bash
curl -sS -X POST https://api.kie.ai/api/v1/jobs/createTask \
  -H "Authorization: Bearer $KIE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-omni-video",
    "input": {
      "prompt": "<prompt — see safe-prompts below>",
      "aspect_ratio": "9:16",
      "duration": 8,
      "image_urls": ["https://path/to/reference.png"]
    }
  }'
```

- **`duration`**: requested values of 4 or 6 routinely come back as 8 or 10. Either pre-trim with ffmpeg or accept the longer clip.
- **`image_urls`**: optional reference images. Up to 3-5. Pass real images (uploaded to your own CDN or Postiz, not data URIs).
- **Aspect**: `9:16` for vertical (TikTok/Reels/Shorts), `16:9` for horizontal, `1:1` for IG square.

### Poll + download

Same as Pattern A. Download via `curl -A 'Mozilla/5.0'`.

## Failure modes (and how to recover)

| Symptom | Cause | Fix |
|---|---|---|
| HTTP 500 on createTask (image OR video) | Kie transient cluster error | Retry up to 3x with same payload. ~30% of first-submissions on busy days return 500; the retry almost always succeeds. Credits **are not** charged on these. |
| `state: fail` with `PUBLIC_ERROR_UNSAFE_GENERATION` | Safety filter rejected the prompt | **Rewrite, don't retry.** Common triggers below. |
| `state: fail` with generic `INTERNAL_ERROR` | Stochastic failure | Retry up to 3x. Credits refunded. |
| Image downloads as 403 / empty | Cloudflare CDN UA reject | Use `-A 'Mozilla/5.0'`. |
| Image text is garbled | Nano Banana Pro can produce bad typography under stress | Pre-render text in a layer (Pillow/Sketch) and overlay yourself. Don't ask the model for fine typography in small font sizes. |
| Video duration is 8s when you asked for 4s | Kie rounding | Trim in post: `ffmpeg -i in.mp4 -t 4 -c copy out.mp4`. Or accept. |

### Safety filter triggers (avoid these in prompts)

Hard-learned from the 2026-05-22 JobWeave campaign:

- **Rejection-letter language**: "we've decided to move forward with other candidates", "position has been filled". Use generic "status update" phrasing.
- **Competitor brand verbatim** in body text: "Claude AI", "ChatGPT", "OpenAI", "Google" rendered as on-screen text. Filter is fine with these in non-rendered prompt sections; just don't ask the model to render the logo or product name.
- **Google OAuth modal flashes** in screen recordings. Use a generic "sign-in modal" instead.
- **Lip-sync motion shorter than 3 seconds**. Either render with motion-blurred lips, or no lip motion at all, or extend to ≥3s.
- **Identifiable people on video calls** that the model would have to fabricate. Use blurred neutral avatars (initials over a soft colored circle) — preserves intent without the filter trigger.
- **Real CEOs / public figures** by name when asked to render them visually. Generic descriptive prompts only.

The filter is intermittent. The SAME prompt can fail 3 times and succeed on attempt 4 unchanged. After 2 same-prompt fails, **rewrite**, don't keep retrying.

## Prompt craft (Nano Banana Pro)

This model rewards specific, photoreal-cinematic prompts with clear composition. Pattern:

```
{Style}, {camera + lens}, {lighting + time of day}.
Subject: {2-3 sentences describing the central element with brand colors and aesthetic}.
Composition: {framing — close-up / wide / split-screen / panel}.
Text on image: {if any — keep to 1-2 short labels, large size, sans-serif, in quotes}.
Mood: {one adjective}.
Avoid: {anything you don't want}.
```

Example for an X reply on the spec-driven dev angle:

```
Vertical 16:9 photoreal cinematic, 35mm shallow depth of field. Cool blue-gray studio lighting.
Subject: A clean dark-mode terminal window centered in frame, showing 3 stacked spec files (spec.md, plan.md, tasks.md) with crisp purple syntax highlighting. The file titles are legible in white sans-serif.
Composition: tight centered framing, slight perspective tilt.
Text on image: A single white sans-serif label in the upper-third reading exactly "ship the spec, not the prompt."
Mood: confident.
Avoid: garbled text, third-party logos, generic stock aesthetics.
```

## Prompt craft (gemini-omni-video)

10-second cap per clip. For longer videos, render multiple clips and concatenate.

```
Vertical 9:16 photoreal cinematic, {duration} seconds, shallow depth of field 85mm.
{Lighting + setting + time of day}.
{Subject description — keep continuity-friendly: same person, same outfit, same room across multi-clip sequences via image_urls references}.
{Action timeline using t=0s, t=2s, t=4s markers}.
{Text overlays — fixed sans-serif labels with exact quoted text}.
{Audio direction — "soft ambient room tone, no music" is the safest default}.
{Negative cues — "no garbled text, no recognizable third-party logos, photoreal skin"}.
```

## Aspect-ratio cheat sheet

| Platform | Use | Aspect | Resolution to request |
|---|---|---|---|
| X reply / quote / blog hero | image | 16:9 | 1080p (= 1920×1080) |
| TikTok / Reels / Shorts | image OR video | 9:16 | 1080p (= 1080×1920) |
| Instagram feed | image | 1:1 OR 4:5 | 1080p |
| LinkedIn document | image | 1:1 OR 4:5 | 2K if doc-style |
| YouTube thumbnail | image | 16:9 | 2K (= 2560×1440) |

## Cost reference

| Model | Per-unit credits | $ approx (assuming 1 credit ≈ $0.0007) |
|---|---|---|
| `gpt-image-2-text-to-image` (default) | ~50-55 / image observed | ~$0.04 |
| `gpt-image-2-image-to-image` | similar | ~$0.04 |
| `nano-banana-pro` (1080p PNG, fallback) | ~60 | ~$0.04 |
| `nano-banana-pro` (2K PNG, fallback) | ~120 | ~$0.08 |
| `nano-banana-2` | ~30 | ~$0.02 |
| `gemini-omni-video` (10s, 1080p) | ~180 | ~$0.13 |
| `gemini-omni-video` (10s, 720p upscaled to 1080p) | ~150 | ~$0.10 |

Cost is not the constraint per Anton — pick the best model (GPT Image v2), not the cheapest.

Failures are not billed (Kie auto-refunds creditsConsumed on `fail` state).

## Integration with the social engagement routine

The `social-engagement-hourly` scheduled task calls this skill on `IMAGE_FIRE=1` fires (odd hours, ~8/day). Pattern: generate ONE 16:9 image for ONE of the 6-8 X replies, attach via the inline composer's file input, post. (The old `twitter-social-media-promotion` task is disabled — do not reference it.)

See `~/.claude/scheduled-tasks/social-engagement-hourly/SKILL.md` Step 1.6.

## Sample end-to-end (single image)

```bash
#!/usr/bin/env bash
set -euo pipefail
KEY=$(security find-generic-password -s 'kie-api-key' -w 2>/dev/null || cat ~/.config/kie/api_key)

PROMPT='Vertical 16:9 photoreal cinematic, 35mm shallow depth of field. Cool blue-gray studio lighting.
Subject: A clean dark-mode terminal window centered in frame, showing 3 stacked spec files (spec.md, plan.md, tasks.md) with crisp purple syntax highlighting. The file titles are legible in white sans-serif.
Composition: tight centered framing.
Text on image: A single white sans-serif label in the upper-third reading exactly "ship the spec, not the prompt."
Mood: confident.
Avoid: garbled text, third-party logos, generic stock aesthetics.'

TID=$(curl -sS -X POST https://api.kie.ai/api/v1/jobs/createTask \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d "$(jq -n --arg p "$PROMPT" '{model:"gpt-image-2-text-to-image",input:{prompt:$p,aspect_ratio:"16:9",resolution:"2K"}}')" \
  | jq -r '.data.taskId')

echo "taskId=$TID, polling..."

for i in $(seq 1 60); do
  R=$(curl -sS "https://api.kie.ai/api/v1/jobs/recordInfo?taskId=$TID" -H "Authorization: Bearer $KEY")
  S=$(echo "$R" | jq -r '.data.state')
  case "$S" in
    success) URL=$(echo "$R" | jq -r '.data.resultJson' | jq -r '.resultUrls[0]'); break ;;
    fail) echo "$R" | jq '.data.failReason'; exit 1 ;;
    *) sleep 3 ;;
  esac
done

OUT=/tmp/kie-$(date +%s).png
curl -sS -A 'Mozilla/5.0' -o "$OUT" "$URL"
echo "Saved: $OUT"
```

## Why this exists

Before this skill: every video/image gen run re-derived the model name from memory ("was it Veo 3.1 or `gemini-omni-video`?"), re-discovered the Cloudflare UA gotcha, re-tripped the safety filter on the same patterns, and used Veo3 by default — which is outdated and produces lower-fidelity results at higher credit cost. This skill locks in the model selection (Nano Banana Pro for images, Gemini Omni Video for clips), the safety-filter avoidance, the CDN UA, and the failure-recovery loop so every run starts from a known-good baseline.
