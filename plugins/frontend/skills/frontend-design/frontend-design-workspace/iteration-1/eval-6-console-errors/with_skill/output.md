# Plan: Diagnose and Fix Product Card Grid (Images Not Loading + JS Errors)

## Step 1: Browser Tool Detection

The user states "Chrome extension is connected," so I check for `mcp__claude_in_chrome__*` tools in the available tool list. Per the skill's Browser Tool Detection hierarchy, the Chrome Extension is preference #1 ("best for interactive development") and gives direct access to the user's real browser with live DOM inspection and console error reading. This is the tool set I would use.

## Step 2: Navigate to the Running App

**Tool call:**
```
mcp__claude_in_chrome__navigate({ url: "http://localhost:5173" })
```

The user confirmed the app is running on localhost:5173 (standard Vite dev server port). Navigate there first to load the page in the connected Chrome instance.

## Step 3: Visual Inspection -- Assess the Current State

**Tool call:**
```
mcp__claude_in_chrome__screenshot()
```

Take a screenshot to see the current rendered state of the product card grid. This establishes a baseline of what is broken: I would look for broken image placeholders (alt text showing, broken image icons, or empty boxes where product images should appear), layout issues in the grid, and any visible error indicators.

## Step 4: Check the Console for JavaScript Errors

**Tool call:**
```
mcp__claude_in_chrome__get_console_logs()
```

This is the critical diagnostic step. The user suspects JS errors, so I read the browser console to capture:

- **JavaScript runtime errors** (TypeError, ReferenceError, etc.) -- these could be causing the images not to load if, for example, image URLs are constructed from data that fails to resolve (e.g., `Cannot read properties of undefined` when accessing `product.image`)
- **Network errors** (Failed to load resource, 404s for image URLs) -- indicates wrong image paths or broken URLs
- **CORS errors** -- if images are loaded from an external domain without proper headers
- **React/Vue/framework errors** -- component rendering failures, key warnings, hydration mismatches

I would categorize each error by severity and identify root causes.

## Step 5: Inspect the DOM for Image Elements

**Tool call:**
```
mcp__claude_in_chrome__evaluate({
  expression: "JSON.stringify(Array.from(document.querySelectorAll('img')).map(img => ({ src: img.src, alt: img.alt, complete: img.complete, naturalWidth: img.naturalWidth, error: img.getAttribute('data-error') || null })))"
})
```

This JavaScript evaluation gathers diagnostic data about every `<img>` element on the page:
- `src` -- are the URLs well-formed or empty/malformed?
- `complete` -- did the image finish loading (or fail)?
- `naturalWidth` -- a value of 0 means the image failed to load even if `complete` is true

Common failure patterns this would reveal:
- Empty `src` attributes (data binding issue -- the image URL field is undefined or null)
- Relative paths that resolve incorrectly (e.g., `./images/product.jpg` instead of `/images/product.jpg`)
- Broken template literals (e.g., literal `${product.image}` in the src instead of the interpolated value)
- External URLs returning 404 (wrong picsum/unsplash/placeholder URL format)

## Step 6: Identify Root Causes and Fix the Code

Based on the console errors and DOM inspection, I would now identify the specific issues. Here are the most likely scenarios and how I would fix each:

**Scenario A: Broken image URLs (most common)**
If `src` values are empty, `undefined`, or malformed, trace the data flow. Read the component file to find where images are rendered and where the data comes from. Fix the data binding -- e.g., `product.imageUrl` vs `product.image`, or a missing API response field.

**Scenario B: JS runtime errors blocking render**
If console shows errors like `TypeError: Cannot read properties of undefined (reading 'map')`, the product data array may be undefined on initial render (async data not yet loaded, no loading state guard). Fix: add a null/loading check before mapping over the products array, add a loading skeleton.

**Scenario C: Network/CORS errors on image fetch**
If images use external URLs that return CORS or 404 errors, fix the URLs. Per the skill's Visual Media guidance, use reliable placeholder sources:
- Photos: `https://picsum.photos/seed/{slug}/{width}/{height}`
- Avatars: `https://i.pravatar.cc/150?u={unique-id}`

**Scenario D: Mixed issues**
Multiple issues often compound. For example, a JS error might prevent half the cards from rendering, and the cards that do render have wrong image paths. Fix each issue independently.

For each fix, I would use the Edit tool to modify the relevant source files (components, data files, etc.) in the project.

## Step 7: Re-verify After Each Fix (Iteration Loop)

After making code changes, the Vite dev server at localhost:5173 will hot-reload automatically. I would then re-verify:

**Tool call:**
```
mcp__claude_in_chrome__screenshot()
```

Take a fresh screenshot to confirm images are now loading and the grid renders correctly.

**Tool call:**
```
mcp__claude_in_chrome__get_console_logs()
```

Check the console again to confirm all JS errors are resolved. A clean console (no errors, no warnings) is the target.

**Tool call:**
```
mcp__claude_in_chrome__evaluate({
  expression: "JSON.stringify(Array.from(document.querySelectorAll('img')).map(img => ({ src: img.src, complete: img.complete, naturalWidth: img.naturalWidth })))"
})
```

Confirm all images have `complete: true` and `naturalWidth > 0`.

If any issues remain, iterate: fix the code, wait for HMR, re-screenshot, re-check console. The skill mandates this loop ("If something is off -> fix the code and go back to step 2").

## Step 8: Broader Visual Quality Check

Once the functional bugs (images, JS errors) are resolved, do a final pass per the skill's verification checklist:

**Tool call:**
```
mcp__claude_in_chrome__screenshot()
```

Evaluate the final state:
- Does the grid layout look correct (proper gaps, alignment, responsive behavior)?
- Are images sized appropriately within their cards (no stretched/squished images, proper aspect ratios)?
- Is the typography rendering correctly (not falling back to system fonts)?
- Are there any visual regressions introduced by the fixes?

If the grid also needs responsive verification:

**Tool call:**
```
mcp__claude_in_chrome__evaluate({
  expression: "window.resizeTo(375, 812)"
})
```

Then take another screenshot to confirm mobile layout works. Repeat at tablet width (768px) if relevant.

## Summary of Tool Usage Order

| Step | Tool | Purpose |
|------|------|---------|
| 1 | `mcp__claude_in_chrome__navigate` | Load the app at localhost:5173 |
| 2 | `mcp__claude_in_chrome__screenshot` | See current broken state |
| 3 | `mcp__claude_in_chrome__get_console_logs` | Read JS errors and network failures |
| 4 | `mcp__claude_in_chrome__evaluate` | Inspect img elements for broken src/load state |
| 5 | `Edit` (standard tool) | Fix source code based on diagnosed issues |
| 6 | `mcp__claude_in_chrome__screenshot` | Verify fixes rendered correctly |
| 7 | `mcp__claude_in_chrome__get_console_logs` | Confirm console is clean |
| 8 | `mcp__claude_in_chrome__evaluate` | Confirm all images loaded successfully |
| 9 | `mcp__claude_in_chrome__screenshot` | Final visual quality check |

The key principle from the skill: "Writing frontend code without seeing the result is like painting blindfolded." Every code change is followed by a browser verification step. The loop does not terminate until both the console is error-free and the visual output matches intent.
