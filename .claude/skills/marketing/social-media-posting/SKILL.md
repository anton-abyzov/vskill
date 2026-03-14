---
name: social-media-posting
description: "Cross-platform social media content creation, posting, and engagement skill. Covers Instagram, LinkedIn, X/Twitter, Threads, YouTube, TikTok, Reddit, dev.to, Facebook, Discord, and Telegram. Handles AI image generation (Nano Banana Pro with 3 options per image at correct aspect ratios), AI video generation (Veo 3.1), carousel creation, platform-specific posting flows, deduplication against recent posts, strategic content planning (hook formulas, psychological angles, content pillars), brand context integration, proof screenshot creation for virality, and daily engagement (replying to 10 threads per platform). Use this skill whenever the user wants to post content to social media, create social media visuals, schedule posts, engage with followers, grow their audience, reply to threads, or manage any social media activity. Also activate when the user mentions any social platform by name, says 'post this', 'share on social', 'engage', 'reply to threads', 'publish a post about', 'social media blast', 'cross-post this', 'announce on social', 'spread the word', 'promote this on', 'quick post', 'post with video', 'create social content for', 'repost across socials', or references content distribution."
metadata:
  tags: social-media, instagram, linkedin, twitter, threads, youtube, tiktok, reddit, discord, telegram, posting, engagement, automation, image-generation, content-creation, copywriting, publishing, video-generation, veo
---

# Social Media Posting & Engagement

**Primary goal: go viral, grow followers, and promote the user's products and personal brand.**

Every post is an opportunity to attract new followers, build brand authority, and drive awareness of the user's products. Content that delivers value or tells a compelling story while naturally weaving in the brand is the highest-leverage output. Engagement, reach, and follower growth are the metrics that matter — optimize for them, not just for "posting something".

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

### North Star

Every post serves one or more of these goals — always be explicit about which ones apply:

1. **Go viral** — high shareability, broad appeal, stops the scroll. Prioritize hooks, proof, and emotional resonance.
2. **Grow followers** — content that makes people think "I want more of this." End with a clear follow CTA or a hook into the next post.
3. **Promote the product** — weave the product in naturally as the tool that enabled the result, solved the problem, or made the story possible. Never feel like an ad.
4. **Build personal brand** — establish the user as a credible, interesting voice in their space. Opinions, behind-the-scenes, and unique perspectives beat generic tips.

Optimizing for all four simultaneously is possible — a viral behind-the-scenes post that mentions the product in passing is the gold standard. The worst outcome is content that does none of them (generic, forgettable, no CTA).

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
9. POST        -> Attach image FIRST, wait for preview thumbnail, THEN click Post (X/Twitter + Threads: mandatory verification)
10. VERIFY     -> Navigate to published post URL, screenshot it, check text encoding + image/video present — see "Post-Publication Verification" section
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

### AppleScript File Picker: Keyboard Language Issue

**This is a silent failure.** When AppleScript uses `Cmd+Shift+G` to open the "Go to Folder" dialog in a macOS file picker, any keystrokes go through the currently active system keyboard input source. If the user has a non-Latin layout active (Russian, Japanese, Arabic, etc.), the typed path characters get converted — `/Users/anton/image.png` becomes garbage, the dialog finds nothing, and the file is never attached. No error is thrown.

**Always switch the input source to English before typing any path, then restore it.**

```python
import subprocess, time

def ensure_english_input_source():
    """Switch to a Latin/English input source before typing paths in macOS dialogs.
    Returns the name of the previous input source so it can be restored."""
    script = '''
tell application "System Events"
    set currentName to name of current input source
    set allSources to input sources
    set englishNames to {"U.S.", "ABC", "U.S. Extended", "U.S. International - PC", "British", "Australian"}
    set alreadyEnglish to false
    repeat with n in englishNames
        if currentName is n then
            set alreadyEnglish to true
            exit repeat
        end if
    end repeat
    if alreadyEnglish then
        return "already_english"
    end if
    repeat with src in allSources
        if (name of src) is in englishNames then
            set current input source to src
            return currentName
        end if
    end repeat
    return "no_english_source_found"
end tell
'''
    result = subprocess.run(['osascript', '-e', script], capture_output=True, text=True)
    return result.stdout.strip()

def restore_input_source(original_name):
    if original_name in ('already_english', 'no_english_source_found', ''):
        return
    script = f'''
tell application "System Events"
    repeat with src in input sources
        if (name of src) is "{original_name}" then
            set current input source to src
            exit repeat
        end if
    end repeat
end tell
'''
    subprocess.run(['osascript', '-e', script])

# Usage pattern:
original_lang = ensure_english_input_source()
time.sleep(0.3)  # give the OS time to switch before typing

# ... Cmd+Shift+G, type the path, press Enter ...

restore_input_source(original_lang)
```

**Checklist when using any AppleScript file picker:**

1. Call `ensure_english_input_source()` BEFORE triggering `Cmd+Shift+G`
2. Add a 0.3s delay after switching — the OS needs a moment to apply the change
3. Type the path
4. Restore the original input source after pressing Enter
5. If `no_english_source_found` is returned, warn the user: "Please temporarily switch your keyboard to English in System Settings → Keyboard → Input Sources, then retry"

**Diagnosing silently failed path input:** If the file picker opened but nothing was selected, run:
```bash
osascript -e 'tell application "System Events" to return name of current input source'
```
If it returns anything other than a Latin layout name, the language mismatch was the cause.

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

Each platform has strict aspect ratio requirements. **Always generate at the correct ratio from the start** — resizing after the fact loses quality. Include the target dimensions in your prompt so the model composes correctly.

| Platform | Best Ratio | Pixels | Allowed Range | Max File Size | JPEG Quality | Resolution Flag |
|----------|-----------|--------|---------------|---------------|--------------|-----------------|
| Instagram Feed (portrait) | **4:5** | 1080x1350 | 0.8–1.91 | 8 MB | 95+ | `--resolution 2K` |
| Instagram Feed (square) | 1:1 | 1080x1080 | 0.8–1.91 | 8 MB | 95+ | `--resolution 2K` |
| Instagram Carousel | 1:1 or 4:5 | 1080x1080 or 1080x1350 | 0.8–1.91 (all slides same ratio) | 8 MB each | 95+ | `--resolution 2K` |
| Instagram Story/Reel | 9:16 | 1080x1920 | 9:16 only | 8 MB | 95+ | `--resolution 2K` |
| TikTok | 9:16 | 1080x1920 | 9:16 strongly preferred | 20 MB | 90+ | `--resolution 2K` |
| X/Twitter | 16:9 | 1200x675 | any, but 16:9 crops best in preview | 5 MB | 85+ | `--resolution 1K` |
| LinkedIn | 1.91:1 | 1200x628 | any | 8 MB | 90+ | `--resolution 1K` |
| Facebook | 1.91:1 | 1200x628 | any | 8 MB | 90+ | `--resolution 1K` |
| YouTube Community | 16:9 | 1280x720 | any | 8 MB | 90+ | `--resolution 1K` |
| YouTube Thumbnail | 16:9 | 1280x720 | 16:9 only | 2 MB | 90+ | `--resolution 1K` |
| Threads | 1:1 | 1080x1080 | 0.8–1.91 | 8 MB | 90+ | `--resolution 1K` |
| Discord | 16:9 | 1280x720 | any | 8 MB | 85+ | `--resolution 1K` |
| Telegram | 16:9 | 1280x720 | any | 10 MB | 85+ | `--resolution 1K` |
| dev.to | 1000x420 | 1000x420 | any | 1 MB | 85+ | `--resolution 1K` |

**Instagram 4:5 portrait is the recommended default** — it takes up the most vertical screen space in the feed, which increases impressions before the user scrolls past.

### Image Aspect Ratio Enforcement

**Always validate and fix aspect ratio BEFORE uploading.** Instagram (and TikTok) will hard-reject images outside their allowed range with an "uploaded image isn't in an allowed aspect ratio" error. This must be caught and fixed, not reported back to the user as a failure.

**Two strategies — choose based on image type:**

| Image Type | Strategy | Why |
|------------|----------|-----|
| AI-generated image | Regenerate with correct ratio in the prompt | Easiest — just add the ratio to the generation prompt |
| User screenshot / proof image | **Pad, never crop** | Cropping cuts content; padding preserves everything |
| Logo or icon | Pad with transparent/dark background | Keeps proportions exact |

**Step 1: Check the aspect ratio before uploading**

```python
from PIL import Image

def check_aspect_ratio(img_path, platform='instagram'):
    """Check if image ratio is within platform's allowed range."""
    img = Image.open(img_path)
    w, h = img.size
    ratio = w / h

    limits = {
        'instagram': (0.8, 1.91),   # 4:5 portrait to 1.91:1 landscape
        'threads':   (0.8, 1.91),
        'tiktok':    (0.5, 1.0),    # strongly prefer 9:16 = 0.5625
        'twitter':   (0.33, 3.0),   # very permissive
    }
    lo, hi = limits.get(platform, (0.5, 2.0))

    if ratio < lo:
        return False, ratio, 'too_tall'
    elif ratio > hi:
        return False, ratio, 'too_wide'
    return True, ratio, 'ok'
```

**Step 2: Fix it — pad, never crop (especially for screenshots)**

```python
from PIL import Image, ImageFilter

def fit_to_ratio(input_path, output_path, target_w, target_h, background='blur'):
    """
    Fit image into target dimensions without cropping any content.

    background='blur'  → blurred + darkened version of the image fills the padding (looks natural, no black bars)
    background='dark'  → solid dark (#0f0f0f) padding (cleaner for screenshots with dark backgrounds)
    background='white' → solid white padding (cleaner for screenshots with white backgrounds)
    """
    img = Image.open(input_path).convert('RGB')
    src_w, src_h = img.size
    src_ratio = src_w / src_h
    tgt_ratio = target_w / target_h

    # Build background canvas
    if background == 'blur':
        bg = img.resize((target_w, target_h), Image.LANCZOS)
        bg = bg.filter(ImageFilter.GaussianBlur(radius=40))
        # Darken so the content stands out
        dark = Image.new('RGB', (target_w, target_h), (0, 0, 0))
        bg = Image.blend(bg, dark, 0.45)
    elif background == 'white':
        bg = Image.new('RGB', (target_w, target_h), (255, 255, 255))
    else:
        bg = Image.new('RGB', (target_w, target_h), (15, 15, 15))

    # Scale image to fit, preserving ALL content (letterbox/pillarbox)
    if src_ratio > tgt_ratio:
        new_w = target_w
        new_h = int(target_w / src_ratio)
    else:
        new_h = target_h
        new_w = int(target_h * src_ratio)

    img_scaled = img.resize((new_w, new_h), Image.LANCZOS)

    # Center on background
    x = (target_w - new_w) // 2
    y = (target_h - new_h) // 2
    bg.paste(img_scaled, (x, y))

    bg.save(output_path, 'JPEG', quality=95, optimize=True, progressive=True)
    print(f"Saved {output_path} ({target_w}x{target_h}, original: {src_w}x{src_h})")
    return output_path
```

**Step 3: Choose the right target for Instagram**

```python
def get_instagram_target(img_path):
    """Return the best Instagram canvas size for this image."""
    img = Image.open(img_path)
    w, h = img.size
    ratio = w / h

    if ratio > 1.91:
        # Way too wide (e.g., ultrawide screenshot) → fit into 4:5 canvas
        return (1080, 1350)  # 4:5 portrait — max vertical real estate
    elif ratio > 1.0:
        # Landscape screenshot → fit into square (keeps it neutral)
        return (1080, 1080)
    elif ratio >= 0.8:
        # Already in range → just resize to 1080 width, keep ratio
        new_h = int(1080 / ratio)
        return (1080, new_h)
    else:
        # Too tall → fit into 4:5
        return (1080, 1350)
```

**Full workflow for any image before Instagram upload:**

```python
valid, ratio, status = check_aspect_ratio(img_path, platform='instagram')
if not valid:
    target_w, target_h = get_instagram_target(img_path)
    # For screenshots: use 'blur' background (matches dark terminal themes)
    # For logos/icons: use 'dark' background
    # For light-background screenshots: use 'white' background
    background = 'blur'  # default; adjust based on image content
    img_path = fit_to_ratio(img_path, img_path.replace('.png', '-ig.jpg'), target_w, target_h, background)
    print(f"Fixed aspect ratio: {ratio:.2f} → {target_w/target_h:.2f} ({target_w}x{target_h})")
# Now safe to upload
```

**For AI-generated images:** don't resize — instead re-run generation with the correct ratio in the prompt. Resizing an AI image introduces quality loss. Only use `fit_to_ratio` for user-provided screenshots and assets.

**Quality checklist before uploading any image:**
- [ ] Aspect ratio is within platform's allowed range (checked programmatically)
- [ ] Long edge is at least 1080px (Instagram rejects undersized images)
- [ ] File size is under the platform limit (use `os.path.getsize()`)
- [ ] JPEG quality is 95+ for Instagram, 90+ for others
- [ ] For screenshots: padding strategy chosen to match the screenshot's background tone

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

### First Frame / Cover: The Most Important Asset

**The first frame of a video (or first slide of a carousel) is the only thing that determines whether anyone watches the rest.** Algorithms surface this as the thumbnail in the feed — it must stop the scroll.

**Rules for the first frame/slide:**

1. **If the user provides a screenshot, proof image, or specific asset — it goes first.** Use it as Slide 1 or extract/composite it into the video's opening 1-2 seconds. This is the same principle as proof screenshots on X/Twitter: real evidence beats generated art every time.
2. **If no user-provided image exists**, generate a dedicated cover image/frame — do NOT reuse a generic slide. The cover needs:
   - A bold, high-contrast visual (proof screenshot, dramatic number, product shot, or striking scene)
   - Readable text at a glance: the hook or the single biggest claim from the post
   - For video: a scene that conveys motion/energy in a still frame (fire, speed, contrast)
3. **Carousels (Instagram, TikTok photo mode)**: Slide 1 = hook image with the boldest headline. Slides 2-N can carry the detailed content. Never bury the most compelling visual in the middle.
4. **Video (TikTok, Reels, Shorts)**: The first 1-2 seconds must not be a slow fade-in or black screen. Start on the strongest visual frame. If using ffmpeg, trim the opening to start on action.
5. **Custom thumbnail for YouTube and TikTok**: Always generate a separate 1280x720 (YouTube) or 1080x1920 (TikTok) thumbnail image — do not rely on an auto-selected frame. The thumbnail is what drives clicks from search and suggested.

**Cover image checklist before attaching:**
- [ ] Is this the strongest, most attention-grabbing visual in the set?
- [ ] Does it convey the hook or main claim in under 2 seconds?
- [ ] If user provided a screenshot/image, is it this one?
- [ ] For video: does it show action from the first second (not a fade or black)?

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

### ⚠️ IMAGE ATTACHMENT: THE #1 FAILURE POINT

**Image attachment fails silently more often than any other step.** This is especially true on X/Twitter and Threads. The post goes live but without the image — and the user has to redo it manually. Do not let this happen.

**Rules before clicking Post on any platform:**

1. **If the user's prompt includes a screenshot, image, or file path — that image is REQUIRED.** Capture it at the start, confirm the path exists, and treat attachment failure as a blocking error (not a warning).
2. **After attaching any image, wait for the image preview to render** in the compose UI before clicking Post. If no preview appears within 10 seconds, the attachment failed — retry before proceeding.
3. **Never post without verifying the image preview is visible.** "I attached the file" is not enough — confirm the UI shows the thumbnail.
4. **If attachment repeatedly fails**, stop and report it instead of posting without the image. A text-only post is worse than no post when the user explicitly asked for an image.

**Platform-specific image attachment flows are documented below for X/Twitter and Threads** — read them before posting to either platform.

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
- **Instagram**: Visual-first. Decide the post type explicitly before writing anything — see "Instagram: Image-Only vs Text+Image" section below.
- **Threads**: Casual, conversational, like talking to a friend.
- **TikTok**: Upload via TikTok Studio with anti-bot override + AppleScript file picker. Convert photo carousels to video with ffmpeg first. Caption is secondary to visuals. See `references/platform-posting.md` TikTok section for the full anti-bot workflow.
- **Reddit**: Match the subreddit's tone. Informative, no self-promo smell. Check flair requirements.
- **dev.to**: Full article format with markdown. Technical depth.
- **Facebook**: Conversational, longer-form OK. Links in post body (not penalized like LinkedIn). Use images.
- **Discord**: Short, punchy, chat-style. No markdown tables (Discord renders them ugly). Use **bold** for emphasis, not headers.
- **Telegram**: Clean, formatted message. Use markdown formatting.
- **YouTube Community**: Community post style -- short, conversational, pose a question to drive comments. Link to full videos or articles in text.
- **YouTube Video**: Upload via Studio with hybrid AppleScript + browser automation. See `references/youtube-studio-upload.md` for the complete workflow. Set video language to English for auto-generated captions and auto-translate support.

### Instagram: Image-Only vs Text+Image

**This is the most common Instagram ambiguity.** When the user asks for "a post with both an image and text", they could mean several different things. Decide the post type explicitly and confirm it before posting.

#### The Three Instagram Post Modes

| Mode | When to use | Caption | Image |
|------|------------|---------|-------|
| **Image-only** | Aesthetic/art posts, images with text overlaid on the slide itself, photography, product shots where the visual is self-explanatory | Empty or minimal (1-3 emojis or a single line) | All content is in the image |
| **Text + image** | Educational content, announcements, behind-the-scenes, posts where caption adds real context | Full caption (hook + body + CTA + hashtags) | Image supports/illustrates the text |
| **Carousel + caption** | Multi-point content where slides carry the story | Short teaser caption ("Swipe to see all 5 →") + hashtags | Each slide is a self-contained point |
| **Carousel image-only** | Visual storytelling, design portfolios, before/after sequences | Empty or minimal | Slides tell the complete story visually |

**When the user asks for "both text and an image":**
1. Write the full caption text
2. Generate the image
3. Ask the user: "For Instagram — should the caption text go in the post body, or should I bake the key points as text overlays directly onto the image/slides? (Caption posts = discoverable via search; image-only = cleaner aesthetic)"
4. Wait for their preference before posting

**Never silently drop the caption.** If the user asked for text, that text must appear somewhere — either in the caption field or as a text overlay on the image. Silently posting with an empty caption when the user wrote copy is a failure.

#### Caption Must Not Be Dropped — Technical Safeguard

The Instagram API's `caption` field is the most commonly dropped parameter. Always verify it explicitly:

```python
# When posting via Puppeteer/browser — caption field check
def post_instagram_with_caption(image_paths, caption_text):
    """Always verify caption is non-empty before posting."""
    if not caption_text or not caption_text.strip():
        raise ValueError("Caption is empty — user asked for text, this is a bug. Add caption before posting.")

    # For API posting: caption goes in the configure call, not the upload call
    # rupload_igphoto / rupload_igvideo → uploads the media (no caption here)
    # configure_sidecar / configure_to_reel → this is where caption is set
    payload = {
        "caption": caption_text,  # REQUIRED — do not omit or leave empty
        "media_type": "CAROUSEL",
        "children_media_ids": [...],
    }
    # Verify caption made it into the payload before sending
    assert payload["caption"], "Caption was cleared before API call — check for variable shadowing"
```

For browser automation (Puppeteer):
```js
// After opening the compose dialog, type the caption BEFORE attaching images
// Instagram's compose flow: caption textarea → image attach → next → share
// If you attach images first, the caption field sometimes loses focus and clears on mobile web

// Verify caption is in the textarea before clicking Share
const captionEl = await page.$('textarea[aria-label*="caption"], div[role="textbox"]');
const captionValue = await captionEl.evaluate(el => el.value || el.textContent);
if (!captionValue.trim() && userWantsCaption) {
  throw new Error('Caption textarea is empty before posting — re-type caption and retry');
}
```

#### Carousel: Slides with Text Overlays vs Caption-Driven

**Slides carry the story (image-only mode):**
- Each slide has text baked into the image via Pillow/ffmpeg
- Caption = short hook + "Swipe →" + hashtags only
- No duplication between slide text and caption

**Caption carries the story (text+image mode):**
- Slides are pure visuals (no text overlay) — let the image breathe
- Caption = the full article/thread/story with line breaks
- Slides serve as visual proof or aesthetic support

**Never duplicate content between slide overlays and caption** — it looks amateurish and wastes reach (Instagram truncates long captions to "more" after 3 lines, so lead with the hook).

### X/Twitter: Image Attachment Workflow

X/Twitter is the most common platform where images silently drop. Use the right method for the tool in use.

**Via `xurl` CLI (preferred):**

```bash
# Step 1: Upload media FIRST — get the media_id
MEDIA_RESPONSE=$(xurl media upload /absolute/path/to/image.png)
MEDIA_ID=$(echo "$MEDIA_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['media_id_string'])")

# Step 2: Confirm MEDIA_ID is not empty before proceeding
if [ -z "$MEDIA_ID" ]; then
  echo "ERROR: media upload failed — do not post without image"
  exit 1
fi

# Step 3: Post with media attached
xurl post "Your tweet text" --media-id "$MEDIA_ID"

# Step 4: Verify — navigate to the posted tweet URL and confirm the image renders
```

**Via Puppeteer / browser automation:**

```js
// Step 1: Get the file input element (Twitter uses a hidden <input type="file">)
const fileInput = await page.$('input[data-testid="fileInput"]');
if (!fileInput) throw new Error('File input not found — DOM may have changed');

// Step 2: Set the file
await fileInput.uploadFile('/absolute/path/to/image.png');

// Step 3: WAIT for image preview — do not skip this wait
await page.waitForSelector('[data-testid="attachments"] img', { timeout: 15000 })
  .catch(() => { throw new Error('Image preview did not appear — attachment failed, aborting post'); });

// Step 4: Only now click the Post button
await page.click('[data-testid="tweetButtonInline"]');
```

**Image not attaching via CDP?** Twitter's React-controlled file input rejects programmatic `setFileInputFiles` on newer builds. Use `DOM.setFileInputFiles` via the CDP session directly on the node's backendNodeId instead of querySelector. If that also fails, use Peekaboo to click the image attach button and trigger the native macOS file picker, then AppleScript to type the path.

### Threads: Image Attachment Workflow

Threads is the second most common platform where images silently drop. The compose dialog has multiple "Post" buttons (feed header + dialog) and the image preview can fail to render.

**Via Puppeteer / browser automation:**

```js
// Step 1: Open the Threads compose dialog and type the caption first
// (typing before attaching avoids focus loss that can clear the file input)

// Step 2: Click the image/media attach icon (paperclip or image icon in compose dialog)
// Use Playwright snapshot to get the aria ref — querySelector is unreliable here
// browser snapshot → find the attach-image button ref → browser act click ref=<ref>

// Step 3: Trigger file selection via the hidden input
const fileInput = await page.$('input[type="file"]');
await fileInput.uploadFile('/absolute/path/to/image.png');

// Step 4: WAIT for thumbnail preview in the compose dialog — mandatory
// Look for an <img> inside the compose area (NOT the feed) with the uploaded image
await page.waitForSelector('div[role="dialog"] img[src*="blob:"]', { timeout: 15000 })
  .catch(() => { throw new Error('Threads: image preview not visible — do not post, attachment failed'); });

// Step 5: Take a Playwright/Peekaboo screenshot to visually confirm the image is there
// before clicking Post

// Step 6: Click the correct "Post" button — must be inside the compose dialog
// WRONG: page.click('button:has-text("Post")') — finds the feed header button first
// RIGHT: use Playwright snapshot refs=aria, find the Post button scoped to the dialog
// browser snapshot → locate 'Post' ref within dialog → browser act click ref=<ref>
```

**Clipboard paste alternative** (if file input fails):

```python
import subprocess

# Copy image to clipboard as a file reference
subprocess.run(['osascript', '-e', f'set the clipboard to (POSIX file "{abs_image_path}")'])

# Click into the Threads compose area
# Use peekaboo to click the media attach area
# Then Cmd+V to paste the image from clipboard
subprocess.run(['osascript', '-e', 'tell application "Google Chrome" to activate'])
subprocess.run(['cliclick', 'kd:cmd', 't:v', 'ku:cmd'])

# Then wait for preview to render before posting
```

**NEVER post to Threads without seeing the image thumbnail in the compose dialog.** If the thumbnail isn't there, the image will not appear in the published post.

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

Two approaches depending on the context. Use Bot API for broadcast channels (most reliable). Use web client automation when Bot API isn't available or the user is posting to a personal chat/group.

#### Option A: Bot API (Preferred — Broadcast Channels)

```bash
# Photo with caption
curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendPhoto" \
  -F "chat_id=$CHANNEL_ID" \
  -F "photo=@image.png" \
  -F "caption=Your caption" \
  -F "parse_mode=Markdown"

# Scheduled post (Unix timestamp)
curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendPhoto" \
  -F "chat_id=$CHANNEL_ID" \
  -F "photo=@image.png" \
  -F "caption=Your caption" \
  -F "schedule_date=1735689600"
```

#### Option B: Web Client Automation (web.telegram.org)

Use this when Bot API is unavailable or when posting to chats/groups as a user (not a bot). The web client flow has several non-obvious failure points — follow every step exactly.

**Step 1: Open the chat and locate the attachment button**

```js
// The "Add an attachment" button (paperclip icon)
// Use Playwright snapshot to find it — selector is unreliable across builds
// browser snapshot → find button with aria-label or tooltip "Add an attachment"
// browser act click ref=<ref>
```

**Step 2: Click "Photo or Video" from the dropdown**

```js
// The dropdown uses class .MenuItem
// Find by text content — don't use index (menu order can change)
const menuItems = document.querySelectorAll('.MenuItem');
const photoItem = Array.from(menuItems).find(el => el.textContent?.includes('Photo or Video'));
photoItem.click();
// This triggers a native macOS file picker dialog
```

**⚠️ CRITICAL: Do NOT click in the wrong area before this step.** The emoji picker can open instead of the attachment menu if focus is in the wrong element. If the emoji picker opens: press Escape, then re-click the correct attachment icon.

**Step 3: Handle the native file picker — keyboard language issue**

The native macOS file picker opens in whatever language the system keyboard is set to. If the user has a non-Latin layout (Russian, etc.), Cmd+Shift+G + typing the path will produce garbage. **Always switch to English first.**

```python
import subprocess, time

# Switch to English input source BEFORE the file picker opens
original_lang = ensure_english_input_source()  # see AppleScript section
time.sleep(0.3)

# CDP approach (more reliable than AppleScript typing):
# Find the hidden file input that the native picker backs
# input[type='file'][accept*='image'] or input[type='file'][accept*='video']
# await page.evaluate(() => {
#   const input = document.querySelector("input[type='file'][accept*='image']");
#   if (input) input.click();  // triggers native picker
# });
# Then use DOM.setFileInputFiles to set the file without native picker:
# cdp.send('DOM.setFileInputFiles', { files: ['/abs/path/to/image.jpg'], nodeId: inputNodeId })
```

**AppleScript fallback** (when CDP file input isn't accessible):

```applescript
-- Needs generous delays — the file picker dialog takes time to fully render
tell application "System Events"
    tell process "Google Chrome"
        delay 2
        keystroke "g" using {command down, shift down}
        delay 2
        -- Type the FULL absolute path
        keystroke "/absolute/path/to/image.jpg"
        delay 1
        key code 36  -- Enter (confirm path in Go To Folder)
        delay 2
        key code 36  -- Enter again (confirm file selection)
    end tell
end tell
```

After file selection, restore the original input source:
```python
restore_input_source(original_lang)
```

**Step 4: "Send Photo" dialog — caption field**

After file selection, Telegram opens a "Send Photo" preview dialog with a caption field and a Send button.

```js
// The caption field is NOT a standard contenteditable="true" div
// It's: div.form-control.allow-selection inside the modal
// Standard .innerText = text or insertText CDP call will NOT work reliably

// Approach 1: Focus + Paste (most reliable)
const modal = document.querySelector('.send-photo-modal, [class*="SendPhoto"]');
const captionField = modal?.querySelector('.form-control.allow-selection');
captionField.click();
captionField.focus();
// Then use Python subprocess pbcopy + AppleScript Cmd+V to paste caption
// (same pattern as for Twitter/Threads — avoids encoding issues)

// Approach 2: CDP insertText after focus (if paste unavailable)
// cdp.send('Input.insertText', { text: captionText })
// Only use this for ASCII-only captions — emoji and non-Latin chars may garble
```

**Paste caption via Python (encoding-safe):**
```python
import subprocess

caption_text = "Your caption text here"
subprocess.Popen(['pbcopy']).communicate(caption_text.encode('utf-8'))
time.sleep(0.2)
subprocess.run(['osascript', '-e', 'tell application "Google Chrome" to activate'])
subprocess.run(['cliclick', 'kd:cmd', 't:v', 'ku:cmd'])
time.sleep(0.3)
# Verify the text appeared in the caption field before sending
```

**⚠️ CRITICAL: Do NOT press Enter in the caption field.** Enter adds a newline, it does NOT send the message.

**Step 5: Click Send**

The Send button text is "Send" (capitalized, not "SEND"). The class pattern varies by Telegram build version.

```js
// Find by text content — more stable than class selector
const modal = document.querySelector('.popup, [class*="SendPhoto"], [class*="Modal"]');
const buttons = modal ? modal.querySelectorAll('button, [class*="Button"]') : [];
const sendBtn = Array.from(buttons).find(el => el.textContent.trim() === 'Send');
if (!sendBtn) throw new Error('Send button not found — modal may have closed or class changed');
sendBtn.click();

// Fallback if text search fails: look for the primary button
// class pattern: Button <hash> smaller primary inline
const primaryBtn = modal?.querySelector('[class*="Button"][class*="primary"]');
primaryBtn?.click();
```

**Full Telegram web client gotcha list:**

| Gotcha | What happens | Fix |
|--------|-------------|-----|
| Emoji picker opens | Clicked in message input area before attachment | Press Escape, re-click the paperclip icon |
| Russian/non-Latin file picker | Path typed in wrong keyboard layout | `ensure_english_input_source()` before file picker opens |
| Caption field rejects insertText | Not a standard contenteditable | Focus + Python pbcopy + Cmd+V paste |
| Enter key doesn't send | Adds newline in caption | Click the Send button, never press Enter |
| Send button not found | Class hash changed in new Telegram build | Search by `textContent === 'Send'` first |
| File picker closes without selecting | Not enough delay after Cmd+Shift+G | Increase delay to 2s between each AppleScript step |
| Modal closes unexpectedly | Escape was sent accidentally | Catch modal close event; re-open attach flow from Step 1 |

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

## Post-Publication Verification

**This is mandatory, not optional.** Never report a post as done without completing this. Encoding artifacts and missing images are common silent failures that only show up in the published post.

### Step 1: Navigate to the Post URL

Immediately after publishing, collect the exact URL of the post (platform should return or display it). Navigate to that URL directly — do not stay on the compose page or assume the feed view matches the actual post.

### Step 2: Screenshot the Published Post

Use Peekaboo to take a screenshot of the published post as it actually appears:

```bash
# Navigate Chrome to the post URL first, then screenshot it
peekaboo see --app "Google Chrome" --path /tmp/post-verify.png

# Or via Puppeteer — navigate to the URL and screenshot
# await page.goto(postUrl); await page.screenshot({ path: '/tmp/post-verify.png' });
```

Show the screenshot to the user using the Read tool so they can see the post without opening a browser.

### Step 3: Check Text Encoding

Extract the visible post text and scan for encoding artifacts. Common failure signatures:

| Artifact | Cause | Looks like |
|----------|-------|------------|
| `‚Äî` | UTF-8 em dash decoded as Mac Roman | `word‚Äîword` instead of `word—word` |
| `Ã©`, `Ã¨`, `Ã ` | UTF-8 accented chars decoded as Latin-1 | `caf‚Äö√†√†` |
| `â€œ` / `â€` | Curly quotes garbled | `â€œquoteâ€` |
| `ï»¿` | BOM at start of text | First char looks like a bullet |
| Lone `?` replacing chars | Wrong encoding on clipboard paste | `word?word` |
| Cyrillic/Hebrew/Arabic in a Latin post | Wrong keyboard input source active during typing | Random non-Latin chars mid-sentence |

```python
import re

def check_encoding_artifacts(text):
    """Detect common encoding corruption patterns in post text."""
    patterns = [
        (r'â€[œ"â]', 'Garbled curly quotes (UTF-8 → Latin-1 mismatch)'),
        (r'‚Äî|‚Äù|‚Äú', 'Garbled em dash or curly quotes (Mac Roman mismatch)'),
        (r'Ã[©¨ ¢£¤¥¦§]', 'Garbled accented characters'),
        (r'ï»¿', 'BOM character at start'),
        (r'[А-Яа-яЁё]{2,}', 'Cyrillic characters (possible keyboard language leak)'),
    ]
    issues = []
    for pattern, description in patterns:
        if re.search(pattern, text):
            issues.append(description)
    return issues

# Usage: extract text from the DOM, then:
# issues = check_encoding_artifacts(post_text)
# if issues: report them and flag the post for correction
```

If artifacts are found: **report them immediately with the screenshot, do NOT mark the post as done.** The user needs to edit the post to fix the text.

### Step 4: Check Image / Video Attachment

Visually confirm in the screenshot:

- **Image posts**: The image thumbnail is visible in the post body (not just in the composer)
- **Video posts**: The video player/thumbnail is visible; click play if possible to confirm the video loads
- **Carousels**: The first slide is visible and is the correct hook image (not a blank or wrong slide)
- **Thread/Twitter with image**: The image appears inline below the tweet text, not as a broken link icon

If the image or video is missing from the screenshot of the live post: **stop, report it, and do NOT mark the post as done.**

### Step 5: Report to User

After verification, present a clear summary:

```
✅ Post verified at: [URL]
   Screenshot: [show inline via Read tool]
   Text: OK / ⚠️ ENCODING ISSUE FOUND: [describe]
   Image: Attached / ⚠️ MISSING — post needs to be corrected
   Video: Attached / ⚠️ MISSING
```

If any check fails, provide the screenshot and specific fix instructions before marking the platform as done.

---

## Post-Publishing Checklist

- [ ] **Image preview confirmed visible in compose dialog BEFORE clicking Post** (X/Twitter and Threads: mandatory)
- [ ] Navigated to the exact published post URL
- [ ] Screenshot taken and shown to user (Peekaboo or Puppeteer)
- [ ] Text encoding checked — no garbled characters (`‚Äî`, `Ã©`, Cyrillic in wrong context, etc.)
- [ ] Image/video confirmed present in published post (not just in composer)
- [ ] Exact URL collected and logged
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
| Published post has garbled text (`‚Äî`, `Ã©`, etc.) | UTF-8/Mac Roman encoding mismatch from clipboard | Use Python subprocess for pbcopy; edit the live post to fix text; report to user with screenshot |
| Published post has Cyrillic or wrong-language characters mid-text | Non-Latin keyboard was active during typing | Switch input source to English before typing (see AppleScript keyboard language section); edit the post |
| Image/video missing from live post (was visible in composer) | Silent attachment failure — post went live without media | Do not mark as done; report with screenshot; user must edit or repost with image |
| Post URL not returned by platform | Browser automation didn't capture the redirect URL | Navigate to profile and find the newest post to get the URL |
| Instagram: caption is empty in the published post but user asked for text | Caption was dropped — either not passed to `configure_sidecar`, or textarea cleared during browser automation | Caption goes in the `configure` API call, not the upload call; for browser: type caption BEFORE attaching images; verify textarea is non-empty before clicking Share |
| Instagram: post went up image-only but user wanted text | Ambiguity in the request was resolved wrong | Always confirm image-only vs text+image mode when user asks for "both"; never silently drop copy |
| Instagram: "uploaded image isn't in an allowed aspect ratio" | Image ratio is outside 0.8–1.91 range | Run `check_aspect_ratio()` → `fit_to_ratio()` with blur background; NEVER crop screenshots — pad them. See "Image Aspect Ratio Enforcement" section. |
| Instagram: image rejected but ratio looks fine | Ratio is fine but file is under 320px on shortest side or over 8MB | Resize up to 1080px minimum; compress to under 8MB at quality=95 |
| Instagram: all carousel slides rejected | Slides have different aspect ratios | All slides in a carousel MUST be the same ratio — normalize all to 1:1 or all to 4:5 |
| Instagram API `Transcode not finished` | Wait 30s after video upload before calling `configure_to_clips` |
| Instagram API `cover_photo_upload_error` | Upload cover photo via `rupload_igphoto` with same upload_id before configure |
| Instagram `sessionid` cookie expired | User must re-login in Chrome profile; re-extract cookies |
| X/Twitter: image missing from published post | Silent attachment failure — post went live without image | NEVER click Post without confirming the image preview thumbnail is visible in the compose dialog |
| X/Twitter: `xurl media upload` returns no media_id | Upload silently failed or API returned error | Check response JSON for error field; confirm file path is absolute and file exists; retry once |
| X/Twitter: image drops after clicking Post | Media_id not included in post request | Upload image FIRST, store media_id, then post — never upload and post in the same command without capturing the id |
| Threads: image not in published post | File input set but preview never rendered | Wait for `img[src*="blob:"]` inside compose dialog before clicking Post; if no preview = don't post |
| Threads: image preview appears then disappears | Focus event cleared the file input when typing caption | Type caption BEFORE attaching image, not after |
| Threads: querySelector file input returns null | Threads DOM structure changed | Use Playwright snapshot to find current file input ref; don't hardcode selectors |
| Threads: image attached but posted without it | Clicked wrong Post button (feed header, not dialog) | Always scope to dialog: Playwright snapshot + aria ref for the Post button inside compose dialog |
| User provided a screenshot/image path and it wasn't attached | Skill proceeded without attaching user-provided image | A user-provided image is REQUIRED — treat missing attachment as a blocker, not a warning; stop and retry |
| CDP insertText on X or Threads | Text corrupts in React editor (garbled, repeated fragments) | Use Python subprocess pbcopy + AppleScript Cmd+V |
| Shell printf pipes to pbcopy | UTF-8 garbled — em dashes → ‚Äî, emoji → broken bytes | ALWAYS use Python subprocess: `subprocess.Popen(['pbcopy']).communicate(text.encode('utf-8'))` |
| Threads clicks "Add to thread" instead of "Post" | JS querySelector finds wrong button — DOM order puts "Add to thread" first | Use Playwright snapshot refs=aria to get exact Post button ref, then `browser act click ref=<ref>` |
| Threads: cliclick hits wrong "Post" button | getBoundingClientRect finds "Post" in main feed header, not compose dialog | Playwright snapshot + aria ref is the only reliable method |
| X video upload: media missing from post | Post sent before upload completed | Wait 45s after `DOM.setFileInputFiles` before clicking Post |
| TikTok page crashes after upload | Override `navigator.webdriver` BEFORE page load; zero CDP calls during upload |
| TikTok DraftJS rejects caption | Skip caption in upload, edit via TikTok app after publish |
| AppleScript file picker opens but selects nothing / types garbage | Non-Latin keyboard input source active (e.g., Russian) — keystrokes get converted and the path becomes unreadable | Call `ensure_english_input_source()` BEFORE Cmd+Shift+G, wait 0.3s, type path, then restore. See "AppleScript File Picker: Keyboard Language Issue" section. |
| AppleScript file picker fails (permissions) | Accessibility permissions not granted | Check System Settings → Privacy & Security → Accessibility; increase delays; verify file path is absolute |
| Telegram web: emoji picker opens instead of attachment menu | Clicked in the message text area before clicking the paperclip | Press Escape to dismiss, then click the paperclip icon (not the message area) |
| Telegram web: file picker types garbage path | Non-Latin keyboard active when AppleScript types the path | Call `ensure_english_input_source()` before triggering the picker; 2s delays between each AppleScript step |
| Telegram web: caption field ignores insertText CDP call | Field is `.form-control.allow-selection`, not a standard contenteditable | Focus the field + Python `pbcopy` + AppleScript `Cmd+V` to paste |
| Telegram web: Enter key in caption field doesn't send | Enter inserts newline in Telegram's composer | Click the Send button explicitly; never use Enter to send |
| Telegram web: Send button not found | Class hash changed in new Telegram build | Search by `textContent.trim() === 'Send'` on all elements in the modal |
| Telegram web: file picker closes without selecting | Insufficient delay after `Cmd+Shift+G` in AppleScript | Increase delays to 2s after each keystroke/key code step |
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
