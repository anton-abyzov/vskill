import { spawn } from "node:child_process";
import type { Router } from "./router.js";
import { readBody, sendJson } from "./router.js";

type ExternalOpener = (url: string) => Promise<void> | void;

export interface DesktopOpenRoutesOptions {
  opener?: ExternalOpener;
}

export function registerDesktopOpenRoutes(
  router: Router,
  opts: DesktopOpenRoutesOptions = {},
): void {
  const opener = opts.opener ?? openExternalUrl;

  router.post("/api/desktop/open-url", async (req, res) => {
    let body: unknown;
    try {
      body = await readBody(req);
    } catch {
      sendJson(res, { ok: false, error: "Malformed JSON body" }, 400, req);
      return;
    }

    const rawUrl = (body as { url?: unknown } | null)?.url;
    const url = normalizeExternalHttpsUrl(rawUrl);
    if (!url) {
      sendJson(res, { ok: false, error: "Only https URLs can be opened" }, 400, req);
      return;
    }

    try {
      await opener(url);
      sendJson(res, { ok: true }, 200, req);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, { ok: false, error: message }, 500, req);
    }
  });
}

export function normalizeExternalHttpsUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

async function openExternalUrl(url: string): Promise<void> {
  const [command, ...args] = openCommand(url);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

function openCommand(url: string): [string, ...string[]] {
  if (process.platform === "darwin") return ["open", url];
  if (process.platform === "win32") return ["rundll32", "url.dll,FileProtocolHandler", url];
  return ["xdg-open", url];
}
