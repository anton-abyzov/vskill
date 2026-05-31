// 0857 — cross-surface default-model invariant.
//
// The CLI eval path (createClaudeCliClient, via createLlmClient) and the Studio
// path (PROVIDER_MODELS["claude-cli"][0], consumed by getEffectiveRawModel)
// INTENTIONALLY default to different claude-cli aliases:
//
//   • CLI    default → "sonnet"  (cheaper; eval runs can be many)
//   • Studio default → "opus"    (Opus-first picker, models[0])
//
// This divergence is deliberate but easy to flip by accident. This test locks
// BOTH values so the divergence stays visible and tested rather than silently
// drifting into agreement (or into a different pair).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createLlmClient } from "../llm.js";
import { PROVIDER_MODELS } from "../../eval-server/api-routes.js";

describe("cross-surface claude-cli default model invariant (0857)", () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.VSKILL_EVAL_PROVIDER;
    delete process.env.VSKILL_EVAL_MODEL;
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it("CLI claude-cli default alias is 'sonnet'", () => {
    const client = createLlmClient({ provider: "claude-cli" });
    expect(client.model).toBe("sonnet");
  });

  it("Studio claude-cli default alias (PROVIDER_MODELS[0]) is 'opus'", () => {
    expect(PROVIDER_MODELS["claude-cli"][0].id).toBe("opus");
  });

  it("the two surfaces intentionally diverge (sonnet vs opus)", () => {
    const cliDefault = createLlmClient({ provider: "claude-cli" }).model;
    const studioDefault = PROVIDER_MODELS["claude-cli"][0].id;
    expect(cliDefault).toBe("sonnet");
    expect(studioDefault).toBe("opus");
    expect(cliDefault).not.toBe(studioDefault);
  });
});
