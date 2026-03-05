# Platform-Specific Posting Guide

Detailed technical instructions for posting to each platform via browser automation (Puppeteer/Chrome profiles) and APIs.

## Table of Contents
1. [Chrome Profile Architecture](#chrome-profile-architecture)
2. [Instagram](#instagram)
3. [X/Twitter](#xtwitter)
4. [LinkedIn](#linkedin)
5. [Threads](#threads)
6. [YouTube](#youtube)
7. [TikTok](#tiktok)
8. [Reddit](#reddit)
9. [dev.to](#devto)
10. [Facebook](#facebook)
11. [Discord](#discord)
12. [Telegram](#telegram)
13. [Common Automation Patterns](#common-automation-patterns)
14. [Troubleshooting](#troubleshooting)

---

## Chrome Profile Architecture

Each social media account uses a separate Chrome profile running on a unique debug port:

```
Chrome Profile → localhost:<port> → Puppeteer connects → automates posting
```

**Connection pattern:**
```javascript
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.connect({
  browserURL: 'http://localhost:<PORT>',
  defaultViewport: null
});
```

Never mix Chrome profiles between accounts. Each account gets its own dedicated profile and port.

---

## Instagram

### Carousel Upload Flow (Puppeteer)

1. Connect to Chrome via `puppeteer.connect({ browserURL: 'http://localhost:<PORT>' })`
2. Navigate to `instagram.com`
3. Click Create (find via `a` with `svg[aria-label="New post"]`)
4. Click Post from dropdown
5. File input: `input[type="file"]` — accepts `image/avif, image/jpeg, image/png, image/heic, video/mp4`
6. Input supports `multiple: true` for carousel uploads
7. Use `fileInput.uploadFile(...paths)` for multiple images
8. Click through Crop → Edit → Caption → Share
9. Caption: use ClipboardEvent paste on `[aria-label="Write a caption..."]`
10. Uncheck Facebook cross-post if already posted there
11. Wait ~30s for "has been shared" confirmation

### Reel Video Encoding (CRITICAL)

Instagram silently rejects videos at 29.97fps. Always re-encode to exact specs:

```bash
ffmpeg -i input.mp4 \
  -c:v libx264 -profile:v high -level:v 4.0 -pix_fmt yuv420p \
  -r 30 -g 60 -crf 20 -preset medium \
  -c:a aac -ar 48000 -b:a 192k -ac 2 \
  -movflags +faststart -f mp4 output.mp4
```

Key: `-r 30` (exact 30fps, NOT 29.97). Without this, the upload appears to succeed but the reel never appears on the profile.

### Reel Upload Flow

1. Navigate to `instagram.com`
2. Click Create → Post (videos >60s auto-become Reels)
3. Find `input[type="file"]` → `uploadFile(videoPath)`
4. Wait for processing (~5-10s until "Next" button appears)
5. Click Next (crop) → Next (filter)
6. Type caption in `[aria-label="Write a caption..."]` — this is a contentEditable div
7. Click Share
8. Wait ~50-85s for "reel has been shared" confirmation

### People Tagging (Hidden DOM — CDP Accessibility Technique)

Instagram's tag popup renders in a hidden DOM layer. The only reliable method is CDP:

```javascript
const cdp = await page.createCDPSession();

// 1. Click "Tag people" button
await page.evaluate(() => {
  const d = document.querySelector('[role="dialog"]');
  for (const b of d.querySelectorAll('button')) {
    if (b.textContent.includes('Tag people')) { b.click(); return; }
  }
});
await sleep(2000);

// 2. Tab to the hidden search input
for (let i = 0; i < 15; i++) {
  await page.keyboard.press('Tab');
  await sleep(200);
  if ((await page.evaluate(() => document.activeElement?.placeholder)) === 'Search') break;
}

// 3. Type to search
await page.keyboard.type('username', { delay: 80 });
await sleep(4000);

// 4. Use Accessibility tree to find the result button
await cdp.send('Accessibility.enable');
const {nodes} = await cdp.send('Accessibility.getFullAXTree');
const resultBtn = nodes.find(n =>
  n.role?.value === 'button' && (n.name?.value || '').includes('target_username')
);

// 5. Click via DOM.resolveNode + Runtime.callFunctionOn
if (resultBtn?.backendDOMNodeId) {
  const {object} = await cdp.send('DOM.resolveNode', {
    backendNodeId: resultBtn.backendDOMNodeId
  });
  await cdp.send('Runtime.callFunctionOn', {
    objectId: object.objectId,
    functionDeclaration: 'function() { this.click(); }',
    returnByValue: true
  });
}
```

What does NOT work on hidden elements: `querySelectorAll`, `page.$()`, `page.mouse.click(x,y)`, CDP `Input.dispatchMouseEvent`, `ArrowDown + Enter`.

What DOES work: CDP `Accessibility.getFullAXTree` → `DOM.resolveNode` → `Runtime.callFunctionOn('this.click()')`, `page.keyboard.press('Tab')`, `page.keyboard.type()`.

### @Mentions vs People Tags

| | @Mention (caption) | People Tag |
|---|---|---|
| Shows on their profile? | No | Yes (Tagged tab) |
| Cross-promotion | Low | High — reaches their followers |

Best practice: Do BOTH for maximum reach.

### Editing Existing Posts

Navigate to post URL → Click `svg[aria-label="More options"]` → Click "Edit" → Caption field: `[aria-label="Write a caption..."]` → Click Done.

---

## X/Twitter

### Posting Flow

1. Navigate to `x.com/compose/post`
2. Find the tweet composer: `[data-testid="tweetTextarea_0"]` or `div[role="textbox"]`
3. Click and type the tweet
4. Click Post: `[data-testid="tweetButtonInline"]`

### Thread Creation

Compose dialog thread creation (+ button) is unreliable in automation. Instead:
1. Post the main tweet
2. Navigate to the tweet URL
3. Click reply → type the thread continuation → post

### Getting the Tweet URL

After posting: `https://x.com/{handle}/status/{id}` — find the latest tweet on the profile page.

---

## LinkedIn

### Company Page Posting

1. Navigate to `https://www.linkedin.com/company/{ID}/admin/dashboard/`
2. Dismiss any Premium upsell modals first
3. Click Create → Start a post
4. Find the editor: `.ql-editor[contenteditable="true"]` inside `[role="dialog"]`
5. Use `keyboard.type()` — LinkedIn's Quill editor rejects `fill` actions
6. Click Post button

### Key Gotchas

- LinkedIn uses a Quill rich text editor — Puppeteer's `fill` action does NOT work
- Must use `page.keyboard.type()` after clicking into the editor
- Premium upsell modals randomly appear — dismiss them first

---

## Threads

### Posting Flow

1. Navigate to `threads.com`
2. Click the compose/new post button
3. Type in the text editor
4. 500 character limit — always check post length before posting
5. Link previews render automatically
6. Attach media if needed
7. Click Post

---

## YouTube

### Community Posts

1. Navigate to `https://www.youtube.com/channel/{CHANNEL_ID}/posts?show_create_dialog=1`
2. Click "What's on your mind?" to activate the editor
3. The `#contenteditable-root` div becomes available
4. Type text via system clipboard + Cmd+V (see below)
5. Click Post

**Text input:** YouTube's editor is heavily protected. The ONLY reliable method is system clipboard:

```bash
# Step 1: Write text to system clipboard
cat << 'EOF' | pbcopy
Your post text here...
EOF
```

```javascript
// Step 2: Focus and paste
const el = document.querySelector('#contenteditable-root');
el.focus();
await page.keyboard.down('Meta');
await page.keyboard.press('v');
await page.keyboard.up('Meta');
```

What does NOT work: `execCommand('insertText')`, `innerHTML` (TrustedHTML policy), `navigator.clipboard.writeText()`, `ClipboardEvent`, `page.keyboard.type()` with long text.

### Video Upload

Upload via YouTube Studio: `studio.youtube.com`

### Description Editing

Navigate to `studio.youtube.com/video/{ID}/edit` → Select all + delete before typing → Type new description → Save.

---

## TikTok

- TikTok Studio web (`tiktok.com/upload`) only accepts video — no photo carousel
- Photo carousels are mobile-app only
- Workaround: Convert carousel slides to slideshow video with ffmpeg, then upload as video
- Video file input: `accept="video/*"`, `multiple=false`

```bash
ffmpeg -framerate 1/4 -i slide-%d.png \
  -c:v libx264 -r 30 -pix_fmt yuv420p \
  -vf "scale=1080:1080:force_original_aspect_ratio=decrease,pad=1080:1080:(ow-iw)/2:(oh-ih)/2" \
  output.mp4
```

---

## Reddit

### Posting

Use old.reddit.com for reliable automation:
- Submit page: `old.reddit.com/r/{subreddit}/submit?selftext=true`
- Standard HTML form fields: `textarea[name="title"]`, `textarea[name="text"]`, `input[type="submit"]`

New Reddit's submit form uses contenteditable which is harder to automate reliably.

### Anti-Spam Rules (CRITICAL — Account Safety)

- NEVER post more than 3 comments in a single thread within 1 hour
- NEVER post more than 5 comments total across Reddit within 30 minutes
- Space comments at least 5-10 minutes apart
- NEVER reply to your own post with multiple comments (top red flag)
- One top-level comment per thread MAX
- The cost of getting banned is losing ALL existing posts and karma

### Flair

Some subreddits require flair — check before posting. Available flairs vary by subreddit.

---

## dev.to

### Posting

- Title and body are SEPARATE fields: `#article-form-title` and `#article_body_markdown`
- Always select-all + delete before typing to avoid appending to leftover text
- Tab from title to body
- Tags: max 4, type each tag then press comma/enter to confirm
- The Publish button may require all fields to be valid

---

## Facebook

Standard posting flow via browser. Navigate to profile or page, find the composer, type, and post.

---

## Discord

### Option 1: Webhook (Preferred for Announcements)

```bash
curl -X POST "$DISCORD_WEBHOOK_URL" \
  -H "Content-Type: multipart/form-data" \
  -F "payload_json={\"content\": \"Your message here\"}" \
  -F "file=@image.png"
```

### Option 2: Bot API

```bash
curl -X POST "https://discord.com/api/v10/channels/$CHANNEL_ID/messages" \
  -H "Authorization: Bot $DISCORD_BOT_TOKEN" \
  -H "Content-Type: multipart/form-data" \
  -F "payload_json={\"content\": \"Your message\"}" \
  -F "files[0]=@image.png"
```

### Option 3: Browser Automation

- Use `ClipboardEvent('paste')` to paste text into Discord's React contenteditable textbox
- `innerHTML` approach only inserts first character; paste event works
- `type` with `slowly: true` times out on long messages with newlines

---

## Telegram

### Bot API (Required for Broadcast Channels)

Broadcast channels have NO input box in web.telegram.org. Must use Bot API.

```bash
# Text message
curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" \
  -d "chat_id=$CHANNEL_ID" \
  -d "text=Your message" \
  -d "parse_mode=Markdown"

# Photo with caption
curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendPhoto" \
  -F "chat_id=$CHANNEL_ID" \
  -F "photo=@image.png" \
  -F "caption=Your caption" \
  -F "parse_mode=Markdown"

# Multiple photos (media group)
curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMediaGroup" \
  -F "chat_id=$CHANNEL_ID" \
  -F "media=[{\"type\":\"photo\",\"media\":\"attach://photo1\",\"caption\":\"Caption\"},{\"type\":\"photo\",\"media\":\"attach://photo2\"}]" \
  -F "photo1=@slide1.png" \
  -F "photo2=@slide2.png"
```

For group chats (not broadcast): web.telegram.org editor exists, ClipboardEvent paste works.

---

## Common Automation Patterns

### Reliable Element Clicking

```javascript
// Normal DOM elements
await page.evaluate(() => {
  for (const b of document.querySelectorAll('button')) {
    if (b.textContent.trim() === 'Share') { b.click(); return; }
  }
});

// Hidden DOM / overlays — use CDP
const cdp = await page.createCDPSession();
await cdp.send('Input.dispatchMouseEvent', {
  type: 'mousePressed', x, y, button: 'left', clickCount: 1, buttons: 1
});
await cdp.send('Input.dispatchMouseEvent', {
  type: 'mouseReleased', x, y, button: 'left', clickCount: 1
});

// Hidden inputs — tab navigation
for (let i = 0; i < 20; i++) {
  await page.keyboard.press('Tab');
  const placeholder = await page.evaluate(() => document.activeElement?.placeholder);
  if (placeholder === 'Search') break;
}
```

### Dismissing Popups

```javascript
await page.evaluate(() => {
  document.querySelectorAll('button').forEach(b => {
    if (b.textContent.includes('Not Now') || b.textContent.includes('Dismiss')) b.click();
  });
});
```

### Waiting for Upload/Processing

```javascript
for (let i = 0; i < 30; i++) {
  await sleep(5000);
  const status = await page.evaluate(() => {
    if (document.body.innerText.includes('has been shared')) return 'SHARED';
    if (document.body.innerText.includes('Error')) return 'ERROR';
    return 'WAITING';
  });
  if (status !== 'WAITING') break;
}
```

---

## Troubleshooting

| Problem | Platform | Solution |
|---------|----------|----------|
| Video upload silently fails | Instagram | Re-encode at exact 30fps (not 29.97) |
| Share button clicks but nothing happens | Instagram | Video >60s auto-becomes Reel, wait longer |
| Caption not saving | Instagram | Use contentEditable div, not textarea selector |
| `fill` action fails on editor | LinkedIn | Use `page.keyboard.type()` — Quill editor |
| Tag search input invisible | Instagram | Tab navigation + CDP clicks (hidden DOM) |
| Thread creation fails | X/Twitter | Post main tweet first, then reply separately |
| Premium upsell blocks posting | LinkedIn | Dismiss modal first |
| "Report a problem" dialog | Instagram | CDP key events went to wrong element |
| Upload timeout | All | Increase wait time, check network |
| Broadcast channel no editor | Telegram | Use Bot API, not web.telegram.org |
| Text paste fails | Discord | Use ClipboardEvent('paste'), not innerHTML |
| System clipboard garbles UTF-8 | YouTube | Use `printf` or ensure UTF-8 encoding |

### macOS File Upload Bug

Some browser automation tools have a macOS `/tmp` → `/private/tmp` symlink path validation bug. Files at `/tmp/uploads/` resolve to `/private/tmp/uploads/` which fails validation. Workaround: Use Puppeteer scripts with `uploadFile()` instead of browser tool file upload.
