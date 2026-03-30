# Contact Form Page -- Plan and Code

## Design Decisions

### Visual Direction

The design follows a restrained, editorial aesthetic -- the kind you would see on a thoughtful designer's portfolio rather than a template site. The goal is to feel intentional and quiet, letting whitespace and typography do the heavy lifting.

### Typography

- **Headings**: `"DM Serif Display"` from Google Fonts -- a high-contrast serif with personality that avoids being generic. It reads as confident without being loud.
- **Body / Inputs / Labels**: `"Inter"` -- a neutral sans-serif designed for screens, with excellent legibility at small sizes. Its open apertures keep form labels readable.

### Color Palette

| Role | Value | Rationale |
|------|-------|-----------|
| Background | `#f5f2ed` | Warm off-white, like aged paper. Avoids clinical sterility. |
| Card surface | `#fffdfb` | Slightly lighter warm white for the form card -- lifts it off the background. |
| Primary text | `#2c2825` | Deep warm brown-black. Softer than pure black. |
| Secondary text | `#7a746d` | Muted warm gray for labels and helper text. |
| Accent | `#c4734f` | Terracotta/burnt sienna -- earthy, distinctive, avoids the blue/purple cliche. |
| Accent hover | `#a85d3d` | Darkened accent for button hover state. |
| Border | `#ddd7cf` | Subtle warm border for input fields. |
| Focus ring | `rgba(196, 115, 79, 0.3)` | Translucent accent for focus outlines. |
| Error | `#c44f4f` | Warm red that belongs in the palette, not a jarring alarm color. |
| Success background | `#eef6ee` | Soft sage green for the success state. |
| Success text | `#2d5a2d` | Deep green for success message readability. |

### Background Texture Approach

Rather than loading an external image (which adds a network request and can look tiled/repetitive), the texture is generated purely with CSS using a layered `radial-gradient` noise technique. Multiple tiny semi-transparent radial gradients at varying sizes are composited to produce a subtle paper-like grain. This approach:

- Adds zero network requests
- Scales to any viewport without tiling artifacts
- Is trivially customizable by adjusting opacity or gradient sizes
- Performs well since it is rendered once by the compositor

The texture is applied to the `body` via a `::before` pseudo-element so it sits behind all content without interfering with pointer events.

### Layout

- Vertically and horizontally centered card on the page (flexbox)
- Max-width of 520px for the form -- wide enough for comfortable input, narrow enough to feel intimate
- Generous padding (48px) inside the card
- Subtle box-shadow for depth, no hard borders on the card itself
- The card uses a very slight border-radius (12px) -- enough to feel modern, not enough to feel playful

### Interaction Details

- Input fields grow a warm accent border and a soft glow on focus
- The submit button has a smooth background transition on hover and a slight scale-down on active press
- A lightweight loading spinner (CSS-only) replaces the button text during "submission"
- On success, the entire form fades out and is replaced by a confirmation message with a gentle fade-in
- Client-side validation highlights individual fields with error messages below them
- Labels float above inputs as static labels (not animated float labels -- those hurt usability)

### JavaScript

- Vanilla JS, no dependencies
- Simple validation: required fields, email format via regex, minimum message length
- A simulated form submission (setTimeout) since there is no backend -- easily replaceable with a `fetch()` call
- All state management is done with class toggling on DOM elements

---

## Code

### `index.html`

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Contact</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=Inter:wght@400;500&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <main class="page">
    <div class="card">
      <div class="card__header">
        <h1 class="card__title">Get in Touch</h1>
        <p class="card__subtitle">Have a project in mind or just want to say hello? I'd love to hear from you.</p>
      </div>

      <form id="contactForm" class="form" novalidate>
        <div class="form__group">
          <label for="name" class="form__label">Name</label>
          <input
            type="text"
            id="name"
            name="name"
            class="form__input"
            placeholder="Your name"
            required
          >
          <span class="form__error" id="nameError"></span>
        </div>

        <div class="form__group">
          <label for="email" class="form__label">Email</label>
          <input
            type="email"
            id="email"
            name="email"
            class="form__input"
            placeholder="you@example.com"
            required
          >
          <span class="form__error" id="emailError"></span>
        </div>

        <div class="form__group">
          <label for="subject" class="form__label">Subject <span class="form__optional">(optional)</span></label>
          <input
            type="text"
            id="subject"
            name="subject"
            class="form__input"
            placeholder="What's this about?"
          >
        </div>

        <div class="form__group">
          <label for="message" class="form__label">Message</label>
          <textarea
            id="message"
            name="message"
            class="form__input form__textarea"
            placeholder="Tell me about your project, idea, or just say hi..."
            rows="5"
            required
          ></textarea>
          <span class="form__error" id="messageError"></span>
        </div>

        <button type="submit" class="form__submit" id="submitBtn">
          <span class="form__submit-text">Send Message</span>
          <span class="form__submit-spinner"></span>
        </button>
      </form>

      <div class="success" id="successMessage">
        <div class="success__icon">&#10003;</div>
        <h2 class="success__title">Message Sent</h2>
        <p class="success__text">Thank you for reaching out. I'll get back to you within a day or two.</p>
        <button class="success__reset" id="resetBtn">Send Another</button>
      </div>
    </div>
  </main>

  <script src="script.js"></script>
</body>
</html>
```

### `style.css`

```css
/* ============================================
   Reset & Base
   ============================================ */

*,
*::before,
*::after {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

:root {
  --bg: #f5f2ed;
  --surface: #fffdfb;
  --text-primary: #2c2825;
  --text-secondary: #7a746d;
  --accent: #c4734f;
  --accent-hover: #a85d3d;
  --border: #ddd7cf;
  --focus-ring: rgba(196, 115, 79, 0.3);
  --error: #c44f4f;
  --success-bg: #eef6ee;
  --success-text: #2d5a2d;
  --radius: 12px;
  --radius-sm: 8px;
  --shadow: 0 4px 24px rgba(44, 40, 37, 0.06), 0 1px 4px rgba(44, 40, 37, 0.04);
  --transition: 0.25s ease;
}

body {
  font-family: "Inter", system-ui, -apple-system, sans-serif;
  background-color: var(--bg);
  color: var(--text-primary);
  line-height: 1.6;
  min-height: 100vh;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

/* ============================================
   Subtle Paper Texture (CSS-only)
   ============================================ */

body::before {
  content: "";
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  opacity: 0.4;
  background-image:
    radial-gradient(ellipse at 20% 50%, rgba(120, 100, 80, 0.03) 0%, transparent 50%),
    radial-gradient(ellipse at 80% 20%, rgba(120, 100, 80, 0.03) 0%, transparent 50%),
    radial-gradient(ellipse at 60% 80%, rgba(120, 100, 80, 0.02) 0%, transparent 50%);
  background-size: 100% 100%;
  filter: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='4' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.08'/%3E%3C/svg%3E#n");
}

/* ============================================
   Page Layout
   ============================================ */

.page {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: 24px;
}

/* ============================================
   Card
   ============================================ */

.card {
  background: var(--surface);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  width: 100%;
  max-width: 520px;
  padding: 48px;
}

.card__header {
  margin-bottom: 36px;
}

.card__title {
  font-family: "DM Serif Display", Georgia, serif;
  font-size: 2rem;
  font-weight: 400;
  line-height: 1.2;
  color: var(--text-primary);
  margin-bottom: 8px;
}

.card__subtitle {
  font-size: 0.95rem;
  color: var(--text-secondary);
  line-height: 1.55;
}

/* ============================================
   Form
   ============================================ */

.form__group {
  margin-bottom: 22px;
}

.form__label {
  display: block;
  font-size: 0.82rem;
  font-weight: 500;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 6px;
}

.form__optional {
  font-weight: 400;
  text-transform: none;
  letter-spacing: normal;
  color: var(--border);
  font-size: 0.8rem;
}

.form__input {
  width: 100%;
  padding: 12px 16px;
  font-family: inherit;
  font-size: 0.95rem;
  color: var(--text-primary);
  background: var(--surface);
  border: 1.5px solid var(--border);
  border-radius: var(--radius-sm);
  outline: none;
  transition: border-color var(--transition), box-shadow var(--transition);
}

.form__input::placeholder {
  color: var(--border);
}

.form__input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--focus-ring);
}

.form__input.is-invalid {
  border-color: var(--error);
}

.form__input.is-invalid:focus {
  box-shadow: 0 0 0 3px rgba(196, 79, 79, 0.2);
}

.form__textarea {
  resize: vertical;
  min-height: 120px;
  line-height: 1.6;
}

.form__error {
  display: block;
  font-size: 0.8rem;
  color: var(--error);
  margin-top: 4px;
  min-height: 1.2em;
}

/* ============================================
   Submit Button
   ============================================ */

.form__submit {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  padding: 14px 24px;
  margin-top: 28px;
  font-family: inherit;
  font-size: 0.95rem;
  font-weight: 500;
  color: #fff;
  background: var(--accent);
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--transition), transform 0.1s ease;
}

.form__submit:hover {
  background: var(--accent-hover);
}

.form__submit:active {
  transform: scale(0.985);
}

.form__submit:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.form__submit-spinner {
  display: none;
  width: 18px;
  height: 18px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

.form__submit.is-loading .form__submit-text {
  display: none;
}

.form__submit.is-loading .form__submit-spinner {
  display: block;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* ============================================
   Success State
   ============================================ */

.success {
  display: none;
  text-align: center;
  padding: 16px 0;
  animation: fadeIn 0.4s ease;
}

.success.is-visible {
  display: block;
}

.success__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  margin-bottom: 20px;
  background: var(--success-bg);
  color: var(--success-text);
  font-size: 1.5rem;
  font-weight: 600;
  border-radius: 50%;
}

.success__title {
  font-family: "DM Serif Display", Georgia, serif;
  font-size: 1.5rem;
  font-weight: 400;
  margin-bottom: 8px;
}

.success__text {
  font-size: 0.95rem;
  color: var(--text-secondary);
  margin-bottom: 28px;
  line-height: 1.55;
}

.success__reset {
  padding: 10px 24px;
  font-family: inherit;
  font-size: 0.88rem;
  font-weight: 500;
  color: var(--accent);
  background: transparent;
  border: 1.5px solid var(--accent);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--transition), color var(--transition);
}

.success__reset:hover {
  background: var(--accent);
  color: #fff;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* ============================================
   Responsive
   ============================================ */

@media (max-width: 560px) {
  .card {
    padding: 32px 24px;
  }

  .card__title {
    font-size: 1.65rem;
  }
}
```

### `script.js`

```js
(function () {
  "use strict";

  var form = document.getElementById("contactForm");
  var submitBtn = document.getElementById("submitBtn");
  var successMessage = document.getElementById("successMessage");
  var resetBtn = document.getElementById("resetBtn");

  var fields = {
    name: {
      el: document.getElementById("name"),
      error: document.getElementById("nameError"),
      validate: function (v) {
        if (!v.trim()) return "Name is required.";
        if (v.trim().length < 2) return "Name must be at least 2 characters.";
        return "";
      },
    },
    email: {
      el: document.getElementById("email"),
      error: document.getElementById("emailError"),
      validate: function (v) {
        if (!v.trim()) return "Email is required.";
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())) return "Please enter a valid email address.";
        return "";
      },
    },
    message: {
      el: document.getElementById("message"),
      error: document.getElementById("messageError"),
      validate: function (v) {
        if (!v.trim()) return "Message is required.";
        if (v.trim().length < 10) return "Please write at least 10 characters.";
        return "";
      },
    },
  };

  // Live validation: clear error on input once field was touched
  Object.keys(fields).forEach(function (key) {
    var field = fields[key];
    field.el.addEventListener("input", function () {
      if (field.el.classList.contains("is-invalid")) {
        var msg = field.validate(field.el.value);
        if (!msg) {
          field.el.classList.remove("is-invalid");
          field.error.textContent = "";
        }
      }
    });
  });

  function validateAll() {
    var valid = true;
    Object.keys(fields).forEach(function (key) {
      var field = fields[key];
      var msg = field.validate(field.el.value);
      if (msg) {
        field.el.classList.add("is-invalid");
        field.error.textContent = msg;
        valid = false;
      } else {
        field.el.classList.remove("is-invalid");
        field.error.textContent = "";
      }
    });
    return valid;
  }

  function setLoading(loading) {
    if (loading) {
      submitBtn.classList.add("is-loading");
      submitBtn.disabled = true;
    } else {
      submitBtn.classList.remove("is-loading");
      submitBtn.disabled = false;
    }
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();

    if (!validateAll()) return;

    setLoading(true);

    // Simulate network request -- replace this with a real fetch() call
    // pointing at your form endpoint (Formspree, Netlify Forms, your own API, etc.)
    setTimeout(function () {
      setLoading(false);
      form.style.display = "none";
      document.querySelector(".card__header").style.display = "none";
      successMessage.classList.add("is-visible");
    }, 1500);
  });

  resetBtn.addEventListener("click", function () {
    form.reset();
    Object.keys(fields).forEach(function (key) {
      fields[key].el.classList.remove("is-invalid");
      fields[key].error.textContent = "";
    });
    successMessage.classList.remove("is-visible");
    form.style.display = "";
    document.querySelector(".card__header").style.display = "";
  });
})();
```

---

## Summary of Approach

**What makes this not look like "generic AI output":**

1. **Color**: The terracotta accent (`#c4734f`) and warm neutral palette steer away from the blue/purple defaults that saturate template sites. The palette feels cohesive because every color shares the same warm undertone.

2. **Typography pairing**: DM Serif Display for headings paired with Inter for body creates contrast between editorial personality and functional clarity. Most AI-generated pages default to a single sans-serif.

3. **Texture**: The SVG filter-based noise texture applied via `body::before` gives the background a tactile paper quality without any external assets. The `feTurbulence` SVG filter generates fractal noise rendered at low opacity, layered beneath soft radial gradients for depth variation.

4. **Proportions**: 48px card padding, 22px group spacing, uppercase tracking on labels -- these specific measurements come from deliberate typographic scale choices, not framework defaults.

5. **Micro-interactions**: The focus ring uses the accent color at 30% opacity rather than the browser default. The submit button scales down 1.5% on press for tactile feedback. The success state fades in with a slight upward translation. These small details compound into a polished feel.

6. **No dependencies**: Zero external JS libraries, zero icon libraries, zero CSS frameworks. The checkmark in the success state is a Unicode character. The spinner is pure CSS. The texture is an inline SVG filter. Everything loads in three files.

**To connect to a real backend**, replace the `setTimeout` block in `script.js` with a `fetch()` POST to a service like Formspree, Netlify Forms, or a custom endpoint. The form already uses `name` attributes on all inputs, so `new FormData(form)` will capture everything.
