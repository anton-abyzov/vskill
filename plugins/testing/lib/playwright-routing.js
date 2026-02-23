import { detectPlaywrightCli } from "./playwright-cli-detector.js";
function resolvePlaywrightMode(task, config = {}) {
  const { preferCli = true } = config;
  if (!preferCli) return "mcp";
  const detection = detectPlaywrightCli({ useCache: true });
  if (!detection.installed) return "mcp";
  return "cli";
}
export {
  resolvePlaywrightMode
};
