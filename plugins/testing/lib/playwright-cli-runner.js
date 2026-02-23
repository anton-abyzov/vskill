import { execFileSync } from "child_process";
class PlaywrightCliRunner {
  constructor(config = {}) {
    this.config = {
      headed: config.headed ?? false,
      browser: config.browser ?? "chrome",
      timeout: config.timeout ?? 3e4,
      session: config.session
    };
  }
  exec(args) {
    const fullArgs = [];
    if (this.config.session) {
      fullArgs.push(`-s=${this.config.session}`);
    }
    fullArgs.push(...args);
    try {
      const output = execFileSync("playwright-cli", fullArgs, {
        encoding: "utf-8",
        timeout: this.config.timeout,
        maxBuffer: 1024 * 1024
      }).trim();
      return { ok: true, output };
    } catch (e) {
      return { ok: false, output: e.message };
    }
  }
  open(url) {
    const args = ["open"];
    if (url) args.push(url);
    if (this.config.headed) args.push("--headed");
    return this.exec(args);
  }
  navigate(url) {
    return this.exec(["goto", url]);
  }
  snapshot() {
    return this.exec(["snapshot"]);
  }
  screenshot(filename) {
    const args = ["screenshot"];
    if (filename) args.push("--filename", filename);
    return this.exec(args);
  }
  close() {
    return this.exec(["close"]);
  }
  click(ref) {
    return this.exec(["click", ref]);
  }
  type(text) {
    return this.exec(["type", text]);
  }
  fill(ref, text) {
    return this.exec(["fill", ref, text]);
  }
  evaluate(fn) {
    return this.exec(["eval", fn]);
  }
}
export {
  PlaywrightCliRunner
};
