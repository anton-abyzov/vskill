# Diagnosing and Fixing Product Card Grid Issues (Without Skill)

## Scenario

The user has a product card grid running on localhost:5173 with broken images and suspected JS errors. A Chrome extension is connected for browser interaction.

## Approach Without a Specialized Skill

### Step 1: Locate and Read the Source Files

I would start by searching for the relevant source files in the project:

- **Glob** for component files (`**/*card*`, `**/*product*`, `**/*grid*`) to find the product card component.
- **Glob** for the main entry point and any data files (`**/data*.json`, `**/products*`, `**/mock*`).
- **Read** the identified component files, layout/page files, and any CSS/style files.

This establishes what the code looks like before observing any runtime behavior.

### Step 2: Static Code Analysis for Common Issues

With the source code read, I would manually inspect for common problems:

**Image issues:**
- Incorrect `src` attribute paths (relative vs. absolute, missing `/public` prefix, wrong file extensions).
- Broken template interpolation (e.g., `src={product.image}` where the data field is actually `product.imageUrl` or `product.img`).
- Missing `alt` attributes or broken dynamic URL construction.
- Images referenced from a CDN or external URL that may have CORS issues.
- Files placed in the wrong directory (e.g., outside `public/` in a Vite project, or referenced without the base path).

**JS error candidates:**
- Mapping over undefined or null data (e.g., `products.map()` when `products` is undefined).
- Missing key props in list rendering (React) or missing `:key` bindings (Vue).
- Typos in property access (e.g., `product.title` vs. `product.name`).
- Failed fetch calls without error handling.
- Import errors for missing modules or components.
- Incorrect event handler bindings.

### Step 3: Attempt Browser Verification (Limited)

Without a browser automation skill or MCP tool connected to Chrome DevTools, I have no direct way to:

- View the browser console output for JS errors.
- Inspect the rendered DOM or network tab for failed image requests.
- See 404s, CORS errors, or other network failures.
- Take screenshots of the actual rendered state.

**This is the critical gap.** The user mentioned a Chrome extension is connected, but without a dedicated browser interaction tool (like a DevTools MCP server, Puppeteer, or Playwright), I cannot programmatically access the running application's console, network tab, or rendered output.

I would have to rely entirely on reading the source code and making educated guesses about what the runtime errors might be.

### Step 4: Apply Fixes Based on Static Analysis

Based on what I found in the code, I would use **Edit** to fix the identified issues. Common fixes might include:

- Correcting image paths (e.g., changing `./images/product.jpg` to `/images/product.jpg`).
- Fixing property name mismatches between the data source and template.
- Adding null checks or default values for data that might be undefined.
- Fixing import paths or adding missing imports.
- Correcting event handler syntax.

### Step 5: Verification

Without browser access, verification is limited to:

- Re-reading the edited files to confirm the changes are syntactically correct.
- Running any available linters or type checkers (`npx tsc --noEmit`, `npx eslint`).
- Running any existing tests (`npx vitest run`).
- Asking the user to refresh the browser and confirm if the issues are resolved.

## What This Approach Lacks

1. **No runtime error visibility.** I cannot see the actual console errors, so I am guessing at the problem based on code patterns. The real error might be something non-obvious (e.g., a CORS policy, a Vite plugin misconfiguration, a Content Security Policy header blocking images).

2. **No network tab inspection.** I cannot see which image URLs are returning 404s, what status codes are coming back, or whether requests are even being made.

3. **No visual verification.** I cannot see what the page actually looks like, whether images are partially loading, showing broken image icons, or simply invisible due to CSS issues (e.g., `width: 0`, `display: none`, `opacity: 0`).

4. **No DOM inspection.** I cannot verify that the components are rendering at all, or check if the generated `src` attributes match what the code intends.

5. **Iterative debugging is slow.** Without seeing the actual errors, each fix attempt requires asking the user to check the browser and report back, turning a 2-minute fix into a multi-round conversation.

## Summary

Without a browser interaction tool, this task becomes a static code review exercise. I would read all the source files, look for common patterns that cause broken images and JS errors, apply fixes based on those patterns, and ask the user to verify. If the first round of fixes does not resolve the issue, I would need the user to copy-paste the actual console errors and network failures for me to diagnose further. The lack of direct browser access means I cannot close the feedback loop independently and must rely on the user as an intermediary for all runtime information.
