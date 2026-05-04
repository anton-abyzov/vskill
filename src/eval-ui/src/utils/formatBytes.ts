// 0823 simplify: shared byte formatter. Previously inlined in SkillOverview,
// MetadataTab, SecondaryFileViewer, SourcePanel — all four implementations
// were near-identical. Pick this canonical form.
//
//   < 1 KB  → "<n> B"
//   < 1 MB  → "<kb> KB"  (one decimal under 10, rounded above)
//   else    → "<mb> MB"  (one decimal under 10, rounded above)
//   null/NaN → "—" (em-dash placeholder for missing data)

export function formatBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  if (kb < 1024)
    return kb >= 10 ? `${Math.round(kb)} KB` : `${kb.toFixed(1).replace(/\.0$/, "")} KB`;
  const mb = kb / 1024;
  return mb >= 10 ? `${Math.round(mb)} MB` : `${mb.toFixed(1).replace(/\.0$/, "")} MB`;
}
