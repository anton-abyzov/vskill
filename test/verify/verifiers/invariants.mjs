// Invariants verifier — runs each declared predicate against the surface.
/**
 * @param {import("../verify-types.mjs").Invariant[]} invariants
 * @param {any} surface
 * @returns {Promise<import("../verify-types.mjs").Check[]>}
 */
export async function runInvariants(invariants, surface) {
  if (!invariants?.length) {
    return [{ id: "invariants.declared", status: "warn", message: "no invariants — surface unverified beyond schema" }];
  }
  /** @type {import("../verify-types.mjs").Check[]} */
  const checks = [];
  for (const inv of invariants) {
    try {
      const ok = await inv.predicate(surface);
      checks.push({
        id: `invariant.${inv.id}`,
        status: ok ? "ok" : "fail",
        message: inv.description,
      });
    } catch (err) {
      // Anthropic rule: swallowing verifier errors is forbidden — convert to explicit fail.
      checks.push({
        id: `invariant.${inv.id}`,
        status: "fail",
        message: `${inv.description} — threw: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }
  return checks;
}
