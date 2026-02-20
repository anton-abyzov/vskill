// Safe module — no issues
export function parseId(raw: string): number {
  return parseInt(raw, 10);
}
