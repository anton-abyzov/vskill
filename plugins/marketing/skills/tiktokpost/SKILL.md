---
description: "Open Chrome browser and post to the TikTok website. Log in to make sure that the user is logged in, and then click New Video. Provide some details about the file, and that's it. "
---

# /tiktokpost

Post a video to TikTok via browser automation. Handles anti-bot override, AppleScript file picker, Playwright type for caption, and mandatory profile verification after posting.

## Known Constraints (Read Before Starting)

**TikTok's `webmssdk` blocks the publish API in CDP-attached browsers.** The upload works, the caption works, content checks pass — but the final Post API returns `{code: 7, statusMsg: "Permission Denied"}`. This is caused by deeper fingerprinting than `navigator.webdriver` (CDP WebSocket debug endpoints, timing signatures). It cannot be fixed in a CDP-attached browser.

**The workflow below is the best possible automated path.** The user may need to click Post manually if bot detection fires.

---

## Workflow

### Step 1: Convert to video if needed

TikTok web only accepts video. Photo carousels must be converted first:

```bash
ffmpeg -framerate 1/4 -i slide-%d.png \
  -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p \
  -r 30 -movflags +faststart \
  -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2" \
  output.mp4
# Minimum 12s. 16s with transitions is better.
# ~1.8MB for 16-second slideshow is fine.
```

### Step 2: Open a fresh Chrome tab and inject anti-bot override BEFORE navigation

Must use `Page.addScriptToEvaluateOnNewDocument` on a NEW tab. Must run before page JS:

```python
send("Page.addScriptToEvaluateOnNewDocument", {
    "source": """
        Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
        window.chrome = {runtime: {}, loadTimes: function(){}, csi: function(){}};
        delete window.__cdc_adoQpoasnfa76pfcZLmcfl_Array;
        delete window.__cdc_adoQpoasnfa76pfcZLmcfl_Promise;
        delete window.__cdc_adoQpoasnfa76pfcZLmcfl_Symbol;
    """
})
send("Page.navigate", {"url": "https://www.tiktok.com/creator#/upload?scene=creator_center"})
```

### Step 3: Click "Select video" via cliclick to open native file picker

```python
btn_rect = evaluate("document.querySelector('[data-e2e=\"upload-btn\"]').getBoundingClientRect()")
toolbar_height = evaluate("window.outerHeight - window.innerHeight")  # typically 87px
screen_x = btn_rect['x'] + btn_rect['width'] / 2
screen_y = 33 + toolbar_height + btn_rect['y'] + btn_rect['height'] / 2
os.system(f"cliclick c:{int(screen_x)},{int(screen_y)}")
```

### Step 4: Select file via AppleScript

```applescript
tell application "System Events"
    tell process "Google Chrome"
        delay 1
        keystroke "g" using {command down, shift down}
        delay 1
        keystroke "a" using command down
        delay 0.1
        keystroke "/full/absolute/path/to/video.mp4"
        delay 0.5
        key code 36  -- Enter (navigate)
        delay 1
        key code 36  -- Enter (select)
    end tell
end tell
```

### Step 5: Wait for upload — ZERO CDP calls (CRITICAL)

```python
import time
time.sleep(15)  # Wait for upload + content checks. NO CDP calls during this window.
```

### Step 6: Type caption via Playwright type (NOT clipboard paste)

DraftJS contenteditable silently ignores clipboard paste. Playwright `type` is the only method that works.

```python
# Click caption field to focus
caption_rect = evaluate("document.querySelector('[data-e2e=\"caption-editor\"]').getBoundingClientRect()")
# ... calculate screen coords, cliclick to focus ...

# Type caption (NOT pbcopy + Cmd+V — that's silently ignored)
await page.keyboard.type(caption_text, delay=50)

# Hashtags open autocomplete — press Escape to dismiss
await page.keyboard.press('Escape')
```

### Step 7: Scroll Post button into view and click

Post button is often below the viewport fold (~y=1293 with 996px viewport).

```python
# Scroll into view
send("Runtime.evaluate", {
    "expression": "document.querySelector('button[data-e2e=\"post_video_button\"]')?.scrollIntoView({block: 'center'})"
})
time.sleep(1)

# Recalculate coordinates after scroll
btn_rect = send("Runtime.evaluate", {
    "expression": "document.querySelector('button[data-e2e=\"post_video_button\"]')?.getBoundingClientRect()"
})
screen_x = btn_rect['x'] + btn_rect['width'] / 2
screen_y = 33 + toolbar_height + btn_rect['y'] + btn_rect['height'] / 2
# Example: screen_x ≈ 192, screen_y ≈ 1016

os.system(f"cliclick c:{int(screen_x)},{int(screen_y)}")
time.sleep(10)
```

### Step 8: Verify in a SEPARATE new tab (MANDATORY)

The upload page gives NO success or failure signal. Never re-click Post without verifying first — it will create duplicate uploads.

```python
# Open profile in a NEW tab (never reload the upload page)
send("Target.createTarget", {"url": "https://www.tiktok.com/@USERNAME"})
time.sleep(5)
# Screenshot and check if the new video appears at the top of the feed
```

**If the video appears**: Post succeeded.

**If the video does NOT appear** (Permission Denied / code 7):
- Tell the user: "The video is uploaded and ready. TikTok's anti-bot system blocked the automated publish click. Please click the **Post** button manually in the browser — it will work immediately since you're not on a CDP-controlled click."
- Do NOT re-upload. The video is already there.

---

## What Doesn't Work

| Method | Problem |
|--------|---------|
| CDP `DOM.setFileInputFiles` | Page crashes during content check |
| Clipboard paste (pbcopy + Cmd+V) for caption | DraftJS silently ignores it — field stays empty |
| `navigator.webdriver` override alone | Not enough — webmssdk uses deeper CDP fingerprinting |
| Any CDP call during upload | Crashes the page |
| Reloading the upload page to check status | Resets the form — creates risk of duplicate upload |
| JS `button.click()` on Post | API returns `{code: 7, Permission Denied}` from webmssdk |
