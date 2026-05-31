// Self-registering Map of units. Mirrors src/verify/core/registry.ts.
/** @type {Map<string, import("./verify-types.mjs").VerifiableUnit>} */
const units = new Map();

/** @param {import("./verify-types.mjs").VerifiableUnit} unit */
export function registerUnit(unit) {
  if (units.has(unit.id)) throw new Error(`duplicate unit id: ${unit.id}`);
  units.set(unit.id, unit);
}

export function listUnits() {
  return [...units.values()];
}

export function buildManifest() {
  return [...units.values()].map((u) => ({
    id: u.id,
    command: u.command,
    fixtures: u.fixtures.map((f) => ({ id: f.id, probe: !!f.probe })),
    invariants: u.invariants.map((i) => ({ id: i.id, description: i.description })),
  }));
}
