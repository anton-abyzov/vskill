// ---------------------------------------------------------------------------
// vskill audit-webmcp -- terminal output.
// ---------------------------------------------------------------------------

import { bold, cyan, dim, green, red, yellow } from "../utils/output.js";
import type { Severity, SiteReport, WebmcpTool } from "./types.js";

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

/**
 * Page-supplied text (tool names, matched description excerpts, script URLs)
 * goes to the auditor's terminal: show control and bidi-override characters
 * as U+XXXX so a site cannot send escape sequences or reorder the output.
 */
export function clean(s: string): string {
  return s.replace(/[\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/g, (c) => `U+${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}`);
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

function shortScript(url: string | undefined): string {
  if (!url) return "-";
  try {
    const u = new URL(url);
    const path = u.pathname.length > 32 ? `${u.pathname.slice(0, 31)}…` : u.pathname;
    return clean(`${u.host}${path}`);
  } catch {
    return clean(url);
  }
}

const yn = (b: boolean | undefined) => (b === true ? "yes" : b === false ? "no" : "-");

const SOURCE_LABELS: Record<NonNullable<WebmcpTool["registeredByKind"]>, string> = {
  "first-party": "1st",
  platform: "platform",
  library: "library",
  "third-party": "3rd",
};

function sourceLabel(t: WebmcpTool): string {
  if (t.registeredByKind) return SOURCE_LABELS[t.registeredByKind];
  return t.thirdParty ? "3rd" : "-";
}

export function formatSiteTerminal(r: SiteReport): string {
  const lines: string[] = [];
  const s = r.summary;
  const target = clean(r.finalUrl && r.finalUrl !== r.url ? `${r.url} -> ${r.finalUrl}` : r.url);
  const failed = s.verdict === "ERROR";
  lines.push(`${bold(target)}  ${verdictLabel(r)}${failed ? "" : `  ${dim(`score ${s.score}`)}`}`);
  if (r.error) lines.push(`  ${red("error:")} ${clean(r.error)}`);
  if (failed) return lines.join("\n");

  if (!r.webmcp.documentModelContext && !r.error) {
    lines.push(dim("  document.modelContext is not available in this browser; WebMCP was not enabled."));
  }
  if (r.webmcp.navigatorModelContext) {
    lines.push(yellow("  navigator.modelContext exists (removed in Chrome 152; the page may polyfill it)."));
  }

  lines.push(
    `  ${s.toolCount} tools: ${s.readOnlyCount} read-only, ${s.consequentialCount} consequential, ` +
      `${s.writeShapedCount} write-shaped, ${s.thirdPartyCount} third-party` +
      (s.platformCount ? `, ${s.platformCount} platform` : "") +
      (s.libraryCount ? `, ${s.libraryCount} library` : ""),
  );

  if (r.tools.length > 0) {
    const names = r.tools.map((t) => clean(t.name));
    const nameW = Math.min(32, Math.max(4, ...names.map((n) => n.length)));
    lines.push(dim(`  ${pad("TOOL", nameW)}  READONLY  CONSEQ  SOURCE    REGISTERED BY`));
    r.tools.forEach((t, i) => {
      const full = names[i];
      const name = full.length > nameW ? `${full.slice(0, nameW - 1)}…` : full;
      lines.push(
        `  ${pad(name, nameW)}  ${pad(yn(t.annotations.readOnlyHint), 8)}  ${pad(yn(t.annotations.consequentialHint), 6)}  ` +
          `${pad(sourceLabel(t), 8)}  ${shortScript(t.registeredBy)}`,
      );
    });
  }

  if (r.findings.length > 0) {
    lines.push("");
    for (const f of r.findings) {
      lines.push(`  ${sevLabel(f.severity)} ${f.id}  ${f.tool ? `${bold(clean(f.tool))}: ` : ""}${clean(f.message)}`);
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
