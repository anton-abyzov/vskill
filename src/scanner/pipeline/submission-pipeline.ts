/**
 * Submission Pipeline State Machine
 *
 * Deterministic state machine for processing skill verification requests.
 * Every state transition is logged for audit trail compliance.
 *
 * @see research/submission-state-machine.md for full design
 */

// ---------------------------------------------------------------------------
// State Enum
// ---------------------------------------------------------------------------

/**
 * All possible states in the submission pipeline.
 * Terminal states: TIER1_FAILED, REJECTED, PUBLISHED
 */
export enum SubmissionState {
  /** Initial state — submission received via API or web form */
  RECEIVED = 'RECEIVED',

  /** Tier 1 deterministic scan running */
  TIER1_SCANNING = 'TIER1_SCANNING',

  /** Tier 1 failed — terminal state */
  TIER1_FAILED = 'TIER1_FAILED',

  /** Tier 2 LLM judge analysis running */
  TIER2_SCANNING = 'TIER2_SCANNING',

  /** Both tiers passed with score >= 80 — auto-approved */
  AUTO_APPROVED = 'AUTO_APPROVED',

  /** Tier 2 returned CONCERNS (60-79) or high-privilege skill — needs human review */
  NEEDS_REVIEW = 'NEEDS_REVIEW',

  /** Tier 3 manual review in progress */
  TIER3_REVIEW = 'TIER3_REVIEW',

  /** Approved and published to registry */
  PUBLISHED = 'PUBLISHED',

  /** Rejected at any stage — terminal state */
  REJECTED = 'REJECTED',

  /** Vendor auto-verified — bypassed scanning */
  VENDOR_APPROVED = 'VENDOR_APPROVED',
}

// ---------------------------------------------------------------------------
// Transition Types
// ---------------------------------------------------------------------------

/** Actor types that can trigger state transitions */
export type TransitionActor = 'system' | 'worker' | 'admin';

/** A state transition event for the audit trail */
export interface StateTransitionEvent {
  /** Unique event ID */
  id: string;

  /** Submission this event belongs to */
  submissionId: string;

  /** State before the transition (null for initial RECEIVED) */
  fromState: SubmissionState | null;

  /** State after the transition */
  toState: SubmissionState;

  /** What triggered this transition */
  trigger: string;

  /** Who triggered the transition */
  actor: string;

  /** Actor type classification */
  actorType: TransitionActor;

  /** Context-specific metadata (scan results, scores, etc.) */
  metadata: Record<string, unknown>;

  /** ISO timestamp when the transition occurred */
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Valid Transitions Map
// ---------------------------------------------------------------------------

/**
 * Defines all valid state transitions.
 * Any transition not in this map is invalid and will be rejected.
 */
const VALID_TRANSITIONS: Record<SubmissionState, SubmissionState[]> = {
  [SubmissionState.RECEIVED]: [
    SubmissionState.VENDOR_APPROVED,
    SubmissionState.TIER1_SCANNING,
  ],
  [SubmissionState.TIER1_SCANNING]: [
    SubmissionState.TIER2_SCANNING,
    SubmissionState.TIER1_FAILED,
  ],
  [SubmissionState.TIER1_FAILED]: [],
  [SubmissionState.TIER2_SCANNING]: [
    SubmissionState.AUTO_APPROVED,
    SubmissionState.NEEDS_REVIEW,
    SubmissionState.REJECTED,
  ],
  [SubmissionState.AUTO_APPROVED]: [
    SubmissionState.PUBLISHED,
  ],
  [SubmissionState.NEEDS_REVIEW]: [
    SubmissionState.TIER3_REVIEW,
    SubmissionState.REJECTED,
  ],
  [SubmissionState.TIER3_REVIEW]: [
    SubmissionState.PUBLISHED,
    SubmissionState.REJECTED,
  ],
  [SubmissionState.PUBLISHED]: [],
  [SubmissionState.REJECTED]: [],
  [SubmissionState.VENDOR_APPROVED]: [
    SubmissionState.PUBLISHED,
  ],
};

// ---------------------------------------------------------------------------
// Terminal States
// ---------------------------------------------------------------------------

/** States from which no further transitions are possible */
export const TERMINAL_STATES: ReadonlySet<SubmissionState> = new Set([
  SubmissionState.TIER1_FAILED,
  SubmissionState.PUBLISHED,
  SubmissionState.REJECTED,
]);

// ---------------------------------------------------------------------------
// Transition Function
// ---------------------------------------------------------------------------

/**
 * Validate whether a state transition is allowed.
 *
 * @param current - The current state of the submission
 * @param next - The proposed next state
 * @returns true if the transition is valid
 */
export function validateTransition(
  current: SubmissionState,
  next: SubmissionState
): boolean {
  const allowed = VALID_TRANSITIONS[current];
  if (!allowed) return false;
  return allowed.includes(next);
}

/**
 * Attempt a state transition. Returns the new state if valid,
 * throws an error if the transition is not allowed.
 *
 * @param current - The current state
 * @param next - The desired next state
 * @param trigger - What caused the transition
 * @param actor - Who triggered the transition
 * @returns The new state (same as `next`)
 * @throws Error if the transition is invalid
 */
export function transition(
  current: SubmissionState,
  next: SubmissionState,
  trigger: string,
  actor: TransitionActor
): SubmissionState {
  if (!validateTransition(current, next)) {
    throw new Error(
      `Invalid state transition: ${current} → ${next} (trigger: ${trigger}, actor: ${actor})`
    );
  }
  return next;
}

// ---------------------------------------------------------------------------
// Vendor Fast-Path
// ---------------------------------------------------------------------------

/** GitHub organizations whose skills are auto-verified */
export const TRUSTED_ORGS: readonly string[] = [
  'anthropics',
  'openai',
  'google',
  'google-gemini',
  'vercel-labs',
  'supabase',
  'microsoft',
];

/**
 * Check if a GitHub repo owner is a trusted vendor organization.
 *
 * @param owner - GitHub organization or user name
 * @returns true if the owner is in the trusted orgs list
 */
export function isVendorOrg(owner: string): boolean {
  return TRUSTED_ORGS.includes(owner.toLowerCase());
}

// ---------------------------------------------------------------------------
// Utility Functions
// ---------------------------------------------------------------------------

/**
 * Check if a state is terminal (no further transitions possible).
 */
export function isTerminalState(state: SubmissionState): boolean {
  return TERMINAL_STATES.has(state);
}

/**
 * Get all valid next states from the current state.
 */
export function getNextStates(state: SubmissionState): SubmissionState[] {
  return VALID_TRANSITIONS[state] ?? [];
}

/**
 * Create a state transition audit event.
 */
export function createTransitionEvent(
  submissionId: string,
  fromState: SubmissionState | null,
  toState: SubmissionState,
  trigger: string,
  actor: string,
  actorType: TransitionActor,
  metadata: Record<string, unknown> = {}
): StateTransitionEvent {
  return {
    id: crypto.randomUUID(),
    submissionId,
    fromState,
    toState,
    trigger,
    actor,
    actorType,
    metadata,
    createdAt: new Date().toISOString(),
  };
}
