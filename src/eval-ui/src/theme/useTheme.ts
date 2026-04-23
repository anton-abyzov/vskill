import { useContext } from "react";
import { ThemeContext, type ThemeContextValue } from "./ThemeProvider";

/**
 * Access the current theme state. Must be called inside a `<ThemeProvider>`.
 * Throws if the provider is missing so bugs surface loudly instead of
 * falling back to an unexpected default.
 */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error(
      "useTheme must be used inside <ThemeProvider>. Wrap the app root in main.tsx.",
    );
  }
  return ctx;
}
