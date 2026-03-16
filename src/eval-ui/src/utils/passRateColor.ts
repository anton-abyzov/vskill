/** Map a 0-1 pass rate to a CSS color variable. */
export function passRateColor(passRate: number | undefined | null): string {
  if (passRate == null) return "var(--text-tertiary)";
  if (passRate >= 0.7) return "var(--green)";
  if (passRate >= 0.4) return "var(--yellow)";
  return "var(--red)";
}

/** Map a 0-1 pass rate to a muted CSS background variable. */
export function passRateBackground(passRate: number | undefined | null): string {
  if (passRate == null) return "var(--surface-3)";
  if (passRate >= 0.7) return "var(--green-muted)";
  if (passRate >= 0.4) return "var(--yellow-muted)";
  return "var(--red-muted)";
}
