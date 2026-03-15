import type { EvalVerdict } from "../../../eval/verdict.js";

export interface VerdictStyle {
  bg: string;
  text: string;
  border: string;
  glow: string;
  label: string;
}

export const VERDICT_STYLES: Record<EvalVerdict, VerdictStyle> = {
  EFFECTIVE: {
    bg: "var(--green-muted)",
    text: "var(--green)",
    border: "var(--green)",
    glow: "rgba(52,211,153,0.15)",
    label: "Effective",
  },
  MARGINAL: {
    bg: "var(--yellow-muted)",
    text: "var(--yellow)",
    border: "var(--yellow)",
    glow: "rgba(251,191,36,0.15)",
    label: "Marginal",
  },
  INEFFECTIVE: {
    bg: "rgba(251,146,60,0.12)",
    text: "var(--orange)",
    border: "var(--orange)",
    glow: "rgba(251,146,60,0.15)",
    label: "Ineffective",
  },
  EMERGING: {
    bg: "rgba(34,211,238,0.12)",
    text: "var(--cyan, #22d3ee)",
    border: "var(--cyan, #22d3ee)",
    glow: "rgba(34,211,238,0.15)",
    label: "Emerging",
  },
  DEGRADING: {
    bg: "var(--red-muted)",
    text: "var(--red)",
    border: "var(--red)",
    glow: "rgba(248,113,113,0.15)",
    label: "Degrading",
  },
};
