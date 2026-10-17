// ---------------------------------------------------------------------------
// hosted-publishing.ts — Skill Studio's copy of verified-skill.com's launch
// gate for hosted private publishing (0874 AC-07).
//
// Mirrors the platform's launch gate, vskill-platform
// HOSTED_PRIVATE_PUBLISHING_AVAILABLE; flip both together, in one release.
// Studio cannot read the platform constant, so it carries its own.
// ---------------------------------------------------------------------------

import { PRICING_URL } from "./hooks/useTier";

/** Mirrors the platform's launch gate; flip both together. */
export { HOSTED_PRIVATE_PUBLISHING_AVAILABLE } from "../../lib/hosted-publishing";

/** The waitlist on the pricing page, offered while the gate is closed. */
export const HOSTED_WAITLIST_URL = `${PRICING_URL}#hosted-waitlist`;
