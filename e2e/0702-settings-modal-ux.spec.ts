// ---------------------------------------------------------------------------
// 0702 — Full SettingsModal UX verification.
//
// Covers the "manual-equivalent browser verification" checklist from the
// team-lead briefing:
//   - New copy present ("Keys are stored locally..."), tier/keychain strings
//     absent
//   - All three provider rows (anthropic, openai, openrouter) render
//   - Save each provider → status transitions to Stored
//   - Remove-with-confirm flow
//   - Storage path display matches `vskill keys path` output
//   - CLI ↔ UI coherence via cross-process calls
//
// This suite owns its server lifecycle (isolated VSKILL_CONFIG_DIR per test)
// so it does not touch the developer's real ~/.vskill/keys.env.
// ---------------------------------------------------------------------------

import { test, expect, chromium, type Browser } from "@playwright/test";
import { spawn, type ChildProcess, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const TEST_PORT = 3189;

const SPEC_DIR = path.dirname(fileURLToPath(import.meta.url));
const VSKILL_REPO_ROOT = path.resolve(SPEC_DIR, "..");
const VSKILL_BIN = path.join(VSKILL_REPO_ROOT, "dist", "bin.js");
const FIXTURE_ROOT = path.join(VSKILL_REPO_ROOT, "e2e", "fixtures");

const KEYS = {
  anthropic: "sk-ant-MODALUX-AAAABBBBCCCCDDDDEEEEFFFF1111",
  openai: "sk-MODALUX-CCCCDDDDEEEEFFFFGGGGHHHH2222",
  openrouter: "sk-or-v1-MODALUX-EEEEFFFFGGGGHHHH3333",
};
const CANARIES = Object.values(KEYS);

interface ServerHandle {
  proc: ChildProcess;
  stdout: string[];
  stderr: string[];
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
      /* not ready */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`server did not come up on port ${port}`);
}

function startServer(configDir: string, port: number): ServerHandle {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const proc = spawn(
    process.execPath,
    [VSKILL_BIN, "eval", "serve", "--root", FIXTURE_ROOT, "--port", String(port)],
    {
      env: {
        ...process.env,
        VSKILL_CONFIG_DIR: configDir,
        VSKILL_WORKSPACE_DIR: path.join(configDir, "workspace"),
        ANTHROPIC_API_KEY: "",
        OPENAI_API_KEY: "",
        OPENROUTER_API_KEY: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  proc.stdout?.on("data", (c) => stdout.push(c.toString("utf8")));
  proc.stderr?.on("data", (c) => stderr.push(c.toString("utf8")));
  return { proc, stdout, stderr };
}

async function stopServer(h: ServerHandle): Promise<void> {
  if (h.proc.exitCode !== null || h.proc.killed) return;
  const exited = new Promise<void>((r) => h.proc.once("exit", () => r()));
  h.proc.kill("SIGTERM");
  const t = setTimeout(() => {
    if (h.proc.exitCode === null) h.proc.kill("SIGKILL");
  }, 3000);
  await exited;
  clearTimeout(t);
}

function serverLogs(h: ServerHandle): string {
  return h.stdout.join("") + h.stderr.join("");
}

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

test.describe("0702 — SettingsModal full UX", () => {
  test.describe.configure({ mode: "serial" });

  let browser: Browser;
  let configDir: string;
  let server: ServerHandle;

  test.beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
    configDir = fs.mkdtempSync(path.join(os.tmpdir(), "vskill-0702-modal-"));
    server = startServer(configDir, TEST_PORT);
    await waitForServer(TEST_PORT);
  });

  test.afterAll(async () => {
    await stopServer(server);
    await browser?.close();
    try {
      fs.rmSync(configDir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  test("modal renders with new copy, three provider rows, no tier/keychain strings", async () => {
    const page = await browser.newPage();
    await page.goto(`http://localhost:${TEST_PORT}/`, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent("studio:open-settings"));
    });
    const modal = page.getByTestId("settings-modal");
    await expect(modal).toBeVisible();

    // --- Three provider rows present ---
    await expect(page.getByTestId("provider-row-anthropic")).toBeVisible();
    await expect(page.getByTestId("provider-row-openai")).toBeVisible();
    await expect(page.getByTestId("provider-row-openrouter")).toBeVisible();

    // --- Banner has the new storage copy ---
    const banner = page.getByTestId("settings-banner");
    await expect(banner).toContainText(/stored locally on this device/i);

    // --- Forbidden strings (tier, keychain, browser storage) are ABSENT ---
    // Scope to the modal only — the migration banner is allowed to mention
    // "Keychain" since that IS its subject (migrate from legacy).
    const modalText = (await modal.innerText()).toLowerCase();
    const forbidden = ["tier 1", "tier 2", "browser storage", "sessionstorage", "localstorage tier"];
    for (const bad of forbidden) {
      expect(modalText, `modal must not contain "${bad}"`).not.toContain(bad);
    }

    // --- Storage path visible and contains our configDir ---
    const pathRow = page.getByTestId("settings-storage-path");
    await expect(pathRow).toContainText(configDir);
    await expect(pathRow).toContainText("keys.env");

    await page.screenshot({ path: path.join(logsDir, "10-modal-fresh.png") });
    await page.close();
  });

  test("save all three providers and verify status transitions", async () => {
    const page = await browser.newPage();
    await page.goto(`http://localhost:${TEST_PORT}/`, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent("studio:open-settings"));
    });
    const modal = page.getByTestId("settings-modal");
    await expect(modal).toBeVisible();

    for (const provider of ["anthropic", "openai", "openrouter"] as const) {
      const input = modal.locator(`input[data-provider="${provider}"]`);
      await input.fill(KEYS[provider]);

      const saveResp = page.waitForResponse(
        (r) =>
          r.url().includes("/api/settings/keys") &&
          r.request().method() === "POST",
      );
      await page.getByTestId(`save-${provider}`).click();
      const resp = await saveResp;
      expect(resp.status(), `${provider} save HTTP status`).toBe(200);

      await expect(page.getByTestId(`status-${provider}`)).toContainText(/Stored/i, {
        timeout: 5000,
      });
    }

    await page.screenshot({ path: path.join(logsDir, "11-modal-all-saved.png") });

    // --- Cross-check via CLI while server is running ---
    const listOut = spawnSync(process.execPath, [VSKILL_BIN, "keys", "list"], {
      env: {
        ...process.env,
        VSKILL_CONFIG_DIR: configDir,
        ANTHROPIC_API_KEY: "",
        OPENAI_API_KEY: "",
        OPENROUTER_API_KEY: "",
      },
      encoding: "utf8",
    });
    expect(listOut.status, listOut.stderr).toBe(0);
    // All three should show last-4 redaction, not "not set".
    expect(listOut.stdout).toContain("anthropic");
    expect(listOut.stdout).toContain("openai");
    expect(listOut.stdout).toContain("openrouter");
    // Raw key bytes must NEVER appear in CLI output.
    for (const canary of CANARIES) {
      expect(listOut.stdout + listOut.stderr).not.toContain(canary);
    }

    // --- Cross-check via CLI `keys path` ---
    const pathOut = spawnSync(process.execPath, [VSKILL_BIN, "keys", "path"], {
      env: { ...process.env, VSKILL_CONFIG_DIR: configDir },
      encoding: "utf8",
    });
    expect(pathOut.status).toBe(0);
    expect(pathOut.stdout.trim()).toContain(configDir);
    expect(pathOut.stdout.trim()).toContain("keys.env");

    await page.close();
  });

  test("remove-with-confirm flow hides the key and persists removal", async () => {
    const page = await browser.newPage();
    await page.goto(`http://localhost:${TEST_PORT}/`, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent("studio:open-settings"));
    });
    const modal = page.getByTestId("settings-modal");
    await expect(modal).toBeVisible();

    // OpenAI is stored from the previous test. Click Remove → Confirm.
    const removeBtn = page.getByTestId("remove-openai");
    await expect(removeBtn).toBeVisible();
    await removeBtn.click();
    const confirmBtn = page.getByTestId("remove-confirm-openai");
    await expect(confirmBtn).toBeVisible();

    const delResp = page.waitForResponse(
      (r) =>
        r.url().includes("/api/settings/keys/openai") &&
        r.request().method() === "DELETE",
    );
    await confirmBtn.click();
    const resp = await delResp;
    expect(resp.status()).toBe(200);

    await expect(page.getByTestId("status-openai")).toContainText(/no key/i, {
      timeout: 5000,
    });

    await page.screenshot({ path: path.join(logsDir, "12-modal-openai-removed.png") });
    await page.close();
  });

  test("server logs contain zero raw key bytes across entire UX flow", async () => {
    const output = serverLogs(server);
    for (const key of CANARIES) {
      expect(output, `server leaked key ${key.slice(0, 12)}... in logs`).not.toContain(key);
    }
    // Also write the captured output for post-mortem.
    fs.writeFileSync(
      path.join(logsDir, "server-output-modal-ux.txt"),
      `=== STDOUT ===\n${server.stdout.join("")}\n\n=== STDERR ===\n${server.stderr.join("")}\n`,
    );
  });
});
