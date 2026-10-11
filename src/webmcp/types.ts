// ---------------------------------------------------------------------------
// vskill audit-webmcp -- shared types.
//
// The JSON report shape (schemaVersion 1) is documented in README.md under
// "Audit a site's WebMCP tools". Keep the two in sync.
// ---------------------------------------------------------------------------

import type { PatternSeverity, ScanVerdict } from "../scanner/patterns.js";

export type Severity = PatternSeverity;

export const SEVERITIES: Severity[] = ["critical", "high", "medium", "low", "info"];

/** Annotations normalized to the WebMCP hint names. */
export interface ToolAnnotations {
  readOnlyHint?: boolean;
  consequentialHint?: boolean;
  untrustedContentHint?: boolean;
}

/**
 * Who registered a tool, from its script URL (see attribution.ts):
 * the page's own site, the hosting platform's own code, a library from a
 * public npm CDN, or another site.
 */
export type RegistrarKind = "first-party" | "platform" | "library" | "third-party";

/** Where we learned about a tool. */
export type ToolSource = "registerTool" | "cdp" | "getTools";

export interface WebmcpTool {
  name: string;
  title?: string;
  description?: string;
  /** Parsed JSON Schema when the page supplied valid JSON; otherwise the raw value. */
  inputSchema?: unknown;
  annotations: ToolAnnotations;
  /** Script URL that called registerTool (from a captured stack trace). */
  registeredBy?: string;
  /** Classification of registeredBy; absent when the script URL is unknown. */
  registeredByKind?: RegistrarKind;
  /** Platform name when registeredByKind is "platform" (e.g. "Shopify"). */
  registeredByPlatform?: string;
  /** Package the CDN URL names when registeredByKind is "library" (e.g. "simple-webmcp@0.3.0"). */
  registeredByPackage?: string;
  /** True when registeredByKind is "third-party": another site that is neither the page's platform nor a public npm CDN. */
  thirdParty: boolean;
  /** Origins the tool is exposed to, when the page passed exposedTo. */
  exposedTo?: string[];
  sources: ToolSource[];
}

export interface WebmcpFinding {
  id: string;
  severity: Severity;
  /** Tool name, or null for a page-level finding. */
  tool: string | null;
  message: string;
}

export interface SiteSummary {
  toolCount: number;
  readOnlyCount: number;
  consequentialCount: number;
  writeShapedCount: number;
  thirdPartyCount: number;
  /** Tools registered by the hosting platform's own script. */
  platformCount: number;
  /** Tools registered by a library loaded from a public npm CDN. */
  libraryCount: number;
  findingsBySeverity: Record<Severity, number>;
  /** null when the site failed to load and nothing was enumerated. */
  score: number | null;
  /** ERROR when the site failed to load and nothing was enumerated. */
  verdict: ScanVerdict | "ERROR";
}

export interface SiteReport {
  schemaVersion: 1;
  url: string;
  finalUrl: string | null;
  scannedAt: string;
  webmcp: {
    documentModelContext: boolean;
    navigatorModelContext: boolean;
  };
  headers: {
    permissionsPolicy: string | null;
  };
  /** Hosting platforms detected on the page (e.g. ["shopify"]). */
  platforms: string[];
  tools: WebmcpTool[];
  findings: WebmcpFinding[];
  summary: SiteSummary;
  error?: string;
}

/** Raw enumeration result, before scoring. */
export interface EnumerationResult {
  url: string;
  finalUrl: string | null;
  documentModelContext: boolean;
  navigatorModelContext: boolean;
  permissionsPolicy: string | null;
  /** Hosting platforms detected on the page (e.g. ["shopify"]). */
  platforms?: string[];
  tools: WebmcpTool[];
  error?: string;
}
