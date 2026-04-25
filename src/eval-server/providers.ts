// ---------------------------------------------------------------------------
// providers.ts — Single source of truth for provider metadata.
//
// Consumed by:
//   - settings-store (save/read/merge iteration)
//   - api-routes::detectAvailableProviders
//   - src/cli/keys-command (Phase 3)
//   - src/eval-ui/src/components/SettingsModal (Phase 5)
//   - src/cli/first-run (Phase 4)
// ---------------------------------------------------------------------------

export interface ProviderDescriptor {
  readonly id: "anthropic" | "openai" | "openrouter";
  readonly envVarName: string;
  readonly keyPrefix: string;
  readonly keyIssuanceUrl: string;
  readonly label: string;
}

export const PROVIDERS: readonly ProviderDescriptor[] = [
  {
    id: "anthropic",
    envVarName: "ANTHROPIC_API_KEY",
    keyPrefix: "sk-ant-",
    // 0682 F-001 (review iter 2): platform.claude.com is the post-T-014
    // canonical host. UI strings.ts already moved; this server descriptor
    // is consumed by the `vskill keys` CLI, so the two surfaces must agree.
    keyIssuanceUrl: "https://platform.claude.com/settings/keys",
    label: "Anthropic",
  },
  {
    id: "openai",
    envVarName: "OPENAI_API_KEY",
    keyPrefix: "sk-",
    keyIssuanceUrl: "https://platform.openai.com/api-keys",
    label: "OpenAI",
  },
  {
    id: "openrouter",
    envVarName: "OPENROUTER_API_KEY",
    keyPrefix: "sk-or-",
    keyIssuanceUrl: "https://openrouter.ai/keys",
    label: "OpenRouter",
  },
] as const;

export type ProviderId = (typeof PROVIDERS)[number]["id"];

export function getProviderById(id: ProviderId): ProviderDescriptor {
  const p = PROVIDERS.find((x) => x.id === id);
  if (!p) throw new Error(`unknown provider: ${id}`);
  return p;
}

export function isProviderId(id: string): id is ProviderId {
  return PROVIDERS.some((p) => p.id === id);
}
