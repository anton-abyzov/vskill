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

### Carousel Upload Flow (Puppeteer — Fragile)

> ⚠️ **The Puppeteer UI flow is unreliable for carousels.** Instagram's canvas/image processing
> crashes with "Something went wrong" when files are injected via CDP `setFileInputFiles` or
> JavaScript `DataTransfer` because the File objects aren't true in-page context objects.
> **Use the API approach below instead.**

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

### Carousel Upload via Instagram API (Recommended)

The `signed_body` API approach is the only reliable method for programmatic carousel posting.
Requires an active Instagram session in the Chrome profile (cookies must be valid).

**Step 1: Extract cookies from the Chrome profile**

```javascript
// Via CDP WebSocket connection to the Chrome debug port
const cookieResult = await send('Network.getCookies', { urls: ['https://www.instagram.com'] });
const csrfToken = cookieResult.result.cookies.find(c => c.name === 'csrftoken')?.value;
const sessionId = cookieResult.result.cookies.find(c => c.name === 'sessionid')?.value;
// Build full cookie string for curl: "csrftoken=XXX; sessionid=YYY; ds_user_id=ZZZ; ..."
```

**Step 2: Upload each image with `is_sidecar: 1`**

```bash
UPLOAD_ID="$(date +%s)${INDEX}00"
UPLOAD_NAME="${UPLOAD_ID}_0_$(python3 -c 'import random; print(random.randint(1000000000,9999999999))')"

curl -s -X POST "https://www.instagram.com/rupload_igphoto/${UPLOAD_NAME}" \
  -H "Cookie: ${COOKIES}" \
  -H "X-CSRFToken: ${CSRF}" \
  -H "X-IG-App-ID: 936619743392459" \
  -H "X-Instagram-AJAX: 1034662339" \
  -H "Content-Type: image/jpeg" \
  -H "X-Instagram-Rupload-Params: {\"media_type\":1,\"upload_id\":\"${UPLOAD_ID}\",\"upload_media_height\":1080,\"upload_media_width\":1080,\"xsharing_user_ids\":\"[]\",\"is_sidecar\":1,\"image_compression\":\"{\\\"lib_name\\\":\\\"moz\\\",\\\"lib_version\\\":\\\"3.1.m\\\",\\\"quality\\\":\\\"80\\\"}\"}" \
  -H "X-Entity-Name: ${UPLOAD_NAME}" \
  -H "X-Entity-Length: $(stat -f%z image.jpg)" \
  -H "Offset: 0" \
  --data-binary @image.jpg
```

Key params in `X-Instagram-Rupload-Params`:
- `is_sidecar: 1` — **CRITICAL** — marks this upload as part of a carousel
- `media_type: 1` — photo
- `upload_media_height/width: 1080` — standard square

Upload each image separately. Space uploads 2s apart. Save each `upload_id` from the response.

**Step 3: Configure the carousel with `signed_body`**

```bash
# Build children_metadata JSON array from upload IDs
CHILDREN='[{"upload_id":"UID1","source_type":"4","edits":{"crop_original_size":[1080.0,1080.0],"crop_center":[0.0,0.0],"crop_zoom":1.0},"extra":{"source_width":1080,"source_height":1080}},...]'

BODY_JSON='{"_uuid":"'$(uuidgen)'","caption":"Your caption here","client_sidecar_id":"'$(date +%s)'","children_metadata":'$CHILDREN',"disable_comments":0,"like_and_view_counts_disabled":0}'

curl -s -X POST "https://www.instagram.com/api/v1/media/configure_sidecar/" \
  -H "Cookie: ${COOKIES}" \
  -H "X-CSRFToken: ${CSRF}" \
  -H "X-IG-App-ID: 936619743392459" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "signed_body=SIGNATURE.${BODY_JSON}"
```

**Key details:**
- `signed_body=SIGNATURE.{json}` format is **mandatory** — regular JSON or urlencoded body returns errors
- `source_type: "4"` in children metadata (library upload)
- Response contains `media_type: 8` (carousel) and `carousel_media_count: N`
- Response includes the post `code` for the URL: `instagram.com/p/{code}/`

**Step 4: Edit caption (if needed)**

```bash
BODY_JSON='{"_uuid":"'$(uuidgen)'","caption_text":"Updated caption"}'
curl -s -X POST "https://www.instagram.com/api/v1/media/${MEDIA_ID}/edit_media/" \
  -H "Cookie: ${COOKIES}" \
  -H "X-CSRFToken: ${CSRF}" \
  -H "X-IG-App-ID: 936619743392459" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "signed_body=SIGNATURE.${BODY_JSON}"
```

### Instagram API Session Safety (CRITICAL)

- **NEVER call delete endpoints** (`/media/{id}/delete/`) via API — triggers Instagram security and invalidates the session
- **NEVER call unfamiliar API endpoints** experimentally — each failed call increases suspicion score
- If you need to delete a post, do it through the web UI manually
- Stick to: `rupload_igphoto` (upload), `configure_sidecar` (publish carousel), `edit_media` (edit caption)
- If the session gets killed, the user must re-login manually in the Chrome profile

### What Doesn't Work for Carousel Upload

| Method | Problem |
|--------|---------|
| CDP `setFileInputFiles` (Puppeteer `uploadFile`) | Files aren't true JS context objects — Instagram's canvas processing crashes on "Next" |
| JavaScript `DataTransfer` + `input.files` + `change` event | Files load into crop view but crash on "Next" click with "Something went wrong" |
| `configure_sidecar` with regular JSON body | Returns error — must use `signed_body=SIGNATURE.{json}` format |
| `configure_sidecar` with urlencoded body (no signed_body) | Returns error |
| `web/create/configure/` with `children_metadata` | Creates single-image post (media_type=1), not carousel |

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

### Reel Upload Flow (Browser UI — Fragile)

1. Navigate to `instagram.com`
2. Click Create → Post (videos >60s auto-become Reels)
3. Find `input[type="file"]` → `uploadFile(videoPath)`
4. Wait for processing (~5-10s until "Next" button appears)
5. Click Next (crop) → Next (filter)
6. Type caption in `[aria-label="Write a caption..."]` — this is a contentEditable div
7. Click Share
8. Wait ~50-85s for "reel has been shared" confirmation

> ⚠️ **The browser UI flow is fragile for Reels.** CDP-based Chrome profiles can't reliably set files,
> and Instagram's React modal doesn't always open a native file picker from programmatic clicks.
> **Use the API approach below instead.**

### Reel Upload via Instagram API (Recommended)

The direct API approach is the only reliable method for programmatic Reel uploads. Same authentication as carousel uploads — requires an active Instagram session in the Chrome profile.

**Step 1: Extract session cookies**

The `sessionid` cookie is HttpOnly — it can't be read via `document.cookie`. You must decrypt it from Chrome's cookie database:

```python
import hashlib, subprocess, sqlite3, shutil
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

# Get Chrome's encryption key from macOS Keychain
key_output = subprocess.check_output(
    ['security', 'find-generic-password', '-ga', 'Chrome', '-w'],
    stderr=subprocess.DEVNULL
).strip()

# Derive AES key (PBKDF2 with 'saltysalt', 1003 iterations)
dk = hashlib.pbkdf2_hmac('sha1', key_output.encode('utf-8'), b'saltysalt', 1003, dklen=16)

# Copy Chrome's Cookies DB (it's locked while Chrome is running)
import tempfile, os
cookies_db = os.path.expanduser('~/Library/Application Support/Google/Chrome/Default/Cookies')
tmp_db = tempfile.mktemp(suffix='.db')
shutil.copy2(cookies_db, tmp_db)

conn = sqlite3.connect(tmp_db)
row = conn.execute(
    "SELECT encrypted_value FROM cookies WHERE host_key='.instagram.com' AND name='sessionid'"
).fetchone()

# Decrypt: strip 'v10' prefix (3 bytes), AES-CBC with IV = 16 spaces, PKCS7 padding
encrypted = row[0][3:]  # strip v10
cipher = Cipher(algorithms.AES(dk), modes.CBC(b' ' * 16))
decryptor = cipher.decryptor()
decrypted = decryptor.update(encrypted) + decryptor.finalize()
# Remove PKCS7 padding
pad_len = decrypted[-1]
sessionid = decrypted[:-pad_len].decode('utf-8')
```

Other cookies (`csrftoken`, `ds_user_id`, `mid`) are accessible via CDP:
```javascript
const cookies = await send('Network.getCookies', { urls: ['https://www.instagram.com'] });
const csrfToken = cookies.find(c => c.name === 'csrftoken')?.value;
const userId = cookies.find(c => c.name === 'ds_user_id')?.value;
const mid = cookies.find(c => c.name === 'mid')?.value;
```

**Step 2: Upload video to Instagram's Scotty upload service**

```bash
UPLOAD_ID="$(date +%s)000"
FILESIZE=$(stat -f%z "/path/to/video.MOV")

curl -X POST "https://i.instagram.com/rupload_igvideo/fb_uploader_${UPLOAD_ID}" \
  -H "X-Instagram-Rupload-Params: {\"is_clips_video\":true,\"media_type\":2,\"upload_id\":\"${UPLOAD_ID}\",\"upload_media_height\":1920,\"upload_media_width\":1080,\"upload_media_duration_ms\":82000}" \
  -H "X-Entity-Name: fb_uploader_${UPLOAD_ID}" \
  -H "X-Entity-Length: $FILESIZE" \
  -H "X-Entity-Type: video/quicktime" \
  -H "Content-Type: application/octet-stream" \
  -H "Offset: 0" \
  -H "Cookie: sessionid=$SESSIONID; csrftoken=$CSRFTOKEN; ds_user_id=$USERID; mid=$MID" \
  -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" \
  -H "X-IG-App-ID: 936619743392459" \
  --data-binary @"/path/to/video.MOV"
```

Key params in `X-Instagram-Rupload-Params`:
- `is_clips_video: true` — **CRITICAL** — marks this as a Reel (not a regular video)
- `media_type: 2` — video
- `upload_media_duration_ms` — video duration in milliseconds

Response: `{"media_id":"17873247924554714","status":"ok"}`

**Step 3: Wait for transcoding (CRITICAL)**

Instagram transcodes the video server-side. Calling configure immediately returns `"Transcode not finished yet."` (HTTP 202).

```bash
sleep 30  # Wait at least 30 seconds before configuring
```

**Step 4: Upload cover photo (required for Reels)**

Without a cover photo, `configure_to_clips` returns `"media_needs_reupload"` + `"cover_photo_upload_error"`.

```bash
# Extract a frame from the video
ffmpeg -y -i video.MOV -ss 5 -vframes 1 -vf "scale=1080:1920" /tmp/ig_thumb.jpg

# Upload cover photo using the SAME upload_id
curl -X POST "https://i.instagram.com/rupload_igphoto/fb_uploader_${UPLOAD_ID}" \
  -H "X-Entity-Type: image/jpeg" \
  -H "X-Entity-Name: fb_uploader_${UPLOAD_ID}" \
  -H "X-Entity-Length: $(stat -f%z /tmp/ig_thumb.jpg)" \
  -H "Content-Type: application/octet-stream" \
  -H "Offset: 0" \
  -H "Cookie: sessionid=$SESSIONID; csrftoken=$CSRFTOKEN; ds_user_id=$USERID; mid=$MID" \
  -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" \
  -H "X-IG-App-ID: 936619743392459" \
  --data-binary @"/tmp/ig_thumb.jpg"
```

**Step 5: Configure as Reel and publish**

```bash
curl -X POST "https://www.instagram.com/api/v1/media/configure_to_clips/" \
  -H "Cookie: sessionid=$SESSIONID; csrftoken=$CSRFTOKEN; ds_user_id=$USERID; mid=$MID" \
  -H "X-CSRFToken: $CSRFTOKEN" \
  -H "X-IG-App-ID: 936619743392459" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" \
  --data-urlencode "upload_id=$UPLOAD_ID" \
  --data-urlencode "caption=$CAPTION" \
  --data-urlencode "source_type=4" \
  --data-urlencode "clips_share_preview_to_feed=1"
```

Response includes `"code":"DVwl0FaDfDi"` → URL: `https://www.instagram.com/reel/DVwl0FaDfDi/`

**Step 6: Post pinned comment (optional)**

```bash
curl -X POST "https://www.instagram.com/api/v1/web/comments/${MEDIA_ID}/add/" \
  -H "Cookie: sessionid=$SESSIONID; csrftoken=$CSRFTOKEN; ds_user_id=$USERID; mid=$MID" \
  -H "X-CSRFToken: $CSRFTOKEN" \
  -H "X-IG-App-ID: 936619743392459" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "comment_text=$COMMENT_TEXT"
```

Note: Pinning comments (`/media/{id}/comment/{cid}/pin/`) returns 404 on web API — may require mobile API user-agent.

### Instagram Reel API Endpoints Reference

| Endpoint | Purpose |
|----------|---------|
| `i.instagram.com/rupload_igvideo/fb_uploader_{id}` | Upload video file |
| `i.instagram.com/rupload_igphoto/fb_uploader_{id}` | Upload cover photo (same upload_id) |
| `www.instagram.com/api/v1/media/configure_to_clips/` | Publish as Reel |
| `www.instagram.com/api/v1/web/comments/{media_id}/add/` | Add comment |

### What Doesn't Work for Reel Upload

| Method | Problem |
|--------|---------|
| CDP file input via Chrome profile | `upload` action returns success but files array stays empty |
| AppleScript + cliclick on Instagram modal | React modal doesn't open native file picker from programmatic clicks |
| `configure_to_clips` without cover photo | Returns `media_needs_reupload` + `cover_photo_upload_error` |
| `configure_to_clips` immediately after upload | Returns HTTP 202 `Transcode not finished yet` — must wait ~30s |
| Missing `is_clips_video: true` in rupload params | Returns HTTP 500 `something went wrong` |

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
3. Click to focus the editor
4. Input text via **clipboard paste only** — see Text Input section below
5. Attach media if needed (see Video Upload section)
6. Wait 45s after large video uploads before clicking Post
7. Click Post: `[data-testid="tweetButton"]` or `[data-testid="tweetButtonInline"]`

### Text Input (CRITICAL — CDP insertText CORRUPTS X's React editor)

X uses a React rich-text editor that **rejects CDP insertText** — it corrupts the text (inserts repeated garbage, wrong characters).

**ALWAYS use Python subprocess + pbcopy + AppleScript paste:**

```python
import subprocess

# Step 1: Write text to macOS clipboard using Python subprocess
# NEVER use shell printf — it garbles UTF-8 (em dashes → ‚Äî, emoji → broken bytes)
proc = subprocess.Popen(['pbcopy'], stdin=subprocess.PIPE)
proc.communicate(caption.encode('utf-8'))
```

```applescript
-- Step 2: Focus the compose box and paste
tell application "System Events"
    tell process "Google Chrome"
        keystroke "v" using command down
    end tell
end tell
```

**What NOT to do:**
- ❌ `CDP insertText` — corrupts text in X's React editor
- ❌ Shell `printf "text" | pbcopy` — garbles UTF-8 characters (em dashes, emoji, special chars)
- ❌ `page.keyboard.type()` for long text — unreliable in React editors

### Video Upload

CDP `DOM.setFileInputFiles` **works on X/Twitter** (unlike TikTok or Instagram). Standard flow:

```python
# Find file input and set the file
send("DOM.setFileInputFiles", {
    "nodeId": file_input_node_id,
    "files": ["/full/path/to/video.mp4"]
})

# CRITICAL: Wait 45 seconds for large videos before clicking Post
# The upload progress indicator must reach 100% first
import time
time.sleep(45)
```

### Thread Creation

Compose dialog thread creation (+ button) is unreliable in automation. Instead:
1. Post the main tweet
2. Navigate to the tweet URL
3. Click reply → type the thread continuation (using clipboard paste) → post

### Getting the Tweet URL

After posting: `https://x.com/{handle}/status/{id}` — find the latest tweet on the profile page.

### What Doesn't Work

| Method | Problem |
|--------|---------|
| CDP `insertText` | Corrupts text in X's React editor (repeated fragments, garbled output) |
| Shell `printf ... \| pbcopy` | Garbles UTF-8 — em dashes render as ‚Äî, emoji render as broken bytes |
| Clicking Post before upload completes | Post goes through with no media attached |

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

### THE CRITICAL TWO-BUTTON TRAP (Read This First)

Threads compose dialog has **TWO buttons** that look similar:
- **"Add to thread"** (middle of dialog) — adds another post to a thread sequence
- **"Post"** (bottom-right corner) — publishes the post

**JS `querySelectorAll('div[role="button"]')` finds "Add to thread" FIRST** because it appears earlier in the DOM. Every generic JS button-finding approach will click the wrong button. This caused 5+ failed attempts in real sessions.

**ALWAYS use Playwright snapshot aria refs to find the Post button:**

```python
# Step 1: Take a snapshot to get aria refs
snapshot = browser_snapshot(refs="aria")

# Step 2: Identify the ref for the correct "Post" button
# It's the bottom-right button in the compose dialog — different ref from "Add to thread"

# Step 3: Click using the exact aria ref
browser_act(f"click ref={post_button_ref}")  # e.g., ref=e1516
```

### Posting Flow

1. Navigate to `threads.com`
2. Click the compose/new post button
3. Input text via **clipboard paste only** (same Python subprocess method as X — see X/Twitter section)
4. **500 character limit** — always check post length before posting. Trim if needed.
5. Link previews render automatically
6. Attach media if needed (see Video Upload section)
7. Use Playwright snapshot `refs=aria` to find the exact "Post" button ref
8. Click via `browser act click ref=<exact_ref>` (NOT JS querySelector)

### Text Input (CRITICAL — same rules as X/Twitter)

Use Python subprocess + pbcopy + AppleScript paste. Same reasons: React editor, UTF-8 safety.

```python
import subprocess
proc = subprocess.Popen(['pbcopy'], stdin=subprocess.PIPE)
proc.communicate(caption.encode('utf-8'))
# Then AppleScript Cmd+V to paste into the editor
```

### Video Upload

CDP `DOM.setFileInputFiles` **works on Threads**, including large files (tested with 136MB MOV):

```python
send("DOM.setFileInputFiles", {
    "nodeId": file_input_node_id,
    "files": ["/full/path/to/video.MOV"]
})
```

### Multi-Post Thread vs Single Post

- **Single post**: After composing, click "Post" (bottom-right) — NOT "Add to thread"
- **Multi-slide thread**: Click "Add to thread" to add each additional post, THEN click the final "Post" button

### Character Limit

500 characters per post. Always check before posting:

```python
if len(caption) > 500:
    # Trim to 500 chars, ideally at a sentence boundary
    caption = caption[:497] + "..."
```

### What Doesn't Work

| Method | Problem |
|--------|---------|
| JS `querySelectorAll('div[role="button"]')` | Finds "Add to thread" before "Post" — wrong button clicked |
| JS `.click()` on any queried button | Same DOM ordering problem |
| `dispatchEvent` on queried buttons | Same DOM ordering problem |
| `cliclick` with `getBoundingClientRect` | May find "Post" in main feed header, not compose dialog |
| Shell `printf ... \| pbcopy` | Garbles UTF-8 (same as X) |
| CDP `insertText` | Corrupts React editor (same as X) |

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

### Video Upload (Hybrid AppleScript + Browser Automation)

YouTube Studio's file input cannot be set via CDP — the native OS file picker must be driven with AppleScript. The full workflow:

1. Navigate to `youtube.com/upload` or `studio.youtube.com`
2. Click "Select files" button (`ytcp-uploads-file-picker button`) — opens native macOS file picker
3. Use AppleScript with Cmd+Shift+G to type the file path and select
4. Wait for upload to complete, then fill metadata (title, description, tags, category, language) via JavaScript
5. Navigate tabs: Details → Video elements → Initial check → Visibility
6. Set visibility to Public (`tp-yt-paper-radio-button[name="PUBLIC"]`) and click Publish (`#done-button`)

**See `references/youtube-studio-upload.md` for the complete step-by-step guide with all selectors, AppleScript code, metadata filling, subtitles setup, and troubleshooting.**

### Description Editing

Navigate to `studio.youtube.com/video/{ID}/edit` → Select all + delete before typing → Type new description → Save.

---

## TikTok

### Video Upload (Anti-Bot Override + AppleScript — Full Workflow)

TikTok Studio web (`tiktok.com/tiktokstudio/upload`) only accepts video. Photo carousels are mobile-app only — convert to slideshow with ffmpeg first.

> ⚠️ **TikTok has aggressive anti-bot detection.** Chrome with `--remote-debugging-port` sets
> `navigator.webdriver = true`, which causes TikTok to crash the page 15-30 seconds after upload.
> The anti-bot override below is **mandatory**.

**Step 1: Override navigator.webdriver BEFORE loading TikTok**

Must be injected via `Page.addScriptToEvaluateOnNewDocument` on a NEW tab before navigation:

```python
# Via CDP on a fresh tab — MUST run before page load
send("Page.addScriptToEvaluateOnNewDocument", {
    "source": """
        Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
        window.chrome = {runtime: {}, loadTimes: function(){}, csi: function(){}};
        delete window.__cdc_adoQpoasnfa76pfcZLmcfl_Array;
        delete window.__cdc_adoQpoasnfa76pfcZLmcfl_Promise;
        delete window.__cdc_adoQpoasnfa76pfcZLmcfl_Symbol;
        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters) => (
            parameters.name === 'notifications' ?
            Promise.resolve({ state: Notification.permission }) :
            originalQuery(parameters)
        );
    """
})
# THEN navigate
send("Page.navigate", {"url": "https://www.tiktok.com/tiktokstudio/upload"})
```

Key rules:
- Must use `addScriptToEvaluateOnNewDocument` (not `Runtime.evaluate`) — it runs before page JS
- Must be a NEW tab (not navigate an existing one with TikTok already loaded)
- The `__cdc_*` properties are Chrome DevTools fingerprints — TikTok checks for them

**Step 2: Get "Select video" button screen coordinates**

Before triggering the file picker, calculate the button's screen position for cliclick:

```python
# Calculate screen coordinates from CSS layout
btn_rect = evaluate("document.querySelector('button with Select video text').getBoundingClientRect()")
toolbar_height = evaluate("window.outerHeight - window.innerHeight")  # typically 87px
menu_bar = 33  # macOS menu bar height

screen_x = btn_rect['x'] + btn_rect['width'] / 2
screen_y = menu_bar + toolbar_height + btn_rect['y'] + btn_rect['height'] / 2
```

Screen coordinate formula:
```
Desktop: 1728 x 1117 points (MacBook Pro, varies by resolution)
Window AX position: (0, 33) — menu bar offset
Toolbar height: outerHeight - innerHeight (typically 87px)
Viewport origin: x=0, y=33+87=120
Button screen pos: (css_x + width/2, 120 + css_y + height/2)
```

**Step 3: Click "Select video" with cliclick to open native file picker**

```bash
# Install cliclick if needed: brew install cliclick
cliclick c:988,741  # Use calculated coordinates from Step 2
```

Verify the file picker opened:
```bash
osascript -e 'tell application "System Events" to tell process "Google Chrome" to count of sheets of window 1'
# Should return 1 (file picker sheet is open)
```

**Step 4: Select file via AppleScript (same pattern as YouTube)**

```applescript
tell application "System Events"
    -- Target the specific Chrome process (personal profile)
    set p to first process whose unix id is CHROME_PID
    tell p
        keystroke "g" using {command down, shift down}  -- Cmd+Shift+G: Go to folder
        delay 1
        keystroke "a" using command down  -- Select all (clear previous path)
        delay 0.1
        keystroke "/full/path/to/video.MOV"
        delay 0.5
        key code 36  -- Enter (navigate to path)
        delay 1
        key code 36  -- Enter (select file)
    end tell
end tell
```

**Step 5: Wait for upload — ZERO CDP calls (CRITICAL)**

```bash
sleep 30  # Do NOT make ANY CDP/JS calls during upload!
```

**ANY CDP call during or after upload (evaluate, screenshot, DOM query) will crash the page.** TikTok's anti-bot detection monitors for automation signals during the upload flow. The upload must complete in a "hands-off" state.

**Step 6: Set caption (optional — DraftJS editor is fragile)**

TikTok uses DraftJS which may reject clipboard paste. Options in order of reliability:

```bash
# Option A: Single CDP call (risky — may crash page)
# Only try this if you haven't made any CDP calls since upload
send("Runtime.evaluate", {
    "expression": "document.execCommand('insertText', false, 'Your caption')"
})

# Option B: cliclick + AppleScript clipboard paste
echo "Your caption" | pbcopy
cliclick t:500,400  # Click description field area
osascript -e 'tell application "System Events" to keystroke "a" using command down'
osascript -e 'tell application "System Events" to keystroke "v" using command down'

# Option C: Skip caption, edit after publishing via TikTok app
```

**Step 7: Click Post**

```bash
# Scroll to Post button (may be below fold)
osascript -e 'tell application "System Events" to key code 119'  # End key

# Click Post via cliclick (use calculated coordinates)
cliclick c:POST_X,POST_Y

# Or: manual click by user (most reliable for now)
```

### Chrome Personal Profile Window Management

When Chrome runs with a personal profile on a debug port, it's a separate process from the default Chrome:

```bash
# Find the personal Chrome process PID
ps aux | grep "user-data.*personal" | grep -v helper | awk '{print $2}'

# CDP tab activation changes the debug target but NOT the visible tab
# To switch visible tab, use AppleScript:
osascript -e 'tell application "System Events" to tell process "Google Chrome" to keystroke "l" using command down'
# Then type the URL
```

Key details:
- `tell application "Google Chrome"` targets the WRONG Chrome instance (returns 0 windows)
- Must use `System Events` with `first process whose unix id is <PID>`
- PID changes on restart — always re-detect
- CDP `/json/activate/{id}` changes CDP target but not the visible browser tab

### Photo Carousel → Video Conversion

TikTok web doesn't support photo carousels. Convert slides to video:

```bash
ffmpeg -framerate 1/4 -i slide-%d.png \
  -c:v libx264 -r 30 -pix_fmt yuv420p \
  -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2" \
  output.mp4
```

### What Doesn't Work for TikTok Upload

| Method | Problem |
|--------|---------|
| CDP `DOM.setFileInputFiles` | File accepted but page crashes during content check |
| CDP `upload` browser action | Returns success but file not actually set |
| `cliclick` without tab activation | Clicks wrong Chrome window (personal vs default) |
| `document.execCommand()` after upload | Triggers page crash (anti-bot) |
| Keyboard Tab+Enter to Post button | Can't reliably navigate to the button |
| JS `button.click()` on Post | Click registers but page crashes before API call completes |
| Any CDP call during upload | Crashes the page — TikTok monitors for automation |

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

### Anti-Bot Override for CDP (TikTok, etc.)

Sites that detect `navigator.webdriver` (set by `--remote-debugging-port`) will block or crash automation. Override BEFORE page load:

```python
# Must be on a NEW tab, before navigation
send("Page.addScriptToEvaluateOnNewDocument", {
    "source": """
        Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
        window.chrome = {runtime: {}, loadTimes: function(){}, csi: function(){}};
        delete window.__cdc_adoQpoasnfa76pfcZLmcfl_Array;
        delete window.__cdc_adoQpoasnfa76pfcZLmcfl_Promise;
        delete window.__cdc_adoQpoasnfa76pfcZLmcfl_Symbol;
    """
})
```

This works because `addScriptToEvaluateOnNewDocument` injects before ANY page JavaScript runs.

### Chrome Cookie Extraction (for API Access)

HttpOnly cookies (like Instagram's `sessionid`) can't be read via `document.cookie`. Extract from Chrome's encrypted cookie database:

```bash
# 1. Get Chrome's encryption password from macOS Keychain
security find-generic-password -ga 'Chrome' -w 2>/dev/null

# 2. Derive AES key: PBKDF2-SHA1 with salt='saltysalt', 1003 iterations, 16-byte key
# 3. Copy Cookies DB (locked while Chrome runs): ~/Library/Application Support/Google/Chrome/{Profile}/Cookies
# 4. Query: SELECT encrypted_value FROM cookies WHERE host_key='.example.com' AND name='cookie_name'
# 5. Decrypt: strip 'v10' prefix (3 bytes), AES-CBC with IV = 16 spaces, PKCS7 unpadding
```

See the Instagram Reel API section for the full Python implementation.

Non-HttpOnly cookies can be extracted via CDP:
```javascript
const {cookies} = await send('Network.getCookies', { urls: ['https://www.example.com'] });
```

### Screen Coordinate Calculation (for cliclick)

When using `cliclick` for native macOS clicks (file pickers, anti-bot-sensitive sites):

```
macOS menu bar height: 33 points
Chrome toolbar height: window.outerHeight - window.innerHeight (typically 87px)
Viewport origin (screen): x=window_x, y=33 + toolbar_height

Button screen position:
  screen_x = window_x + css_rect.x + css_rect.width / 2
  screen_y = 33 + toolbar_height + css_rect.y + css_rect.height / 2
```

Install: `brew install cliclick`. Usage: `cliclick c:X,Y` (click at screen coordinates).

### AppleScript File Picker Pattern (YouTube, TikTok, etc.)

When CDP can't set files on `<input type="file">`, use AppleScript to drive the native macOS file picker:

```applescript
tell application "System Events"
    -- For personal Chrome profiles, target by PID:
    -- set p to first process whose unix id is CHROME_PID
    tell process "Google Chrome"
        delay 1
        keystroke "g" using {shift down, command down}  -- Cmd+Shift+G: Go to folder
        delay 1
        keystroke "a" using command down  -- Select all (clear previous)
        delay 0.1
        keystroke "/full/absolute/path/to/file.ext"
        delay 0.5
        key code 36  -- Enter (navigate to path)
        delay 1
        key code 36  -- Enter (select file)
    end tell
end tell
```

Prerequisites:
- System Events must have Accessibility permissions in System Settings
- Use **full absolute paths** — relative paths don't work in the Go To dialog
- Increase delays if the picker is slow (SSD vs HDD, large directories)
- Verify picker opened: `osascript -e 'tell app "System Events" to tell process "Google Chrome" to count of sheets of window 1'` → should be 1

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
| `Transcode not finished yet` (HTTP 202) | Instagram API | Wait 30s before calling `configure_to_clips` |
| `media_needs_reupload` / `cover_photo_upload_error` | Instagram API | Upload cover photo (`rupload_igphoto`) before configure |
| Missing `is_clips_video` → HTTP 500 | Instagram API | Add `"is_clips_video":true` to rupload params |
| `fill` action fails on editor | LinkedIn | Use `page.keyboard.type()` — Quill editor |
| Tag search input invisible | Instagram | Tab navigation + CDP clicks (hidden DOM) |
| Thread creation fails | X/Twitter | Post main tweet first, then reply separately |
| Premium upsell blocks posting | LinkedIn | Dismiss modal first |
| "Report a problem" dialog | Instagram | CDP key events went to wrong element |
| Upload timeout | All | Increase wait time, check network |
| Broadcast channel no editor | Telegram | Use Bot API, not web.telegram.org |
| Text paste fails | Discord | Use ClipboardEvent('paste'), not innerHTML |
| System clipboard garbles UTF-8 | YouTube | Use `printf` or ensure UTF-8 encoding |
| Page crashes after TikTok upload | TikTok | Must override `navigator.webdriver` BEFORE page load |
| CDP calls crash TikTok page | TikTok | NO CDP calls during/after upload — use `sleep` + cliclick only |
| cliclick hits wrong Chrome window | TikTok | Target by PID: `first process whose unix id is <PID>` |
| AppleScript "Go to folder" doesn't open | All (file picker) | Grant Accessibility permissions to System Events |
| File picker closes without selecting | All (file picker) | Increase AppleScript delays (1s → 2s) |

### macOS File Upload Bug

Some browser automation tools have a macOS `/tmp` → `/private/tmp` symlink path validation bug. Files at `/tmp/uploads/` resolve to `/private/tmp/uploads/` which fails validation. Workaround: Use Puppeteer scripts with `uploadFile()` instead of browser tool file upload.
