import type { ReactNode } from "react";
import type { SkillInfo } from "../types";
import type { SelectedSkill } from "../StudioContext";
import { AGENTS_REGISTRY } from "../../../agents/agents-registry";

// ---------------------------------------------------------------------------
// T-027 / T-028 / T-029 / T-030: MetadataTab
//
// Surfaces every SkillInfo field (frontmatter + filesystem + benchmark + MCP
// deps + skill deps + optional source agent) as a calm, serif-titled card
// layout. No shimmer, no pill fills — chips use text + 1px border only.
//
// Design constraints:
//   - Section headings use var(--font-serif) (Source Serif 4) — this is the
//     *only* place serif appears in Phase 3 per ADR-0674-03.
//   - Body text uses var(--font-sans) (Inter Tight).
//   - Tabular numbers (font-variant-numeric: tabular-nums) for version, size,
//     timestamps.
//   - MCP deps list: icon + name + version.
//   - Skill dep chips: border-only; clickable when resolvable, tooltip
//     "Not installed" otherwise; keyboard-activatable via Enter.
//   - Source-agent row only renders when origin === "installed".
//   - Null scalar fields render as "—" in var(--text-secondary).
//
// Composition uses plain helper functions (not nested React components) so
// that downstream test inspection walks a single inlined element tree.
// ---------------------------------------------------------------------------

interface Props {
  skill: SkillInfo;
  allSkills?: SkillInfo[];
  onSelectSkill?: (s: SelectedSkill) => void;
}

const SECTION_HEADING_STYLE = {
  fontFamily: "var(--font-serif)",
  fontSize: 15,
  fontWeight: 500,
  color: "var(--text-primary)",
  margin: "0 0 8px",
  letterSpacing: 0.1,
};

const CARD_STYLE = {
  background: "var(--bg-surface)",
  border: "1px solid var(--border-default)",
  borderRadius: 8,
  padding: "14px 16px",
  boxShadow: "none",
};

const LABEL_STYLE = {
  fontFamily: "var(--font-sans)",
  fontSize: 11,
  color: "var(--text-secondary)",
  textTransform: "uppercase" as const,
  letterSpacing: 0.4,
};

const VALUE_STYLE = {
  fontFamily: "var(--font-sans)",
  fontSize: 13,
  color: "var(--text-primary)",
};

const MONO_VALUE_STYLE = {
  fontFamily: "var(--font-mono)",
  fontSize: 12,
  color: "var(--text-primary)",
  wordBreak: "break-all" as const,
};

const TABULAR_STYLE = {
  fontFamily: "var(--font-sans)",
  fontSize: 13,
  color: "var(--text-primary)",
  fontVariantNumeric: "tabular-nums" as const,
};

const DASH_STYLE = {
  fontFamily: "var(--font-sans)",
  fontSize: 13,
  color: "var(--text-secondary)",
};

// T-058: Path values can get very long (absolute filesystem paths). Apply
// overflow-wrap: anywhere so the browser breaks between characters rather
// than mid-word at arbitrary column boundaries. wordBreak "break-word" is
// included for Firefox parity.
const PATH_VALUE_STYLE = {
  fontFamily: "var(--font-mono)",
  fontSize: 12,
  color: "var(--text-primary)",
  overflowWrap: "anywhere" as const,
  wordBreak: "break-word" as const,
};

// T-062: Help hint suffixes for null frontmatter/filesystem fields — gives
// users an actionable tooltip explaining where the value comes from.
const FIELD_HINTS: Record<string, string> = {
  Description: "Add `description:` to the SKILL.md frontmatter to display a value here.",
  Version: "Add `version:` to the SKILL.md frontmatter to display a value here.",
  Category: "Add `category:` to the SKILL.md frontmatter to display a value here.",
  Author: "Add `author:` to the SKILL.md frontmatter to display a value here.",
  License: "Add `license:` to the SKILL.md frontmatter to display a value here.",
  Homepage: "Add `homepage:` to the SKILL.md frontmatter to display a value here.",
  Tags: "Add `tags:` to the SKILL.md frontmatter to display a value here.",
  Directory: "Filesystem location of this skill — not configurable via SKILL.md.",
  "Entry point": "Add `entry-point:` to the SKILL.md frontmatter to customize; defaults to SKILL.md.",
  "Last modified": "Filesystem mtime — updates automatically on save.",
  "Last benchmark": "Shown after the first benchmark run completes.",
};

// ---------------------------------------------------------------------------
// Helpers (inline renderers — NOT components)
// ---------------------------------------------------------------------------

function formatBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  if (kb < 1024) return kb >= 10 ? `${Math.round(kb)} KB` : `${kb.toFixed(1).replace(/\.0$/, "")} KB`;
  const mb = kb / 1024;
  return mb >= 10 ? `${Math.round(mb)} MB` : `${mb.toFixed(1).replace(/\.0$/, "")} MB`;
}

function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const diff = Date.now() - d.getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const days = Math.floor(hr / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.floor(months / 12);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}

function agentDisplayName(id: string): string {
  const agent = AGENTS_REGISTRY.find((a) => a.id === id);
  return agent?.displayName ?? id;
}

function dashValue(labelHint?: string): ReactNode {
  // T-062: When a field's label matches a known hint, surface it via the
  // native `title` attribute so mouse users get an actionable tooltip
  // without introducing a custom tooltip component.
  const title = labelHint ? FIELD_HINTS[labelHint] : undefined;
  return (
    <span style={DASH_STYLE} title={title}>
      —
    </span>
  );
}

function row(label: string, value: ReactNode, key?: string): ReactNode {
  return (
    <div
      key={key ?? label}
      style={{
        display: "grid",
        gridTemplateColumns: "130px 1fr",
        alignItems: "baseline",
        gap: 12,
        padding: "6px 0",
      }}
    >
      <span style={LABEL_STYLE}>{label}</span>
      <span style={{ minWidth: 0 }}>{value}</span>
    </div>
  );
}

function scalarRow(
  label: string,
  value: string | null | undefined,
  opts: { tabular?: boolean; mono?: boolean; path?: boolean } = {},
): ReactNode {
  if (value == null || value === "") {
    return row(label, dashValue(label));
  }
  // T-058: When the value is a filesystem path, use the path-aware style that
  // wraps at any character (with the correct data attribute so tests and
  // E2E checks can target it deterministically).
  if (opts.path) {
    return row(
      label,
      <span data-path-value="true" style={PATH_VALUE_STYLE}>
        {value}
      </span>,
    );
  }
  const style = opts.tabular ? TABULAR_STYLE : opts.mono ? MONO_VALUE_STYLE : VALUE_STYLE;
  return row(label, <span style={style}>{value}</span>);
}

// ---------------------------------------------------------------------------
// MetadataTab
// ---------------------------------------------------------------------------

export function MetadataTab({ skill, allSkills = [], onSelectSkill }: Props) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 16 }}>
      {renderFrontmatterCard(skill)}
      {skill.origin === "installed" ? renderSourceAgentCard(skill) : null}
      {renderFilesystemCard(skill)}
      {renderBenchmarkCard(skill)}
      {renderMcpDepsCard(skill)}
      {renderSkillDepsCard(skill, allSkills, onSelectSkill)}
    </div>
  );
}

// ---------------------------------------------------------------------------
// T-027: Frontmatter card
// ---------------------------------------------------------------------------
function renderFrontmatterCard(skill: SkillInfo): ReactNode {
  // T-056: Homepage renders as an external link with a trailing ↗ glyph and
  // underline-on-hover only (rest state is just colored). When null, render
  // the muted em-dash with a tooltip hint so users know where to put the URL.
  const homepageValue: ReactNode = skill.homepage ? (
    <a
      href={skill.homepage}
      target="_blank"
      rel="noopener noreferrer"
      data-external-link="homepage"
      style={{
        ...MONO_VALUE_STYLE,
        color: "var(--text-accent)",
        textDecoration: "none",
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLAnchorElement).style.textDecoration = "underline";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLAnchorElement).style.textDecoration = "none";
      }}
    >
      <span>{skill.homepage}</span>
      <span aria-hidden="true" style={{ fontSize: 11, color: "var(--text-accent)" }}>↗</span>
    </a>
  ) : (
    dashValue("Homepage")
  );

  const tagsValue: ReactNode = skill.tags && skill.tags.length > 0 ? (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {skill.tags.map((t) => (
        <span
          key={t}
          data-chip="tag"
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: 11,
            padding: "2px 8px",
            border: "1px solid var(--border-default)",
            borderRadius: 999,
            color: "var(--text-secondary)",
            background: "transparent",
          }}
        >
          {t}
        </span>
      ))}
    </div>
  ) : (
    dashValue("Tags")
  );

  return (
    <section key="frontmatter" style={CARD_STYLE} aria-labelledby="md-frontmatter">
      <h3 id="md-frontmatter" style={SECTION_HEADING_STYLE}>Frontmatter</h3>
      {scalarRow("Description", skill.description ?? null)}
      {scalarRow("Version", skill.version ?? null, { tabular: true })}
      {scalarRow("Category", skill.category ?? null)}
      {scalarRow("Author", skill.author ?? null)}
      {scalarRow("License", skill.license ?? null)}
      {row("Homepage", homepageValue)}
      {row("Tags", tagsValue)}
    </section>
  );
}

// ---------------------------------------------------------------------------
// T-030: Source agent (installed only)
// ---------------------------------------------------------------------------
function renderSourceAgentCard(skill: SkillInfo): ReactNode {
  const agentId = skill.sourceAgent;
  const value: ReactNode = agentId ? (
    <span style={VALUE_STYLE} data-agent-id={agentId}>{agentDisplayName(agentId)}</span>
  ) : (
    dashValue("Agent")
  );
  return (
    <section key="source-agent" style={CARD_STYLE} aria-labelledby="md-source-agent">
      <h3 id="md-source-agent" style={SECTION_HEADING_STYLE}>Source agent</h3>
      {row("Agent", value)}
    </section>
  );
}

// ---------------------------------------------------------------------------
// T-027: Filesystem group
// ---------------------------------------------------------------------------
function renderFilesystemCard(skill: SkillInfo): ReactNode {
  const lastModValue: ReactNode = skill.lastModified ? (
    <span style={TABULAR_STYLE} title={skill.lastModified}>{formatRelativeTime(skill.lastModified)}</span>
  ) : (
    dashValue("Last modified")
  );

  // T-057: Entry point renders as an interactive mono chip. Clicking it copies
  // the absolute path (`${dir}/${entryPoint}`) to the system clipboard and
  // emits a `studio:toast` CustomEvent so the app-level ToastProvider can
  // surface a "Copied <path>" confirmation. We deliberately avoid calling
  // `useToast()` here to keep MetadataTab hook-free (it is invoked as a
  // plain function by RightPanel).
  const entryPoint = skill.entryPoint ?? "SKILL.md";
  const absPath = skill.dir ? `${skill.dir.replace(/\/$/, "")}/${entryPoint}` : entryPoint;
  const entryValue: ReactNode = (
    <button
      type="button"
      data-entry-chip="true"
      title={`Copy ${absPath}`}
      aria-label={`Copy entry-point path ${absPath} to clipboard`}
      onClick={() => copyEntryPath(absPath)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "2px 8px",
        border: "1px solid var(--border-default)",
        borderRadius: 4,
        background: "transparent",
        fontFamily: "var(--font-mono)",
        fontSize: 12,
        color: "var(--text-primary)",
        cursor: "pointer",
        maxWidth: "100%",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {entryPoint}
    </button>
  );

  return (
    <section key="filesystem" style={CARD_STYLE} aria-labelledby="md-fs">
      <h3 id="md-fs" style={SECTION_HEADING_STYLE}>Filesystem</h3>
      {scalarRow("Directory", skill.dir || null, { path: true })}
      {row("Entry point", entryValue)}
      {row("Size", <span style={TABULAR_STYLE}>{formatBytes(skill.sizeBytes)}</span>)}
      {row("Last modified", lastModValue)}
    </section>
  );
}

// T-057: Copy + toast helper — kept outside the component so it is hook-free
// and exercisable in tests without React render context.
function copyEntryPath(absPath: string): void {
  try {
    navigator.clipboard?.writeText(absPath);
  } catch {
    // Silently ignore clipboard errors — the toast still tells the user
    // what path was requested; they can manually copy from the tooltip.
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("studio:toast", {
        detail: { message: `Copied ${absPath}`, severity: "info" },
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// T-027: Benchmark group
// ---------------------------------------------------------------------------
function renderBenchmarkCard(skill: SkillInfo): ReactNode {
  const statusColor =
    skill.benchmarkStatus === "pass"
      ? "var(--status-installed)"
      : skill.benchmarkStatus === "fail"
      ? "var(--red, #b54444)"
      : "var(--status-own)";
  const statusValue = (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontFamily: "var(--font-sans)",
        fontSize: 13,
        color: "var(--text-primary)",
      }}
    >
      <span
        aria-hidden="true"
        style={{ display: "inline-block", width: 7, height: 7, borderRadius: 999, background: statusColor }}
      />
      {skill.benchmarkStatus}
    </span>
  );
  const lastBenchValue: ReactNode = skill.lastBenchmark ? (
    <span style={TABULAR_STYLE} title={skill.lastBenchmark}>{formatRelativeTime(skill.lastBenchmark)}</span>
  ) : (
    dashValue("Last benchmark")
  );
  return (
    <section key="benchmark" style={CARD_STYLE} aria-labelledby="md-bench">
      <h3 id="md-bench" style={SECTION_HEADING_STYLE}>Benchmark</h3>
      {row("Eval count", <span style={TABULAR_STYLE}>{skill.evalCount}</span>)}
      {row("Assertions", <span style={TABULAR_STYLE}>{skill.assertionCount}</span>)}
      {row("Status", statusValue)}
      {row("Last benchmark", lastBenchValue)}
    </section>
  );
}

// ---------------------------------------------------------------------------
// T-028: MCP dependencies
// ---------------------------------------------------------------------------
function renderMcpDepsCard(skill: SkillInfo): ReactNode {
  const deps = skill.mcpDeps ?? [];
  return (
    <section key="mcp-deps" style={CARD_STYLE} aria-labelledby="md-mcp">
      <h3 id="md-mcp" style={SECTION_HEADING_STYLE}>MCP dependencies</h3>
      {deps.length === 0 ? (
        <p style={{ fontFamily: "var(--font-sans)", fontSize: 12, color: "var(--text-secondary)", margin: 0 }}>
          No MCP dependencies
        </p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {deps.map((name) => (
            <li
              key={name}
              data-mcp-dep={name}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 0",
                borderBottom: "1px solid var(--border-default)",
              }}
            >
              <McpIcon />
              <span style={{ fontFamily: "var(--font-sans)", fontSize: 13, color: "var(--text-primary)" }}>
                {name}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function McpIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ color: "var(--text-secondary)", flexShrink: 0 }}
      aria-hidden="true"
    >
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// T-029: Skill dependency chips
// ---------------------------------------------------------------------------
function renderSkillDepsCard(
  skill: SkillInfo,
  allSkills: SkillInfo[],
  onSelectSkill?: (s: SelectedSkill) => void,
): ReactNode {
  const deps = skill.deps ?? [];
  return (
    <section key="skill-deps" style={CARD_STYLE} aria-labelledby="md-skill-deps">
      <h3 id="md-skill-deps" style={SECTION_HEADING_STYLE}>Skill dependencies</h3>
      {deps.length === 0 ? (
        <p style={{ fontFamily: "var(--font-sans)", fontSize: 12, color: "var(--text-secondary)", margin: 0 }}>
          No skill dependencies
        </p>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {deps.map((dep) => {
            const match = resolveDep(dep, allSkills);
            const present = match != null;
            const chipStyle = {
              fontFamily: "var(--font-sans)",
              fontSize: 12,
              padding: "3px 10px",
              border: "1px solid var(--border-default)",
              borderRadius: 999,
              color: present ? "var(--text-primary)" : "var(--text-secondary)",
              background: "transparent",
              cursor: present ? "pointer" : "help",
            };
            const onClick = present && onSelectSkill
              ? () => onSelectSkill({ plugin: match.plugin, skill: match.skill, origin: match.origin })
              : undefined;
            const onKeyDown = present && onSelectSkill
              ? (e: React.KeyboardEvent) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelectSkill({ plugin: match.plugin, skill: match.skill, origin: match.origin });
                  }
                }
              : undefined;
            return (
              <button
                key={dep}
                type="button"
                data-chip="skill-dep"
                data-present={present ? "true" : "false"}
                title={present ? `Open ${dep}` : "Not installed"}
                onClick={onClick}
                onKeyDown={onKeyDown}
                style={chipStyle}
              >
                {dep}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

function resolveDep(dep: string, skills: SkillInfo[]): SkillInfo | null {
  const [a, b] = dep.includes("/") ? dep.split("/") : ["", dep];
  for (const s of skills) {
    if (a && s.plugin === a && s.skill === b) return s;
    if (!a && s.skill === b) return s;
  }
  return null;
}
