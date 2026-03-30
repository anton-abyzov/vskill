# Contact Form Page -- Portfolio Site

## Phase 1: Design Thinking

### Aesthetic Direction

- **Purpose**: A contact page for a personal portfolio. Visitors are potential clients, collaborators, or recruiters reaching out after browsing work samples. The page must feel approachable but professional -- a quiet confidence that reflects craft.
- **Tone**: Warm minimalism with an editorial edge. Not sterile-corporate, not trendy-startup. Think architectural studio letterhead: generous white space, deliberate type, tactile surface quality.
- **Differentiation / Signature Element**: A CSS-generated noise grain texture layered over a warm paper-tone background. This gives the page a physical, almost printed quality that separates it from flat digital screens. The form itself floats on a slightly elevated card with a soft shadow, as if a paper form resting on a linen desk.

### Typography

- **Display / Headings**: "DM Serif Display" -- warm, high-contrast serif with personality. Used for the page title and section headings.
- **Body / UI**: "IBM Plex Sans" -- humanist sans-serif with excellent legibility at small sizes and a technical character that pairs well with the serif display font. Used for labels, inputs, body text.
- **Scale**: Base 16px, Golden Ratio (1.618x) steps: 16 / 26 / 42 / 68.

### Color Palette

CSS custom properties throughout. No purple gradients. No pure white backgrounds.

| Token | Value | Usage |
|---|---|---|
| `--bg-base` | `#F5F0EB` | Page background -- warm parchment |
| `--bg-card` | `#FFFFFF` | Form card surface |
| `--text-primary` | `#1A1A1A` | Headings, primary text |
| `--text-secondary` | `#5C5C5C` | Labels, helper text |
| `--accent` | `#C8553D` | Terracotta -- submit button, focus rings, links |
| `--accent-hover` | `#A8432F` | Darkened accent for hover states |
| `--border` | `#D4CFC9` | Input borders at rest |
| `--border-focus` | `#C8553D` | Input borders on focus (matches accent) |
| `--success` | `#3D8B6E` | Success feedback after submission |
| `--error` | `#C8553D` | Validation error (reuses accent -- intentional, the terracotta reads as both warm and cautionary) |
| `--grain-opacity` | `0.035` | Noise texture overlay strength |

### Background Texture Approach

A CSS-only noise grain texture using an SVG `<filter>` with `feTurbulence`. This is inlined as a pseudo-element (`::before`) on the `<body>`, covering the full viewport at low opacity. No external image files needed, no network requests, works offline, scales to any resolution.

The turbulence parameters (`baseFrequency: 0.65`, `numOctaves: 4`, type `fractalNoise`) produce a fine-grained paper-like texture. Overlaid at 3.5% opacity on the warm parchment background, it adds a tactile quality without competing with content.

### Motion & Animation

Restrained. Three orchestrated moments:

1. **Page load**: The heading fades and slides up (0.6s ease-out), followed by the form card (0.4s delay, 0.6s ease-out). Staggered reveal.
2. **Input focus**: Border color transitions (0.2s) and a subtle inner shadow appears, making the active field feel recessed.
3. **Submit success**: A smooth message fade-in replacing the button area.

All animations wrapped in `@media (prefers-reduced-motion: no-preference)` -- reduced motion gets instant rendering with no transitions.

### Spatial Composition

Centered single-column layout. The form card maxes out at 520px width with generous internal padding (48px). The page title sits outside and above the card, left-aligned to the card's edge, breaking the expected centered symmetry. Vertical rhythm uses 8px base grid.

---

## Phase 2: Implementation

### Framework Detection

Plain HTML/CSS/JS as specified. No build tools, no framework.

### Complete Code

**index.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Contact -- Portfolio</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="styles.css">
</head>
<body>

  <!-- SVG noise filter for background texture -->
  <svg aria-hidden="true" style="position:absolute;width:0;height:0;">
    <filter id="grain">
      <feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="4" stitchTiles="stitch"/>
    </filter>
  </svg>

  <main class="page">
    <div class="container">
      <header class="page-header">
        <h1 class="page-title">Get in touch</h1>
        <p class="page-subtitle">Have a project in mind, a question, or just want to say hello? Fill out the form below and I will get back to you within a day or two.</p>
      </header>

      <div class="card">
        <form id="contact-form" class="form" novalidate>
          <div class="form-group">
            <label for="name" class="form-label">Name</label>
            <input
              type="text"
              id="name"
              name="name"
              class="form-input"
              required
              autocomplete="name"
              placeholder="Your name"
            >
            <span class="form-error" aria-live="polite"></span>
          </div>

          <div class="form-group">
            <label for="email" class="form-label">Email</label>
            <input
              type="email"
              id="email"
              name="email"
              class="form-input"
              required
              autocomplete="email"
              placeholder="you@example.com"
            >
            <span class="form-error" aria-live="polite"></span>
          </div>

          <div class="form-group">
            <label for="subject" class="form-label">Subject <span class="optional">(optional)</span></label>
            <input
              type="text"
              id="subject"
              name="subject"
              class="form-input"
              placeholder="What is this about?"
            >
          </div>

          <div class="form-group">
            <label for="message" class="form-label">Message</label>
            <textarea
              id="message"
              name="message"
              class="form-input form-textarea"
              required
              rows="6"
              placeholder="Tell me about your project or idea..."
            ></textarea>
            <span class="form-error" aria-live="polite"></span>
          </div>

          <div class="form-actions">
            <button type="submit" class="btn-submit" id="submit-btn">
              <span class="btn-text">Send message</span>
              <span class="btn-sending" aria-hidden="true">Sending...</span>
            </button>
          </div>

          <div class="form-success" id="form-success" role="status" aria-hidden="true">
            <svg class="success-icon" viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M20 6L9 17l-5-5"/>
            </svg>
            <p class="success-text">Message sent. I will be in touch soon.</p>
          </div>
        </form>
      </div>

      <footer class="page-footer">
        <p>Or reach me directly at <a href="mailto:hello@example.com" class="footer-link">hello@example.com</a></p>
      </footer>
    </div>
  </main>

  <script src="script.js"></script>
</body>
</html>
```

**styles.css**

```css
/* ============================================
   Contact Form -- Portfolio
   Warm minimalism with paper-grain texture
   ============================================ */

/* --- Tokens --- */
:root {
  --bg-base: #F5F0EB;
  --bg-card: #FFFFFF;
  --text-primary: #1A1A1A;
  --text-secondary: #5C5C5C;
  --accent: #C8553D;
  --accent-hover: #A8432F;
  --border: #D4CFC9;
  --border-focus: #C8553D;
  --success: #3D8B6E;
  --error: #C8553D;
  --grain-opacity: 0.035;

  --font-display: 'DM Serif Display', Georgia, serif;
  --font-body: 'IBM Plex Sans', -apple-system, sans-serif;

  --space-xs: 4px;
  --space-sm: 8px;
  --space-md: 16px;
  --space-lg: 24px;
  --space-xl: 32px;
  --space-2xl: 48px;

  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
}

/* --- Reset --- */
*,
*::before,
*::after {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

/* --- Background texture --- */
body {
  font-family: var(--font-body);
  font-size: 16px;
  line-height: 1.6;
  color: var(--text-primary);
  background-color: var(--bg-base);
  min-height: 100vh;
  position: relative;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

body::before {
  content: '';
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  filter: url(#grain);
  opacity: var(--grain-opacity);
}

/* --- Layout --- */
.page {
  position: relative;
  z-index: 1;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  min-height: 100vh;
  padding: var(--space-2xl) var(--space-md);
  padding-top: max(var(--space-2xl), 8vh);
}

.container {
  width: 100%;
  max-width: 520px;
}

/* --- Header --- */
.page-header {
  margin-bottom: var(--space-xl);
}

.page-title {
  font-family: var(--font-display);
  font-size: clamp(2rem, 5vw, 2.625rem);
  font-weight: 400;
  line-height: 1.15;
  color: var(--text-primary);
  margin-bottom: var(--space-sm);
}

.page-subtitle {
  font-size: 0.9375rem;
  color: var(--text-secondary);
  line-height: 1.65;
  max-width: 44ch;
}

/* --- Card --- */
.card {
  background: var(--bg-card);
  border-radius: var(--radius-lg);
  padding: var(--space-2xl);
  box-shadow:
    0 1px 3px rgba(0, 0, 0, 0.04),
    0 4px 12px rgba(0, 0, 0, 0.06),
    0 12px 32px rgba(0, 0, 0, 0.04);
}

/* --- Form --- */
.form {
  display: flex;
  flex-direction: column;
  gap: var(--space-lg);
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}

.form-label {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--text-primary);
  letter-spacing: 0.01em;
}

.optional {
  font-weight: 400;
  color: var(--text-secondary);
}

.form-input {
  font-family: var(--font-body);
  font-size: 1rem;
  line-height: 1.5;
  color: var(--text-primary);
  background: var(--bg-card);
  border: 1.5px solid var(--border);
  border-radius: var(--radius-md);
  padding: var(--space-sm) var(--space-md);
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
  outline: none;
}

.form-input::placeholder {
  color: #B0AAA3;
}

.form-input:focus-visible {
  border-color: var(--border-focus);
  box-shadow: 0 0 0 3px rgba(200, 85, 61, 0.12), inset 0 1px 3px rgba(0, 0, 0, 0.04);
}

.form-input.has-error {
  border-color: var(--error);
}

.form-textarea {
  resize: vertical;
  min-height: 140px;
}

.form-error {
  font-size: 0.8125rem;
  color: var(--error);
  min-height: 0;
  overflow: hidden;
  transition: min-height 0.2s ease;
}

.form-error:not(:empty) {
  min-height: 1.3em;
}

/* --- Button --- */
.form-actions {
  padding-top: var(--space-sm);
}

.btn-submit {
  font-family: var(--font-body);
  font-size: 0.9375rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: #FFFFFF;
  background: var(--accent);
  border: none;
  border-radius: var(--radius-md);
  padding: 14px var(--space-xl);
  cursor: pointer;
  transition: background-color 0.2s ease, transform 0.1s ease;
  position: relative;
  width: 100%;
}

.btn-submit:hover {
  background: var(--accent-hover);
}

.btn-submit:active {
  transform: scale(0.985);
}

.btn-submit:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
}

.btn-submit .btn-sending {
  display: none;
}

.btn-submit.is-sending .btn-text {
  display: none;
}

.btn-submit.is-sending .btn-sending {
  display: inline;
}

.btn-submit.is-sending {
  opacity: 0.7;
  cursor: not-allowed;
}

/* --- Success state --- */
.form-success {
  display: none;
  flex-direction: column;
  align-items: center;
  gap: var(--space-md);
  text-align: center;
  padding: var(--space-xl) 0;
}

.form-success.is-visible {
  display: flex;
}

.success-icon {
  color: var(--success);
}

.success-text {
  font-size: 1.0625rem;
  font-weight: 500;
  color: var(--text-primary);
}

/* --- Footer --- */
.page-footer {
  margin-top: var(--space-xl);
  text-align: center;
  font-size: 0.875rem;
  color: var(--text-secondary);
}

.footer-link {
  color: var(--accent);
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 2px;
  transition: color 0.2s ease;
}

.footer-link:hover {
  color: var(--accent-hover);
}

.footer-link:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-radius: 2px;
}

/* --- Animations --- */
@media (prefers-reduced-motion: no-preference) {
  .page-header {
    opacity: 0;
    transform: translateY(16px);
    animation: fadeSlideUp 0.6s ease-out forwards;
  }

  .card {
    opacity: 0;
    transform: translateY(16px);
    animation: fadeSlideUp 0.6s ease-out 0.15s forwards;
  }

  .page-footer {
    opacity: 0;
    animation: fadeIn 0.5s ease-out 0.4s forwards;
  }

  .form-success.is-visible {
    animation: fadeIn 0.4s ease-out forwards;
  }
}

@keyframes fadeSlideUp {
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

/* --- Responsive --- */
@media (max-width: 600px) {
  .page {
    padding: var(--space-lg) var(--space-md);
    padding-top: var(--space-xl);
  }

  .card {
    padding: var(--space-lg) var(--space-md);
    border-radius: var(--radius-md);
  }

  .page-title {
    font-size: 1.75rem;
  }
}
```

**script.js**

```javascript
(function () {
  'use strict';

  var form = document.getElementById('contact-form');
  var submitBtn = document.getElementById('submit-btn');
  var successEl = document.getElementById('form-success');

  var rules = {
    name: {
      required: true,
      message: 'Please enter your name.'
    },
    email: {
      required: true,
      pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
      message: 'Please enter a valid email address.'
    },
    message: {
      required: true,
      minLength: 10,
      message: 'Please write at least a short message (10 characters).'
    }
  };

  function validateField(field) {
    var rule = rules[field.name];
    if (!rule) return true;

    var value = field.value.trim();
    var errorEl = field.parentElement.querySelector('.form-error');

    // Clear previous state
    field.classList.remove('has-error');
    if (errorEl) errorEl.textContent = '';

    if (rule.required && !value) {
      field.classList.add('has-error');
      if (errorEl) errorEl.textContent = rule.message;
      return false;
    }

    if (rule.pattern && value && !rule.pattern.test(value)) {
      field.classList.add('has-error');
      if (errorEl) errorEl.textContent = rule.message;
      return false;
    }

    if (rule.minLength && value.length < rule.minLength) {
      field.classList.add('has-error');
      if (errorEl) errorEl.textContent = rule.message;
      return false;
    }

    return true;
  }

  // Validate on blur after first interaction
  var fields = form.querySelectorAll('.form-input');
  fields.forEach(function (field) {
    var touched = false;

    field.addEventListener('blur', function () {
      touched = true;
      validateField(field);
    });

    field.addEventListener('input', function () {
      if (touched) {
        validateField(field);
      }
    });
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();

    // Validate all fields
    var allValid = true;
    fields.forEach(function (field) {
      if (!validateField(field)) {
        allValid = false;
      }
    });

    if (!allValid) {
      // Focus the first invalid field
      var firstError = form.querySelector('.has-error');
      if (firstError) firstError.focus();
      return;
    }

    // Simulate sending
    submitBtn.classList.add('is-sending');
    submitBtn.disabled = true;

    // In production, replace this timeout with a real fetch() to your backend
    setTimeout(function () {
      form.style.display = 'none';
      successEl.classList.add('is-visible');
      successEl.setAttribute('aria-hidden', 'false');
    }, 1200);
  });
})();
```

---

## Phase 3: Visual Verification

### Browser Tool Detection Result

No browser verification tools are available for this session:

- **Chrome Extension**: No `mcp__claude_in_chrome__*` tools detected.
- **Playwright MCP**: No `mcp__playwright__*` tools detected.
- **Playwright CLI**: No `package.json` or `playwright.config.*` present in the project (this is a standalone HTML/CSS/JS page, not an npm project).

All four browser tool detection paths from the skill have been exhausted. This code was generated using design principles only, without visual verification.

### What This Means

Without a browser in the loop, I cannot confirm:

- Whether the DM Serif Display and IBM Plex Sans fonts render as intended (or fall back to Georgia/system sans)
- Whether the SVG `feTurbulence` noise grain looks appropriately subtle at `0.035` opacity across different displays -- it may need tuning
- Whether the terracotta accent (`#C8553D`) on the white card provides the warmth intended or reads too aggressively
- Whether the card shadow layers feel natural or appear too heavy/too faint
- Whether the staggered fade-slide-up animations feel smooth and well-timed at 0.15s stagger
- The responsive breakpoint behavior at exactly 600px and various phone sizes
- WCAG contrast ratios at every text/background combination (the palette was designed with AA compliance in mind, but pixel-level rendering may differ)

### Recommended Setup for Verification

To close the verification loop, set up one of these options:

**Quickest -- Playwright MCP (one command):**
```bash
claude mcp add playwright -- npx @playwright/mcp@latest
```
This gives programmatic screenshot capture, accessibility tree snapshots, viewport resizing, and console error detection. After setup, I can navigate to the HTML file, take screenshots at multiple viewport widths, inspect the accessibility tree, and iterate on any visual issues.

**Best for interactive work -- Chrome Extension:**
1. Install "Claude in Chrome" from the Chrome Web Store (v1.0.36+)
2. Start Claude Code with `claude --chrome`
3. Open the `index.html` file in Chrome

This lets me see the page directly in your browser, inspect the DOM, check console for errors, and test hover/focus states interactively.

Either option takes under a minute to set up and would let me verify and refine the design before calling it done.
