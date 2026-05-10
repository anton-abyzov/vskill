// ---------------------------------------------------------------------------
// 0836 US-002 — test helpers for the X-Studio-Token gate.
//
// Tests that drive `Router.handle()` against `/api/*` paths must include the
// live studio token; otherwise the gate writes 401 and the route handler
// never runs. Use:
//
//   import { studioTokenHeaders } from "./helpers/studio-token-test-helpers.js";
//   const req = { ..., headers: { host: "localhost", ...studioTokenHeaders() } };
//
// For real-fetch tests:
//
//   await fetch(url, { headers: studioTokenHeaders() });
// ---------------------------------------------------------------------------

import { getStudioToken } from "../../router.js";

/** Returns `{ "x-studio-token": <token> }` for spreading into headers. */
export function studioTokenHeaders(): Record<string, string> {
  return { "x-studio-token": getStudioToken() };
}
