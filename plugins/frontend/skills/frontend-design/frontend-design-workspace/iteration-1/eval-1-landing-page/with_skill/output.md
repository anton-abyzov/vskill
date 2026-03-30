# Meridian Landing Page -- With Skill Output

## Phase 1: Design Thinking

### Aesthetic Direction

**Purpose**: Landing page for Meridian, a project management tool targeting creative agencies. The audience is design directors, producers, and creative leads who have refined aesthetic taste and are actively repelled by generic SaaS visuals.

**Tone**: Luxury editorial. Think Monocle magazine meets a Swiss design monograph. Controlled, confident, unhurried. Every element earns its place. The page should feel like opening a well-made book, not scrolling through a startup template.

**Signature Element**: Oversized serif typography with dramatic vertical rhythm. Section transitions use a slow, deliberate curtain-reveal animation on scroll -- content slides up from below a clipping mask, mimicking a physical page turn. This single motion language unifies the whole page and makes it instantly recognizable.

**Differentiation from typical SaaS**: No hero gradient blobs. No floating dashboard mockups at a jaunty angle. No "Trusted by 10,000+ teams" social proof bar above the fold. Instead: a stark typographic hero with a single, striking product screenshot that fills the viewport edge-to-edge below the fold.

### Typography

**Display font**: `"Instrument Serif"` from Google Fonts -- a high-contrast transitional serif with editorial character. Elegant without being decorative. Used for all headings and the hero statement.

**Body font**: `"Satoshi"` from Fontshare (or `"General Sans"` as fallback from Google Fonts) -- a geometric sans-serif with humanist details. Clean enough for UI copy, warm enough to avoid clinical coldness.

**Typographic scale** (Golden Ratio, base 18px):

```
--text-xs:    11px    (0.688rem)
--text-sm:    14px    (0.875rem)
--text-base:  18px    (1.125rem)
--text-lg:    29px    (1.813rem)
--text-xl:    47px    (2.938rem)
--text-2xl:   76px    (4.750rem)
--text-3xl:   123px   (7.688rem)
```

Hero headline uses `--text-3xl` on desktop, dropping to `--text-2xl` on tablet and `--text-xl` on mobile. Body copy is `--text-base` with generous `1.7` line-height for readability.

### Color & Theme

Dark theme with warm undertones. No pure black -- all backgrounds use a deep warm charcoal.

```css
:root {
  /* Backgrounds -- warm dark, not pure black */
  --bg-primary:    #0F0E0C;     /* Deep warm charcoal */
  --bg-secondary:  #1A1816;     /* Slightly lifted surface */
  --bg-tertiary:   #242220;     /* Cards, elevated elements */

  /* Text */
  --text-primary:   #F5F0E8;    /* Warm cream, not pure white */
  --text-secondary: #A39E93;    /* Muted, for captions/metadata */
  --text-tertiary:  #6B6560;    /* De-emphasized text */

  /* Accent -- warm amber/gold, not tech-blue */
  --accent:         #C8956A;    /* Burnished copper */
  --accent-hover:   #DBA97E;    /* Lighter on hover */
  --accent-subtle:  #C8956A1A;  /* 10% opacity for backgrounds */

  /* Borders & Dividers */
  --border:         #2A2826;    /* Subtle warm border */
  --border-hover:   #3D3A37;    /* Slightly visible on hover */

  /* Functional */
  --success:        #7DB97A;
  --error:          #D4694A;
}
```

The copper accent provides warmth and sophistication without the tech-startup cliche of electric blue or violet. Against the warm charcoal backgrounds it reads as premium and intentional.

### Motion & Animation

**Core motion language**: Vertical reveals with eased timing. Content enters from below, opacity fading in simultaneously. All motion uses `cubic-bezier(0.16, 1, 0.3, 1)` -- a custom ease that starts fast and decelerates gracefully (feels organic, not mechanical).

**Specific animations**:

1. **Hero entrance**: The headline words appear one at a time, staggered by 120ms, sliding up 30px with opacity fade. Total sequence ~600ms.
2. **Scroll reveals**: Each section's content reveals via IntersectionObserver. Elements translate from `translateY(60px), opacity: 0` to resting position. Stagger of 80ms between sibling elements.
3. **Product screenshot parallax**: The main product image moves at 0.85x scroll speed, creating a subtle depth layer.
4. **Navigation**: On scroll past hero, nav background transitions from transparent to `--bg-primary` with backdrop-blur. Transition duration 400ms.
5. **Hover states**: Buttons scale to 1.02 with a shadow expansion. Feature cards lift 4px with border color transitioning to `--accent`.

**Reduced motion**: All animations wrapped in `prefers-reduced-motion` check. When reduced motion is preferred, elements appear instantly at their final positions -- no translate, no stagger, just immediate visibility.

### Spatial Composition

**Hero**: Full viewport height. Navigation pinned top. Headline positioned at the vertical center-left (not dead center), with a single line of subtext below. A thin horizontal rule separates the hero from the next section. Asymmetric -- the headline sits on a 7-column span of a 12-column grid, leaving breathing room on the right.

**Product showcase**: Edge-to-edge screenshot (breaks out of the content container) with a subtle warm gradient overlay at top and bottom edges to blend into the dark background.

**Features section**: 2-column asymmetric layout. Left column holds a large feature title and description. Right column holds an illustration or screenshot. Columns alternate sides on each feature block (left-right, right-left pattern).

**Social proof**: A horizontal scrolling ticker of agency logos, monochrome, at reduced opacity. Not a static grid -- the continuous motion adds life without demanding attention.

**CTA section**: Stark simplicity. Large serif text ("Start your next project"), a single input field, and one button. Generous whitespace above and below.

### Backgrounds & Visual Details

- **Noise texture overlay**: A subtle CSS noise grain applied to `--bg-primary` via a repeating SVG data URI at 3-5% opacity. Adds tactile quality to the flat dark surfaces.
- **Section dividers**: Thin 1px horizontal lines using `--border`, not whitespace-only separation.
- **Gradient accents**: A very subtle radial gradient (copper at 5% opacity) positioned behind the hero headline, adding warmth without being visible as an explicit "blob."
- **Custom cursor**: Not recommended here -- creative agency users may find it annoying when evaluating a tool.

---

## Phase 2: Implementation

### Framework Detection

The user specified **React + Tailwind**, dev server on `localhost:3000`. Before writing code, I would check:

```bash
cat package.json | grep -E '"react"|"tailwindcss"|"next"'
```

And check for `tailwind.config.js` or `tailwind.config.ts` to confirm Tailwind version and any existing theme customization.

If this is a fresh CRA/Vite project, I would extend `tailwind.config.js` with the custom theme tokens rather than using inline style variables.

### Key Files Created/Modified

1. `tailwind.config.js` -- extended with Meridian theme
2. `src/App.tsx` -- main landing page composition
3. `src/components/Navbar.tsx`
4. `src/components/Hero.tsx`
5. `src/components/ProductShowcase.tsx`
6. `src/components/Features.tsx`
7. `src/components/LogoTicker.tsx`
8. `src/components/CTA.tsx`
9. `src/components/Footer.tsx`
10. `src/hooks/useScrollReveal.ts` -- IntersectionObserver hook for animations
11. `src/index.css` -- font imports, noise texture, base resets

### Code Snippets

#### tailwind.config.js

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        meridian: {
          bg:        '#0F0E0C',
          surface:   '#1A1816',
          elevated:  '#242220',
          text:      '#F5F0E8',
          muted:     '#A39E93',
          faint:     '#6B6560',
          accent:    '#C8956A',
          'accent-hover': '#DBA97E',
          'accent-subtle': 'rgba(200, 149, 106, 0.1)',
          border:    '#2A2826',
          'border-hover': '#3D3A37',
        },
      },
      fontFamily: {
        serif:  ['"Instrument Serif"', 'Georgia', 'serif'],
        sans:   ['"General Sans"', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        'display-lg': ['7.688rem', { lineHeight: '0.9', letterSpacing: '-0.03em' }],
        'display':    ['4.750rem', { lineHeight: '0.95', letterSpacing: '-0.02em' }],
        'display-sm': ['2.938rem', { lineHeight: '1.05', letterSpacing: '-0.01em' }],
        'heading':    ['1.813rem', { lineHeight: '1.2' }],
        'body':       ['1.125rem', { lineHeight: '1.7' }],
        'caption':    ['0.875rem', { lineHeight: '1.5', letterSpacing: '0.04em' }],
      },
      animation: {
        'fade-up':     'fadeUp 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'logo-scroll': 'logoScroll 30s linear infinite',
      },
      keyframes: {
        fadeUp: {
          '0%':   { opacity: '0', transform: 'translateY(60px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        logoScroll: {
          '0%':   { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' },
        },
      },
    },
  },
  plugins: [],
};
```

#### src/index.css

```css
@import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&display=swap');
@import url('https://fonts.googleapis.com/css2?family=General+Sans:wght@400;500;600&display=swap');

@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  body {
    @apply bg-meridian-bg text-meridian-text font-sans text-body antialiased;
  }

  ::selection {
    background-color: rgba(200, 149, 106, 0.3);
    color: #F5F0E8;
  }
}

/* Noise texture overlay */
.noise-overlay::before {
  content: '';
  position: fixed;
  inset: 0;
  z-index: 9999;
  pointer-events: none;
  opacity: 0.04;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E");
}

/* Reduced motion */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

#### src/hooks/useScrollReveal.ts

```tsx
import { useEffect, useRef, useState } from 'react';

interface ScrollRevealOptions {
  threshold?: number;
  rootMargin?: string;
  once?: boolean;
}

export function useScrollReveal<T extends HTMLElement>({
  threshold = 0.15,
  rootMargin = '0px 0px -60px 0px',
  once = true,
}: ScrollRevealOptions = {}) {
  const ref = useRef<T>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches;

    if (prefersReducedMotion) {
      setIsVisible(true);
      return;
    }

    const element = ref.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          if (once) observer.unobserve(element);
        }
      },
      { threshold, rootMargin }
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [threshold, rootMargin, once]);

  return { ref, isVisible };
}
```

#### src/components/Navbar.tsx

```tsx
import { useEffect, useState } from 'react';

export function Navbar() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 80);
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-400 ${
        scrolled
          ? 'bg-meridian-bg/90 backdrop-blur-md border-b border-meridian-border'
          : 'bg-transparent'
      }`}
    >
      <div className="max-w-7xl mx-auto px-6 lg:px-12 h-20 flex items-center justify-between">
        <a
          href="/"
          className="font-serif text-heading text-meridian-text tracking-tight"
        >
          Meridian
        </a>

        <div className="hidden md:flex items-center gap-10">
          <a
            href="#features"
            className="text-caption uppercase tracking-widest text-meridian-muted hover:text-meridian-text transition-colors"
          >
            Features
          </a>
          <a
            href="#pricing"
            className="text-caption uppercase tracking-widest text-meridian-muted hover:text-meridian-text transition-colors"
          >
            Pricing
          </a>
          <a
            href="#about"
            className="text-caption uppercase tracking-widest text-meridian-muted hover:text-meridian-text transition-colors"
          >
            About
          </a>
          <button className="px-5 py-2.5 border border-meridian-accent text-meridian-accent text-caption uppercase tracking-widest hover:bg-meridian-accent hover:text-meridian-bg transition-all duration-300">
            Get Started
          </button>
        </div>

        {/* Mobile hamburger */}
        <button
          className="md:hidden text-meridian-text"
          aria-label="Open navigation menu"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M3 8h18M3 16h18" />
          </svg>
        </button>
      </div>
    </nav>
  );
}
```

#### src/components/Hero.tsx

```tsx
import { useEffect, useState } from 'react';

export function Hero() {
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // Trigger entrance animation after mount
    const timer = setTimeout(() => setLoaded(true), 100);
    return () => clearTimeout(timer);
  }, []);

  const words = ['Project', 'management,', 'refined.'];

  return (
    <section className="relative min-h-screen flex items-center overflow-hidden">
      {/* Subtle radial gradient behind headline */}
      <div
        className="absolute top-1/2 left-1/4 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] rounded-full pointer-events-none"
        style={{
          background: 'radial-gradient(circle, rgba(200,149,106,0.06) 0%, transparent 70%)',
        }}
        aria-hidden="true"
      />

      <div className="max-w-7xl mx-auto px-6 lg:px-12 w-full">
        <div className="max-w-[65%]">
          <p
            className={`text-caption uppercase tracking-[0.2em] text-meridian-accent mb-8 transition-all duration-700 ${
              loaded
                ? 'opacity-100 translate-y-0'
                : 'opacity-0 translate-y-4'
            }`}
          >
            For creative agencies
          </p>

          <h1 className="font-serif text-display-lg leading-[0.9] tracking-tight">
            {words.map((word, i) => (
              <span
                key={word}
                className={`inline-block mr-[0.3em] transition-all duration-800 ${
                  loaded
                    ? 'opacity-100 translate-y-0'
                    : 'opacity-0 translate-y-[30px]'
                }`}
                style={{
                  transitionDelay: loaded ? `${200 + i * 120}ms` : '0ms',
                }}
              >
                {word === 'refined.' ? (
                  <em className="text-meridian-accent">{word}</em>
                ) : (
                  word
                )}
              </span>
            ))}
          </h1>

          <p
            className={`text-heading font-sans text-meridian-muted mt-10 max-w-xl transition-all duration-700 ${
              loaded
                ? 'opacity-100 translate-y-0'
                : 'opacity-0 translate-y-6'
            }`}
            style={{ transitionDelay: loaded ? '650ms' : '0ms' }}
          >
            The workspace where creative vision meets structured delivery.
            Timelines, briefs, and reviews -- without the noise.
          </p>

          <div
            className={`flex gap-4 mt-12 transition-all duration-700 ${
              loaded
                ? 'opacity-100 translate-y-0'
                : 'opacity-0 translate-y-6'
            }`}
            style={{ transitionDelay: loaded ? '800ms' : '0ms' }}
          >
            <button className="px-8 py-4 bg-meridian-accent text-meridian-bg font-sans text-caption uppercase tracking-widest hover:bg-meridian-accent-hover transition-all duration-300 hover:scale-[1.02] hover:shadow-lg hover:shadow-meridian-accent/20">
              Start Free Trial
            </button>
            <button className="px-8 py-4 border border-meridian-border text-meridian-muted font-sans text-caption uppercase tracking-widest hover:border-meridian-text hover:text-meridian-text transition-all duration-300">
              Watch Demo
            </button>
          </div>
        </div>
      </div>

      {/* Bottom divider */}
      <div className="absolute bottom-0 left-0 right-0 h-px bg-meridian-border" />
    </section>
  );
}
```

#### src/components/ProductShowcase.tsx

```tsx
import { useScrollReveal } from '../hooks/useScrollReveal';

export function ProductShowcase() {
  const { ref, isVisible } = useScrollReveal<HTMLDivElement>();

  return (
    <section className="py-24 overflow-hidden" ref={ref}>
      <div
        className={`transition-all duration-1000 ${
          isVisible
            ? 'opacity-100 translate-y-0'
            : 'opacity-0 translate-y-16'
        }`}
      >
        {/* Edge-to-edge product screenshot */}
        <div className="relative">
          {/* Top gradient fade */}
          <div className="absolute top-0 left-0 right-0 h-24 bg-gradient-to-b from-meridian-bg to-transparent z-10" />

          <img
            src="https://picsum.photos/seed/meridian-dashboard/1920/1080"
            alt="Meridian project dashboard showing timeline view with active creative briefs"
            className="w-full h-auto"
          />

          {/* Bottom gradient fade */}
          <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-meridian-bg to-transparent z-10" />
        </div>

        <div className="max-w-7xl mx-auto px-6 lg:px-12 mt-16">
          <p className="text-caption uppercase tracking-[0.2em] text-meridian-accent">
            The workspace
          </p>
          <p className="text-heading text-meridian-muted mt-4 max-w-2xl">
            A single surface for briefs, timelines, feedback, and delivery.
            Designed for how creative teams actually work.
          </p>
        </div>
      </div>
    </section>
  );
}
```

#### src/components/Features.tsx

```tsx
import { useScrollReveal } from '../hooks/useScrollReveal';

interface FeatureBlockProps {
  label: string;
  title: string;
  description: string;
  imageSeed: string;
  reverse?: boolean;
}

function FeatureBlock({ label, title, description, imageSeed, reverse }: FeatureBlockProps) {
  const { ref, isVisible } = useScrollReveal<HTMLDivElement>();

  return (
    <div
      ref={ref}
      className={`grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-20 items-center py-20 border-t border-meridian-border ${
        isVisible ? 'opacity-100' : 'opacity-0'
      } transition-opacity duration-700`}
    >
      <div
        className={`lg:col-span-5 ${reverse ? 'lg:order-2' : ''} ${
          isVisible ? 'translate-y-0 opacity-100' : 'translate-y-12 opacity-0'
        } transition-all duration-700`}
        style={{ transitionDelay: isVisible ? '100ms' : '0ms' }}
      >
        <p className="text-caption uppercase tracking-[0.2em] text-meridian-accent mb-4">
          {label}
        </p>
        <h3 className="font-serif text-display-sm text-meridian-text mb-6">
          {title}
        </h3>
        <p className="text-body text-meridian-muted leading-relaxed">
          {description}
        </p>
      </div>

      <div
        className={`lg:col-span-7 ${reverse ? 'lg:order-1' : ''} ${
          isVisible ? 'translate-y-0 opacity-100' : 'translate-y-12 opacity-0'
        } transition-all duration-700`}
        style={{ transitionDelay: isVisible ? '250ms' : '0ms' }}
      >
        <div className="bg-meridian-surface border border-meridian-border overflow-hidden">
          <img
            src={`https://picsum.photos/seed/${imageSeed}/960/640`}
            alt={`${title} feature illustration`}
            className="w-full h-auto"
          />
        </div>
      </div>
    </div>
  );
}

export function Features() {
  return (
    <section id="features" className="max-w-7xl mx-auto px-6 lg:px-12 py-16">
      <FeatureBlock
        label="01 -- Timelines"
        title="See the whole picture"
        description="Gantt-style timelines built for creative workflows. Drag to reschedule, link dependencies, and spot bottlenecks before they derail a campaign."
        imageSeed="meridian-timelines"
      />
      <FeatureBlock
        label="02 -- Briefs"
        title="Briefs that actually get read"
        description="Structured creative briefs with inline references, mood boards, and version history. No more PDFs lost in email threads."
        imageSeed="meridian-briefs"
        reverse
      />
      <FeatureBlock
        label="03 -- Reviews"
        title="Feedback with precision"
        description="Pin comments directly on deliverables. Track revision rounds. Know exactly what changed between v3 and v7 without asking."
        imageSeed="meridian-reviews"
      />
    </section>
  );
}
```

#### src/components/LogoTicker.tsx

```tsx
export function LogoTicker() {
  // Placeholder agency names rendered as text logos
  const agencies = [
    'Wieden+Kennedy', 'Pentagram', 'Droga5', 'R/GA',
    'IDEO', 'Huge', 'Instrument', 'ustwo',
  ];

  // Duplicate for seamless infinite scroll
  const doubled = [...agencies, ...agencies];

  return (
    <section className="py-20 border-t border-b border-meridian-border overflow-hidden">
      <p className="text-center text-caption uppercase tracking-[0.2em] text-meridian-faint mb-12">
        Trusted by leading creative studios
      </p>
      <div className="relative">
        <div className="flex animate-logo-scroll whitespace-nowrap">
          {doubled.map((name, i) => (
            <span
              key={`${name}-${i}`}
              className="inline-block mx-12 text-heading font-serif text-meridian-faint/40 select-none"
              aria-hidden={i >= agencies.length}
            >
              {name}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
```

#### src/components/CTA.tsx

```tsx
import { useScrollReveal } from '../hooks/useScrollReveal';

export function CTA() {
  const { ref, isVisible } = useScrollReveal<HTMLDivElement>();

  return (
    <section className="py-32" ref={ref}>
      <div
        className={`max-w-3xl mx-auto px-6 text-center transition-all duration-900 ${
          isVisible
            ? 'opacity-100 translate-y-0'
            : 'opacity-0 translate-y-12'
        }`}
      >
        <h2 className="font-serif text-display text-meridian-text mb-8">
          Start your next project
        </h2>
        <p className="text-body text-meridian-muted mb-12">
          14-day free trial. No credit card required.
        </p>
        <form
          className="flex flex-col sm:flex-row gap-4 max-w-lg mx-auto"
          onSubmit={(e) => e.preventDefault()}
        >
          <label className="sr-only" htmlFor="cta-email">
            Work email address
          </label>
          <input
            id="cta-email"
            type="email"
            placeholder="you@agency.com"
            className="flex-1 px-5 py-4 bg-meridian-surface border border-meridian-border text-meridian-text placeholder:text-meridian-faint focus:outline-none focus:border-meridian-accent transition-colors"
            required
          />
          <button
            type="submit"
            className="px-8 py-4 bg-meridian-accent text-meridian-bg text-caption uppercase tracking-widest hover:bg-meridian-accent-hover transition-all duration-300 hover:scale-[1.02] whitespace-nowrap"
          >
            Get Started
          </button>
        </form>
      </div>
    </section>
  );
}
```

#### src/components/Footer.tsx

```tsx
export function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="border-t border-meridian-border">
      <div className="max-w-7xl mx-auto px-6 lg:px-12 py-16">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-12">
          <div>
            <p className="font-serif text-heading text-meridian-text mb-4">Meridian</p>
            <p className="text-body text-meridian-muted">
              Project management for creative agencies.
            </p>
          </div>

          <nav aria-label="Product links">
            <p className="text-caption uppercase tracking-[0.15em] text-meridian-faint mb-4">
              Product
            </p>
            <ul className="space-y-3">
              {['Features', 'Pricing', 'Changelog', 'Integrations'].map((link) => (
                <li key={link}>
                  <a href="#" className="text-body text-meridian-muted hover:text-meridian-text transition-colors">
                    {link}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-label="Company links">
            <p className="text-caption uppercase tracking-[0.15em] text-meridian-faint mb-4">
              Company
            </p>
            <ul className="space-y-3">
              {['About', 'Blog', 'Careers', 'Contact'].map((link) => (
                <li key={link}>
                  <a href="#" className="text-body text-meridian-muted hover:text-meridian-text transition-colors">
                    {link}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-label="Legal links">
            <p className="text-caption uppercase tracking-[0.15em] text-meridian-faint mb-4">
              Legal
            </p>
            <ul className="space-y-3">
              {['Privacy', 'Terms', 'Security'].map((link) => (
                <li key={link}>
                  <a href="#" className="text-body text-meridian-muted hover:text-meridian-text transition-colors">
                    {link}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        <div className="mt-16 pt-8 border-t border-meridian-border flex flex-col sm:flex-row justify-between items-center gap-4">
          <p className="text-caption text-meridian-faint">
            {currentYear} Meridian. All rights reserved.
          </p>
          <p className="text-caption text-meridian-faint">
            Crafted for agencies that care about craft.
          </p>
        </div>
      </div>
    </footer>
  );
}
```

#### src/App.tsx

```tsx
import { Navbar } from './components/Navbar';
import { Hero } from './components/Hero';
import { ProductShowcase } from './components/ProductShowcase';
import { Features } from './components/Features';
import { LogoTicker } from './components/LogoTicker';
import { CTA } from './components/CTA';
import { Footer } from './components/Footer';

export default function App() {
  return (
    <div className="noise-overlay">
      <Navbar />
      <main>
        <Hero />
        <ProductShowcase />
        <Features />
        <LogoTicker />
        <CTA />
      </main>
      <Footer />
    </div>
  );
}
```

### Accessibility Compliance

- All images have descriptive `alt` text specific to the content, not generic ("dashboard screenshot").
- `<nav>` elements have `aria-label` attributes distinguishing them (product links, company links, legal links).
- The CTA email input has a `<label>` with `sr-only` for screen readers.
- Mobile menu button has `aria-label="Open navigation menu"`.
- Focus indicators: Tailwind's default `focus:outline-none` on the input is paired with `focus:border-meridian-accent` so keyboard users see a visible border change.
- Color contrast: `#F5F0E8` on `#0F0E0C` yields a ratio of approximately 16.4:1 (passes AAA). `#A39E93` on `#0F0E0C` yields approximately 6.2:1 (passes AA for body text). `#C8956A` on `#0F0E0C` yields approximately 6.8:1 (passes AA).
- `prefers-reduced-motion` media query blanket-disables all animation and transition durations.
- Semantic HTML: `<nav>`, `<main>`, `<section>`, `<footer>`, `<form>` used appropriately.

### Visual Media

- Product screenshots: `https://picsum.photos/seed/meridian-dashboard/1920/1080` (and similar seeded URLs for feature illustrations) -- deterministic seeds so the same image appears on reload.
- Avatars: not needed on this page.
- Agency logos: Rendered as text in `Instrument Serif` rather than using image placeholders -- this is a deliberate editorial choice that avoids broken image links and reinforces the typographic aesthetic.

---

## Phase 3: Visual Verification Loop

### Tool Detection

I would check for browser tools in this priority order:

1. **Chrome Extension**: Look for `mcp__claude_in_chrome__*` tools in the available tool list. If present, this is preferred because I can see the actual rendered page in real-time, inspect DOM elements, read console errors, and test hover/scroll interactions interactively.

2. **Playwright MCP**: Look for `mcp__playwright__*` tools. If present, I can take automated screenshots, get accessibility tree snapshots, read console messages, and resize the viewport programmatically.

3. **Playwright CLI**: Check `package.json` for `@playwright/test` or look for `playwright.config.*` in the project root.

4. **None available**: In this case I would still generate the code using the design principles above, then advise the user on setting up browser verification.

In this scenario, checking the available tools list: I see `mcp__pencil__*` and `mcp__claude_ai_Figma__*` tools but NO `mcp__claude_in_chrome__*` or `mcp__playwright__*` tools. So I would fall back to option 3 or 4 and recommend the user install browser verification tools.

### Verification Workflow (What I Would Do)

Since no direct browser MCP tools are available, here is the verification workflow I would follow:

#### Step 1: Ensure the dev server is running

```bash
# Check if the dev server is already running on port 3000
lsof -i :3000

# If not, start it
npm run dev
```

#### Step 2: Incremental build-and-verify cycle

I would NOT generate all components at once and hope they work. Instead, I would build incrementally, verifying after each phase:

**Round 1 -- Layout skeleton**
- Create `App.tsx` with all section components as empty colored boxes
- Create `Navbar.tsx` and `Hero.tsx` with just the structural HTML (no animations yet)
- **Verify**: Open `localhost:3000` in the browser. If Playwright CLI is available, run a quick screenshot test:

```bash
npx playwright test --headed --project=chromium
```

With a minimal test file:

```ts
// e2e/visual-check.spec.ts
import { test, expect } from '@playwright/test';

test('landing page renders', async ({ page }) => {
  await page.goto('http://localhost:3000');
  await expect(page.locator('nav')).toBeVisible();
  await expect(page.locator('h1')).toContainText('Project management');
  await page.screenshot({ path: 'screenshots/01-skeleton.png', fullPage: true });
});
```

Check the screenshot file to confirm: Is the nav positioned correctly? Does the hero fill the viewport? Are fonts loading (not falling back to system serif)?

**Round 2 -- Typography and color**
- Apply the full Tailwind config with Meridian theme
- Add font imports to `index.css`
- Style all text elements
- **Verify**: Take another screenshot. Key checks:
  - Is `Instrument Serif` actually rendering? (Look for the distinctive high-contrast letterforms -- if it fell back to Georgia, the stroke contrast will be different.)
  - Does the warm charcoal background read correctly? (Not too brown, not too gray.)
  - Is the copper accent visible and warm against the dark background?

**Round 3 -- Animations**
- Add the `useScrollReveal` hook
- Wire up hero entrance animation and scroll reveals
- Add navbar scroll behavior
- **Verify**: This requires interactive testing. If Chrome extension were available, I would scroll through the page and observe animations. Without it, I would:
  - Check that the page loads without console errors
  - Use Playwright to scroll programmatically and capture screenshots at different scroll positions:

```ts
test('scroll animations trigger', async ({ page }) => {
  await page.goto('http://localhost:3000');
  // Wait for hero entrance
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'screenshots/02-hero-animated.png' });

  // Scroll to features
  await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'screenshots/03-features-revealed.png' });
});
```

**Round 4 -- Responsive behavior**
- Test at three viewport widths:

```ts
test('responsive layouts', async ({ page }) => {
  // Mobile
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('http://localhost:3000');
  await page.screenshot({ path: 'screenshots/04-mobile.png', fullPage: true });

  // Tablet
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto('http://localhost:3000');
  await page.screenshot({ path: 'screenshots/05-tablet.png', fullPage: true });

  // Desktop
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('http://localhost:3000');
  await page.screenshot({ path: 'screenshots/06-desktop.png', fullPage: true });
});
```

- **Key checks at each breakpoint**:
  - Mobile: Does the hero headline scale down gracefully? Is the `max-w-[65%]` constraint removed? Does the CTA form stack vertically?
  - Tablet: Is the features section still readable in a single column? Is the nav still functional?
  - Desktop: Does the asymmetric hero layout feel balanced? Is there enough whitespace?

**Round 5 -- Final polish and accessibility**

```ts
test('accessibility tree check', async ({ page }) => {
  await page.goto('http://localhost:3000');
  const snapshot = await page.accessibility.snapshot();
  console.log(JSON.stringify(snapshot, null, 2));
});

test('no console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  await page.goto('http://localhost:3000');
  await page.waitForTimeout(2000);
  expect(errors).toHaveLength(0);
});
```

### What the Verification Loop Catches (and Why It Matters)

Without visual verification, the following issues would go undetected:

1. **Font loading failures**: Google Fonts might fail to load due to CSP headers, incorrect URL encoding, or network issues. The page would silently fall back to Georgia/system-ui, and the entire editorial aesthetic collapses. A screenshot immediately reveals this.

2. **Tailwind purging**: If the Tailwind config's `content` glob doesn't match the actual file paths, custom classes like `text-display-lg` or `bg-meridian-bg` get purged in production builds. The page would render with missing styles. A screenshot of the production build (not just dev) catches this.

3. **Animation timing**: The staggered hero word entrance (120ms delay) might feel too fast or too slow. CSS transition values are guesses until you see them in motion. Browser inspection lets you tune this in real-time.

4. **Overflow issues**: The edge-to-edge product screenshot and the infinite-scrolling logo ticker are both prone to horizontal overflow bugs that create unwanted scrollbars. Only a rendered page reveals this.

5. **Color relationships**: `#C8956A` on `#0F0E0C` passes WCAG AA mathematically, but the perceptual experience of copper-on-charcoal depends on surrounding context, font size, and rendering. A screenshot confirms it reads as warm and intentional rather than muddy.

6. **Z-index stacking**: The noise overlay (`z-index: 9999`), the nav (`z-50`), and the gradient overlays on the product screenshot all need to stack correctly. A visual check is the only reliable way to confirm this.

### If No Browser Tools Are Available At All

I would still generate all the code above, then include these instructions for the user:

> To enable visual verification in future sessions, install the Playwright MCP server:
>
> ```bash
> npm install -D @playwright/test
> npx playwright install chromium
> ```
>
> Then add Playwright MCP to your Claude Code configuration. This enables screenshot-based verification directly in the conversation.
>
> Alternatively, install the Chrome Extension for Claude Code for real-time interactive browser inspection.

---

## Summary of Design Decisions

| Decision | Rationale |
|---|---|
| Instrument Serif + General Sans | High-contrast editorial serif paired with warm geometric sans. Neither is overused in AI output. |
| Warm charcoal (#0F0E0C) not pure black | Pure black feels harsh and digital. The warm undertone adds sophistication. |
| Copper accent (#C8956A) not blue/purple | Deliberate avoidance of tech-startup cliches. Copper reads as warm, premium, and creative-industry-appropriate. |
| Asymmetric hero layout (7/12 columns) | Breaks the centered-text-with-gradient hero pattern. Creates editorial tension. |
| Text-based logo ticker | No broken image links, reinforces typographic identity, and the serif font at reduced opacity creates an elegant pattern. |
| Vertical-reveal animation language | One consistent motion direction (up) with one consistent easing curve. Coherent motion language prevents the "random animations everywhere" anti-pattern. |
| No floating dashboard mockup | The product screenshot sits full-bleed between gradient fades. Grounded, not floating at an angle -- matches the editorial, confident tone. |
| Noise texture overlay at 4% | Adds analog warmth to digital surfaces. Subtle enough to not interfere with readability but perceptible enough to prevent the "flat digital" feeling. |
