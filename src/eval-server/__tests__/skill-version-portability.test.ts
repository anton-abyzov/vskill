import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Router } from "../router.js";
import { registerRoutes, buildSkillMetadata, parseSkillFrontmatter } from "../api-routes.js";
import { registerSkillCreateRoutes } from "../skill-create-routes.js";
import { computeSavePayload } from "../../eval-ui/src/utils/computeSavePayload.js";
import { getFrontmatterVersion } from "../../eval-ui/src/utils/setFrontmatterVersion.js";
import { extractFrontmatterVersion, setFrontmatterVersion } from "../../utils/version.js";
import { upsertFrontmatterVersion } from "../../lib/frontmatter.js";
import { studioTokenHeaders } from "./helpers/studio-token-test-helpers.js";

describe("portable skill version lifecycle", () => {
  let root: string;
  let server: Server;
  let url: string;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "vskill-version-portability-"));
    const router = new Router();
    registerRoutes(router, root);
    registerSkillCreateRoutes(router, root);
    server = createServer((req, res) => { void router.handle(req, res); });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    rmSync(root, { recursive: true, force: true });
  });

  it("creates, editor-saves, reads and publishes metadata.version without introducing a root version", async () => {
    const headers = { "content-type": "application/json", ...studioTokenHeaders() };
    const created = await fetch(`${url}/api/skills/create`, {
      method: "POST", headers,
      body: JSON.stringify({
        name: "portable-version", plugin: "demo", layout: 1, engine: "none",
        description: "Check portable skill versions.", body: "# Portable version\n\nOriginal body.",
      }),
    });
    expect(created.status).toBe(201);
    const { skillMdPath, dir } = await created.json() as { skillMdPath: string; dir: string };
    const original = readFileSync(skillMdPath, "utf8");
    expect(original).toContain('metadata:\n  version: "1.0.0"');
    expect(original).not.toMatch(/^version:/m);
    expect(getFrontmatterVersion(original)).toBe("1.0.0");

    const payload = computeSavePayload(original.replace("Original body.", "Edited body."), original);
    expect(payload.version).toBe("1.0.1");
    const saved = await fetch(`${url}/api/skills/demo/portable-version/file`, {
      method: "PUT", headers,
      body: JSON.stringify({ path: "SKILL.md", content: payload.contentToSave }),
    });
    expect(saved.status).toBe(200);
    await saved.text();
    const readback = await fetch(`${url}/api/skills/demo/portable-version/file?path=SKILL.md`, { headers });
    const { content } = await readback.json() as { content: string };
    expect(content).toBe(payload.contentToSave);
    expect(content).toContain("Edited body.");
    expect(content).not.toMatch(/^version:/m);
    expect(extractFrontmatterVersion(content)).toBe("1.0.1");
    expect(buildSkillMetadata(dir, "source", root).version).toBe("1.0.1");
    expect(parseSkillFrontmatter(content).metadata).toEqual({ version: "1.0.1" });

    // Server improvement/update and successful registry writeback must retain
    // the portable shape created by Studio, too.
    const improved = setFrontmatterVersion(content, "1.0.2");
    const published = upsertFrontmatterVersion(improved, "1.0.3");
    expect(published).not.toMatch(/^version:/m);
    expect(extractFrontmatterVersion(published)).toBe("1.0.3");
    expect(getFrontmatterVersion(published)).toBe("1.0.3");
    expect(parseSkillFrontmatter(published).metadata).toEqual({ version: "1.0.3" });
  });
});
