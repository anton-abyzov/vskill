// ---------------------------------------------------------------------------
// formatCost.ts -- consistent cost and token formatting across dashboard
// ---------------------------------------------------------------------------

/**
 * Format a cost value for display.
 *
 * @param cost - Dollar cost (null = unavailable)
 * @param billingMode - "per-token" | "subscription" | "free"
 * @returns Formatted string: "$0.0042", "N/A", "Free", "Included"
 *
 * 0682 AC-US5-01 / F-003: the user-facing return value for the
 * subscription-billing case is "Included" (per Anthropic's April 2026 ToS
 * reframe — the picker copy avoids "Max/Pro" / "subscription"). The internal
 * billingMode comparison is allowed because it's a programmer-side enum
 * matched against ModelEntry["billingMode"], not user-rendered copy.
 */
export function formatCost(cost: number | null, billingMode?: string): string {
  if (billingMode === "free") return "Free";
  if (billingMode === "subscription" && cost == null) return "Included"; // voice-allow — internal enum compare; return is user-facing copy
  if (cost == null) return "N/A";

  if (cost >= 1) {
    return `$${cost.toFixed(2)}`;
  }
  if (cost === 0) {
    return "$0.00";
  }
  if (cost >= 0.001) {
    return `$${cost.toFixed(4)}`;
  }
  // Very small costs — use toPrecision for significant digits, strip trailing zeros
  const str = cost.toPrecision(3).replace(/0+$/, "").replace(/\.$/, "");
  return `$${str}`;
}

/**
 * Format input/output token counts for display.
 *
 * @returns "1,234 in / 567 out" or "N/A"
 */
export function formatTokens(input: number | null, output: number | null): string {
  if (input == null || output == null) return "N/A";
  return `${input.toLocaleString("en-US")} in / ${output.toLocaleString("en-US")} out`;
}
