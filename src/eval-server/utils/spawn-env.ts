// ---------------------------------------------------------------------------
// spawn-env — minimal env passed to install-spawn child processes.
// ---------------------------------------------------------------------------
// `child_process.spawn` inherits the parent's full env by default. The
// studio process is loaded with provider API keys (ANTHROPIC_API_KEY,
// OPENAI_API_KEY, OPENROUTER_API_KEY etc.) populated by boot-preflight, plus
// VSKILL_PLATFORM_URL overrides and any other developer-shell env. None of
// that is needed by `vskill install` or `claude plugin install`, and leaking
// keys to spawned subprocesses widens the secret blast radius for no gain.
//
// We pass the smallest set that real installers need: PATH, HOME, USER,
// SHELL, plus locale + tmpdir vars. Anything else (registry overrides etc.)
// must be added explicitly by the caller.
// ---------------------------------------------------------------------------

const DEFAULT_PASSTHROUGH_KEYS = [
  "PATH",
  "HOME",
  "USER",
  "USERNAME",
  "LOGNAME",
  "SHELL",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TMPDIR",
  "TMP",
  "TEMP",
  "SystemRoot", // Windows
  "APPDATA", // Windows
  "LOCALAPPDATA", // Windows
  "ProgramFiles", // Windows
  "ProgramFiles(x86)", // Windows
] as const;

export function buildSpawnEnv(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of DEFAULT_PASSTHROUGH_KEYS) {
    const v = process.env[key];
    if (v !== undefined) env[key] = v;
  }
  for (const [k, v] of Object.entries(extra)) {
    if (v !== undefined) env[k] = v;
  }
  return env;
}
