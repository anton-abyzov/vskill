import { isValidSemver } from "./semver";

// Numeric identifiers can exceed Number.MAX_SAFE_INTEGER. Compare their
// lengths before their digits so valid large versions keep exact precedence.
function compareNumeric(a: string, b: string): number {
  return a.length === b.length ? (a === b ? 0 : a < b ? -1 : 1) : a.length < b.length ? -1 : 1;
}

/** SemVer precedence, ignoring build metadata. Invalid inputs are unordered. */
export function compareSemver(a: string, b: string): number | null {
  if (!isValidSemver(a) || !isValidSemver(b)) return null;
  const parse = (version: string) => {
    const [withoutBuild] = version.trim().split("+");
    const dash = withoutBuild.indexOf("-");
    return {
      core: (dash < 0 ? withoutBuild : withoutBuild.slice(0, dash)).split("."),
      pre: dash < 0 ? [] : withoutBuild.slice(dash + 1).split("."),
    };
  };
  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < 3; i++) {
    const cmp = compareNumeric(left.core[i], right.core[i]);
    if (cmp) return cmp;
  }
  if (!left.pre.length || !right.pre.length) {
    return left.pre.length === right.pre.length ? 0 : left.pre.length ? -1 : 1;
  }
  for (let i = 0; i < Math.max(left.pre.length, right.pre.length); i++) {
    const x = left.pre[i];
    const y = right.pre[i];
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    if (x === y) continue;
    const xNumeric = /^\d+$/.test(x);
    const yNumeric = /^\d+$/.test(y);
    if (xNumeric && yNumeric) return compareNumeric(x, y);
    if (xNumeric !== yNumeric) return xNumeric ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}
