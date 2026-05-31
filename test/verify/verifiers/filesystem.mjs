// Filesystem verifier — confirms declared files in the surface exist on disk and are non-empty.
import { statSync, existsSync } from "node:fs";

/**
 * @param {string[]} paths  absolute paths
 * @returns {import("../verify-types.mjs").Check[]}
 */
export function runFilesystem(paths) {
  /** @type {import("../verify-types.mjs").Check[]} */
  const checks = [];
  for (const p of paths) {
    if (!existsSync(p)) {
      checks.push({ id: `fs.exists:${p}`, status: "fail", message: "missing file", expected: "exists", actual: "missing" });
      continue;
    }
    const st = statSync(p);
    if (st.size === 0) {
      checks.push({ id: `fs.size:${p}`, status: "fail", message: "empty file", expected: ">0 bytes", actual: 0 });
      continue;
    }
    checks.push({ id: `fs.ok:${p}`, status: "ok", message: `${st.size} bytes` });
  }
  return checks;
}
