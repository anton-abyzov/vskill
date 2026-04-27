---
name: frontend-design
description: "Create distinctive, production-grade frontend interfaces with visual verification. Use this skill when the user asks to build web components, pages, landing pages, dashboards, React/Vue/Svelte components, HTML/CSS layouts, or any web UI that needs to look polished. Also activates when styling, beautifying, redesigning, or doing visual refresh of existing UI. Covers the full loop: design thinking, code generation, and browser-based visual verification to iterate until the result actually looks right. Use this skill even if the user doesn't explicitly say 'design' — any request to build or improve a web interface benefits from this skill's aesthetic guidance and verification workflow."
metadata:
  version: 1.0.2
  tags: frontend, design, ui, visual-verification, browser, chrome, playwright, css, animations, accessibility
---

# Frontend Design with Visual Verification

Build distinctive, production-grade frontend interfaces — then verify they actually look right in a real browser. This skill closes the gap between "generate code" and "ship something beautiful" by combining bold design thinking with a browser-based verification loop.

## Why Visual Verification Matters

Writing frontend code without seeing the result is like painting blindfolded. Generic AI-generated UIs happen because the model never sees what it produced — it can't catch misaligned layouts, clashing colors, or broken animations. This skill ensures you always close the loop: generate code, open it in a browser, see what it looks like, and iterate until it's genuinely good.

## Phase 1: Design Thinking

Before writing any code, commit to a clear aesthetic direction. The goal is intentionality — bold maximalism and refined minimalism both work when executed with precision.

### Aesthetic Direction

Pick a strong conceptual direction and execute it consistently:
- **Purpose**: What problem does this interface solve? Who uses it?
- **Tone**: Choose something specific — brutally minimal, retro-futuristic, luxury editorial, organic/natural, playful, industrial, art deco, soft/pastel. Vague directions produce vague results.
- **Differentiation**: What makes this memorable? Identify one signature element someone will remember.

### Typography

Font choice is the single biggest design signal. Generic fonts (Inter, Roboto, Arial, system defaults) immediately signal "AI-generated."

- Pair a distinctive display font with a refined body font
- Use a clear typographic scale (e.g., Golden Ratio: 1.618 multiplier between sizes)
- Load fonts from Google Fonts or bundle them — never rely on system fonts for character
- Vary choices across projects — converging on the same "safe" picks (Space Grotesk, Poppins) defeats the purpose

### Color & Theme

- Commit to a cohesive palette using CSS variables for consistency
- A dominant color with sharp accents outperforms timid, evenly-distributed palettes
- Dark mode: deep, rich backgrounds (not pure black) with vibrant accents that pop
- Light mode: warm off-whites (not sterile #fff) with deeper accent variants
- Never default to purple gradients on white — the most recognizable AI-slop pattern

### Motion & Animation

Animation creates delight when used with intention. One well-orchestrated page load with staggered reveals creates more impact than scattered micro-interactions everywhere.

- Prioritize CSS-only solutions for HTML projects, Motion library for React
- Focus on high-impact moments: page load reveals (staggered `animation-delay`), scroll-triggered transitions, hover states that surprise
- Include skeleton shimmer for loading states
- Always respect `prefers-reduced-motion` — wrap animations in a media query

### Spatial Composition

Break out of the grid occasionally. Unexpected layouts — asymmetry, overlap, diagonal flow, grid-breaking hero elements — create visual interest. Balance generous negative space with controlled density depending on the aesthetic direction.

### Backgrounds & Visual Details

Create atmosphere and depth rather than defaulting to solid colors. Gradient meshes, noise textures, geometric patterns, layered transparencies, dramatic shadows, decorative borders, custom cursors, and grain overlays all contribute to a distinctive feel.

## Phase 2: Implementation

Generate working code (HTML/CSS/JS, React, Vue, Svelte, etc.) that is production-grade, visually striking, and cohesive.

### Framework Detection

Check the project for its tech stack before generating code:
- `package.json` with `react` / `next` → React/Next.js (JSX + CSS Modules or Tailwind)
- `package.json` with `vue` → Vue SFC
- `package.json` with `svelte` → Svelte components
- `tailwind.config.*` → Use Tailwind utility classes
- No framework detected → Vanilla HTML/CSS/JS

### Visual Media

Every image slot must show something — never leave empty placeholders:
- **Avatars**: `https://i.pravatar.cc/150?u={unique-id}`
- **Photos**: `https://picsum.photos/seed/{slug}/{width}/{height}`
- **Branded graphics**: Generate with AI image tools or use gradient SVGs
- **Data display**: Always use `Intl.NumberFormat` for prices, `Intl.DateTimeFormat` for dates — showing `$NaN` or `Invalid Date` is a critical visual bug

### Accessibility (Non-Negotiable)

- Color contrast: minimum 4.5:1 for text, 3:1 for large text (WCAG AA)
- Visible focus indicators on all interactive elements (`:focus-visible`)
- Semantic HTML — `<nav>`, `<main>`, `<article>`, `<button>` over generic `<div>`
- ARIA labels where semantics alone aren't sufficient
- `prefers-reduced-motion` media query wrapping all animations

## Phase 3: Visual Verification Loop

This is the key differentiator. After generating code, verify it visually and iterate.

### Browser Tool Detection

Check which browser tools are available, in order of preference:

**1. Chrome Extension (best for interactive development)**
If `mcp__claude_in_chrome__*` tools are available — the Chrome extension is connected. This gives you direct access to the user's real browser with their login state, live DOM inspection, and console error reading.

**2. Playwright MCP (best for automated/headless verification)**
If `mcp__playwright__*` tools are available — the Playwright MCP server is configured. This gives you programmatic browser control with screenshots, accessibility tree snapshots, and console message capture. Works headless for CI/CD.

**3. Playwright CLI (fallback)**
If neither MCP is available but the project has `@playwright/test` in `package.json` or a `playwright.config.*` file, you can run `npx playwright test` for basic E2E verification.

**4. No browser tools available**
Generate the code using design principles only. Suggest the user set up browser verification — read `references/browser-verification-setup.md` for instructions and share the relevant setup steps.

### Verification Workflow

Regardless of which browser tool is available, follow this loop:

```
1. Generate/update the frontend code
2. Ensure the dev server is running (or open the HTML file)
3. Open the page in the browser
4. Take a screenshot or visually inspect the rendered result
5. Evaluate against the design intent:
   - Does the layout match the intended composition?
   - Are fonts rendering correctly (not falling back to system fonts)?
   - Do colors feel cohesive and intentional?
   - Are animations smooth and purposeful?
   - Is the page responsive at different viewport widths?
   - Are there any console errors?
6. If something is off → fix the code and go back to step 2
7. If it looks right → move on
```

### With Chrome Extension

```
- Navigate to the dev server URL (e.g., http://localhost:3000)
- Visually inspect the page — you can see it directly
- Check the console for errors or warnings
- Test interactions: hover states, click handlers, form flows
- If the user is logged in, test authenticated views
- Resize the viewport to check responsive behavior
- Iterate: fix issues in code, refresh, re-verify
```

### With Playwright MCP

```
- browser_navigate to the dev server URL
- browser_take_screenshot to capture the current state
- browser_snapshot to get the accessibility tree (semantic structure check)
- browser_console_messages to catch JavaScript errors
- browser_evaluate to test dynamic behavior
- browser_resize to check responsive layouts
- browser_take_screenshot again after each fix to confirm improvement
```

### Iteration Discipline

The verification loop should run at least once for every meaningful UI change. Don't generate a massive component and hope it works — build incrementally:

1. Layout skeleton first → verify structure
2. Add typography and color → verify visual hierarchy
3. Add animations and interactions → verify motion feels right
4. Add responsive behavior → verify at mobile/tablet/desktop breakpoints
5. Final polish → verify the complete experience

## Anti-Patterns (What to Avoid)

These patterns immediately signal "AI-generated UI" — avoid them:

- **Inter/Roboto/Arial** as primary fonts — use distinctive alternatives
- **Purple gradients on white backgrounds** — the most recognizable AI cliche
- **Uniform card grids with identical spacing** — vary the rhythm
- **Cookie-cutter hero sections** — centered text, stock gradient, two buttons
- **Overused font families** — Space Grotesk, Poppins used in every generation
- **Timid palettes** — five nearly-identical shades with no contrast or punch
- **Ignoring the aesthetic direction** — switching to "safe" defaults partway through
- **Skipping the browser check** — generating code and declaring it done without looking

## Integration Notes

- **With Figma workflows**: If the user has a Figma URL, use the `figma-connect` skill for design extraction, then use this skill's verification loop to confirm the implementation matches
- **With SpecWeave**: Visual verification counts as task evidence — screenshots from the browser loop confirm AC completion
- **With E2E testing**: After visual verification, formal Playwright test suites (via `sw:e2e`) can be generated to lock in the verified behavior for CI/CD
