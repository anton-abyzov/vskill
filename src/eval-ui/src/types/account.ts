/**
 * 0834 — Account cabinet shared DTOs (mirror of vskill-platform).
 *
 * Source of truth: `vskill-platform/src/lib/types/account.ts`. This file
 * is a verbatim copy so eval-ui can compile standalone (npx-studio bundle
 * has no platform code-path resolution). When the platform shape changes,
 * copy the new definitions in here.
 *
 * Wire-format invariants:
 *   - BigInt installationId → string
 *   - Token list never includes plaintext/hash
 *   - securityAlerts literal `true` only
 *   - Sync status lowercase on the wire ("green")
 */

// ─── Tier (mirrors Prisma UserTier) ───────────────────────

/** UserTier values normalized to lowercase strings on the wire. */
export type UserTierWire = "free" | "pro" | "enterprise";

// ─── Profile ──────────────────────────────────────────────

/** GET /api/v1/account/profile response. */
export interface ProfileDTO {
  userId: string;
  /** Editable. Falls back to githubUsername when null. Max 80 chars. */
  displayName: string;
  /** Read-only. Synced from GitHub. */
  githubHandle: string;
  /** GitHub avatar URL. Read-only. */
  avatarUrl: string | null;
  /** Public bio. Max 280 chars. Null = not set. */
  bio: string | null;
  /** Whether `/u/{handle}` is publicly visible. */
  publicProfile: boolean;
  /** Pricing tier. Read-only here — change via /pricing waitlist. */
  tier: UserTierWire;
  /** ISO-8601 timestamp of account creation. */
  createdAt: string;
}

/** PATCH /api/v1/account/profile request body. All fields optional. */
export interface ProfilePatchDTO {
  displayName?: string;
  bio?: string | null;
  publicProfile?: boolean;
}

// ─── Connected repos ──────────────────────────────────────

/**
 * Sync status for a connected repo. Mirrors Prisma SyncStatus enum but
 * lowercase (matches how the table component renders the dot color and
 * the API serializes the enum).
 *
 * - `green`: healthy, synced within the last 24h
 * - `amber`: reauth needed (installation token expired)
 * - `grey`:  idle (no sync activity in 24h)
 * - `red`:   error during last sync (see lastErrorMessage)
 */
export type SyncStatusWire = "green" | "amber" | "grey" | "red";

/** A row in the connected-repos table (GET /api/v1/account/repos). */
export interface ConnectedRepoDTO {
  repoId: string;
  ownerLogin: string;
  ownerAvatarUrl: string;
  repoName: string;
  /** "owner/name" — convenience for GitHub URL construction. */
  repoFullName: string;
  isPrivate: boolean;
  skillsCount: number;
  syncStatus: SyncStatusWire;
  /** ISO-8601 of last successful scan, null if never synced. */
  lastSyncedAt: string | null;
  /** ISO-8601 of last activity (sync OR connect), null if neither. */
  lastActivityAt: string | null;
  /** Surfaced as hover tooltip on RED rows. */
  lastErrorMessage: string | null;
  /**
   * GitHub installation_id this connection rides on. Stringified because
   * BigInt does not survive JSON.
   */
  githubInstallationId: string;
}

/** GET /api/v1/account/repos response. */
export interface ConnectedReposListDTO {
  repos: ConnectedRepoDTO[];
  /** Total number of connected (non-disconnected) repos. */
  totalCount: number;
  /** Public repo count (drives the summary chip). */
  publicCount: number;
  /** Private repo count (drives the summary chip + paywall trigger). */
  privateCount: number;
}

// ─── API tokens ──────────────────────────────────────────

/** Valid token scopes. v1 supports read/write; admin scopes slot in later. */
export type TokenScope = "read" | "write";

/** A row in the tokens table (GET /api/v1/account/tokens). Never includes plaintext. */
export interface TokenDTO {
  id: string;
  /** User-chosen label, e.g. "MacBook CLI". */
  name: string;
  /** First 12 chars, e.g. "vsk_x9a2b8c4". For identification only. */
  prefix: string;
  scopes: TokenScope[];
  /** ISO-8601, null if never used. */
  lastUsedAt: string | null;
  createdAt: string;
  expiresAt: string;
  /** Non-null = revoked. Listed-only; revoke via DELETE endpoint. */
  revokedAt: string | null;
}

/** POST /api/v1/account/tokens request body. */
export interface TokenCreateRequestDTO {
  name: string;
  scopes: TokenScope[];
  /** Days until expiry. Common values: 30, 90, 365. Server caps at 365. */
  expiresInDays: number;
}

/**
 * POST /api/v1/account/tokens response. The `plaintext` field is shown
 * ONCE in the UI and never returned from the list endpoint.
 */
export interface TokenCreateResponseDTO {
  token: TokenDTO;
  /** Full vsk_*-prefixed plaintext. Only time the user sees this value. */
  plaintext: string;
}

// ─── Notification preferences ────────────────────────────

/**
 * Notification preference keys. `securityAlerts` is always true — the API
 * rejects PATCH bodies that try to set it false.
 */
export interface NotificationPrefsDTO {
  weeklyDigest: boolean;
  /** Always true — wire-level invariant. */
  securityAlerts: true;
  commentReplies: boolean;
  productUpdates: boolean;
}

/**
 * PATCH /api/v1/account/notifications body. `securityAlerts` is omitted
 * intentionally — the server rejects attempts to mutate it.
 */
export interface NotificationPrefsPatchDTO {
  weeklyDigest?: boolean;
  commentReplies?: boolean;
  productUpdates?: boolean;
}

// ─── Skills summary ──────────────────────────────────────

/** A single recent activity line on the Skills tab. */
export interface SkillActivityDTO {
  skillName: string;
  action: "published" | "updated";
  /** ISO-8601 timestamp. */
  timestamp: string;
}

/** GET /api/v1/account/skills/summary response. */
export interface SkillsSummaryDTO {
  publicCount: number;
  privateCount: number;
  /** Last 5 publishes/updates, newest first. */
  recentActivity: SkillActivityDTO[];
}

// ─── Account exports (Danger zone) ───────────────────────

/** Mirrors Prisma ExportStatus enum but lowercase on the wire. */
export type ExportStatusWire =
  | "queued"
  | "processing"
  | "ready"
  | "failed"
  | "expired";

/** A row in the export-history table on the Danger zone tab. */
export interface AccountExportDTO {
  id: string;
  status: ExportStatusWire;
  requestedAt: string;
  completedAt: string | null;
  /** Pre-signed R2 URL. Null until status=ready, also null after expired. */
  downloadUrl: string | null;
  expiresAt: string | null;
}

// ─── Pre-flight connect flow ─────────────────────────────

/**
 * Response from GET /api/v1/account/repos/connect — used by the
 * pre-flight permissions page to render the Continue button URL.
 */
export interface ConnectPreflightDTO {
  /** Full GitHub install URL with state token query param. */
  redirectUrl: string;
  /** App slug, e.g. "verified-skill". For display in the modal copy. */
  appSlug: string;
}

// ─── Local UI helpers ─────────────────────────────────────
//
// Component-prop types shared by the eval-ui shell. Not part of the
// platform wire contract — kept here so account-related types live in
// one place.

/**
 * Action callbacks that ConnectedReposTable emits. The host wires these
 * to the fetch/IPC layer (web → fetch, desktop → useAccount mutate).
 */
export interface ConnectedReposActions {
  onOpenOnGitHub(repo: ConnectedRepoDTO): void;
  onResync(repo: ConnectedRepoDTO): void | Promise<void>;
  onDisconnect(repo: ConnectedRepoDTO): void | Promise<void>;
  onConnectNew(): void;
}

// ─── Backwards-compat aliases ─────────────────────────────
//
// The pre-contract draft of this file used different names before the
// platform DTO landed. Aliases let consumers migrate gradually. The
// platform names (PlatformDTO suffix) are canonical; the aliases will
// be removed once every consumer points at them.

/** @deprecated use UserTierWire */
export type Tier = UserTierWire;
/** @deprecated use SyncStatusWire */
export type SyncStatus = SyncStatusWire;
/** @deprecated use ExportStatusWire */
export type ExportStatus = ExportStatusWire;
/** @deprecated use ProfileDTO */
export type AccountProfile = ProfileDTO;
/** @deprecated use ProfilePatchDTO */
export type AccountProfilePatch = ProfilePatchDTO;
/** @deprecated use ConnectedRepoDTO */
export type ConnectedRepo = ConnectedRepoDTO;
/** @deprecated use TokenDTO */
export type ApiToken = TokenDTO;
/** @deprecated use NotificationPrefsDTO */
export type NotificationPreferences = NotificationPrefsDTO;
/** @deprecated use one of the explicit keys of NotificationPrefsDTO */
export type NotificationKey = keyof NotificationPrefsDTO;
/** @deprecated use AccountExportDTO */
export type AccountExport = AccountExportDTO;
/** @deprecated use SkillsSummaryDTO */
export type SkillsSummary = SkillsSummaryDTO;

/**
 * Pre-contract shape merged TokenDTO + plaintext into a single object.
 * The canonical platform DTO splits them. Intersection alias keeps
 * existing code (`created.id` / `created.plaintext`) compiling; new
 * code should treat token + plaintext as separate fields per
 * TokenCreateResponseDTO.
 *
 * @deprecated use TokenCreateResponseDTO
 */
export type CreatedApiToken = TokenDTO & { plaintext: string };
