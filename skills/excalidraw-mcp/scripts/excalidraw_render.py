#!/usr/bin/env python3
"""Render a .excalidraw scene to PNG/SVG so you can LOOK at it before shipping.

The linter checks geometry arithmetic; this checks reality. It drives Excalidraw's
own `exportToSvg`, so text is measured with the real Excalifont metrics rather than
our calibrated estimate — the one way to be certain a label actually fits.

    python3 excalidraw_render.py diagram.excalidraw -o /tmp/preview.png
    python3 excalidraw_render.py diagram.excalidraw.md -o /tmp/preview.svg --svg

Requires: `pip install playwright && playwright install chromium`, plus network
access to esm.sh on first run. If either is missing the script says so and exits 2 —
fall back to excalidraw_lint.py, which is offline and dependency-free.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from excalidraw_lint import load  # noqa: E402

TEMPLATE = """<!doctype html>
<html><head><meta charset="utf-8">
<style>html,body{margin:0;background:%(bg)s}#root{display:inline-block}</style>
</head><body><div id="root"></div>
<script type="module">
  import { exportToSvg } from "https://esm.sh/@excalidraw/excalidraw@0.18.0";
  window.__render = async (elements, appState) => {
    const svg = await exportToSvg({
      elements, appState: { ...appState, exportBackground: true, exportWithDarkMode: %(dark)s },
      files: {}, exportPadding: 24,
    });
    document.getElementById("root").appendChild(svg);
    // fonts load async; give them a beat so text metrics settle
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    window.__done = true;
  };
  window.__moduleReady = true;
</script></body></html>
"""


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("path")
    ap.add_argument("-o", "--out", required=True)
    ap.add_argument("--svg", action="store_true", help="write SVG markup instead of PNG")
    ap.add_argument("--dark", action="store_true")
    ap.add_argument("--timeout", type=int, default=45000)
    args = ap.parse_args()

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("playwright not installed: pip install playwright && playwright install chromium",
              file=sys.stderr)
        return 2

    elements, skeleton = load(Path(args.path))
    if skeleton:
        from excalidraw_build import Builder
        elements = Builder(elements, dark=args.dark).build()

    html = TEMPLATE % {"bg": "#121212" if args.dark else "#ffffff",
                       "dark": "true" if args.dark else "false"}
    tmp = Path(args.out).with_suffix(".render.html")
    tmp.write_text(html)

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page(viewport={"width": 1600, "height": 1200},
                                    device_scale_factor=2)
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto(tmp.as_uri())
            try:
                page.wait_for_function("window.__moduleReady === true", timeout=args.timeout)
            except Exception:
                print("could not load @excalidraw/excalidraw from esm.sh (offline?); "
                      "use excalidraw_lint.py instead", file=sys.stderr)
                return 2
            page.evaluate("([els, st]) => window.__render(els, st)",
                          [elements, {"viewBackgroundColor": "#121212" if args.dark else "#ffffff"}])
            page.wait_for_function("window.__done === true", timeout=args.timeout)
            if errors:
                print("page errors:", "; ".join(errors[:3]), file=sys.stderr)

            if args.svg:
                svg = page.eval_on_selector("#root svg", "el => el.outerHTML")
                Path(args.out).write_text(svg)
            else:
                page.locator("#root svg").screenshot(path=args.out)
            browser.close()
    finally:
        tmp.unlink(missing_ok=True)

    print(f"{args.out}  ({len(elements)} elements)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
