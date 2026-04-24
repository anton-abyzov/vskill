// ---------------------------------------------------------------------------
// boot-ordering.test.ts — T-020 (0702 Phase 2).
//
// Contract: importing eval-server.ts must run `mergeStoredKeysIntoEnv()`
// BEFORE any module that reads `process.env.*_API_KEY` at import time.
//
// Verified by spawning a fresh `node` (via `tsx`) subprocess with:
//   - VSKILL_CONFIG_DIR pointing to a tmp dir that contains a keys.env
//     with ANTHROPIC_API_KEY=sk-ant-BOOTORDER1234
//   - no ANTHROPIC_API_KEY in the inherited env
// The subprocess imports eval-server.ts purely for its side effects, then
// prints `process.env.ANTHROPIC_API_KEY` on stdout and exits. If the merge
// ran first, the value is present; otherwise it is `undefined`.
// ---------------------------------------------------------------------------

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

function makeTmpConfigDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vskill-bootord-"));
  fs.writeFileSync(
    path.join(dir, "keys.env"),
    "# boot-ordering canary\nANTHROPIC_API_KEY=sk-ant-BOOTORDER1234\n",
    { mode: 0o600 },
  );
  return dir;
}

function cleanup(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

describe("boot-ordering — eval-server import (T-020)", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTmpConfigDir();
  });

  afterEach(() => {
    cleanup(tmp);
  });

  it("TC-015: importing eval-server.ts populates process.env.ANTHROPIC_API_KEY from stored key before any provider module reads env", () => {
    const repoRoot = path.resolve(__dirname, "../../..");
    const evalServerModule = path.resolve(
      __dirname,
      "..",
      "eval-server.ts",
    );

    // Minimal driver: import eval-server for side effects, print the env
    // var the merge should populate, exit. The import is side-effect only;
    // we do NOT call startEvalServer() because that opens a port.
    const driverPath = path.join(tmp, "driver.mjs");
    const driverSrc = `
      // Subprocess driver for T-020. Any failure here surfaces via exit code.
      const mod = ${JSON.stringify(evalServerModule)};
      import(mod).then(() => {
        process.stdout.write(
          "ANTHROPIC_API_KEY=" + (process.env.ANTHROPIC_API_KEY ?? "<unset>") + "\\n",
        );
        process.exit(0);
      }).catch((err) => {
        process.stderr.write("IMPORT_FAILED: " + (err && err.stack ? err.stack : String(err)) + "\\n");
        process.exit(2);
      });
    `;
    fs.writeFileSync(driverPath, driverSrc, "utf8");

    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;
    delete env.OPENAI_API_KEY;
    delete env.OPENROUTER_API_KEY;
    env.VSKILL_CONFIG_DIR = tmp;
    // Subprocess must never accidentally open the studio port. Keep boot
    // lightweight — the side effect we care about is the preflight import.
    env.VSKILL_BOOT_ORDER_PROBE = "1";

    const result = spawnSync(
      "npx",
      ["tsx", driverPath],
      {
        cwd: repoRoot,
        env,
        encoding: "utf8",
        timeout: 45_000,
      },
    );

    if (result.status !== 0) {
      // Surface stderr so CI failures are diagnosable.
      throw new Error(
        `subprocess exited with status=${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
      );
    }

    expect(result.stdout).toContain("ANTHROPIC_API_KEY=sk-ant-BOOTORDER1234");
    expect(result.stdout).not.toContain("ANTHROPIC_API_KEY=<unset>");
  }, 60_000);
});
