/**
 * JSON formatter — serializes AuditResult as structured JSON.
 */

import type { AuditResult } from "../audit-types.js";

/**
 * Format an AuditResult as a JSON string.
 */
export function formatJson(result: AuditResult): string {
  return JSON.stringify(result, null, 2);
}
