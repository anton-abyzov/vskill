import type { ReactNode } from "react";
import type { SkillInfo } from "../types";
import type { PanelId } from "../pages/workspace/workspaceTypes";
import { MetricCard } from "./MetricCard";
import { VersionBadge } from "./VersionBadge";
import { AuthorLink } from "./AuthorLink";
import { SourceFileLink } from "./SourceFileLink";
import { BenchmarkInfoPopover } from "./BenchmarkInfoPopover";
// 0772 US-005: surface GitHub publish-readiness on the Overview tab.
import { PublishStatusRow } from "./PublishStatusRow";

// ---------------------------------------------------------------------------
// T-006 (0707): SkillOverview — responsive 8-card metric grid + sticky
// compact header. Replaces the previous MetadataTab as the Overview body
// now that the 9 workspace tabs are hoisted flat under RightPanel.
//
// Cards (in order):
//   1. Benchmark  — pass-rate percent (or "—") with ℹ popover
//   2. Tests      — evalCount (clickable → Tests tab)
//   3. Activations— activation history count (clickable → Activation tab)
//   4. Last run   — relative time of last benchmark/activation
//   5. MCP deps   — mcpDeps.length (clickable → Deps tab)
//   6. Skill deps — deps.length (clickable → Deps tab)
//   7. Size       — formatted bytes
//   8. Last mod   — relative time of filesystem mtime
//
// Layout: CSS grid with repeat(auto-fit, minmax(180px, 1fr)) and gap
// 0.75rem, card interior padding 1rem. Explicit @media rules in globals.css
// control typography density at the 480/768/1024 breakpoints.
// ---------------------------------------------------------------------------

export interface SkillOverviewProps {
  skill: SkillInfo;
  /** Tab-navigation callback — receives the canonical `PanelId` target. */
  onNavigate?: (panel: PanelId) => void;
  /** Optional — resolved "total activations" count, populated by the
   *  parent once /api/skills/.../activation-history resolves. */
  activationsCount?: number;
  /** Optional last-run ISO timestamp — from activation history or latest benchmark. */
  lastRunIso?: string | null;
  /** Optional repo URL derived by parent (today we fall back to `skill.homepage`). */
  repoUrl?: string | null;
  /** Optional relative path inside the repo (used by SourceFileLink). */
  skillPathInRepo?: string | null;
}

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

function benchmarkValue(skill: SkillInfo): string {
  switch (skill.benchmarkStatus) {
    case "pass":
    case "fail":
    case "stale":
      return skill.benchmarkStatus === "pass" ? "100%" : skill.benchmarkStatus === "fail" ? "0%" : "—";
    default:
      return "—";
  }
}

function installMethodChip(skill: SkillInfo): ReactNode {
  const m = skill.installMethod;
  if (!m) return null;
  const label = m === "authored" ? "Authored" : m === "copied" ? "Copied" : "Symlinked";
  return (
    <span
      data-testid="overview-install-method"
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "1px 6px",
        border: "1px solid var(--border-default, var(--border))",
        borderRadius: 4,
        fontFamily: "var(--font-mono, var(--font-geist-mono))",
        fontSize: 10,
        color: "var(--text-secondary)",
        textTransform: "uppercase",
        letterSpacing: 0.4,
      }}
    >
      {label}
    </span>
  );
}

export function SkillOverview(props: SkillOverviewProps) {
  const { skill, onNavigate, activationsCount = 0, lastRunIso = null, repoUrl, skillPathInRepo } = props;
  const effectiveRepoUrl = repoUrl ?? (isLikelyGitHubUrl(skill.homepage) ? skill.homepage ?? null : null);
  const mcpDepsCount = skill.mcpDeps?.length ?? 0;
  const skillDepsCount = skill.deps?.length ?? 0;

  return (
    <div
      data-testid="skill-overview"
      className="skill-overview"
      style={{ display: "flex", flexDirection: "column", gap: 12, padding: 16 }}
    >
      {/* Compact sticky header — skill name, version badge, install method,
          and byline row (author + source + category + last modified). */}
      <header
        data-testid="skill-overview-header"
        style={{
          position: "sticky",
          top: 0,
          zIndex: 5,
          display: "flex",
          flexDirection: "column",
          gap: 6,
          padding: "10px 12px",
          background: "var(--bg-surface, var(--surface-1))",
          border: "1px solid var(--border-default, var(--border))",
          borderRadius: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <h2
            data-testid="skill-overview-name"
            style={{
              fontFamily: "var(--font-serif, var(--font-sans))",
              fontSize: 18,
              fontWeight: 500,
              color: "var(--text-primary)",
              margin: 0,
              lineHeight: 1.2,
            }}
          >
            {skill.skill}
          </h2>
          <VersionBadge
            version={skill.resolvedVersion ?? skill.version ?? null}
            source={skill.versionSource}
            pluginName={skill.pluginName ?? null}
          />
          {installMethodChip(skill)}
        </div>
        <div
          data-testid="skill-overview-byline"
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 10,
            fontFamily: "var(--font-sans)",
            fontSize: 12,
            color: "var(--text-secondary)",
          }}
        >
          <AuthorLink author={skill.author ?? null} repoUrl={effectiveRepoUrl} />
          {skill.category ? <span>· {skill.category}</span> : null}
          <SourceFileLink
            repoUrl={effectiveRepoUrl}
            skillPath={skillPathInRepo ?? null}
            absolutePath={skill.dir}
          />
          {skill.lastModified ? (
            <span title={skill.lastModified}>
              · Updated {formatRelativeTime(skill.lastModified)}
            </span>
          ) : null}
        </div>
      </header>

      {/* 0772 US-005: GitHub publish-readiness row. Renders nothing while
          status is loading; once resolved, renders one of three states. */}
      <PublishStatusRow />

      {/* Responsive 8-card grid */}
      <div
        data-testid="skill-overview-grid"
        className="skill-overview-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: "0.75rem",
          alignItems: "stretch",
        }}
      >
        <MetricCard
          title="Benchmark"
          value={benchmarkValue(skill)}
          subtitle={skill.lastBenchmark ? formatRelativeTime(skill.lastBenchmark) : "Never run"}
          data-testid="metric-benchmark"
          onClick={onNavigate ? () => onNavigate("run") : undefined}
        >
          <div style={{ marginTop: 4, display: "inline-flex", alignItems: "center" }}>
            <BenchmarkInfoPopover onNavigate={onNavigate} />
          </div>
        </MetricCard>
        <MetricCard
          title="Tests"
          value={skill.evalCount ?? 0}
          subtitle={`${skill.assertionCount ?? 0} assertions`}
          data-testid="metric-tests"
          onClick={onNavigate ? () => onNavigate("tests") : undefined}
        />
        <MetricCard
          title="Activations"
          value={activationsCount}
          subtitle={lastRunIso ? `Last: ${formatRelativeTime(lastRunIso)}` : "Never"}
          data-testid="metric-activations"
          onClick={onNavigate ? () => onNavigate("activation") : undefined}
        />
        <MetricCard
          title="Last run"
          value={formatRelativeTime(lastRunIso ?? skill.lastBenchmark ?? null)}
          data-testid="metric-last-run"
          onClick={onNavigate ? () => onNavigate("history") : undefined}
        />
        <MetricCard
          title="MCP deps"
          value={mcpDepsCount}
          subtitle={
            mcpDepsCount > 0 && skill.mcpDeps ? skill.mcpDeps.slice(0, 3).join(", ") : "None"
          }
          data-testid="metric-mcp-deps"
          onClick={onNavigate ? () => onNavigate("deps") : undefined}
        />
        <MetricCard
          title="Skill deps"
          value={skillDepsCount}
          subtitle={
            skillDepsCount > 0 && skill.deps ? skill.deps.slice(0, 3).join(", ") : "None"
          }
          data-testid="metric-skill-deps"
          onClick={onNavigate ? () => onNavigate("deps") : undefined}
        />
        <MetricCard
          title="Size"
          value={formatBytes(skill.sizeBytes)}
          data-testid="metric-size"
        />
        <MetricCard
          title="Last modified"
          value={formatRelativeTime(skill.lastModified)}
          subtitle={skill.lastModified ?? undefined}
          data-testid="metric-last-modified"
        />
      </div>
    </div>
  );
}

function isLikelyGitHubUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return /^https?:\/\/(?:www\.)?(?:github\.com|raw\.githubusercontent\.com)\//.test(url);
}

export default SkillOverview;
