// ---------------------------------------------------------------------------
// Blocklist types — malicious skills registry
// ---------------------------------------------------------------------------

export interface BlocklistEntry {
  skillName: string;
  sourceUrl?: string;
  sourceRegistry?: string;
  contentHash?: string;
  threatType: string;
  severity: string;
  reason: string;
  evidenceUrls: string[];
  discoveredAt: string;
}

export interface BlocklistCache {
  entries: BlocklistEntry[];
  count: number;
  lastUpdated: string;
  fetchedAt: string;
  etag?: string;
}
