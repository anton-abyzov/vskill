// ---------------------------------------------------------------------------
// integration-types.ts -- types for the integration test runner
// ---------------------------------------------------------------------------

export type IntegrationPhase = "preflight" | "connect" | "execute" | "verify" | "cleanup";

export interface PhaseResult {
  phase: IntegrationPhase;
  status: "pass" | "fail" | "skipped";
  durationMs?: number;
  errorMessage?: string;
}

export interface IntegrationRunResult {
  evalId: string;
  runId: string;
  phases: PhaseResult[];
  overallPass: boolean;
  testArtifactIds: string[];
  dryRun: boolean;
}

export interface PlatformRateLimit {
  requestsPerMinute: number;
}

export interface IntegrationRequirements {
  chromeProfile?: string;
  chromeProfilePath?: string; // absolute path override
  platform?: string;
  rateLimit?: PlatformRateLimit;
}

export interface CleanupAction {
  type: "delete_post" | "remove_artifact" | "custom";
  description: string;
  execute?: () => Promise<void>;
}

export interface IntegrationEvalCase {
  id: number | string;
  name: string;
  prompt: string;
  expected_output: string;
  assertions: Array<{ id: string; text: string; type: string }>;
  testType: "integration";
  requiredCredentials?: string[];
  requirements?: IntegrationRequirements;
  cleanup?: CleanupAction[];
}

export interface IntegrationRunOpts {
  dryRun?: boolean;
  confirm?: boolean;
  skillDir: string;
  runId?: string;
}

/** Default rate limits per platform (requests per minute). */
export const DEFAULT_RATE_LIMITS: Record<string, PlatformRateLimit> = {
  x: { requestsPerMinute: 3 },
  twitter: { requestsPerMinute: 3 },
  linkedin: { requestsPerMinute: 2 },
  slack: { requestsPerMinute: 10 },
  instagram: { requestsPerMinute: 5 },
  facebook: { requestsPerMinute: 5 },
};

export const DEFAULT_RATE_LIMIT: PlatformRateLimit = { requestsPerMinute: 10 };

// ---------------------------------------------------------------------------
// Schema types for eval generation validation (US-003, US-004)
// ---------------------------------------------------------------------------

export const VALID_CLEANUP_ACTIONS = ["delete_post", "remove_artifact", "custom"] as const;
export type CleanupActionType = typeof VALID_CLEANUP_ACTIONS[number];

export interface EvalCleanupSchema {
  action: CleanupActionType;
  platform?: string;
  identifier?: string;
  description?: string;
}

export interface EvalRequirementsSchema {
  chromeProfile?: string;
  platform?: string;
}
