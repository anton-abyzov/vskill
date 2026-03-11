---
name: social-media-posting
description: "Cross-platform social media content creation, posting, and engagement skill. Covers Instagram, LinkedIn, X/Twitter, Threads, YouTube, TikTok, Reddit, dev.to, Facebook, Discord, and Telegram. Handles AI image generation (Nano Banana Pro with 3 options per image at correct aspect ratios), AI video generation (Veo 3.1), carousel creation, platform-specific posting flows, deduplication against recent posts, strategic content planning (hook formulas, psychological angles, content pillars), brand context integration, proof screenshot creation for virality, and daily engagement (replying to 10 threads per platform). Use this skill whenever the user wants to post content to social media, create social media visuals, schedule posts, engage with followers, grow their audience, reply to threads, or manage any social media activity. Also activate when the user mentions any social platform by name, says 'post this', 'share on social', 'engage', 'reply to threads', 'publish a post about', 'social media blast', 'cross-post this', 'announce on social', 'spread the word', 'promote this on', 'quick post', 'post with video', 'create social content for', 'repost across socials', or references content distribution."
metadata:
  tags: social-media, instagram, linkedin, twitter, threads, youtube, tiktok, reddit, discord, telegram, posting, engagement, automation, image-generation, content-creation, copywriting, publishing, video-generation, veo
---

# Social Media Posting & Engagement

Post content across all major platforms with AI-generated visuals, strategic content planning, mandatory human approval, and daily engagement to grow your audience.

---

## Before Starting

Before writing any content, gather context:

1. **Check for a product/brand context file.** Look for `product-marketing-context.md` in the project's `.claude/` directory first, then the project root. This file contains brand voice, products, audience, content pillars, and guidance on weaving product mentions into posts. If it exists, read it -- every post should be informed by this context. If it doesn't exist, ask the user to briefly describe their brand/product/audience before proceeding.

2. **Check for a config file.** Look for a `config.json` in the skill directory or project. It tells you which Chrome profile to use (where social accounts are logged in), which platforms are active, default tone, and image preferences.

3. **Check published articles / reference material.** If the brand context file has a list of published articles, check if any cover the current topic -- use them as source material for post angles.

4. **Ensure image generation is available.** This skill uses the `nano-banana-pro` skill (Gemini image generation) for AI images. Check that `GEMINI_API_KEY` is set. If not, warn the user and proceed with copy-only output.

5. **Ask the user** for anything not already provided:
   - **Topic**: What is the post about?
   - **Context/angle**: Specific news, data, or event? Reference material?
   - **Tone**: Override default? (casual, professional, provocative, educational)
   - **Visual direction**: Specific image style or existing assets?
   - **Platforms to skip**: Any platforms to exclude?

---

## Core Rules (Non-Negotiable)

### 1. NEVER Post Without Approval

Every piece of content -- posts, comments, replies -- must be shown to you first. The workflow is always:

1. **Draft** the content (text + images)
2. **Present** it for review with a clear summary
3. **Wait** for explicit "go ahead" / "approved" / "post it"
4. **Post** only after approval
5. **Verify** the post is live and report the URL

This exists because social media is public, permanent, and tied to your reputation. A bad post can't be unseen. The cost of waiting 30 seconds for approval is nothing compared to the cost of posting something wrong.

### 2. Always Generate Images

Every post gets AI-generated visuals. Use the `nano-banana-pro` skill (Gemini 3 Pro Image) to create photo-realistic, editorial-quality images. For each image needed, generate **3 options** so the user can pick the best one. See the Image Generation section for exact dimensions per platform.

### 3. Check for Duplicates First

Before drafting any post, read the **last 10 posts** on each target platform. This prevents posting duplicate or near-duplicate content. Look for:
- Same topic covered in the last 48 hours
- Similar headlines or angles
- Overlapping key facts or data points

If you find overlap, flag it: "You posted about [topic] on [platform] [time ago]. Want to skip this platform, change the angle, or post anyway?"

### 4. Track Everything

After every post, collect the exact URL. Log all URLs (posts + engagement comments) to a daily log file. Never say "posted" without providing a clickable link.

### 5. Verify Before Reporting

Navigate to the profile/page after publishing and confirm the post actually appears. Be honest about failures -- never report unverified posts as successful.

---

## Strategic Thinking

Before writing a single word, think strategically:

### Hook Formula

The first line determines whether anyone reads the rest. Use one of these patterns:

- **Curiosity gap**: "I was wrong about..." / "Nobody's talking about this..."
- **Contrarian take**: "X is wrong, here's why" / "Unpopular opinion:"
- **Story hook**: "3 years ago I..." / "Last week something happened..."
- **Value hook**: "How to X without Y" / "The 5-minute trick that..."
- **Data hook**: "We analyzed 10,000..." / "The numbers are in:"

### Psychological Angle

What makes this compelling?

- **Social proof**: Numbers, testimonials, adoption stats
- **Curiosity gap**: Incomplete information that demands completion
- **Loss aversion**: What they'll miss if they don't pay attention
- **Authority**: Expertise signal, credentials, experience
- **Reciprocity**: Giving value first, teaching something useful

### Copy Principles

- Clarity over cleverness
- Benefits over features
- Specificity over vagueness ("Cut reporting from 4 hours to 15 minutes" beats "streamline your workflow")
- Customer language over company language
- One idea per post -- don't cram multiple messages

### Content Pillar Check

Does this fit an existing pattern?

- **Educational**: Teaching something useful
- **Behind-the-scenes**: Process, struggles, real numbers
- **Personal story**: Lessons learned, failures, pivots
- **Industry insight**: Trends, analysis, predictions
- **Promotional**: Product launches, features, milestones

Keep promotional under 5% of posts. If a product/brand context file exists:

- ~60% of posts: mention a product as natural context (example, lesson, origin story)
- ~20% of posts: pure value, no product mention (builds trust and reach)
- ~15% of posts: directly about a product (releases, milestones, features)
- ~5% of posts: personal/humanizing, zero product angle

**The test:** Would a reader find the mention helpful, or would they roll their eyes? If helpful, include it. If eye-roll, skip it and just deliver value.

---

## Workflow Overview

```
0. CONTEXT     -> Read product-marketing-context.md + config, check published articles
1. DEDUP       -> Read last 10 posts per platform, flag overlaps
2. STRATEGIZE  -> Hook formula, psychological angle, content pillar selection
3. ANALYZE     -> Check post analytics history, recommend optimal posting time
4. CONTENT     -> Write platform-adapted copy + save per-platform copy files
5. IMAGES      -> Generate 3 options per image with Nano Banana Pro (correct aspect ratio)
6. PROOF       -> For X/Twitter & Threads: create proof/evidence screenshot as first image
7. VIDEO       -> If video content: Veo 3.1 AI video (or Ken Burns fallback)
8. REVIEW      -> Present everything + timing recommendation to user, wait for approval
9. POST        -> Publish or schedule to each platform using best available tool
10. VERIFY     -> Confirm each post is live (or scheduled), collect URLs
11. ENGAGE     -> Find 10 threads per platform, draft replies, get approval
12. LOG        -> Write daily engagement log with all URLs + save copy files
```

---

## Virality and Proof Screenshots

### Why Proof Beats Generic AI Art

On X/Twitter and Threads, the **first image** in a post determines whether it gets engagement. Generic AI-generated art blends into the feed -- everyone's using it now. Screenshots of real results stop the scroll because they signal **authenticity and evidence**. A terminal showing test passes, a dashboard with real numbers, or a before/after comparison says "this is real" in a way that no AI-rendered abstract gradient ever will.

### What Counts as Proof

- **Terminal output**: Test passes, deployment logs, benchmark results, build output
- **Metrics dashboards**: Download counts, user growth charts, revenue screenshots, analytics
- **Before/after comparisons**: Code diff, performance numbers, UI redesign side-by-side
- **Code snippets with results**: A function and its actual output, a query and its response
- **Error messages that tell a story**: "This error cost us 3 days..." with the actual stack trace
- **Tool output**: npm download stats, GitHub stars graph, Vercel analytics, CI/CD results

### How to Create Proof Screenshots

1. **If the user provides a command or metric**, run it or ask them to screenshot it
2. **Use Puppeteer or Peekaboo** to capture the relevant screen/dashboard
3. **Crop to the key area** -- full-screen screenshots are noisy. Focus on the number, the result, the graph
4. **For terminal output**: Use a clean dark terminal theme, highlight the key numbers or success indicators
5. **For dashboards**: Capture the specific graph or metric that tells the story, not the entire page

### Image Order for X/Twitter and Threads

- **Image 1**: ALWAYS the proof screenshot (this appears in the timeline preview and drives clicks)
- **Image 2+**: AI-generated visuals from Nano Banana Pro (supporting/aesthetic images)

### When Proof Isn't Available

If the topic is abstract (opinion piece, thought leadership, general advice) and no proof screenshot exists:

1. **Ask the user** if they have any relevant screenshot, metric, or terminal output they could share
2. **If they don't**, fall back to **data visualization or infographic-style** AI art -- charts, diagrams, annotated screenshots -- rather than generic abstract imagery
3. **NEVER generate fake/mock terminal screenshots** -- that's dishonest and undermines trust

The workflow should never block over this. If no proof exists and the user confirms, proceed with the best available AI imagery.

---

## Available Tools (Prefer Dedicated Tools)

Multiple tools may be available for posting. Always prefer dedicated CLI/API tools over browser automation -- they're faster, more reliable, and don't break when UIs change.

### Tool Priority Order

| Platform | 1st Choice (Best) | 2nd Choice | 3rd Choice | Last Resort |
|----------|-------------------|------------|------------|-------------|
| X/Twitter | `xurl` CLI (if installed) | Puppeteer/browser | Peekaboo | Chrome-open |
| Discord | `discord` skill actions | Webhook API (`curl`) | Browser automation | Chrome-open |
| Telegram | Telegram Bot API (`curl`) | N/A | N/A | N/A |
| Instagram Carousel | API (`rupload_igphoto` + `configure_sidecar`) | Puppeteer + Chrome profile | Peekaboo | Chrome-open |
| Instagram Reel | API (`rupload_igvideo` + `configure_to_clips`) | Puppeteer + Chrome profile | Peekaboo | Chrome-open |
| LinkedIn | Puppeteer + Chrome profile | Peekaboo | Chrome-open | - |
| Threads | Puppeteer + Chrome profile | Peekaboo | Chrome-open | - |
| YouTube Community | Puppeteer + system clipboard | Peekaboo | Chrome-open | - |
| YouTube Video Upload | AppleScript + browser automation | Peekaboo | Chrome-open | - |
| Reddit | Puppeteer (old.reddit.com) | Peekaboo | Chrome-open | - |
| TikTok | Anti-bot override + AppleScript + cliclick | Peekaboo | Chrome-open | - |
| dev.to | Puppeteer + Chrome profile | Peekaboo | Chrome-open | - |
| Facebook | Puppeteer + Chrome profile | Peekaboo | Chrome-open | - |

### X/Twitter via `xurl` (Preferred)

If the `xurl` CLI is installed (`xurl auth status` to check), use it instead of browser automation:

```bash
# Post with image
xurl media upload image.png           # get MEDIA_ID from response
xurl post "Your tweet text" --media-id MEDIA_ID

# Thread: post main tweet, then reply
xurl post "Main tweet"                # get POST_ID
xurl reply POST_ID "Thread continuation"

# Search for engagement threads
xurl search "topic keywords" -n 10

# Reply to a thread
xurl reply POST_ID "Your thoughtful reply"

# Read recent posts (dedup check)
xurl timeline -n 10
```

### Discord via Skill Actions (Preferred)

If the `discord` skill is available, use its native actions:

```json
{
  "action": "sendMessage",
  "to": "channel:<CHANNEL_ID>",
  "content": "Your announcement text",
  "mediaUrl": "file:///path/to/image.png"
}
```

```json
{
  "action": "readMessages",
  "channelId": "<CHANNEL_ID>",
  "limit": 10
}
```

### Peekaboo (macOS UI Fallback)

When browser automation (Puppeteer) isn't available or breaks, use the `peekaboo` skill for macOS UI automation:

```bash
# See what's on screen, identify clickable elements
peekaboo see --app "Google Chrome" --annotate --path /tmp/see.png

# Click an identified element
peekaboo click --on B3 --app "Google Chrome"

# Type text
peekaboo type "Your post content" --app "Google Chrome"

# Paste from clipboard (for editors that reject keyboard input)
echo "Your text" | pbcopy
peekaboo hotkey --keys "cmd,v" --app "Google Chrome"
```

This is particularly useful when:
- Puppeteer can't connect to Chrome
- A platform's DOM changed and selectors broke
- File upload dialogs need native OS interaction
- You need to interact with system dialogs (CAPTCHA, etc.)

### Chrome-Open (Last Resort)

When all automation fails, open the platform's compose page in Chrome with the user's configured profile:

```bash
open -na "Google Chrome" --args --profile-directory="PROFILE_DIR" "COMPOSE_URL"
```

Then provide a per-platform posting guide for each tab:
- **Copy from**: full absolute path to the `.txt` file
- **Attach image**: full absolute path to the image file
- **First comment**: if applicable, what to paste after publishing

The user pastes, attaches, reviews, and clicks publish.

---

## Image Generation with Nano Banana Pro

Use the `nano-banana-pro` skill for all image generation. The script path is:
```
{nano-banana-pro baseDir}/scripts/generate_image.py
```

**Fallback (direct Gemini API)** -- if the `nano-banana-pro` skill is not installed:

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

### Platform-Specific Dimensions

Each platform has an optimal aspect ratio. Include the target dimensions in your prompt so the model composes the image correctly, and use the right resolution setting.

| Platform | Aspect Ratio | Pixels | Use Case | Resolution Flag |
|----------|-------------|--------|----------|-----------------|
| Instagram Feed/Carousel | 1:1 (square) | 1080x1080 | Carousel slides | `--resolution 2K` |
| Instagram Story/Reel | 9:16 (vertical) | 1080x1920 | Stories, Reels | `--resolution 2K` |
| TikTok | 9:16 (vertical) | 1080x1920 | Video frames | `--resolution 2K` |
| X/Twitter | 16:9 (landscape) | 1200x675 | Tweet images | `--resolution 1K` |
| LinkedIn | 1.91:1 (landscape) | 1200x628 | Post images | `--resolution 1K` |
| Facebook | 1.91:1 (landscape) | 1200x628 | Post images | `--resolution 1K` |
| YouTube Community | 16:9 (landscape) | 1280x720 | Community posts | `--resolution 1K` |
| Threads | 1:1 (square) | 1080x1080 | Post images | `--resolution 1K` |
| Discord | 16:9 (landscape) | 1280x720 | Embeds | `--resolution 1K` |
| Telegram | 16:9 (landscape) | 1280x720 | Channel posts | `--resolution 1K` |
| dev.to | 16:9 (landscape) | 1000x420 | Cover image | `--resolution 1K` |

### Generating 3 Options Per Image

For every image, generate 3 distinct options with varied composition. Include the aspect ratio in the prompt:

```bash
# Option A -- dramatic angle
uv run {baseDir}/scripts/generate_image.py \
  --prompt "square 1:1 composition, photorealistic tech editorial: [topic], cinematic lighting, dark gradient, clean typography overlay" \
  --filename "2026-03-04-topic-option-a.png" --resolution 2K

# Option B -- data/infographic style
uv run {baseDir}/scripts/generate_image.py \
  --prompt "square 1:1 composition, [alternative visual: data visualization, charts, key stats]" \
  --filename "2026-03-04-topic-option-b.png" --resolution 2K

# Option C -- human/product focus
uv run {baseDir}/scripts/generate_image.py \
  --prompt "square 1:1 composition, [third approach: device mockup, person using tech, product shot]" \
  --filename "2026-03-04-topic-option-c.png" --resolution 2K
```

Present all 3 to the user: "Here are 3 image options. Which do you prefer? (A/B/C, or I can regenerate)"

### Carousels (Instagram/TikTok)

Generate **5 slides**, each with **3 options** (15 images total). Present as a grid so the user can mix and match:

```
Slide 1 (Hook):    [A1] [B1] [C1]
Slide 2 (Point 1): [A2] [B2] [C2]
Slide 3 (Point 2): [A3] [B3] [C3]
Slide 4 (Point 3): [A4] [B4] [C4]
Slide 5 (CTA):     [A5] [B5] [C5]
```

**Logo handling:** When mentioning companies, scrape and download their official logos first. Pass logos as input images (`-i logo.png`) to Nano Banana Pro so they render correctly.

**Carousel compositing with Pillow** (for text overlays on backgrounds):

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

### Image Style Guidelines

- Photo-realistic, cinematic lighting, editorial quality
- Dark gradient backgrounds with clean typography overlays
- Professional tech-forward aesthetic
- Use timestamps in filenames: `yyyy-mm-dd-topic-name-option-X.png`

**IMPORTANT -- Always use full absolute paths and specify per-platform.** After generation, present a clear table with **full absolute paths** and which platform each image is for. Show images inline using the Read tool so the user can review without opening Finder.

---

## Video Generation

For content that benefits from video (especially TikTok and Instagram Reels), use **Veo 3.1** via the Gemini API for AI-generated cinematic video clips.

### Option A: AI Video with Veo 3.1 (Recommended)

**Model**: `veo-3.1-generate-preview`
**Endpoint**: `POST https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-generate-preview:predictLongRunning`
**Auth**: Same `GEMINI_API_KEY` used for image generation

**Step 1: Generate video clips (one per slide)**

```python
import json, os, urllib.request

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

### Option B: Ken Burns Slideshow (Fallback)

If Veo is unavailable, create a Ken Burns zoom slideshow from still images using ffmpeg:

```bash
ffmpeg -loop 1 -t 5 -i slide.jpg -vf "zoompan=z='1+0.0006*on':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=150:s=1080x1920:fps=30" output.mp4
```

For multi-slide videos, concatenate with crossfade transitions (same ffmpeg pattern as Step 5 above).

### Option C: UGC Filming Script

If the user prefers to film themselves, provide a structured script:

1. **Hook** (0-2s): Pattern interrupt or bold claim
2. **Setup** (2-5s): Context and stakes
3. **Value** (5-25s): The actual content, tips, or demonstration
4. **CTA** (25-30s): Follow, engage, share, or link in bio

---

## Platform Posting

Each platform has quirks. Read `references/platform-posting.md` for the detailed technical guide (selectors, upload flows, encoding requirements, workarounds).

### Supported Platforms

| Platform | Content Type | Char Limit | Hashtags | Image Support |
|----------|-------------|------------|----------|---------------|
| X/Twitter | Text + image | 280 (free) / 25K (premium) | 1-3 | Yes |
| LinkedIn | Text + image | 3,000 | 3-5 | Yes |
| Instagram Carousel | Carousel (API) | 2,200 caption | Up to 30 | Required |
| Instagram Reel | Reel (API) | 2,200 caption | Up to 30 | Video |
| Threads | Text + image | 500 | 3-5 | Yes |
| TikTok | Video (from carousel) | 2,200 caption | 3-5 | Video only |
| YouTube Community | Community post | ~5,000 | N/A | Yes |
| YouTube Video | Video upload (Studio) | 5,000 title+desc | Up to 15 tags | Video |
| Reddit | Text post | Unlimited | N/A | Optional |
| dev.to | Article (markdown) | Unlimited | Max 4 tags | Optional |
| Facebook | Text + image | 63,206 | 1-3 | Yes |
| Discord | Message | 2,000 | N/A | Yes (embed) |
| Telegram | Message | 4,096 | N/A | Yes |

### Content Adaptation

Don't copy-paste the same text everywhere. Adapt for each platform:

- **X/Twitter**: Punchy, concise, hook in first line. Thread for longer content.
- **LinkedIn**: Professional tone, insight-driven, mention implications for the industry. Links in first comment, not post body.
- **Instagram**: Visual-first, caption supports the image. Use line breaks for readability.
- **Threads**: Casual, conversational, like talking to a friend.
- **TikTok**: Upload via TikTok Studio with anti-bot override + AppleScript file picker. Convert photo carousels to video with ffmpeg first. Caption is secondary to visuals. See `references/platform-posting.md` TikTok section for the full anti-bot workflow.
- **Reddit**: Match the subreddit's tone. Informative, no self-promo smell. Check flair requirements.
- **dev.to**: Full article format with markdown. Technical depth.
- **Facebook**: Conversational, longer-form OK. Links in post body (not penalized like LinkedIn). Use images.
- **Discord**: Short, punchy, chat-style. No markdown tables (Discord renders them ugly). Use **bold** for emphasis, not headers.
- **Telegram**: Clean, formatted message. Use markdown formatting.
- **YouTube Community**: Community post style -- short, conversational, pose a question to drive comments. Link to full videos or articles in text.
- **YouTube Video**: Upload via Studio with hybrid AppleScript + browser automation. See `references/youtube-studio-upload.md` for the complete workflow. Set video language to English for auto-generated captions and auto-translate support.

### Per-Platform Copy File Output

After writing copy for all platforms, save each to individual files:

```
generated-assets/copy/linkedin.txt
generated-assets/copy/twitter.txt        # or twitter-thread.txt for threads
generated-assets/copy/instagram.txt
generated-assets/copy/tiktok.txt
generated-assets/copy/facebook.txt
generated-assets/copy/threads.txt
generated-assets/copy/reddit.txt
generated-assets/copy/devto.txt
generated-assets/copy/discord.txt
generated-assets/copy/telegram.txt
generated-assets/copy/youtube.txt
generated-assets/copy/first-comments.txt  # links, hashtags for first comments
```

Also show all copy in the conversation so the user can review without opening files.

### TikTok Video

TikTok web only accepts video. Use the Video Generation section (Veo 3.1 recommended) to create 9:16 vertical content. Quick fallback via ffmpeg slideshow:

```bash
ffmpeg -framerate 1/4 -i slide-%d.png \
  -c:v libx264 -r 30 -pix_fmt yuv420p \
  -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2" \
  output.mp4
```

### Optimal Timing & Scheduled Posting

Posting at the right time can double engagement. Use a three-tier approach:

**Tier 1 -- Analytics-driven (best).** Before posting, check the user's actual engagement data:
- Read the last 20-30 posts per platform
- Note which posts got the most likes/comments/shares
- Note what time and day those top posts went live
- Recommend posting at the time that historically performs best for THIS account

Present your analysis: "Your top 5 LinkedIn posts were all published between 7-8 AM EST on Tuesdays and Thursdays. I recommend scheduling for 7:30 AM EST tomorrow (Thursday)."

**Tier 2 -- General best practices (fallback).** When analytics aren't available:

| Platform | Best Time (EST) | Weekend Shift |
|----------|----------------|---------------|
| X/Twitter | 9-11 AM | +1h |
| LinkedIn | 7-8 AM or 12 PM | Skip weekends |
| Instagram | 11 AM-1 PM, 7-9 PM | 10 AM-2 PM |
| TikTok | 10 AM, 7-9 PM | +1h |
| Threads | 7-9 AM or 12-3 PM | +2h |
| Facebook | 1-3 PM | 12-2 PM |
| Reddit | 6-9 AM | 8-11 AM |
| dev.to | 7-10 AM | Skip weekends |
| Discord | 10 AM-12 PM, 7-9 PM | Evenings better |
| Telegram | 9-11 AM, 7-9 PM | Same |

**Tier 3 -- Breaking news.** Immediacy beats optimal timing. Post ASAP.

### Scheduled Posting Support

Several platforms support scheduling posts to go live at a specific future time. When the optimal time isn't "right now", use native scheduling.

| Platform | Native Scheduling | How |
|----------|------------------|-----|
| X/Twitter | Yes | Compose dialog has a calendar icon; or `xurl post "text" --scheduled-at "2026-03-05T14:00:00Z"` if supported |
| LinkedIn | Yes | Compose dialog > click clock icon > set date/time before clicking Post |
| Instagram | Yes (Creator Studio) | Via Creator Studio or Meta Business Suite > Schedule option |
| Facebook | Yes | Compose > click dropdown on Publish button > Schedule |
| YouTube | Yes | Studio > Upload > set "Schedule" instead of "Publish" |
| TikTok | Yes | TikTok Studio > upload > toggle "Schedule" > pick date/time |
| Reddit | No | Must post in real-time |
| Threads | No | Must post in real-time |
| dev.to | No | Can save as draft, publish manually later |
| Discord | No | Must post in real-time (or use a bot with cron) |
| Telegram | Yes | Bot API `sendMessage` with `schedule_date` parameter (Unix timestamp) |

**Workflow for scheduled posts:**
1. Analyze optimal time (Tier 1 or Tier 2 above)
2. Present recommendation: "Based on your analytics, best time is [X]. Schedule for [datetime]?"
3. After approval, set up scheduling on platforms that support it
4. For platforms without scheduling (Reddit, Threads, Discord, dev.to), note the target time and remind the user, or set a system reminder
5. Verify scheduled posts are queued (navigate to scheduled posts section on each platform)

### Cross-Platform Video Rollout Strategy

When posting the same video across YouTube, TikTok, and Instagram Reels, **stagger the releases**. Same-day cross-posting can suppress reach on all platforms because each algorithm checks for originality.

| Day | Platform | Rationale |
|-----|----------|-----------|
| Day 0 | YouTube (Shorts or long-form) | YouTube rewards original uploads — post here FIRST |
| Day 2-3 | TikTok | Safe gap — YouTube's originality signal is indexed |
| Day 3-4 | Instagram Reels | Another day buffer — IG also penalizes cross-posted content |

The 2-3 day gap is the sweet spot. Adjust based on analytics — if a platform consistently underperforms, it can go later in the sequence.

### YouTube Video Upload

YouTube video upload requires a hybrid AppleScript + browser automation approach because CDP cannot set files on YouTube Studio's native file input.

**Quick summary:**
1. Navigate to `youtube.com/upload`
2. Click "Select files" → opens native macOS file picker
3. AppleScript drives the file picker (Cmd+Shift+G → type path → Enter)
4. Fill metadata (title, description, tags, category, language) via JavaScript
5. Navigate tabs → set Public → Publish

**Full guide:** `references/youtube-studio-upload.md`

### Telegram Posting

Broadcast channels have NO input box in web.telegram.org. Use the Bot API:

```bash
# Photo with caption
curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendPhoto" \
  -F "chat_id=$CHANNEL_ID" \
  -F "photo=@image.png" \
  -F "caption=Your caption" \
  -F "parse_mode=Markdown"
```

---

## Deduplication: Reading Recent Posts

Before posting, check what was recently published to avoid repetition.

### How to Check Per Platform

| Platform | Method |
|----------|--------|
| X/Twitter | `xurl timeline -n 10` or navigate to profile |
| LinkedIn | Navigate to company/personal page, read last 10 posts |
| Instagram | Navigate to profile grid, check last 10 posts |
| Threads | Navigate to profile, read last 10 |
| Reddit | Navigate to user profile, check recent submissions |
| dev.to | Navigate to profile/dashboard, check recent articles |
| Discord | `discord readMessages` or scroll channel history |
| Telegram | `curl "https://api.telegram.org/bot$TOKEN/getUpdates"` or check channel |
| YouTube | Navigate to channel Posts tab |
| Facebook | Navigate to page/profile |
| TikTok | Navigate to profile |

If you find a recent post covering the same topic, present the overlap to the user before proceeding.

---

## Daily Engagement

Growing an audience requires showing up in other people's conversations. After publishing your own content, spend time engaging with the community.

Read `references/engagement-playbook.md` for the full strategy. The summary:

### The 10-Thread Rule

For each platform, find **10 active threads** related to your topics and leave a thoughtful reply. That's 10 per platform, not 10 total.

### Drafting Replies

Draft all 10 replies for a platform, then present them as a batch for approval:

```
Platform: X/Twitter
Thread 1: [link to thread]
  Reply: "Your drafted reply here"

Thread 2: [link to thread]
  Reply: "Your drafted reply here"

...approve all / edit / skip specific ones?
```

Wait for approval before posting any replies.

### Reply Quality Rules

- **1-3 sentences max**
- **Add genuine value** -- a new perspective, relevant data, a follow-up question
- **Sound human** -- match the platform's tone
- **Never use em dashes** -- use commas, periods, or conjunctions instead
- **Don't force self-promotion** -- maybe 1-2 out of 10 naturally reference your work

### Anti-Spam Safeguards

- **Reddit**: Max 3 comments per thread/hour. Max 5 total in 30 min. Space 5-10 min apart.
- **X/Twitter**: Max 5 replies in 10 minutes. Vary length and style.
- **LinkedIn**: Max 5-7 comments per hour. No identical phrasing.
- **General**: If CAPTCHA or rate limit appears, stop immediately and report it.

---

## Post-Publishing Checklist

- [ ] Verify the post is live
- [ ] Check that the full caption/text saved correctly
- [ ] Check tags/mentions persisted
- [ ] Copy the exact published URL
- [ ] Log the URL in the daily engagement file
- [ ] Save post to `post-history/YYYY-MM-DD-topic.md` with content, platforms, and asset paths
- [ ] Suggest follow-up: respond to comments within the first hour (this is when algorithms decide reach)
- [ ] Check analytics in 24-48 hours

---

## When Things Go Wrong

| Problem | What to do |
|---------|-----------|
| No `GEMINI_API_KEY` | Deliver copy only, skip images/video, tell user how to set the key |
| Image generation fails | Retry with alternative prompt, or ask user to create images manually |
| Veo generation fails or times out | Fall back to Ken Burns slideshow (Option B) or UGC script (Option C) |
| Veo returns 400 on durationSeconds | Ensure value is a number (6) not a string ("6") |
| Veo download returns 403 | Append `&key=API_KEY` to the download URI |
| Browser won't open / Puppeteer fails | Try Peekaboo, then Chrome-open fallback, then print URLs for manual posting |
| A platform is down or needs re-auth | Skip it, note it, user handles auth |
| No product context file | Ask user for basic brand/audience info, or proceed with generic tone |
| CAPTCHA or rate limit | Stop immediately, report to user |
| Post verification fails | Be honest, never report unverified posts as successful |
| Instagram API `Transcode not finished` | Wait 30s after video upload before calling `configure_to_clips` |
| Instagram API `cover_photo_upload_error` | Upload cover photo via `rupload_igphoto` with same upload_id before configure |
| Instagram `sessionid` cookie expired | User must re-login in Chrome profile; re-extract cookies |
| TikTok page crashes after upload | Override `navigator.webdriver` BEFORE page load; zero CDP calls during upload |
| TikTok DraftJS rejects caption | Skip caption in upload, edit via TikTok app after publish |
| AppleScript file picker fails | Check Accessibility permissions; increase delays; verify file path exists |
| YouTube Studio metadata not saving | Dispatch `input` event after setting `textContent` on contenteditable divs |
| Cross-platform video suppressed reach | Stagger releases: Day 0 YouTube, Day 2-3 TikTok, Day 3-4 Instagram Reels |

---

## Daily Engagement Log

After ALL posting and engagement is complete, write a log file:

```
File: memory/YYYY-MM-DD-engagement-log.md

# Engagement Log -- YYYY-MM-DD

## Posts Published
- **X/Twitter**: [URL]
- **LinkedIn**: [URL]
- **Instagram**: [URL]
...

## Engagement Replies
### X/Twitter (10 replies)
1. [thread URL] -- "reply text snippet..."
...
```

---

## Reference Files

- `references/platform-posting.md` -- Detailed platform-specific technical guides (selectors, upload flows, encoding, workarounds, Chrome profile setup, Puppeteer patterns)
- `references/youtube-studio-upload.md` -- YouTube Studio video upload workflow (hybrid AppleScript + browser automation, DOM selectors, metadata, subtitles, tags)
- `references/engagement-playbook.md` -- Deep dive on engagement strategy, finding threads, crafting replies, platform-specific tone guides
- `generated-assets/copy/` -- Per-platform copy files (generated per session)
- `post-history/` -- Post logs by date (generated per session)

---

## Related Skills

When you need deeper strategy, invoke the relevant skill:

- **social-content** -- platform strategies, content pillars, hook formulas, engagement tactics
- **copywriting** -- landing page-quality copy principles (clarity, benefits, specificity)
- **ad-creative** -- headline formulas, value propositions, scaled creative production
- **marketing-psychology** -- cognitive biases, persuasion principles, behavioral triggers
- **copy-editing** -- polish, conciseness, tone consistency
- **content-strategy** -- pillar planning, calendar structure, audience mapping
- **nano-banana-pro** -- AI image generation via Gemini (used directly by this skill)
