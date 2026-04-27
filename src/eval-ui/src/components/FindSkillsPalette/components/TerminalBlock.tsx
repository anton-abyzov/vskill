// 0741 T-007: Ported from vskill-platform/src/app/components/TerminalBlock.tsx.
// Terminal-style code display block (black bg, mono text).

import type { ReactNode } from "react";

interface TerminalBlockProps {
  children: ReactNode;
  compact?: boolean;
}

export default function TerminalBlock({ children, compact }: TerminalBlockProps) {
  return (
    <pre
      data-testid="terminal-block"
      style={{
        // 0784: --bg-code is not defined in eval-ui's globals — without a
        // fallback the block rendered with NO background, leaving #E6EDF3
        // text on the white surface (effectively invisible). Hardcoded #161B22
        // as the fallback so the terminal block is always readable.
        background: "var(--bg-code, #161B22)",
        color: "#E6EDF3",
        fontFamily: "var(--font-geist-mono)",
        fontSize: compact ? "0.8rem" : "0.875rem",
        lineHeight: 1.6,
        padding: compact ? "1rem 1.25rem" : "1.5rem 2rem",
        borderRadius: "6px",
        overflowX: "auto",
        margin: 0,
      }}
    >
      {children}
    </pre>
  );
}
