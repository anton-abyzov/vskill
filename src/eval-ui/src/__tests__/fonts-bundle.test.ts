import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(__dirname, "../../../..");
const viteConfigPath = resolve(repoRoot, "src/eval-ui/vite.config.ts");
const packageJsonPath = resolve(repoRoot, "package.json");

describe("T-001: fonts bundling (AC-US2-01)", () => {
  it("declares the three @fontsource-variable packages as devDependencies", () => {
    const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    const devDeps = pkg.devDependencies ?? {};
    expect(devDeps["@fontsource-variable/source-serif-4"]).toBeDefined();
    expect(devDeps["@fontsource-variable/inter-tight"]).toBeDefined();
    expect(devDeps["@fontsource-variable/jetbrains-mono"]).toBeDefined();
  });

  it("routes fontsource packages to a dedicated 'fonts' manualChunk in vite.config.ts", () => {
    const config = readFileSync(viteConfigPath, "utf8");
    expect(config).toMatch(/manualChunks/);
    expect(config).toMatch(/['"]fonts['"]/);
    expect(config).toMatch(/@fontsource-variable/);
  });
});
