// ---------------------------------------------------------------------------
// 0688 T-019: FLIP motion helper (First / Last / Invert / Play).
//
// Captures a skill row's bounding rect before a scope transfer, then after
// the list re-renders at its new position, animates it from the old rect
// back to the new one (translate invert), followed by a short pulse.
//
// Rows must carry `data-skill-id="<plugin>/<skill>"`. Respects
// `prefers-reduced-motion: reduce` — when the user opts out, we no-op.
// ---------------------------------------------------------------------------

type SkillRef = { plugin: string; skill: string };

function selectorFor(ref: SkillRef): string {
  return `[data-skill-id="${ref.plugin}/${ref.skill}"]`;
}

export function captureRect(ref: SkillRef): DOMRect | null {
  if (typeof document === "undefined") return null;
  const el = document.querySelector<HTMLElement>(selectorFor(ref));
  return el ? el.getBoundingClientRect() : null;
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function runFlip(ref: SkillRef, first: DOMRect | null): void {
  if (!first) return;
  if (prefersReducedMotion()) return;
  if (typeof document === "undefined") return;

  const el = document.querySelector<HTMLElement>(selectorFor(ref));
  if (!el) return;

  const last = el.getBoundingClientRect();
  const dx = first.left - last.left;
  const dy = first.top - last.top;
  if (dx === 0 && dy === 0) return;

  const flight = el.animate(
    [
      { transform: `translate(${dx}px, ${dy}px)` },
      { transform: "translate(0, 0)" },
    ],
    { duration: 350, easing: "cubic-bezier(.2,.8,.2,1)", fill: "none" },
  );

  const onFlightFinish = () => {
    el.animate(
      [
        { boxShadow: "0 0 0 3px var(--color-own)" },
        { boxShadow: "0 0 0 0 transparent" },
      ],
      { duration: 150, easing: "ease-out", fill: "none" },
    );
  };

  if (flight) {
    (flight as Animation).onfinish = onFlightFinish;
  }
}
