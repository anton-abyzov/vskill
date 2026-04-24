// ---------------------------------------------------------------------------
// boot-preflight.ts — Runs ONCE at server boot BEFORE provider imports.
//
// CRITICAL ORDERING: this module's side effects MUST execute before any
// other module touches `process.env.*_API_KEY`. In eval-server.ts this is
// imported at the VERY TOP, before the Anthropic / OpenAI / OpenRouter
// client modules. Do NOT reorder or the merge runs after providers have
// already captured an empty env.
//
// Phase 2 (T-021) wires this into eval-server.ts. For Phase 1, this module
// exists as a stub so Phase 2 agents can import it without additional changes.
// ---------------------------------------------------------------------------

import { mergeStoredKeysIntoEnv } from "./settings-store.js";

mergeStoredKeysIntoEnv();
