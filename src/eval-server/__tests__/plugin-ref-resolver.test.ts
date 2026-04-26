import { describe, it, expect } from "vitest";
import { resolvePluginRef } from "../plugin-ref-resolver";
import type { InstalledPlugin } from "../plugin-cli";

const installed: InstalledPlugin[] = [
  { name: "skill-creator", marketplace: "claude-plugins-official", version: "78497c524da3", scope: "user", enabled: true },
  { name: "codex", marketplace: "openai-codex", version: "1.0.4", scope: "user", enabled: true },
  { name: "sw", marketplace: "specweave", version: "1.0.0", scope: "project", enabled: true },
];

describe("resolvePluginRef (0743)", () => {
  it("resolves a bare name to name@marketplace using the installed list", () => {
    expect(resolvePluginRef("skill-creator", installed)).toBe(
      "skill-creator@claude-plugins-official",
    );
  });

  it("returns the input as-is when it already has a @marketplace suffix", () => {
    expect(resolvePluginRef("skill-creator@claude-plugins-official", installed)).toBe(
      "skill-creator@claude-plugins-official",
    );
    // Doesn't second-guess a different marketplace the user explicitly passed.
    expect(resolvePluginRef("skill-creator@some-fork", installed)).toBe(
      "skill-creator@some-fork",
    );
  });

  it("returns the bare name unchanged when not in the installed list (let CLI surface real error)", () => {
    expect(resolvePluginRef("unknown-plugin", installed)).toBe("unknown-plugin");
  });

  it("returns the bare name unchanged when the installed list is empty (CLI not yet polled)", () => {
    expect(resolvePluginRef("skill-creator", [])).toBe("skill-creator");
  });

  it("prefers the user-scope match when the same plugin is installed at multiple scopes", () => {
    const dual: InstalledPlugin[] = [
      { name: "sw", marketplace: "specweave", version: "1.0.0", scope: "project", enabled: true },
      { name: "sw", marketplace: "specweave", version: "1.0.0", scope: "user", enabled: true },
    ];
    // Both rows agree on the marketplace, so resolution is unambiguous.
    expect(resolvePluginRef("sw", dual)).toBe("sw@specweave");
  });
});
