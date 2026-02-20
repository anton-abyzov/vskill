import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { discoverAuditFiles } from "./file-discovery.js";
import { createDefaultAuditConfig } from "./audit-types.js";

describe("file-discovery", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "vskill-audit-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("TC-003: discovers .ts, .js, .py files in a directory tree", async () => {
    await mkdir(join(tmpDir, "src"), { recursive: true });
    await writeFile(join(tmpDir, "src", "app.ts"), "const x = 1;");
    await writeFile(join(tmpDir, "src", "utils.js"), "module.exports = {};");
    await writeFile(join(tmpDir, "script.py"), "print('hello')");
    // Non-scannable file
    await writeFile(join(tmpDir, "image.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const config = createDefaultAuditConfig();
    const files = await discoverAuditFiles(tmpDir, config);

    const paths = files.map((f) => f.path).sort();
    expect(paths).toContain("src/app.ts");
    expect(paths).toContain("src/utils.js");
    expect(paths).toContain("script.py");
    expect(paths).not.toContain("image.png");
  });

  it("TC-004: skips node_modules and .git directories", async () => {
    await mkdir(join(tmpDir, "src"), { recursive: true });
    await mkdir(join(tmpDir, "node_modules", "pkg"), { recursive: true });
    await mkdir(join(tmpDir, ".git", "objects"), { recursive: true });

    await writeFile(join(tmpDir, "src", "app.ts"), "const x = 1;");
    await writeFile(join(tmpDir, "node_modules", "pkg", "index.js"), "bad");
    await writeFile(join(tmpDir, ".git", "objects", "data.js"), "bad");

    const config = createDefaultAuditConfig();
    const files = await discoverAuditFiles(tmpDir, config);

    const paths = files.map((f) => f.path);
    expect(paths).toContain("src/app.ts");
    expect(paths).not.toContain("node_modules/pkg/index.js");
    expect(paths).not.toContain(".git/objects/data.js");
  });

  it("TC-005: scans a single file when path points to a file", async () => {
    const filePath = join(tmpDir, "app.ts");
    await writeFile(filePath, "const x = 1;");

    const config = createDefaultAuditConfig();
    const files = await discoverAuditFiles(filePath, config);

    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("app.ts");
    expect(files[0].content).toBe("const x = 1;");
  });

  it("TC-006: respects maxFiles limit", async () => {
    await mkdir(join(tmpDir, "src"), { recursive: true });
    for (let i = 0; i < 10; i++) {
      await writeFile(join(tmpDir, "src", `file${i}.ts`), `const x = ${i};`);
    }

    const config = createDefaultAuditConfig();
    config.maxFiles = 5;
    const files = await discoverAuditFiles(tmpDir, config);

    expect(files.length).toBeLessThanOrEqual(5);
  });

  it("TC-007: skips binary files", async () => {
    await writeFile(join(tmpDir, "text.ts"), "const x = 1;");
    // Create a file with null bytes (binary indicator)
    const binaryContent = Buffer.alloc(100);
    binaryContent[50] = 0; // null byte
    binaryContent.write("const y = 2;", 0);
    await writeFile(join(tmpDir, "binary.ts"), binaryContent);

    const config = createDefaultAuditConfig();
    const files = await discoverAuditFiles(tmpDir, config);

    const paths = files.map((f) => f.path);
    expect(paths).toContain("text.ts");
    expect(paths).not.toContain("binary.ts");
  });

  it("TC-008: respects exclude patterns", async () => {
    await mkdir(join(tmpDir, "src"), { recursive: true });
    await mkdir(join(tmpDir, "test"), { recursive: true });
    await writeFile(join(tmpDir, "src", "app.ts"), "const x = 1;");
    await writeFile(join(tmpDir, "test", "app.test.ts"), "test code");

    const config = createDefaultAuditConfig();
    config.excludePaths = ["**/test/**"];
    const files = await discoverAuditFiles(tmpDir, config);

    const paths = files.map((f) => f.path);
    expect(paths).toContain("src/app.ts");
    expect(paths).not.toContain("test/app.test.ts");
  });

  it("skips dist, build, coverage, .next directories", async () => {
    await mkdir(join(tmpDir, "src"), { recursive: true });
    await mkdir(join(tmpDir, "dist"), { recursive: true });
    await mkdir(join(tmpDir, "build"), { recursive: true });
    await mkdir(join(tmpDir, "coverage"), { recursive: true });
    await mkdir(join(tmpDir, ".next"), { recursive: true });

    await writeFile(join(tmpDir, "src", "app.ts"), "const x = 1;");
    await writeFile(join(tmpDir, "dist", "app.js"), "compiled");
    await writeFile(join(tmpDir, "build", "app.js"), "compiled");
    await writeFile(join(tmpDir, "coverage", "lcov.js"), "data");
    await writeFile(join(tmpDir, ".next", "server.js"), "data");

    const config = createDefaultAuditConfig();
    const files = await discoverAuditFiles(tmpDir, config);

    const paths = files.map((f) => f.path);
    expect(paths).toContain("src/app.ts");
    expect(paths).not.toContain("dist/app.js");
    expect(paths).not.toContain("build/app.js");
    expect(paths).not.toContain("coverage/lcov.js");
    expect(paths).not.toContain(".next/server.js");
  });

  it("respects maxFileSize limit", async () => {
    await writeFile(join(tmpDir, "small.ts"), "x");
    // Create a file larger than default maxFileSize
    const largeContent = "x".repeat(200 * 1024);
    await writeFile(join(tmpDir, "large.ts"), largeContent);

    const config = createDefaultAuditConfig();
    const files = await discoverAuditFiles(tmpDir, config);

    const paths = files.map((f) => f.path);
    expect(paths).toContain("small.ts");
    expect(paths).not.toContain("large.ts");
  });
});
