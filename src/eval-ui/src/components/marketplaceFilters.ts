import type {
  MarketplacePlugin,
  MarketplaceSummary,
} from "./MarketplaceDrawer";

function normalize(query: string): string {
  return query.trim().toLowerCase();
}

export function filterMarketplaces(
  list: MarketplaceSummary[],
  query: string,
): MarketplaceSummary[] {
  const q = normalize(query);
  if (!q) return list;
  return list.filter(
    (m) =>
      m.name.toLowerCase().includes(q) ||
      m.source.toLowerCase().includes(q),
  );
}

export function filterMarketplacePlugins(
  list: MarketplacePlugin[],
  query: string,
): MarketplacePlugin[] {
  const q = normalize(query);
  if (!q) return list;
  return list.filter((p) => {
    const haystack = [
      p.name,
      p.description ?? "",
      p.category ?? "",
      p.author ?? "",
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  });
}
