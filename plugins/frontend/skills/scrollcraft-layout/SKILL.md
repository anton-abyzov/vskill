---
name: scrollcraft-layout
description: Turn a static site into a premium, multi-layered, scroll-driven experience (the "ScrollCraft" approach from Nate Herk's Claude design-skill video, adapted to Anton's no-npm static sites). Use when Anton asks for "multi-layered layout", "layers when you scroll", "interactive scrolling", "make it gorgeous / premium", "scroll animations", "not AI slop", or to apply the ScrollCraft approach to antonabyzov.com, football.antonabyzov.com, EasyChamp or any landing page. Pairs with the frontend-design skill (aesthetics) and the webapp-testing skill (headless verification).
metadata:
  version: "1.0.0"
  author: Anton Abyzov
  tags: scroll, gsap, scrolltrigger, landing-page, parallax, web-design
---

# scrollcraft-layout

Source: transcript of youtube.com/watch?v=QUI6Ug4cHnE (Nate Herk, "I Built The Ultimate Claude Website Design Skill", Aug 2026). Core idea: **the scroll is the story.** Every scroll gesture should correlate with something happening on the page, so the visitor is hooked like short-form content and keeps going. Keep the copy and the brand; change how it unfolds.

## 1. Interview first (2 minutes, not 20)
Answer these before touching code (from the brief or by asking):
- Vibe on two axes: **premium/trusted/editorial ↔ energetic/hype**, and **real assets ↔ generated world**. Anton's sites default to premium editorial with real photos/videos.
- The **scroll journey**: what should the visitor feel at second 0, 5, 20, 60? Which single thing must they remember?
- Real assets available (photos, clips, logos). Generate only fillers that match the palette (Kie/GPT Image via the kie-gemini-omni skill), never photoreal people.
- "One thing this site does that no site you have seen does."

## 2. Composition rules that read as premium
- **Hero must not be bland**: depth (layered background planes, grain, a light source), a magazine-cover lockup (name as object, one line of role, one CTA), a subtle scroll-linked zoom or parallax, real photo/video cut-out on its own layer.
- **One thing at a time**: long sections become pinned sequences where content swaps as you scroll (a "stage" with 3–6 beats), or horizontal scroll rails for series (career eras, products, goals).
- **Numbers count up on scroll**, images reveal with scroll (mask/clip), lines draw, text arrives staggered. Slow it down: a scroll-linked animation should take **~60–100 vh of scroll** to complete, not 20. Fast = invisible.
- **Layers**: at least three planes moving at different rates (background field, mid content, foreground accents). Use `translate3d` only.
- Typography and spacing carry taste: display + body pairing (no Inter/Roboto/Arial/system-ui/Space Grotesk), generous whitespace, editorial hierarchy, a data voice for metrics.
- Cards get dynamic hover (tilt/glow following the pointer) but never depend on hover for meaning.
- Cut what is bland or redundant rather than animating it.

## 3. Implementation (static sites, no npm)
- Prefer **CSS scroll-driven animations** (`animation-timeline: view()` / `scroll()`, `animation-range`) inside `@supports` and `@media (prefers-reduced-motion: no-preference)`; the resting state is the final state so prints/captures/no-JS are complete.
- For pinned sequences, horizontal rails and scrubbed image/video sequences use **GSAP 3 + ScrollTrigger from cdnjs** (`cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js` + `ScrollTrigger.min.js`), `scrub: 0.6–1.2`, `pin: true`, `anticipatePin: 1`; smooth scrolling via Lenis only if it stays under 20 KB and is disabled on reduced-motion.
- Video: `<video muted playsinline preload="metadata" poster>` with `IntersectionObserver` play/pause; scrubbing a clip by scroll only for short (≤ 6 s) hero loops.
- Performance budget: LCP image ≤ 250 KB, total JS ≤ 90 KB, no layout thrash (transform/opacity only), `content-visibility: auto` on below-fold sections.
- Accessibility: focus order unchanged by pinning, `prefers-reduced-motion` turns every scroll animation into a static layout, contrast AA, one h1.

## 4. Verify like the video does ("zoom into keyframes")
Headless only (Playwright, `PWDEBUG=0`). Scroll the page to 0, 10, 25, 40, 55, 70, 85, 100 % and screenshot each stop at 1440 and 375; read them: is something meaningful happening at every stop, is any text unreadable mid-animation, does any pinned section trap the scroll on mobile, does the sequence read too fast (fewer than two stops show its progress)? Fix, re-shoot, repeat. Also test reduced-motion and a no-JS render.

## 5. Delivery checklist
Hero with depth and one hook · 3+ moving layers · at least one pinned or horizontal sequence · counters/reveals tied to scroll and slowed · copy and brand preserved · reduced-motion and no-JS complete · Lighthouse-minded budgets · scroll-stop screenshots in the QA folder.
