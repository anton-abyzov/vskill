import { execFileSync } from "child_process";
let cachedResult = null;
function clearCache() {
  cachedResult = null;
}
function detectPlaywrightCli(options = {}) {
  const { useCache = false } = options;
  if (useCache && cachedResult) {
    return cachedResult;
  }
  const whichCmd = process.platform === "win32" ? "where" : "which";
  let path;
  let version;
  try {
    path = execFileSync(whichCmd, ["playwright-cli"], {
      encoding: "utf-8",
      timeout: 5e3
    }).trim();
  } catch {
    const result2 = { installed: false };
    if (useCache) cachedResult = result2;
    return result2;
  }
  try {
    version = execFileSync("playwright-cli", ["--version"], {
      encoding: "utf-8",
      timeout: 5e3
    }).trim();
  } catch {
  }
  const result = { installed: true, path, version };
  if (useCache) cachedResult = result;
  return result;
}
export {
  clearCache,
  detectPlaywrightCli
};
