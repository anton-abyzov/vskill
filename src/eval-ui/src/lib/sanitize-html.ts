/**
 * Strip all HTML tags except <b> and </b> from ts_headline output.
 * Prevents XSS from skill descriptions injected via search highlights.
 *
 * Ported verbatim from vskill-platform/src/lib/sanitize-html.ts (0741 T-004).
 * Used by FindSkillsPalette → SearchPaletteCore in the eval-ui bundle.
 */
export function sanitizeHighlight(html: string): string {
  if (!html) return "";
  return html.replace(/<(?!\/?b>)[^>]+>/gi, "");
}
