// Unit tests for the shared sidecar build/smoke helpers (pure parts only).
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BANNER_JS, PROLOGUE_MARKERS, assertPrologue, buildOptions } from "./bundle-sidecar.mjs";
import { seaConfig, listFiles } from "./sidecar-assets.mjs";
import { parseListenPort, parseStudioToken, sidecarBinaryPath, targetTriple } from "./smoke-sidecar.mjs";

describe("bundle-sidecar", () => {
  it("banner is the 7-line prologue and carries every marker", () => {
    expect(BANNER_JS.split("\n")).toHaveLength(7);
    for (const m of PROLOGUE_MARKERS) expect(BANNER_JS).toContain(m);
    expect(() => assertPrologue(`${BANNER_JS}\nvar x = 1;`)).not.toThrow();
  });

  it("rejects the cmd.exe-truncated prologue that broke Windows", () => {
    const truncated = "const __sea_pathToFileURL = (() => {\n" + "var x = 1;".repeat(50);
    expect(() => assertPrologue(truncated)).toThrow(/prologue truncated/);
  });

  it("build options match the historical CLI invocation", () => {
    const o = buildOptions("/tmp/out.cjs");
    expect(o).toMatchObject({
      bundle: true,
      platform: "node",
      target: "node22",
      format: "cjs",
      outfile: "/tmp/out.cjs",
      legalComments: "none",
      logLevel: "warning",
    });
    expect(o.external).toEqual(["@napi-rs/keyring", "@napi-rs/keyring-*"]);
    expect(o.define["import.meta.url"]).toBe("__sea_import_meta_url");
    expect(o.define["import.meta.dirname"]).toBe("__dirname");
    expect(o.define["import.meta.filename"]).toBe("__filename");
    expect(o.banner.js).toBe(BANNER_JS);
    expect(o.entryPoints[0].endsWith(path.join("scripts", "desktop", "sidecar-entry.mjs"))).toBe(true);
  });
});

describe("sidecar-assets", () => {
  it("lists files with forward-slash relative paths", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vskill-assets-"));
    fs.mkdirSync(path.join(dir, "assets"));
    fs.writeFileSync(path.join(dir, "index.html"), "");
    fs.writeFileSync(path.join(dir, "assets", "app.js"), "");
    expect(listFiles(dir)).toEqual(["assets/app.js", "index.html"]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("sea-config references bundle, manifest, version and every eval-ui file", () => {
    const cfg = seaConfig({
      sidecarDir: "/r/dist/sidecar",
      evalUiDir: "/r/dist/eval-ui",
      manifest: { "index.html": true, "assets/app.js": true },
    });
    expect(cfg.main).toBe(path.join("/r/dist/sidecar", "server.cjs"));
    expect(cfg.output).toBe(path.join("/r/dist/sidecar", "sea-prep.blob"));
    expect(cfg.useSnapshot).toBe(false);
    expect(cfg.disableExperimentalSEAWarning).toBe(true);
    expect(Object.keys(cfg.assets)).toEqual([
      "eval-ui-manifest.json",
      "vskill-version.txt",
      "eval-ui/index.html",
      "eval-ui/assets/app.js",
    ]);
    expect(cfg.assets["eval-ui/assets/app.js"]).toBe(path.join("/r/dist/eval-ui", "assets", "app.js"));
  });
});

describe("smoke-sidecar", () => {
  it("parses LISTEN_PORT from noisy output and rejects garbage", () => {
    expect(parseListenPort("boot\r\nLISTEN_PORT=49152\r\n  Studio token: abc\n")).toBe(49152);
    expect(parseListenPort("LISTEN_PORT=0")).toBeNull();
    expect(parseListenPort("nothing here")).toBeNull();
  });

  it("parses the studio token banner", () => {
    expect(parseStudioToken("  Studio token: AbC-_123\n")).toBe("AbC-_123");
    expect(parseStudioToken("Studio token:")).toBeNull();
  });

  it("maps host platform to the sidecar binary path", () => {
    expect(sidecarBinaryPath("/r", "win32", "x64")).toBe(
      path.join("/r", "src-tauri", "binaries", "vskill-server-x86_64-pc-windows-msvc.exe"),
    );
    expect(sidecarBinaryPath("/r", "darwin", "arm64")).toBe(
      path.join("/r", "src-tauri", "binaries", "vskill-server-aarch64-apple-darwin"),
    );
    expect(targetTriple("linux", "x64")).toBe("x86_64-unknown-linux-gnu");
    expect(() => targetTriple("linux", "arm64")).toThrow(/no sidecar target triple/);
  });
});
