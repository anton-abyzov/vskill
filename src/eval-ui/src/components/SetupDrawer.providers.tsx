// ---------------------------------------------------------------------------
// 0686 T-011 (US-005): Per-provider SetupDrawer content registry.
//
// The drawer shell (SetupDrawer.tsx) looks up a provider key and renders
// the matching content block from this registry. Each entry is a pure
// data definition so the shell can render it without a per-provider
// React component — keeps the diff tight, preserves i18n migration path,
// and lets tests inspect the exact rendered body with one assertion.
//
// Provider keys map to `strings.setupProviders` in strings.ts so copy and
// URLs stay tokenised. The 7 providers on initial ship per AC-US5-03 are:
//   anthropic-api, openai, openrouter, gemini, ollama, lm-studio, claude-code
// ---------------------------------------------------------------------------

import { strings } from "../strings";

export type SetupProviderKey =
  | "anthropic-api"
  | "openai"
  | "openrouter"
  | "gemini"
  | "ollama"
  | "lm-studio"
  | "claude-code";

export interface SetupProviderContent {
  /** Display name rendered in the drawer title. */
  name: string;
  /** 1-sentence "what this is" body text (AC-US5-04 (a)). */
  description: string;
  /** Required env var names rendered as monospace chips with copy buttons. */
  envVars: readonly string[];
  /** External URL to the provider's API-key console (AC-US5-05). */
  keyUrl?: string;
  /** Optional bash code blocks for local providers — install, start, pull. */
  install?: readonly string[];
  start?: readonly string[];
  pullExample?: string;
  /** Extra one-line notes rendered after the description (e.g. Claude Code's
   *  "login if not logged in" hint). */
  notes?: readonly string[];
  /** Learn-more footer URL (opens in a new tab, rel=noopener noreferrer). */
  learnMoreUrl: string;
}

export const SETUP_PROVIDER_CONTENT: Record<SetupProviderKey, SetupProviderContent> = {
  "anthropic-api": {
    name: strings.setupProviders.anthropic.name,
    description: strings.setupProviders.anthropic.description,
    envVars: strings.setupProviders.anthropic.envVars,
    keyUrl: strings.setupProviders.anthropic.keyUrl,
    learnMoreUrl: strings.setupProviders.anthropic.learnMoreUrl,
  },
  openai: {
    name: strings.setupProviders.openai.name,
    description: strings.setupProviders.openai.description,
    envVars: strings.setupProviders.openai.envVars,
    keyUrl: strings.setupProviders.openai.keyUrl,
    learnMoreUrl: strings.setupProviders.openai.learnMoreUrl,
  },
  openrouter: {
    name: strings.setupProviders.openrouter.name,
    description: strings.setupProviders.openrouter.description,
    envVars: strings.setupProviders.openrouter.envVars,
    keyUrl: strings.setupProviders.openrouter.keyUrl,
    learnMoreUrl: strings.setupProviders.openrouter.learnMoreUrl,
  },
  gemini: {
    name: strings.setupProviders.gemini.name,
    description: strings.setupProviders.gemini.description,
    envVars: strings.setupProviders.gemini.envVars,
    keyUrl: strings.setupProviders.gemini.keyUrl,
    learnMoreUrl: strings.setupProviders.gemini.learnMoreUrl,
  },
  ollama: {
    name: strings.setupProviders.ollama.name,
    description: strings.setupProviders.ollama.description,
    envVars: strings.setupProviders.ollama.envVars,
    install: [strings.setupProviders.ollama.installCmd],
    start: [strings.setupProviders.ollama.startCmd],
    pullExample: strings.setupProviders.ollama.pullExample,
    learnMoreUrl: strings.setupProviders.ollama.learnMoreUrl,
  },
  "lm-studio": {
    name: strings.setupProviders.lmStudio.name,
    description: strings.setupProviders.lmStudio.description,
    envVars: strings.setupProviders.lmStudio.envVars,
    install: [strings.setupProviders.lmStudio.installCmd],
    start: [strings.setupProviders.lmStudio.startCmd],
    pullExample: strings.setupProviders.lmStudio.pullExample,
    learnMoreUrl: strings.setupProviders.lmStudio.learnMoreUrl,
  },
  "claude-code": {
    name: strings.setupProviders.claudeCode.name,
    description: strings.setupProviders.claudeCode.description,
    envVars: [],
    notes: [
      strings.setupProviders.claudeCode.loginHint,
      // AC-US6-01 "verified label" must appear in the claude-code drawer so the
      // user sees the same billing copy here as on the picker row.
      strings.claudeCodeLabel.compactLabel,
    ],
    learnMoreUrl: strings.setupProviders.claudeCode.learnMoreUrl,
  },
};

/** Returns the content for the given key or `null` when unknown. Callers
 *  in non-production builds should hit the dev-time assertion in
 *  `useSetupDrawer.open()` long before reaching this fallback. */
export function lookupSetupProvider(
  key: string | null | undefined,
): SetupProviderContent | null {
  if (!key) return null;
  const content = SETUP_PROVIDER_CONTENT[key as SetupProviderKey];
  return content ?? null;
}
