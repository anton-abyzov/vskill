---
name: social-posts
description: "End-to-end social media content creation and multi-platform publishing orchestrator. Generates platform-optimized copy, AI images (via nanobanana/Gemini), optional AI video, and opens each platform in Chrome for user review before posting. Use this skill whenever the user wants to post, publish, share, promote, or announce something on social media -- even if they only mention one platform or just say 'post about X.' Trigger phrases include: 'publish a post about,' 'post this to socials,' 'social media blast,' 'share on all platforms,' 'cross-post this,' 'announce on social,' 'spread the word about,' 'promote this on LinkedIn/Twitter/Instagram/TikTok/Facebook,' 'quick post,' 'post with video,' 'create social content for,' 'repost across socials,' or any request involving content that should reach a social media audience. Also use when the user provides a topic and expects it to become social posts, or asks 'can you make this into a LinkedIn post and tweet?' This skill coordinates with copywriting, social-content, ad-creative, and marketing-psychology skills for maximum impact."
metadata:
  version: 1.1.0
  tags: social-media, content-creation, copywriting, publishing, linkedin, twitter, instagram, tiktok, facebook, image-generation
---

# Social Posts

You orchestrate social media publishing: take a topic from the user, write platform-optimized copy, generate AI visuals, and open each platform in Chrome so the user can review and post. You do 95% of the work -- the user just reviews, attaches images, and clicks publish.

**The user always reviews before anything goes live.** Never post silently.

---

## Before Starting

1. **Check for a product/brand context file.** Look for a file named `product-marketing-context.md` in the project's `.claude/` directory (or ask the user where it is). This file contains brand voice, products, audience, content pillars, and guidance on weaving product mentions into posts. If it exists, read it -- every post should be informed by this context. If it doesn't exist, ask the user to briefly describe their brand/product/audience before proceeding.

2. **Check for a config file.** Look for a `config.json` in the skill directory or project. It tells you which Chrome profile to use (where social accounts are logged in), which platforms are active, default tone, and image preferences.

3. **Check for a platforms reference.** Look for platform character limits, image specs, and posting best practices in a reference file.

4. **Ensure image generation is available.** This skill uses the `nanobanana` skill (Gemini image generation) for AI images. Check that `GEMINI_API_KEY` is set. If not, warn the user and proceed with copy-only output.

5. **Check published articles / reference material.** If the brand context file has a list of published articles, check if any cover the current topic -- use them as source material for post angles.

6. **Ask the user** for anything not already provided:
   - **Topic**: What is the post about?
   - **Context/angle**: Specific news, data, or event? Reference material?
   - **Tone**: Override default? (casual, professional, provocative, educational)
   - **Visual direction**: Specific image style or existing assets?
   - **Platforms to skip**: YouTube is always skipped unless explicitly requested.

---

## Workflow

### Phase 1: Think Strategically

Before writing a single word, consider:

- **Hook formula**: What's the opening line that stops the scroll? Use curiosity gaps ("I was wrong about..."), contrarian takes ("X is wrong, here's why"), story hooks ("3 years ago I..."), or value hooks ("How to X without Y"). The first line determines whether anyone reads the rest.
- **Psychological angle**: What makes this compelling? Social proof (numbers, testimonials), curiosity gap (incomplete information), loss aversion (what they'll miss), authority (expertise signal), or reciprocity (giving value first).
- **Copy principles**: Clarity over cleverness. Benefits over features. Specificity over vagueness. Customer language over company language. "Cut reporting from 4 hours to 15 minutes" beats "streamline your workflow."
- **Content pillar**: Does this fit an existing pattern -- educational, behind-the-scenes, personal story, industry insight, or promotional? Keep promotional under 5% of posts.

### Product Integration

If a product/brand context file exists, the user's products should appear naturally -- not forced into every post, but present when genuinely relevant.

**The test:** Would a reader find the mention helpful, or would they roll their eyes? If helpful, include it. If eye-roll, skip it and just deliver value.

- ~60% of posts: mention a product as natural context (example, lesson, origin story)
- ~20% of posts: pure value, no product mention (builds trust and reach)
- ~15% of posts: directly about a product (releases, milestones, features)
- ~5% of posts: personal/humanizing, zero product angle

### Phase 2: Write Platform-Optimized Copy

Write copy for each active platform. Each platform post is different -- same topic, different voice, format, and length. Adapt, don't copy-paste.

**Key differences:**
- **LinkedIn**: Professional depth (1,200-1,500 chars), links in comments not post body, 3-5 hashtags at end
- **Twitter/X**: Punchy compression (under 280 chars), or threads for longer value, 1-2 hashtags max
- **Instagram**: Visual-first captions (hook before "more" fold at ~125 chars), hashtags in first comment
- **TikTok**: Ultra-short captions (under 100 chars), pair with video script
- **Facebook**: Conversational, question-based discussion starters, under 250 words
- **Threads**: Casual, conversational, 500 char limit, 3-5 hashtags

**Save each platform's copy** to individual files in `generated-assets/copy/`:

```
generated-assets/copy/linkedin.txt
generated-assets/copy/twitter.txt        # or twitter-thread.txt for threads
generated-assets/copy/instagram.txt
generated-assets/copy/tiktok.txt
generated-assets/copy/facebook.txt
generated-assets/copy/threads.txt
generated-assets/copy/first-comments.txt  # links, hashtags for first comments
```

Also show all copy in the conversation so the user can review without opening files.

### Phase 3: Generate AI Images

Use the **nanobanana** skill (or direct Gemini API calls) for image generation. Generate platform-specific images with correct aspect ratios.

**Image generation via Gemini API (direct):**

```python
import json, base64, os, urllib.request

api_key = os.environ['GEMINI_API_KEY']
model = 'gemini-3-pro-image-preview'
url = f'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}'

payload = {
    'contents': [{'parts': [{'text': 'PROMPT_HERE'}]}],
    'generationConfig': {'responseModalities': ['TEXT', 'IMAGE']}
}

req = urllib.request.Request(url, data=json.dumps(payload).encode(),
    headers={'Content-Type': 'application/json'}, method='POST')

with urllib.request.urlopen(req, timeout=120) as resp:
    result = json.loads(resp.read())
    for part in result['candidates'][0]['content']['parts']:
        if 'inlineData' in part:
            img_data = base64.b64decode(part['inlineData']['data'])
            with open('output.png', 'wb') as f:
                f.write(img_data)
```

**Per-platform image specs:**

| Platform | Ratio | Size | Style |
|----------|-------|------|-------|
| LinkedIn | 16:9 | 1200x627 | Professional, clean |
| Twitter/X | 16:9 | 1200x675 | Bold, eye-catching |
| Instagram feed | 1:1 | 1080x1080 | Aesthetic, vibrant |
| Story/TikTok | 9:16 | 1080x1920 | Dynamic vertical |
| Facebook | 16:9 | 1200x630 | Warm, community-oriented |

**Carousel creation (Instagram/TikTok):**

For multi-slide content, generate background images and composite text overlays using Pillow:

1. Generate 4-5 photorealistic backgrounds via Gemini (1024x1024)
2. Resize/crop to target dimensions (1080x1080 for IG, 1080x1920 for TikTok)
3. Add dark gradient overlay at bottom for text readability
4. Composite: accent color bar + slide number + title + body text
5. Optimize as JPEG (quality=92, optimize=True) -- target under 500KB per slide

```python
from PIL import Image, ImageDraw, ImageFont, ImageFilter

img = Image.open('background.png').convert('RGBA').resize((1080, 1080), Image.LANCZOS)
overlay = Image.new('RGBA', img.size, (0, 0, 0, 0))
draw = ImageDraw.Draw(overlay)
# Dark gradient at bottom 45%
for y in range(594, 1080):
    alpha = int(40 + 200 * ((y - 594) / 486))
    draw.rectangle([(0, y), (1080, y+1)], fill=(0, 0, 0, min(alpha, 230)))
img = Image.alpha_composite(img, overlay)
# Add text with ImageFont
```

If `GEMINI_API_KEY` is not set, skip image generation -- tell the user to `export GEMINI_API_KEY="your-key"` and provide copy-only output.

**IMPORTANT -- Always use full absolute paths and specify per-platform.**

After generation, present a clear table with **full absolute paths** and which platform each image is for. Show images inline using the Read tool so the user can review without opening Finder.

### Phase 4: Video Generation

For content that benefits from video (especially TikTok and Instagram Reels), use **Veo 3.1** via the Gemini API for AI-generated cinematic video clips.

#### Option A: AI Video with Veo 3.1 (Recommended)

**Model**: `veo-3.1-generate-preview`
**Endpoint**: `POST https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-generate-preview:predictLongRunning`
**Auth**: Same `GEMINI_API_KEY` used for image generation

**Step 1: Generate video clips (one per slide)**

```python
import json, urllib.request

api_key = os.environ['GEMINI_API_KEY']
endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-generate-preview:predictLongRunning'

payload = {
    "instances": [{"prompt": "Cinematic scene description here"}],
    "parameters": {
        "aspectRatio": "9:16",    # 9:16 for TikTok/Reels, 16:9 for landscape
        "resolution": "720p",      # 720p or 1080p
        "durationSeconds": 6       # 4, 6, or 8 seconds (MUST be number, not string)
    }
}

req = urllib.request.Request(
    f'{endpoint}?key={api_key}',
    data=json.dumps(payload).encode(),
    headers={'Content-Type': 'application/json'}, method='POST')

with urllib.request.urlopen(req, timeout=60) as resp:
    result = json.loads(resp.read())
    operation_name = result['name']  # e.g. "models/veo-3.1-generate-preview/operations/xxxxx"
```

**Step 2: Poll for completion (2-5 minutes)**

```python
poll_url = f'https://generativelanguage.googleapis.com/v1beta/{operation_name}?key={api_key}'
# GET request, check result['done'] == True
# Video URI at: result['response']['generateVideoResponse']['generatedSamples'][0]['video']['uri']
```

**Step 3: Download video**

```python
download_url = f"{video_uri}&key={api_key}"  # Append API key to download URL
```

**Step 4: Scale up + text overlays with ffmpeg**

Veo outputs 720x1280. Upscale to 1080x1920 and add text using `drawtext` filter:

```bash
ffmpeg -y -i veo-clip.mp4 -vf "
  scale=1080:1920:flags=lanczos,
  drawbox=x=0:y=ih*0.55:w=iw:h=ih*0.45:color=black@0.55:t=fill,
  drawbox=x=60:y=ih*0.60:w=4:h=80:color=0xD4A04A@0.9:t=fill,
  drawtext=fontfile='/System/Library/Fonts/Avenir Next.ttc':text='01':fontcolor=white@0.9:fontsize=52:x=80:y=h*0.60+10,
  drawtext=fontfile='/System/Library/Fonts/Avenir Next.ttc':text='Title Here':fontcolor=white:fontsize=46:x=60:y=h*0.72,
  drawtext=fontfile='/System/Library/Fonts/Avenir Next.ttc':text='Body text here':fontcolor=white@0.8:fontsize=28:x=60:y=h*0.84
" -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p -c:a aac -b:a 128k -movflags +faststart output.mp4
```

**Step 5: Concatenate with crossfade transitions**

```bash
ffmpeg -y -i slide1.mp4 -i slide2.mp4 -i slide3.mp4 -i slide4.mp4 -i slide5.mp4 \
  -filter_complex "
    [0:v][1:v]xfade=transition=fade:duration=0.8:offset=5.2[v01];
    [v01][2:v]xfade=transition=fade:duration=0.8:offset=10.4[v02];
    [v02][3:v]xfade=transition=fade:duration=0.8:offset=15.6[v03];
    [v03][4:v]xfade=transition=fade:duration=0.8:offset=20.8[vout];
    [0:a][1:a]acrossfade=d=0.8[a01];
    [a01][2:a]acrossfade=d=0.8[a02];
    [a02][3:a]acrossfade=d=0.8[a03];
    [a03][4:a]acrossfade=d=0.8[aout]
  " -map "[vout]" -map "[aout]" \
  -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p -c:a aac -b:a 128k \
  -movflags +faststart final-video.mp4
```

**Key Veo 3.1 details:**
- Generates native audio (ambient soundscape) automatically
- Output: h264 + AAC, 24fps
- 720x1280 (9:16) or 1280x720 (16:9) native resolution
- Fire all 5 clip generations in parallel (async API), poll all at once
- Typical generation time: 2-5 minutes per clip
- `durationSeconds` MUST be a number (not string) or you get 400 error
- Download URLs require `&key=API_KEY` appended

**Prompt tips for cinematic results:**
- Describe camera movement: "slow aerial drift", "dolly forward", "push-in", "camera drift backward"
- Include atmosphere: "moody storm clouds", "warm Edison lights", "volumetric lighting"
- Specify color grading: "teal and amber", "cold desaturated", "golden hour"
- Keep prompts specific and visual -- Veo excels at photorealistic scenes

#### Option B: Ken Burns Slideshow (Fallback)

If Veo is unavailable, create a Ken Burns zoom slideshow from still images using ffmpeg:

```bash
ffmpeg -loop 1 -t 5 -i slide.jpg -vf "zoompan=z='1+0.0006*on':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=150:s=1080x1920:fps=30" output.mp4
```

This is simpler but produces static-feeling results compared to Veo.

#### Option C: UGC Script

Give the user a filming script:
1. Hook (0-2s): pattern interrupt or bold claim
2. Setup (2-5s): context
3. Value (5-25s): the actual content
4. CTA (25-30s): follow/engage/share

### Phase 5: Review & Publish

This is the most important phase. The goal: user just reviews and clicks submit.

1. **Present everything** in a clear summary:
   - All copy (shown in conversation + saved to files with full absolute paths)
   - Generated image table (platform, full absolute path, dimensions)
   - Video script or generated video path (if applicable)

2. **Ask for approval**: "Ready to open all platforms? I'll open Chrome with your profile."

3. **Open platforms in Chrome.** Use the configured Chrome profile (from config.json) where social accounts are logged in. Open each platform's compose page as a separate tab.

   On macOS:
   ```bash
   open -na "Google Chrome" --args --profile-directory="PROFILE_DIR" "COMPOSE_URL"
   ```

   Order: LinkedIn, Twitter/X, Facebook, TikTok, Instagram (via Meta Business Suite).

4. **Per-platform posting guide** -- for each tab, tell the user exactly:
   - **Copy from**: full absolute path to the .txt file
   - **Attach image**: full absolute path to the image file
   - **First comment**: if applicable, what to paste after publishing
   - The user pastes, attaches, reviews, and clicks publish. That's it.

### Phase 6: Post-Publishing (Optional)

After the user confirms everything is posted:

- **Log the post** to `post-history/YYYY-MM-DD-topic.md` with the content, platforms, and asset paths.
- **Suggest follow-up**: Respond to comments within the first hour (this is when algorithms decide reach). Check analytics in 24-48 hours.

---

## Platform Defaults

| Platform | Default | Notes |
|----------|---------|-------|
| LinkedIn | Active | Always |
| Twitter/X | Active | Always |
| Instagram | Active | Image/Reel focus |
| TikTok | Active | Video focus |
| Facebook | Active | Community focus |
| Threads | Active | Casual text focus |
| YouTube | **Skip** | On-demand only |

Override per post by telling the skill which platforms to skip or include.

---

## When Things Go Wrong

| Problem | What to do |
|---------|-----------|
| No `GEMINI_API_KEY` | Deliver copy only, skip images/video, tell user how to set the key |
| Image generation fails | Suggest user creates images manually or tries alternative prompts |
| Veo generation fails or times out | Fall back to Ken Burns slideshow (Option B) or provide UGC script (Option C) |
| Veo returns 400 on durationSeconds | Ensure value is a number (6) not a string ("6") |
| Veo download returns 403 | Append `&key=API_KEY` to the download URI |
| Browser won't open | Print the platform URLs so user can open manually |
| A platform is down or needs re-auth | Skip it, note it, the user handles auth during review |
| No product context file | Ask the user for basic brand/audience info, or proceed with generic copy |

---

## Related Skills

This skill orchestrates across the marketing ecosystem. When you need deeper strategy, invoke the relevant skill:

- **social-media-posting** -- full posting automation, engagement engine, deduplication, scheduling, 11 platforms
- **social-content** -- platform strategies, content pillars, hook formulas, engagement tactics
- **copywriting** -- landing page-quality copy principles (clarity, benefits, specificity)
- **ad-creative** -- headline formulas, value propositions, scaled creative production
- **marketing-psychology** -- cognitive biases, persuasion principles, behavioral triggers
- **copy-editing** -- polish, conciseness, tone consistency
- **content-strategy** -- pillar planning, calendar structure, audience mapping
- **nanobanana** -- AI image generation via Gemini (used directly by this skill)
