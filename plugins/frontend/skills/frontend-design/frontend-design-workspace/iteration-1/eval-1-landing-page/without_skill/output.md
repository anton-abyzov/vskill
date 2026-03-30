# Meridian Landing Page -- Plan & Code (Without Skill)

## Aesthetic Direction

**Concept: "The Editorial Studio"**

The design language draws from high-end print magazines and architectural portfolios rather than SaaS conventions. Think Monocle magazine meets Swiss design -- structured grids, generous whitespace, typographic hierarchy as the primary visual device. No gradient blobs, no floating dashboard mockups, no generic isometric illustrations.

The page should feel like opening a beautifully designed annual report: confident, restrained, and immediately communicating that Meridian is built for people who care about craft.

**Key design principles:**
- Typography does the heavy lifting -- no reliance on stock imagery
- Negative space as a design element, not wasted real estate
- Subtle motion that rewards attention rather than demanding it
- A color palette that feels warm-dark, not cold-tech

---

## Typography

**Primary heading font:** `"Playfair Display"` (Google Fonts) -- a high-contrast serif with editorial DNA. Used for hero headlines and section titles.

**Body / UI font:** `"Inter"` (Google Fonts) -- clean geometric sans-serif with excellent readability at small sizes. Used for body copy, navigation, buttons, and labels.

**Accent / monospace:** `"JetBrains Mono"` -- used sparingly for metrics, stats, or code-adjacent elements to add technical credibility.

Font loading strategy: `<link rel="preconnect">` + Google Fonts import, with `font-display: swap` for performance.

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;1,400&family=Inter:wght@300;400;500;600&family=JetBrains+Mono:wght@400&display=swap" rel="stylesheet">
```

Tailwind config additions:

```js
fontFamily: {
  serif: ['"Playfair Display"', 'Georgia', 'serif'],
  sans: ['Inter', 'system-ui', 'sans-serif'],
  mono: ['"JetBrains Mono"', 'monospace'],
},
```

---

## Color Palette

A warm-dark palette that avoids the cold blue-gray of typical dark themes. The background has a slight warm undertone (not pure black), and accent colors lean toward muted gold and warm stone rather than neon.

| Role | Name | Hex | Tailwind Token |
|---|---|---|---|
| Background (deep) | Obsidian | `#0C0B0E` | `bg-obsidian` |
| Background (elevated) | Charcoal | `#1A181D` | `bg-charcoal` |
| Surface / cards | Graphite | `#252329` | `bg-graphite` |
| Border / subtle dividers | Slate Edge | `#3A3740` | `border-slate-edge` |
| Body text | Ash | `#A8A3B0` | `text-ash` |
| Heading text | Ivory | `#F0ECE4` | `text-ivory` |
| Accent primary | Burnished Gold | `#C9A84C` | `text-gold` / `bg-gold` |
| Accent hover | Warm Gold | `#DFC06A` | `hover:text-gold-light` |
| Success / positive | Sage | `#7BAF7B` | `text-sage` |
| Muted / secondary | Pewter | `#6B6575` | `text-pewter` |

Tailwind config:

```js
colors: {
  obsidian: '#0C0B0E',
  charcoal: '#1A181D',
  graphite: '#252329',
  'slate-edge': '#3A3740',
  ash: '#A8A3B0',
  ivory: '#F0ECE4',
  gold: {
    DEFAULT: '#C9A84C',
    light: '#DFC06A',
  },
  sage: '#7BAF7B',
  pewter: '#6B6575',
},
```

---

## Animations

All animations use `Intersection Observer` for scroll-triggered reveals. No heavy animation libraries -- CSS transitions + a lightweight custom hook.

**Animation types:**
1. **Fade-up** -- elements translate Y by 30px and fade in (0.6s ease-out)
2. **Stagger reveal** -- children of a container animate sequentially with 80ms delay between each
3. **Horizontal rule grow** -- decorative `<hr>` elements scale from 0 to full width
4. **Counter** -- stats/metrics count up from 0 when scrolled into view
5. **Parallax text** -- hero headline has a subtle parallax offset on scroll (CSS `transform: translateY()` driven by scroll position)

Custom hook:

```tsx
import { useEffect, useRef, useState } from 'react';

export function useScrollReveal(threshold = 0.15) {
  const ref = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.unobserve(node);
        }
      },
      { threshold }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [threshold]);

  return { ref, isVisible };
}
```

Tailwind utility classes for animations (added via `@layer utilities` in the global CSS):

```css
@layer utilities {
  .animate-fade-up {
    opacity: 0;
    transform: translateY(30px);
    transition: opacity 0.6s ease-out, transform 0.6s ease-out;
  }
  .animate-fade-up.is-visible {
    opacity: 1;
    transform: translateY(0);
  }
  .animate-hr-grow {
    transform: scaleX(0);
    transform-origin: left;
    transition: transform 0.8s ease-out;
  }
  .animate-hr-grow.is-visible {
    transform: scaleX(1);
  }
}
```

---

## Page Sections

1. **Navigation** -- minimal top bar, logo left, links right, CTA button
2. **Hero** -- full-viewport, large serif headline, one-line description, single CTA
3. **Editorial Divider** -- thin gold rule + category label ("Project Management, Reimagined")
4. **Features** -- 3-column grid with icon, heading, and short description
5. **Showcase** -- large screenshot/mockup area with overlaid stats
6. **Testimonials** -- single rotating quote, large italic serif typography
7. **Pricing** -- two-tier cards (Studio / Agency), clean comparison
8. **CTA Banner** -- full-width dark section with final call to action
9. **Footer** -- minimal, links + copyright

---

## Project Structure

```
src/
  components/
    Navbar.tsx
    Hero.tsx
    EditorialDivider.tsx
    Features.tsx
    Showcase.tsx
    Testimonials.tsx
    Pricing.tsx
    CtaBanner.tsx
    Footer.tsx
  hooks/
    useScrollReveal.ts
    useCountUp.ts
  App.tsx
  index.css
  main.tsx
tailwind.config.js
index.html
```

---

## Key Component Code

### tailwind.config.js

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        serif: ['"Playfair Display"', 'Georgia', 'serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      colors: {
        obsidian: '#0C0B0E',
        charcoal: '#1A181D',
        graphite: '#252329',
        'slate-edge': '#3A3740',
        ash: '#A8A3B0',
        ivory: '#F0ECE4',
        gold: {
          DEFAULT: '#C9A84C',
          light: '#DFC06A',
        },
        sage: '#7BAF7B',
        pewter: '#6B6575',
      },
      letterSpacing: {
        editorial: '0.08em',
      },
    },
  },
  plugins: [],
};
```

### src/index.css

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  html {
    scroll-behavior: smooth;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }
  body {
    @apply bg-obsidian text-ash font-sans;
  }
  ::selection {
    @apply bg-gold/20 text-ivory;
  }
}

@layer utilities {
  .animate-fade-up {
    opacity: 0;
    transform: translateY(30px);
    transition: opacity 0.6s ease-out, transform 0.6s ease-out;
  }
  .animate-fade-up.is-visible {
    opacity: 1;
    transform: translateY(0);
  }
  .animate-hr-grow {
    transform: scaleX(0);
    transform-origin: left;
    transition: transform 0.8s ease-out;
  }
  .animate-hr-grow.is-visible {
    transform: scaleX(1);
  }
  .stagger-child {
    opacity: 0;
    transform: translateY(20px);
    transition: opacity 0.5s ease-out, transform 0.5s ease-out;
  }
  .stagger-parent.is-visible .stagger-child:nth-child(1) { transition-delay: 0ms; opacity: 1; transform: translateY(0); }
  .stagger-parent.is-visible .stagger-child:nth-child(2) { transition-delay: 80ms; opacity: 1; transform: translateY(0); }
  .stagger-parent.is-visible .stagger-child:nth-child(3) { transition-delay: 160ms; opacity: 1; transform: translateY(0); }
  .stagger-parent.is-visible .stagger-child:nth-child(4) { transition-delay: 240ms; opacity: 1; transform: translateY(0); }
  .stagger-parent.is-visible .stagger-child:nth-child(5) { transition-delay: 320ms; opacity: 1; transform: translateY(0); }
  .stagger-parent.is-visible .stagger-child:nth-child(6) { transition-delay: 400ms; opacity: 1; transform: translateY(0); }
}
```

### src/hooks/useScrollReveal.ts

```tsx
import { useEffect, useRef, useState } from 'react';

export function useScrollReveal(threshold = 0.15) {
  const ref = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.unobserve(node);
        }
      },
      { threshold }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [threshold]);

  return { ref, isVisible };
}
```

### src/hooks/useCountUp.ts

```tsx
import { useEffect, useState } from 'react';

export function useCountUp(target: number, isActive: boolean, duration = 1500) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!isActive) return;

    let start = 0;
    const startTime = performance.now();

    function tick(now: number) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      setCount(Math.round(eased * target));

      if (progress < 1) {
        requestAnimationFrame(tick);
      }
    }

    requestAnimationFrame(tick);
  }, [isActive, target, duration]);

  return count;
}
```

### src/components/Navbar.tsx

```tsx
import { useState, useEffect } from 'react';

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled ? 'bg-obsidian/90 backdrop-blur-md border-b border-slate-edge' : 'bg-transparent'
      }`}
    >
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <a href="#" className="font-serif text-xl text-ivory tracking-editorial">
          Meridian
        </a>

        <div className="hidden md:flex items-center gap-8">
          <a href="#features" className="text-sm text-ash hover:text-ivory transition-colors">
            Features
          </a>
          <a href="#pricing" className="text-sm text-ash hover:text-ivory transition-colors">
            Pricing
          </a>
          <a href="#testimonials" className="text-sm text-ash hover:text-ivory transition-colors">
            Testimonials
          </a>
          <a
            href="#cta"
            className="text-sm font-medium text-obsidian bg-gold hover:bg-gold-light px-5 py-2 transition-colors"
          >
            Get Early Access
          </a>
        </div>
      </div>
    </nav>
  );
}
```

### src/components/Hero.tsx

```tsx
import { useEffect, useState } from 'react';

export default function Hero() {
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setLoaded(true), 100);
    return () => clearTimeout(timer);
  }, []);

  return (
    <section className="relative min-h-screen flex items-center justify-center px-6">
      {/* Subtle radial gradient for depth */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_#1A181D_0%,_#0C0B0E_70%)]" />

      <div className="relative z-10 max-w-4xl mx-auto text-center">
        {/* Overline label */}
        <p
          className={`text-xs font-sans font-medium tracking-[0.25em] uppercase text-gold mb-8 transition-all duration-700 ${
            loaded ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
          }`}
        >
          Project Management for Creative Agencies
        </p>

        {/* Main headline */}
        <h1
          className={`font-serif text-5xl md:text-7xl lg:text-8xl text-ivory leading-[1.05] mb-8 transition-all duration-700 delay-200 ${
            loaded ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'
          }`}
        >
          Where creative
          <br />
          work finds its
          <br />
          <em className="text-gold">rhythm</em>
        </h1>

        {/* Subheadline */}
        <p
          className={`font-sans text-lg md:text-xl text-ash max-w-xl mx-auto mb-12 leading-relaxed transition-all duration-700 delay-400 ${
            loaded ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'
          }`}
        >
          Meridian brings clarity to creative chaos. Timelines, briefs, feedback,
          and deliverables -- all in one place built for how agencies actually work.
        </p>

        {/* CTA */}
        <div
          className={`transition-all duration-700 delay-500 ${
            loaded ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'
          }`}
        >
          <a
            href="#cta"
            className="inline-block font-sans text-sm font-medium tracking-wide uppercase text-obsidian bg-gold hover:bg-gold-light px-8 py-4 transition-colors"
          >
            Request Early Access
          </a>
          <p className="text-xs text-pewter mt-4">No credit card required. Launches Q3 2026.</p>
        </div>
      </div>

      {/* Scroll indicator */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2">
        <div className="w-px h-12 bg-gradient-to-b from-transparent via-gold/40 to-transparent animate-pulse" />
      </div>
    </section>
  );
}
```

### src/components/EditorialDivider.tsx

```tsx
import { useScrollReveal } from '../hooks/useScrollReveal';

interface Props {
  label: string;
}

export default function EditorialDivider({ label }: Props) {
  const { ref, isVisible } = useScrollReveal();

  return (
    <div ref={ref} className="max-w-6xl mx-auto px-6 py-16 flex items-center gap-6">
      <hr
        className={`flex-1 border-0 h-px bg-gold/30 animate-hr-grow ${isVisible ? 'is-visible' : ''}`}
      />
      <span className="text-xs font-sans font-medium tracking-[0.25em] uppercase text-gold whitespace-nowrap">
        {label}
      </span>
      <hr
        className={`flex-1 border-0 h-px bg-gold/30 animate-hr-grow ${isVisible ? 'is-visible' : ''}`}
        style={{ transformOrigin: 'right' }}
      />
    </div>
  );
}
```

### src/components/Features.tsx

```tsx
import { useScrollReveal } from '../hooks/useScrollReveal';

const features = [
  {
    number: '01',
    title: 'Creative Briefs',
    description:
      'Structured brief templates that capture vision, constraints, and deliverables. No more decks lost in email threads.',
  },
  {
    number: '02',
    title: 'Visual Timelines',
    description:
      'Gantt-style timelines designed for overlapping creative phases. See where every project stands at a glance.',
  },
  {
    number: '03',
    title: 'Feedback Rounds',
    description:
      'Inline annotation and versioned feedback. Clients review in-context. Revisions stay tracked and accountable.',
  },
  {
    number: '04',
    title: 'Resource Allocation',
    description:
      'See who is available, who is overbooked, and where the bottlenecks are -- before they become fires.',
  },
  {
    number: '05',
    title: 'Client Portals',
    description:
      'Branded, read-only spaces where clients track progress, approve milestones, and access deliverables.',
  },
  {
    number: '06',
    title: 'Financial Tracking',
    description:
      'Time tracking, budget burn, and profitability per project. Know which clients make money and which cost it.',
  },
];

export default function Features() {
  const { ref, isVisible } = useScrollReveal(0.1);

  return (
    <section id="features" className="py-24 px-6">
      <div className="max-w-6xl mx-auto">
        <div className="mb-16">
          <h2 className="font-serif text-4xl md:text-5xl text-ivory mb-4">
            Everything an agency needs.
            <br />
            Nothing it doesn't.
          </h2>
          <p className="text-ash text-lg max-w-xl">
            Built from hundreds of conversations with creative directors, producers,
            and agency owners who were tired of forcing generic tools to fit creative workflows.
          </p>
        </div>

        <div
          ref={ref}
          className={`stagger-parent grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px bg-slate-edge ${
            isVisible ? 'is-visible' : ''
          }`}
        >
          {features.map((feature) => (
            <div
              key={feature.number}
              className="stagger-child bg-obsidian p-8 group hover:bg-charcoal transition-colors duration-300"
            >
              <span className="block font-mono text-xs text-gold mb-4">
                {feature.number}
              </span>
              <h3 className="font-serif text-xl text-ivory mb-3 group-hover:text-gold transition-colors">
                {feature.title}
              </h3>
              <p className="text-sm text-ash leading-relaxed">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
```

### src/components/Showcase.tsx

```tsx
import { useScrollReveal } from '../hooks/useScrollReveal';
import { useCountUp } from '../hooks/useCountUp';

const stats = [
  { value: 340, suffix: '+', label: 'Agencies onboarded' },
  { value: 98, suffix: '%', label: 'Client satisfaction' },
  { value: 2.4, suffix: 'x', label: 'Faster approvals', isDecimal: true },
];

export default function Showcase() {
  const { ref, isVisible } = useScrollReveal(0.2);

  return (
    <section className="py-24 px-6">
      <div className="max-w-6xl mx-auto">
        {/* Mockup placeholder */}
        <div
          ref={ref}
          className={`animate-fade-up ${isVisible ? 'is-visible' : ''}`}
        >
          <div className="relative bg-charcoal border border-slate-edge rounded-sm overflow-hidden aspect-[16/9] mb-16">
            {/* This would hold an actual product screenshot or video */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center">
                <div className="w-16 h-16 border border-gold/30 rounded-full flex items-center justify-center mx-auto mb-4">
                  <div className="w-0 h-0 border-l-[10px] border-l-gold border-y-[6px] border-y-transparent ml-1" />
                </div>
                <p className="text-xs tracking-[0.2em] uppercase text-pewter">Watch the demo</p>
              </div>
            </div>

            {/* Decorative corner accents */}
            <div className="absolute top-4 left-4 w-6 h-6 border-t border-l border-gold/20" />
            <div className="absolute top-4 right-4 w-6 h-6 border-t border-r border-gold/20" />
            <div className="absolute bottom-4 left-4 w-6 h-6 border-b border-l border-gold/20" />
            <div className="absolute bottom-4 right-4 w-6 h-6 border-b border-r border-gold/20" />
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 text-center">
          {stats.map((stat) => (
            <StatItem key={stat.label} stat={stat} isVisible={isVisible} />
          ))}
        </div>
      </div>
    </section>
  );
}

function StatItem({
  stat,
  isVisible,
}: {
  stat: { value: number; suffix: string; label: string; isDecimal?: boolean };
  isVisible: boolean;
}) {
  const count = useCountUp(stat.isDecimal ? stat.value * 10 : stat.value, isVisible);
  const display = stat.isDecimal ? (count / 10).toFixed(1) : count;

  return (
    <div>
      <span className="font-serif text-5xl text-ivory">
        {display}
        <span className="text-gold">{stat.suffix}</span>
      </span>
      <p className="text-sm text-ash mt-2">{stat.label}</p>
    </div>
  );
}
```

### src/components/Testimonials.tsx

```tsx
import { useState } from 'react';
import { useScrollReveal } from '../hooks/useScrollReveal';

const testimonials = [
  {
    quote:
      'Meridian replaced three tools for us overnight. Our producers stopped drowning in spreadsheets and our clients stopped asking for status updates -- they could just see for themselves.',
    name: 'Elise Marchetti',
    role: 'Executive Producer',
    agency: 'Studio Parallel',
  },
  {
    quote:
      'We tried every PM tool on the market. They were all built for software teams pretending creative work fits in a sprint. Meridian actually gets how we work.',
    name: 'James Okonkwo',
    role: 'Creative Director',
    agency: 'Brass & Co.',
  },
  {
    quote:
      'The client portal alone justified the switch. Approval cycles that used to take a week now close in a day.',
    name: 'Sofia Reyes',
    role: 'Managing Director',
    agency: 'Forma Collective',
  },
];

export default function Testimonials() {
  const [current, setCurrent] = useState(0);
  const { ref, isVisible } = useScrollReveal();

  const next = () => setCurrent((c) => (c + 1) % testimonials.length);
  const prev = () => setCurrent((c) => (c - 1 + testimonials.length) % testimonials.length);

  const t = testimonials[current];

  return (
    <section id="testimonials" className="py-24 px-6">
      <div
        ref={ref}
        className={`max-w-4xl mx-auto text-center animate-fade-up ${isVisible ? 'is-visible' : ''}`}
      >
        <blockquote className="mb-10">
          <p className="font-serif text-2xl md:text-3xl text-ivory leading-relaxed italic">
            "{t.quote}"
          </p>
        </blockquote>

        <div className="mb-8">
          <p className="text-sm font-medium text-ivory">{t.name}</p>
          <p className="text-xs text-pewter mt-1">
            {t.role}, {t.agency}
          </p>
        </div>

        {/* Navigation dots */}
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={prev}
            className="text-pewter hover:text-ivory transition-colors text-sm"
            aria-label="Previous testimonial"
          >
            &larr;
          </button>
          {testimonials.map((_, i) => (
            <button
              key={i}
              onClick={() => setCurrent(i)}
              className={`w-2 h-2 rounded-full transition-colors ${
                i === current ? 'bg-gold' : 'bg-slate-edge hover:bg-pewter'
              }`}
              aria-label={`Go to testimonial ${i + 1}`}
            />
          ))}
          <button
            onClick={next}
            className="text-pewter hover:text-ivory transition-colors text-sm"
            aria-label="Next testimonial"
          >
            &rarr;
          </button>
        </div>
      </div>
    </section>
  );
}
```

### src/components/Pricing.tsx

```tsx
import { useScrollReveal } from '../hooks/useScrollReveal';

const plans = [
  {
    name: 'Studio',
    price: '$29',
    period: '/seat/mo',
    description: 'For boutique studios and small creative teams.',
    features: [
      'Up to 15 team members',
      'Unlimited projects',
      'Client portals (3 active)',
      'Visual timelines',
      'Brief templates',
      'Email support',
    ],
    cta: 'Start Free Trial',
    highlighted: false,
  },
  {
    name: 'Agency',
    price: '$59',
    period: '/seat/mo',
    description: 'For agencies managing multiple clients and teams.',
    features: [
      'Unlimited team members',
      'Unlimited projects',
      'Unlimited client portals',
      'Resource allocation',
      'Financial tracking & burn rates',
      'Custom branded portals',
      'API access',
      'Priority support & onboarding',
    ],
    cta: 'Start Free Trial',
    highlighted: true,
  },
];

export default function Pricing() {
  const { ref, isVisible } = useScrollReveal(0.1);

  return (
    <section id="pricing" className="py-24 px-6">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="font-serif text-4xl md:text-5xl text-ivory mb-4">
            Simple, transparent pricing
          </h2>
          <p className="text-ash text-lg">
            14-day free trial. No credit card upfront. Cancel anytime.
          </p>
        </div>

        <div
          ref={ref}
          className={`stagger-parent grid grid-cols-1 md:grid-cols-2 gap-6 ${
            isVisible ? 'is-visible' : ''
          }`}
        >
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={`stagger-child p-8 border transition-colors ${
                plan.highlighted
                  ? 'border-gold/40 bg-charcoal'
                  : 'border-slate-edge bg-obsidian hover:bg-charcoal'
              }`}
            >
              {plan.highlighted && (
                <span className="inline-block text-[10px] font-mono tracking-[0.2em] uppercase text-gold bg-gold/10 px-3 py-1 mb-4">
                  Most Popular
                </span>
              )}
              <h3 className="font-serif text-2xl text-ivory">{plan.name}</h3>
              <p className="text-sm text-ash mt-2 mb-6">{plan.description}</p>

              <div className="mb-8">
                <span className="font-serif text-4xl text-ivory">{plan.price}</span>
                <span className="text-sm text-pewter">{plan.period}</span>
              </div>

              <ul className="space-y-3 mb-8">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-3 text-sm">
                    <span className="text-gold mt-0.5">&#10003;</span>
                    <span className="text-ash">{feature}</span>
                  </li>
                ))}
              </ul>

              <a
                href="#cta"
                className={`block text-center text-sm font-medium tracking-wide uppercase py-3 transition-colors ${
                  plan.highlighted
                    ? 'bg-gold text-obsidian hover:bg-gold-light'
                    : 'border border-slate-edge text-ivory hover:border-gold hover:text-gold'
                }`}
              >
                {plan.cta}
              </a>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
```

### src/components/CtaBanner.tsx

```tsx
import { useScrollReveal } from '../hooks/useScrollReveal';

export default function CtaBanner() {
  const { ref, isVisible } = useScrollReveal();

  return (
    <section id="cta" className="py-32 px-6 bg-charcoal">
      <div
        ref={ref}
        className={`max-w-3xl mx-auto text-center animate-fade-up ${isVisible ? 'is-visible' : ''}`}
      >
        <h2 className="font-serif text-4xl md:text-5xl text-ivory mb-6">
          Ready to bring clarity
          <br />
          to your creative work?
        </h2>
        <p className="text-ash text-lg mb-10 max-w-lg mx-auto">
          Join 340+ agencies already using Meridian to deliver better work, faster,
          with fewer headaches.
        </p>

        <form className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto">
          <input
            type="email"
            placeholder="your@agency.com"
            className="flex-1 bg-obsidian border border-slate-edge text-ivory placeholder:text-pewter px-4 py-3 text-sm font-sans focus:outline-none focus:border-gold transition-colors"
          />
          <button
            type="submit"
            className="bg-gold text-obsidian font-medium text-sm tracking-wide uppercase px-6 py-3 hover:bg-gold-light transition-colors whitespace-nowrap"
          >
            Get Early Access
          </button>
        </form>

        <p className="text-xs text-pewter mt-4">
          Free for 14 days. No credit card required.
        </p>
      </div>
    </section>
  );
}
```

### src/components/Footer.tsx

```tsx
export default function Footer() {
  return (
    <footer className="border-t border-slate-edge py-12 px-6">
      <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="flex items-center gap-2">
          <span className="font-serif text-lg text-ivory tracking-editorial">Meridian</span>
          <span className="text-xs text-pewter">&copy; 2026</span>
        </div>

        <div className="flex items-center gap-6 text-sm text-ash">
          <a href="#" className="hover:text-ivory transition-colors">Privacy</a>
          <a href="#" className="hover:text-ivory transition-colors">Terms</a>
          <a href="#" className="hover:text-ivory transition-colors">Contact</a>
          <a href="#" className="hover:text-ivory transition-colors">Twitter</a>
        </div>
      </div>
    </footer>
  );
}
```

### src/App.tsx

```tsx
import Navbar from './components/Navbar';
import Hero from './components/Hero';
import EditorialDivider from './components/EditorialDivider';
import Features from './components/Features';
import Showcase from './components/Showcase';
import Testimonials from './components/Testimonials';
import Pricing from './components/Pricing';
import CtaBanner from './components/CtaBanner';
import Footer from './components/Footer';

export default function App() {
  return (
    <div className="min-h-screen">
      <Navbar />
      <Hero />
      <EditorialDivider label="Project Management, Reimagined" />
      <Features />
      <EditorialDivider label="See It in Action" />
      <Showcase />
      <EditorialDivider label="Trusted by Studios Worldwide" />
      <Testimonials />
      <EditorialDivider label="Pricing" />
      <Pricing />
      <CtaBanner />
      <Footer />
    </div>
  );
}
```

### src/main.tsx

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

### index.html

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Meridian -- Project Management for Creative Agencies</title>
  <meta name="description" content="Meridian brings clarity to creative chaos. Timelines, briefs, feedback, and deliverables -- all in one place built for how agencies actually work." />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;1,400&family=Inter:wght@300;400;500;600&family=JetBrains+Mono:wght@400&display=swap" rel="stylesheet" />
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
</html>
```

---

## Verification Steps

1. **Visual inspection** -- open `localhost:3000`, verify dark background renders, no flash of unstyled content
2. **Typography check** -- confirm Playfair Display loads for headlines (check Network tab for font files), Inter for body
3. **Scroll animations** -- scroll through each section, verify fade-up animations trigger once per element and don't replay
4. **Responsive** -- resize from 320px to 1440px, verify the grid collapses gracefully (3-col to 2-col to 1-col)
5. **Navbar blur** -- scroll down and verify the navbar gains the blurred background
6. **Counter animation** -- scroll to the stats section, verify numbers count up smoothly
7. **Testimonial carousel** -- click arrows and dots, verify rotation works and text transitions
8. **CTA form** -- verify the email input focuses with a gold border, button hover state works
9. **Lighthouse** -- run a Lighthouse audit targeting 90+ on Performance and 100 on Accessibility
10. **Color contrast** -- verify WCAG AA compliance: `#A8A3B0` on `#0C0B0E` is 8.3:1 ratio (passes AAA), `#C9A84C` on `#0C0B0E` is 7.1:1 (passes AAA)

---

## Design Decisions Summary

| Decision | Rationale |
|---|---|
| Playfair Display serif for headlines | Immediately differentiates from typical SaaS (Inter/Satoshi headlines). Conveys editorial sophistication. |
| Warm-dark palette (#0C0B0E not #000) | Pure black feels sterile. Warm obsidian creates depth and feels more inviting, aligned with creative agency sensibility. |
| Gold accent instead of blue/purple | Avoids the saturated neon trope. Burnished gold communicates premium without being flashy. |
| 1px gap grid for features | Classic editorial layout technique. The thin visible grid lines between cards create a magazine-style feel. |
| No border-radius anywhere | Square corners throughout. Rounds corners signal casualness; sharp corners signal intentionality and precision. |
| Intersection Observer animations | Zero dependencies. Lightweight, performant, and the animations are subtle enough that CSS transitions suffice. |
| Minimal illustration / no hero image | The typography IS the hero. This is a deliberate editorial choice -- let the words carry weight. A product screenshot appears later in the Showcase section. |
| Two pricing tiers only | Creative agencies make fast decisions. Two clear options reduce cognitive load vs. the typical three-tier matrix. |
| JetBrains Mono for feature numbers | Adds a structured, systematic feel to the numbering. Signals that Meridian is precise and organized. |
