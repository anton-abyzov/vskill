/**
 * Agent filtering for the --agent flag.
 *
 * Filters a list of detected agents down to only the ones the user
 * explicitly requested. Throws a descriptive error when any requested
 * ID is not found among the detected agents.
 */

import type { AgentDefinition } from "../agents/agents-registry.js";

/**
 * Filter `agents` to only those whose `id` appears in `requestedIds`.
 *
 * - If `requestedIds` is `undefined` or an empty array, all agents are returned.
 * - If any requested ID does not match a detected agent, an error is thrown
 *   listing the available agent IDs.
 */
export function filterAgents(
  agents: AgentDefinition[],
  requestedIds?: string | string[],
): AgentDefinition[] {
  // Coerce single string to array (defensive: Commander may pass string for --agent)
  const ids = typeof requestedIds === "string"
    ? (requestedIds ? [requestedIds] : [])
    : requestedIds;

  if (!ids || ids.length === 0) {
    return agents;
  }

  const available = new Set(agents.map((a) => a.id));
  const missing = ids.filter((id) => !available.has(id));

  if (missing.length > 0) {
    const availableList = agents.map((a) => a.id).join(", ");
    throw new Error(
      `Unknown agent(s): ${missing.join(", ")}. Available: ${availableList}`,
    );
  }

  const requested = new Set(ids);
  return agents.filter((a) => requested.has(a.id));
}
