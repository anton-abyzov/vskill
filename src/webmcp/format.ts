// ---------------------------------------------------------------------------
// vskill audit-webmcp -- terminal output.
// ---------------------------------------------------------------------------

import { bold, cyan, dim, green, red, yellow } from "../utils/output.js";
import type { Severity, SiteReport } from "./types.js";

function sevLabel(s: Severity): string {
  const label = s.toUpperCase().padEnd(8);
  if (s === "critical" || s === "high") return red(label);
  if (s === "medium") return yellow(label);
  if (s === "low") return cyan(label);
  return dim(label);
}

function verdictLabel(r: SiteReport): string {
  const v = r.summary.verdict;
  if (v === "ERROR") return red(v);
  return v === "PASS" ? green(v) : v === "CONCERNS" ? yellow(v) : red(v);
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

function shortScript(url: string | undefined): string {
  if (!url) return "-";
  try {
    const u = new URL(url);
    const path = u.pathname.length > 32 ? `${u.pathname.slice(0, 31)}…` : u.pathname;
    return `${u.host}${path}`;
  } catch {
    return url;
  }
}

const yn = (b: boolean | undefined) => (b === true ? "yes" : b === false ? "no" : "-");

export function formatSiteTerminal(r: SiteReport): string {
  const lines: string[] = [];
  const s = r.summary;
  const target = r.finalUrl && r.finalUrl !== r.url ? `${r.url} -> ${r.finalUrl}` : r.url;
  const failed = s.verdict === "ERROR";
  lines.push(`${bold(target)}  ${verdictLabel(r)}${failed ? "" : `  ${dim(`score ${s.score}`)}`}`);
  if (r.error) lines.push(`  ${red("error:")} ${r.error}`);
  if (failed) return lines.join("\n");

  if (!r.webmcp.documentModelContext && !r.error) {
    lines.push(dim("  document.modelContext is not available in this browser; WebMCP was not enabled."));
  }
  if (r.webmcp.navigatorModelContext) {
    lines.push(yellow("  navigator.modelContext exists (removed in Chrome 152; the page may polyfill it)."));
  }

  lines.push(
    `  ${s.toolCount} tools: ${s.readOnlyCount} read-only, ${s.consequentialCount} consequential, ` +
      `${s.writeShapedCount} write-shaped, ${s.thirdPartyCount} third-party`,
  );

  if (r.tools.length > 0) {
    const nameW = Math.min(32, Math.max(4, ...r.tools.map((t) => t.name.length)));
    lines.push(dim(`  ${pad("TOOL", nameW)}  READONLY  CONSEQ  3P   REGISTERED BY`));
    for (const t of r.tools) {
      const name = t.name.length > nameW ? `${t.name.slice(0, nameW - 1)}…` : t.name;
      lines.push(
        `  ${pad(name, nameW)}  ${pad(yn(t.annotations.readOnlyHint), 8)}  ${pad(yn(t.annotations.consequentialHint), 6)}  ` +
          `${pad(t.thirdParty ? "yes" : "no", 3)}  ${shortScript(t.registeredBy)}`,
      );
    }
  }

  if (r.findings.length > 0) {
    lines.push("");
    for (const f of r.findings) {
      lines.push(`  ${sevLabel(f.severity)} ${f.id}  ${f.tool ? `${bold(f.tool)}: ` : ""}${f.message}`);
    }
  } else if (r.tools.length > 0) {
    lines.push(green("  No findings."));
  }
  return lines.join("\n");
}

export function formatBatchFooter(reports: SiteReport[]): string {
  const withTools = reports.filter((r) => r.summary.toolCount > 0).length;
  const count = (v: SiteReport["summary"]["verdict"]) => reports.filter((r) => r.summary.verdict === v).length;
  const errors = count("ERROR");
  return bold(
    `${reports.length} sites: ${withTools} expose WebMCP tools | ` +
      `${count("PASS")} PASS, ${count("CONCERNS")} CONCERNS, ${count("FAIL")} FAIL, ${errors} errors`,
  );
}
