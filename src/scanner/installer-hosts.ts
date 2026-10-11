// ---------------------------------------------------------------------------
// Official installer endpoints.
//
// NA-004 never treats a download from these as a fake prerequisite, and
// judgeRequiredSignals lets a documented one-line install from them through
// when the judge is unavailable. Keep the list short: every entry is a host
// whose install script the toolchain's own docs tell users to pipe to a shell.
//
// Ported from vskill-platform src/lib/scanner/installer-hosts.ts; keep the two
// in step.
// ---------------------------------------------------------------------------

export const OFFICIAL_INSTALLER_HOSTS: readonly string[] = [
  "brew.sh",
  "bun.sh",
  "sh.rustup.rs",
  "astral.sh",
  "deno.land",
  "get.pnpm.io",
];

/** Owners whose install scripts are served from raw.githubusercontent.com. */
export const OFFICIAL_INSTALLER_GITHUB_OWNERS: readonly string[] = ["nvm-sh", "Homebrew"];

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Regex source for the start of an official installer URL after the scheme:
 * an allowlisted host followed by a delimiter, or a raw.githubusercontent.com
 * path under an allowlisted owner.
 */
export const OFFICIAL_INSTALLER_URL_SOURCE =
  `(?:${OFFICIAL_INSTALLER_HOSTS.map(escapeRe).join("|")})[\\/\\s)'"\`]` +
  `|raw\\.githubusercontent\\.com\\/(?:${OFFICIAL_INSTALLER_GITHUB_OWNERS.map(escapeRe).join("|")})\\/`;

const HOSTS = new Set(OFFICIAL_INSTALLER_HOSTS.map((h) => h.toLowerCase()));
const OWNERS = new Set(OFFICIAL_INSTALLER_GITHUB_OWNERS.map((o) => o.toLowerCase()));

/** True for an http(s) or scheme-less URL on an official installer endpoint. */
export function isOfficialInstallerUrl(url: string): boolean {
  const m = /^(?:https?:\/\/)?([^/\s?#]+)(\/[^\s]*)?$/i.exec(url);
  if (!m) return false;
  const host = m[1].toLowerCase();
  // Userinfo and ports are how look-alike URLs hide the real host.
  if (host.includes("@") || host.includes(":")) return false;
  if (HOSTS.has(host)) return true;
  if (host !== "raw.githubusercontent.com") return false;
  const owner = /^\/([^/]+)\//.exec(m[2] ?? "");
  return !!owner && OWNERS.has(owner[1].toLowerCase());
}

// One command per line, in the exact shapes the official docs use. Anything
// else on the line (a second command, a substitution, a redirect, a local
// script argument) fails the match.
const URL_TOKEN = String.raw`[^\s'"|;&$\x60()<>\\]+`;
const CURL_FLAG = String.raw`(?:-[A-Za-z0-9-]+|--[a-z][\w.-]*(?:\s+'=[\w,+-]+')?)`;
const SHELL_ARG = String.raw`(?:-{1,2}[\w.=-]*|"[\w.=-]+"|[\w.=-]+)`;
const SHELL_INSTALL_RE = new RegExp(
  String.raw`^(?:\$\s+)?(?:curl|wget)(?:\s+${CURL_FLAG})*\s+(['"]?)(${URL_TOKEN})\1` +
    String.raw`\s*\|\s*(?:sudo\s+)?(?:\/(?:usr\/)?bin\/)?(?:ba|z)?sh(?:\s+-s(?:\s+${SHELL_ARG})*|\s+-)?\s*$`,
);
const PS_FETCH = String.raw`(?:irm|iwr|Invoke-RestMethod|Invoke-WebRequest)\s+'?(${URL_TOKEN})'?(?:\s+-(?:UseBasicParsing|useb))?\s*\|\s*(?:iex|Invoke-Expression)`;
const PS_INSTALL_RE = new RegExp(
  String.raw`^(?:PS>\s*)?(?:(?:powershell|pwsh)(?:\.exe)?(?:\s+-(?:ExecutionPolicy\s+(?:ByPass|RemoteSigned)|NoProfile))*\s+-c(?:ommand)?\s+"${PS_FETCH}"|${PS_FETCH})\s*$`,
  "i",
);

/**
 * True when `line` is a single documented install command whose only network
 * target is an official installer endpoint, e.g.
 * `curl -fsSL https://bun.sh/install | bash` or
 * `powershell -c "irm bun.sh/install.ps1 | iex"`.
 */
export function isOfficialInstallerCommand(line: string): boolean {
  const text = line.trim();
  if (text.length > 400) return false;
  const shell = SHELL_INSTALL_RE.exec(text);
  if (shell) return isOfficialInstallerUrl(shell[2]);
  const ps = PS_INSTALL_RE.exec(text);
  if (!ps) return false;
  const url = ps[1] ?? ps[2];
  return typeof url === "string" && isOfficialInstallerUrl(url);
}
