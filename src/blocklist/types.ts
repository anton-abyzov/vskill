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

export interface RejectionInfo {
  skillName: string;
  state: string;
  reason: string;
  score: number | null;
  rejectedAt: string;
}

export interface InstallSafetyResult {
  blocked: boolean;
  entry?: BlocklistEntry;
  rejected: boolean;
  rejection?: RejectionInfo;
}
