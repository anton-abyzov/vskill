# YouTube Studio Video Upload Guide

Complete workflow for uploading videos to YouTube via Studio, using a hybrid AppleScript + browser automation approach.

---

## Why Hybrid?

YouTube Studio's upload dialog uses a native OS file picker (`<input type="file">`). CDP (Chrome DevTools Protocol) **cannot programmatically set files on this input** — the `upload` browser action returns success but the `files` property stays empty. The same applies to JavaScript `DataTransfer` injection (the 136MB+ file fetch into browser memory exceeds evaluation timeouts).

The solution: browser automation opens Studio and clicks "Select files", then **AppleScript drives the native macOS file picker**.

---

## Upload Workflow

### Step 1: Navigate to YouTube Studio Upload

```javascript
// Navigate to upload page
await page.goto('https://www.youtube.com/upload');
// Or click "Upload videos" from studio.youtube.com dashboard
```

The upload dialog appears with a "Select files" button.

### Step 2: Click "Select files" to Open Native File Picker

```javascript
document.querySelector('ytcp-uploads-file-picker button').click();
```

This opens the macOS native file picker dialog. **Do NOT try to set files via JavaScript** — it won't work.

### Step 3: Use AppleScript to Select the File

```applescript
tell application "System Events"
    tell process "Google Chrome"
        delay 1
        keystroke "g" using {shift down, command down}  -- Cmd+Shift+G: "Go to folder"
        delay 1
        keystroke "/full/path/to/your-video.MOV"
        delay 0.5
        key code 36  -- Enter (navigate to path)
        delay 1
        key code 36  -- Enter (select file)
    end tell
end tell
```

**Key points:**
- Use the **full absolute path** to the video file
- The delays are necessary — the file picker is slow to respond
- `key code 36` is the Return key
- Cmd+Shift+G opens the "Go to folder" text field in the native picker

### Step 4: Wait for Upload to Complete

After file selection, YouTube begins uploading immediately. Wait for the upload progress to complete before filling metadata. The upload dialog transitions to show the video details form.

### Step 5: Fill Metadata via JavaScript

**Title** (contenteditable div):
```javascript
const titleEl = document.querySelector('#title-textarea #textbox');
// Or: document.querySelector('[aria-label*="title"]')
titleEl.textContent = 'Your Video Title';
titleEl.dispatchEvent(new Event('input', { bubbles: true }));
```

**Description** (contenteditable div):
```javascript
const descEl = document.querySelector('#description-textarea #textbox');
// Or: document.querySelector('[aria-label*="Tell viewers"]')
descEl.textContent = 'Your video description here...';
descEl.dispatchEvent(new Event('input', { bubbles: true }));
```

**Tags** (text input with chip management):
```javascript
const tagInput = document.querySelector('input[aria-label="Tags"]');
// For each tag:
tagInput.value = 'your tag';
tagInput.dispatchEvent(new Event('input', { bubbles: true }));
tagInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
```

Tags are rendered as chips (`ytcp-chip`). To remove a tag:
```javascript
// Find chip by text, click its delete icon
const chips = document.querySelectorAll('ytcp-free-text-chip-bar ytcp-chip');
for (const chip of chips) {
    if (chip.querySelector('#chip-text')?.textContent?.trim() === 'unwanted-tag') {
        chip.querySelector('#delete-icon').click();
    }
}
```

**Video language** (dropdown):
```javascript
// Click the dropdown trigger containing "Video language"
const triggers = document.querySelectorAll('ytcp-text-dropdown-trigger');
for (const t of triggers) {
    if (t.textContent.includes('Video language')) { t.click(); break; }
}
// Wait for dropdown to open, then click the language option
const items = document.querySelectorAll('tp-yt-paper-item');
for (const item of items) {
    if (item.textContent.trim() === 'English') { item.click(); break; }
}
```

**Category** (same dropdown pattern):
```javascript
// Click trigger showing current category (e.g., "People & Blogs")
// Then click the desired category from tp-yt-paper-item list
```

**Made for kids**: Defaults to "Not made for kids" — no action needed unless changing.

### Step 6: Navigate Through Tabs and Publish

YouTube Studio has 4 tabs: **Details → Video elements → Initial check → Visibility**

```javascript
// Advance through tabs
document.querySelector('#next-button').click();  // Details → Video elements
// Wait, then click again
document.querySelector('#next-button').click();  // Video elements → Initial check
// Wait, then click again
document.querySelector('#next-button').click();  // Initial check → Visibility
```

**Set visibility to Public:**
```javascript
const radios = document.querySelectorAll('tp-yt-paper-radio-button');
for (const radio of radios) {
    if (radio.getAttribute('name') === 'PUBLIC') { radio.click(); break; }
}
```

**Publish:**
```javascript
document.querySelector('#done-button').click();
```

### Step 7: Get the Published Video Link

After publishing, a "Video published" dialog appears with the YouTube link (Shorts link for short-form, standard link for long-form). Extract it from the dialog.

---

## DOM Selectors Reference

| Element | Selector | Notes |
|---------|----------|-------|
| Upload dialog | `ytcp-uploads-dialog` | Main dialog container |
| Title input | `#title-textarea #textbox` | contenteditable div |
| Description input | `#description-textarea #textbox` | contenteditable div |
| Tags input | `input[aria-label="Tags"]` | Text input, chips managed separately |
| Tag chips | `ytcp-free-text-chip-bar ytcp-chip` | Each has `#chip-text` and `#delete-icon` |
| Dropdowns | `ytcp-text-dropdown-trigger` | Click to open; items are `tp-yt-paper-item` |
| Tab badges | `#step-badge-0` through `#step-badge-3` | Details, Video elements, Initial check, Visibility |
| Next button | `#next-button` | Advances to next tab |
| Publish button | `#done-button` | Only active on Visibility tab |
| Visibility radios | `tp-yt-paper-radio-button[name="PUBLIC"]` | Also PRIVATE, UNLISTED |
| Close button | `#ytcp-uploads-dialog-close-button` | Closes dialog |
| File input | `input[name="Filedata"]` | Hidden file input (cannot be set via CDP) |
| File picker button | `ytcp-uploads-file-picker button` | Opens native OS file picker |

---

## Subtitles & Auto-Translation

YouTube auto-generates captions and offers auto-translate to 100+ languages. Setup:

1. **Set video language to English** during upload (Language and captions section → Video language dropdown)
2. YouTube **automatically generates English captions** (takes a few minutes after publish)
3. Viewers click **CC → Auto-translate → [Any Language]** for translated subtitles
4. No manual setup required — it's automatic once video language is set

For manual subtitle uploads: Languages tab → "Upload manual" button for specific languages.

---

## Tags Best Practices

- YouTube's tag field has a **500 character limit** total (including commas)
- Channel default tags auto-populate via "Reuse details" — check what's already set
- **10-15 tags max** per video
- Mix broad ("AI coding", "open source") and specific ("SpecWeave", "Verified Skill")
- Keep total characters under 400 to leave buffer

---

## What Doesn't Work

| Method | Problem |
|--------|---------|
| CDP `setFileInputFiles` via browser `upload` action | Returns `ok: true` but `files` array stays empty |
| JavaScript `DataTransfer` + `input.files = dt.files` | Fetching 136MB+ file via `fetch()` exceeds eval timeout |
| `upload` action with `selector` parameter | Same empty files result |
| YouTube `createvideo` API with Scotty resource ID | Protobuf type mismatch — resource ID format doesn't match expected |

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| AppleScript "Go to folder" doesn't open | Ensure System Events has accessibility permissions in System Settings |
| File picker closes without selecting | Increase delays in AppleScript (1s → 2s) |
| Upload stuck at 0% | Check file size and network; YouTube has upload limits per day |
| Title/description not saving | Dispatch `input` event after setting `textContent` |
| Tags not registering | Must dispatch both `input` and `keydown` Enter events |
| "Publish" button grayed out | Ensure all required fields are filled and "Made for kids" is set |
| Thumbnail generation error | YouTube auto-generates thumbnails; wait a few seconds and retry |
