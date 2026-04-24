// ---------------------------------------------------------------------------
// 0702 T-071 — Playwright E2E: save → restart → read cycle.
//
// Proves the headline persistence guarantee from spec AC-US1-01:
//   "Keys saved via Settings modal survive a server restart and are
//    automatically available to subsequent eval runs."
//
// This test owns its own server lifecycle — it must restart the process
// between save and read, so it CANNOT share the shared playwright.config.ts
// server. Instead it launches `node dist/bin.js eval serve` twice against
// the same ephemeral VSKILL_CONFIG_DIR temp directory.
//
// Log-leak assertion: the test captures stdout + stderr across both server
// processes and asserts the canary key substring never appears in any sink.
// ---------------------------------------------------------------------------

import { test, expect, chromium, type Browser } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const CANARY = "PLAYWRIGHT-CANARY-0702";
const ANTHROPIC_TEST_KEY = `sk-ant-${CANARY}-AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHH`;

// Port range above the shared e2e server (3077) to avoid collision.
const TEST_PORT = 3187;

const SPEC_DIR = path.dirname(fileURLToPath(import.meta.url));
const VSKILL_REPO_ROOT = path.resolve(SPEC_DIR, "..");
const VSKILL_BIN = path.join(VSKILL_REPO_ROOT, "dist", "bin.js");
const FIXTURE_ROOT = path.join(VSKILL_REPO_ROOT, "e2e", "fixtures");

interface ServerHandle {
  proc: ChildProcess;
  stdout: string[];
  stderr: string[];
  port: number;
  configDir: string;
}

async function waitForServer(port: number, timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const resp = await fetch(`http://localhost:${port}/api/config`, {
        signal: AbortSignal.timeout(1000),
      });
      if (resp.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`server did not come up on port ${port} within ${timeoutMs}ms`);
}

function startServer(configDir: string, port: number, extraEnv: Record<string, string> = {}): ServerHandle {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const env = {
    ...process.env,
    VSKILL_CONFIG_DIR: configDir,
    VSKILL_WORKSPACE_DIR: path.join(configDir, "workspace"),
    // Keep existing real-env provider keys out of this test process — the
    // merge step in the server must see an empty env to make the persistence
    // assertion meaningful.
    ANTHROPIC_API_KEY: "",
    OPENAI_API_KEY: "",
    OPENROUTER_API_KEY: "",
    ...extraEnv,
  } as NodeJS.ProcessEnv;
  const proc = spawn(
    process.execPath,
    [VSKILL_BIN, "eval", "serve", "--root", FIXTURE_ROOT, "--port", String(port)],
    { env, stdio: ["ignore", "pipe", "pipe"] },
  );
  proc.stdout?.on("data", (chunk) => stdout.push(chunk.toString("utf8")));
  proc.stderr?.on("data", (chunk) => stderr.push(chunk.toString("utf8")));
  return { proc, stdout, stderr, port, configDir };
}

async function stopServer(handle: ServerHandle): Promise<void> {
  if (handle.proc.exitCode !== null || handle.proc.killed) return;
  const exited = new Promise<void>((resolve) => {
    handle.proc.once("exit", () => resolve());
  });
  handle.proc.kill("SIGTERM");
  // Give it 3s; if still alive, SIGKILL.
  const timer = setTimeout(() => {
    if (handle.proc.exitCode === null) handle.proc.kill("SIGKILL");
  }, 3000);
  await exited;
  clearTimeout(timer);
}

function allOutput(handle: ServerHandle): string {
  return handle.stdout.join("") + handle.stderr.join("");
}

test.describe("0702 T-071 — save → restart → read", () => {
  // This suite ignores the shared webServer config. We own our lifecycle.
  test.describe.configure({ mode: "serial" });

  let browser: Browser;
  let configDir: string;
  let serverA: ServerHandle | null = null;
  let serverB: ServerHandle | null = null;

  test.beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
    configDir = fs.mkdtempSync(path.join(os.tmpdir(), "vskill-0702-persist-"));
  });

  test.afterAll(async () => {
    if (serverA) await stopServer(serverA);
    if (serverB) await stopServer(serverB);
    await browser?.close();
    try {
      fs.rmSync(configDir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  test("key persists across server restart and appears in listKeys", async () => {
    // --- Phase A: launch server, save key via Settings modal -----------------
    serverA = startServer(configDir, TEST_PORT);
    await waitForServer(TEST_PORT);

    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();
    const consoleA: string[] = [];
    pageA.on("console", (msg) => consoleA.push(`${msg.type()}: ${msg.text()}`));

    await pageA.goto(`http://localhost:${TEST_PORT}/`, { waitUntil: "domcontentloaded" });

    // Dispatch the custom event the App listens for to open the modal.
    await pageA.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent("studio:open-settings", { detail: { provider: "anthropic" } }),
      );
    });

    const modal = pageA.getByTestId("settings-modal");
    await expect(modal).toBeVisible();

    // Before save: the anthropic row shows "No key stored".
    const anthropicStatus = pageA.getByTestId("status-anthropic");
    await expect(anthropicStatus).toContainText(/no key/i);

    // Type the key.
    const anthropicInput = modal.locator('input[data-provider="anthropic"]');
    await anthropicInput.fill(ANTHROPIC_TEST_KEY);

    // Click save — wait for the API call to complete.
    const saveResp = pageA.waitForResponse(
      (r) => r.url().includes("/api/settings/keys") && r.request().method() === "POST",
    );
    await pageA.getByTestId("save-anthropic").click();
    const resp = await saveResp;
    expect(resp.status()).toBe(200);

    // After save: status shifts to "stored" with a timestamp.
    await expect(anthropicStatus).toContainText(/Stored/i, { timeout: 5000 });

    // Storage path is displayed and points inside our temp config dir.
    const pathText = await pageA.getByTestId("settings-storage-path").innerText();
    expect(pathText).toContain(configDir);
    expect(pathText).toContain("keys.env");

    // Take a screenshot at this milestone.
    const logsDir = path.join(
      VSKILL_REPO_ROOT,
      "..",
      "..",
      "..",
      ".specweave",
      "increments",
      "0702-skill-studio-cross-platform-api-key-storage",
      "logs",
    );
    fs.mkdirSync(logsDir, { recursive: true });
    await pageA.screenshot({ path: path.join(logsDir, "01-after-save.png"), fullPage: false });

    await contextA.close();

    // --- Phase B: verify file on disk ---------------------------------------
    const keysFile = path.join(configDir, "keys.env");
    expect(fs.existsSync(keysFile)).toBe(true);
    const contents = fs.readFileSync(keysFile, "utf8");
    expect(contents).toContain(`ANTHROPIC_API_KEY=${ANTHROPIC_TEST_KEY}`);

    // POSIX: verify 0600 file mode.
    if (process.platform !== "win32") {
      const stat = fs.statSync(keysFile);
      const mode = stat.mode & 0o777;
      expect(mode).toBe(0o600);
    }

    // --- Phase C: stop server A, capture its output for leak check ----------
    await stopServer(serverA);
    const outputA = allOutput(serverA);
    expect(outputA, "Phase A server leaked canary key in logs").not.toContain(CANARY);
    expect(outputA).not.toContain(ANTHROPIC_TEST_KEY);

    // --- Phase D: restart server with SAME configDir, open modal, verify ----
    serverB = startServer(configDir, TEST_PORT);
    await waitForServer(TEST_PORT);

    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    await pageB.goto(`http://localhost:${TEST_PORT}/`, { waitUntil: "domcontentloaded" });
    await pageB.evaluate(() => {
      window.dispatchEvent(new CustomEvent("studio:open-settings"));
    });

    const modalB = pageB.getByTestId("settings-modal");
    await expect(modalB).toBeVisible();
    const statusB = pageB.getByTestId("status-anthropic");
    await expect(statusB).toContainText(/Stored/i, { timeout: 5000 });

    // Also hit listKeys directly — stored flag must be true.
    const listResp = await pageB.request.get(`http://localhost:${TEST_PORT}/api/settings/keys`);
    expect(listResp.status()).toBe(200);
    const listJson = (await listResp.json()) as {
      anthropic: { stored: boolean; updatedAt: string | null };
    };
    expect(listJson.anthropic.stored).toBe(true);
    expect(listJson.anthropic.updatedAt).not.toBeNull();

    await pageB.screenshot({ path: path.join(logsDir, "02-after-restart.png"), fullPage: false });

    // Redaction check on phase B server output too — boot-time log of the
    // merge step must never include the key.
    const outputB = allOutput(serverB);
    expect(outputB, "Phase B server leaked canary key in logs").not.toContain(CANARY);
    expect(outputB).not.toContain(ANTHROPIC_TEST_KEY);

    await contextB.close();
  });
});
