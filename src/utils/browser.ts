// ---------------------------------------------------------------------------
// Cross-platform browser opener
// ---------------------------------------------------------------------------

import { execFile } from "node:child_process";

/**
 * Open a URL in the user's default browser.
 * Uses execFile (not exec) to avoid shell command injection.
 * Platform-specific: open (macOS), xdg-open (Linux), start (Windows).
 */
export function openBrowser(url: string): Promise<void> {
  const platform = process.platform;
  let cmd: string;
  let args: string[];

  if (platform === "darwin") {
    cmd = "open";
    args = [url];
  } else if (platform === "win32") {
    cmd = "cmd";
    args = ["/c", "start", "", url];
  } else {
    cmd = "xdg-open";
    args = [url];
  }

  return new Promise((resolve, reject) => {
    execFile(cmd, args, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}
