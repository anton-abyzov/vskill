// ---------------------------------------------------------------------------
// 0747 T-005: formatUpdateLocationTooltip
//
// Pure function. Builds the `title=` tooltip text shown on hover of the inline
// Update button in the bell dropdown. Surfaces (a) what's about to be updated
// and (b) any caveats (pinned globally, plugin-bundled handled separately).
// ---------------------------------------------------------------------------

import type { InstallLocation } from "../api";

const SCOPE_ORDER: ReadonlyArray<InstallLocation["scope"]> = [
  "project",
  "personal",
  "plugin",
];

interface Opts {
  /** True when the skill is globally pinned (the global-per-skill pin from the lockfile). */
  pinned?: boolean;
}

export function formatUpdateLocationTooltip(
  locations: ReadonlyArray<InstallLocation>,
  opts: Opts = {},
): string {
  if (locations.length === 0) {
    return "No tracked install — click to view details";
  }

  // Plugin-only case is special: we never invoke vskill update for these.
  const updatable = locations.filter((l) => !l.readonly);
  const readonlyLocs = locations.filter((l) => l.readonly);

  if (updatable.length === 0) {
    return "Plugin-bundled — Update via plugin to refresh";
  }

  // Stable scope ordering: project, then personal, then plugin (filtered out
  // here — readonly locs are surfaced via the suffix below).
  const presentScopes = SCOPE_ORDER.filter((s) =>
    updatable.some((l) => l.scope === s),
  );
  const scopeStr = presentScopes.join(" + ");

  // Unique agent labels, sorted alphabetically for stable output.
  const agentLabels = Array.from(
    new Set(updatable.map((l) => l.agentLabel)),
  ).sort((a, b) => a.localeCompare(b));
  const agentsStr = agentLabels.join(", ");

  const count = updatable.length;
  const noun = count === 1 ? "location" : "locations";

  let out = `Updates ${count} ${noun}: ${scopeStr} (${agentsStr})`;

  if (opts.pinned) {
    out += " — pinned (skipped)";
    return out;
  }

  if (readonlyLocs.length > 0) {
    // Group plugin readonly by pluginSlug if present.
    const slugs = Array.from(
      new Set(readonlyLocs.map((l) => l.pluginSlug ?? "?")),
    );
    if (slugs.length === 1 && slugs[0] !== "?") {
      out += ` — ${readonlyLocs.length} from plugin ${slugs[0]} (handled separately)`;
    } else {
      out += ` — ${readonlyLocs.length} plugin-bundled (handled separately)`;
    }
  }

  return out;
}
