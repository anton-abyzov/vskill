// 0741 + 0751: SearchPaletteCore — eval-ui native command palette.
//
// Originally ported from vskill-platform/src/app/components/SearchPalette.tsx.
// Redesigned in 0751 to:
//   - use eval-ui native CSS tokens (paper/ink editorial palette) so the card
//     actually has a background and the typography matches the rest of Studio
//   - focus the input synchronously via useLayoutEffect (no 50ms setTimeout)
//   - degrade gracefully on upstream 5xx (filter trending client-side instead
//     of red error) — the same gap the network panel showed for /studio/search
//   - add a sticky footer with keyboard hints and ⌘1-9 jump shortcuts
//   - tighter single-line rows with an accent left rail on the selected row
//
// Contract preserved (don't break tests):
//   - data-testids: find-skills-palette, search-error, search-retry,
//     mini-tier-badge, search-highlight, scroll-sentinel, hard-cap-link,
//     skeleton-row
//   - role=dialog, role=listbox, role=combobox, role=option
//   - Props: onSelect, onNavigate, searchUrl, trendingUrl, telemetrySelectUrl,
//     maxPages, initialOpen
//   - openFindSkills CustomEvent (NOT openSearch)

import { useState, useEffect, useRef, useCallback, useLayoutEffect, useMemo } from "react";
import { sanitizeHighlight } from "../../lib/sanitize-html";
import { skillUrl } from "../../lib/skill-url";
import { formatTierLabel } from "./components/TierBadge";

interface TrendingSkillEntry {
  name: string;
  displayName: string;
  author: string;
  repoUrl: string;
  certTier: string;
  ownerSlug?: string;
  repoSlug?: string;
  skillSlug?: string;
}

export interface SearchResult {
  name: string;
  displayName?: string;
  command?: string | null;
  pluginName?: string | null;
  author: string;
  certTier: string;
  repoUrl: string;
  highlight?: string;
  githubStars?: number;
  category?: string;
  isTainted?: boolean;
  isBlocked?: boolean;
  ownerSlug?: string;
  repoSlug?: string;
  skillSlug?: string;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function highlightMatches(text: string, query: string): string {
  if (!text) return "";
  const escaped = escapeHtml(text);
  if (!query) return escaped;
  const words = query.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return escaped;
  const pattern = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const re = new RegExp(`(${pattern})`, "gi");
  return escaped.replace(re, "<b>$1</b>");
}

export function formatStarCount(count: number | null | undefined): string {
  if (!count) return "";
  if (count < 1000) return String(count);
  return `${(count / 1000).toFixed(1)}k`;
}

const CATEGORIES = [
  { label: "Security", href: "/skills?category=security" },
  { label: "Coding", href: "/skills?category=development" },
  { label: "DevOps", href: "/skills?category=devops" },
  { label: "Testing", href: "/skills?category=testing" },
  { label: "Data", href: "/skills?category=data" },
  { label: "Design", href: "/skills?category=design" },
];

const ACTIONS = [
  { label: "Submit a skill", href: "/submit" },
  { label: "Browse all skills", href: "/skills" },
];

// eval-ui native font tokens — Inter Tight (sans), JetBrains Mono (mono),
// Source Serif 4 (serif). Defined in src/eval-ui/src/styles/globals.css.
const SANS = "var(--font-sans, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif)";
const MONO = "var(--font-mono, 'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace)";

function MiniTierBadge({ tier, isTainted, isBlocked }: { tier: string; isTainted?: boolean; isBlocked?: boolean }) {
  const baseStyle = {
    display: "inline-flex" as const,
    alignItems: "center" as const,
    padding: "1px 6px",
    height: 16,
    borderRadius: 3,
    fontFamily: MONO,
    fontSize: 9.5,
    fontWeight: 600,
    letterSpacing: "0.04em",
    whiteSpace: "nowrap" as const,
    lineHeight: 1,
    textTransform: "uppercase" as const,
  };

  if (isBlocked) {
    return (
      <span data-testid="mini-tier-badge" data-tier="BLOCKED" style={{ ...baseStyle, color: "#7A1F1F", background: "#FBE8E5", border: "1px solid #E8B7B0" }}>BLOCKED</span>
    );
  }
  if (isTainted) {
    return (
      <span data-testid="mini-tier-badge" data-tier="TAINTED" style={{ ...baseStyle, color: "#7A4A00", background: "#FBEFD3", border: "1px solid #E8C885" }}>Tainted</span>
    );
  }

  // Map tier → eval-ui paper-aesthetic colors. Keeps the warm palette intact.
  const tierStyles: Record<string, { color: string; bg: string; border: string }> = {
    CERTIFIED: { color: "var(--color-installed, #2F6A4A)", bg: "rgba(47,106,74,0.08)", border: "rgba(47,106,74,0.25)" },
    VERIFIED:  { color: "var(--color-focus, #3B6EA8)",     bg: "rgba(59,110,168,0.08)", border: "rgba(59,110,168,0.25)" },
    REJECTED:  { color: "#7A1F1F",                         bg: "#FBE8E5",               border: "#E8B7B0" },
    BLOCKED:   { color: "#7A1F1F",                         bg: "#FBE8E5",               border: "#E8B7B0" },
  };
  const style = tierStyles[tier];
  if (!style) return null;
  return (
    <span data-testid="mini-tier-badge" data-tier={tier} style={{ ...baseStyle, color: style.color, background: style.bg, border: `1px solid ${style.border}` }}>
      {formatTierLabel(tier)}
    </span>
  );
}

function SkeletonRow() {
  return (
    <div data-testid="skeleton-row" style={{ padding: "10px 18px", display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ height: 12, width: "32%", borderRadius: 3, background: "var(--color-rule, #E8E1D6)", animation: "fsp-pulse 1.4s ease-in-out infinite" }} />
        <div style={{ height: 9, width: "55%", borderRadius: 3, background: "var(--color-rule, #E8E1D6)", animation: "fsp-pulse 1.4s ease-in-out infinite", animationDelay: "0.18s" }} />
      </div>
      <div style={{ height: 14, width: 52, borderRadius: 3, background: "var(--color-rule, #E8E1D6)", animation: "fsp-pulse 1.4s ease-in-out infinite", animationDelay: "0.36s" }} />
    </div>
  );
}

function isInteractiveTarget(e: KeyboardEvent): boolean {
  const tag = (e.target as HTMLElement)?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if ((e.target as HTMLElement)?.isContentEditable) return true;
  return false;
}

export interface SearchPaletteCoreProps {
  onSelect?: (result: SearchResult, query: string) => void;
  onNavigate?: (href: string) => void;
  searchUrl?: string;
  trendingUrl?: string;
  telemetrySelectUrl?: string;
  maxPages?: number;
  initialOpen?: boolean;
}

const DEFAULT_SEARCH_URL = "/api/v1/studio/search";
const DEFAULT_TRENDING_URL = "/api/v1/stats";
const DEFAULT_TELEMETRY_URL = "/api/v1/studio/telemetry/search-select";
const DEFAULT_MAX_PAGES = 10;
const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 150;

export default function SearchPaletteCore({
  onSelect,
  onNavigate,
  searchUrl = DEFAULT_SEARCH_URL,
  trendingUrl = DEFAULT_TRENDING_URL,
  telemetrySelectUrl = DEFAULT_TELEMETRY_URL,
  maxPages = DEFAULT_MAX_PAGES,
  initialOpen = false,
}: SearchPaletteCoreProps = {}) {
  const [open, setOpen] = useState(initialOpen);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selected, setSelected] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 0751: degraded mode — upstream returned a sanitized 502 / search_unavailable.
  // We fall back to client-side trending filtering and surface a soft banner
  // instead of a red retry button.
  const [degraded, setDegraded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const loadMoreAbortRef = useRef<AbortController | null>(null);
  const openWithQueryRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const cacheRef = useRef<Map<string, { results: SearchResult[]; hasMore: boolean; timestamp: number }>>(new Map());
  const trendingRef = useRef<TrendingSkillEntry[] | null>(null);
  const [, setTrendingLoaded] = useState(false);

  const isMac = useMemo(
    () => typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform || ""),
    [],
  );

  const queryRef = useRef(query);
  useEffect(() => { queryRef.current = query; }, [query]);

  // Trending preload — once per mount.
  useEffect(() => {
    if (trendingRef.current) return;
    fetch(trendingUrl)
      .then((res) => res.json())
      .then((data) => {
        trendingRef.current = data.trendingSkills ?? [];
        setTrendingLoaded(true);
      })
      .catch(() => { /* trending preload failure is non-fatal */ });
  }, [trendingUrl]);

  // Global keydown + openFindSkills custom event + type-to-search-from-anywhere.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); return; }
      // 0751: ⌘+digit / Ctrl+digit jump while open — match before printable
      // capture so digits don't open a fresh palette.
      if (open && (e.metaKey || e.ctrlKey) && /^[1-9]$/.test(e.key)) {
        e.preventDefault();
        const idx = Number(e.key) - 1;
        // selection event fires through the rendered list via global state.
        setSelected(idx);
        // mark a "select-by-shortcut" hint via a window event the render reads.
        window.dispatchEvent(new CustomEvent("findSkillsActivateAt", { detail: { index: idx } }));
        return;
      }
      if (
        !e.metaKey && !e.ctrlKey && !e.altKey &&
        e.key.length === 1 &&
        !isInteractiveTarget(e)
      ) {
        openWithQueryRef.current = true;
        setQuery(e.key);
        setOpen(true);
      }
    };
    const openHandler = (e: Event) => {
      const customEvent = e as CustomEvent<{ query?: string } | undefined>;
      const initialQuery = customEvent.detail?.query;
      if (initialQuery) {
        openWithQueryRef.current = true;
        setQuery(initialQuery);
        setOpen(true);
      } else {
        setOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    window.addEventListener("openFindSkills", openHandler as EventListener);
    return () => {
      window.removeEventListener("keydown", handler);
      window.removeEventListener("openFindSkills", openHandler as EventListener);
    };
  }, [open]);

  // 0751 — focus the input synchronously after the dialog mounts. useLayoutEffect
  // fires before the browser paints, so the cursor is visible on the very first
  // frame the user sees. setTimeout(50) caused a perceptible delay where the
  // user could see the input briefly without focus.
  useLayoutEffect(() => {
    if (!open) {
      loadMoreAbortRef.current?.abort();
      return;
    }
    if (openWithQueryRef.current) {
      openWithQueryRef.current = false;
      setResults([]);
      setSelected(0);
      setPage(1);
      setHasMore(false);
      setIsLoading(false);
      setError(null);
      setDegraded(false);
    } else {
      // Don't clobber a query restored from sessionStorage (Back-from-detail).
      const restored = (() => {
        try { return window.sessionStorage?.getItem("find-skills:last-query") ?? ""; }
        catch { return ""; }
      })();
      setQuery(restored);
      setResults([]);
      setSelected(0);
      setPage(1);
      setHasMore(false);
      setIsLoading(false);
      setError(null);
      setDegraded(false);
    }
    const el = inputRef.current;
    if (el) {
      el.focus({ preventScroll: true });
      const len = el.value.length;
      // When opened via a printable key we already pre-filled the query — put
      // caret at end so the next keystroke continues the word.
      // When opened blank, select-all is a no-op.
      el.setSelectionRange(len, len);
    }
  }, [open]);

  // Debounced search (150ms, min 2 chars) with AbortController + SWR cache.
  useEffect(() => {
    if (!query.trim() || query.trim().length < 2) {
      setResults([]);
      setHasMore(false);
      setPage(1);
      setError(null);
      // Don't clear `degraded` — once upstream is offline we keep the soft
      // banner visible across keystrokes so the user understands why typed
      // queries return only client-filtered trending matches.
      return;
    }

    const SWR_TTL_MS = 60_000;
    const cacheKey = query.trim().toLowerCase();
    const cached = cacheRef.current.get(cacheKey);
    const isFresh = cached && (Date.now() - cached.timestamp < SWR_TTL_MS);

    if (isFresh) {
      setResults(cached.results);
      setHasMore(cached.hasMore);
      setPage(1);
      setIsLoading(false);
      setError(null);
      // Background revalidate (SWR).
      fetch(`${searchUrl}?q=${encodeURIComponent(query)}&limit=${PAGE_SIZE}&page=1`)
        .then((res) => res.ok ? res.json() : null)
        .then((data) => {
          if (!data) return;
          cacheRef.current.set(cacheKey, {
            results: data.results || [],
            hasMore: data.pagination?.hasMore ?? false,
            timestamp: Date.now(),
          });
        })
        .catch(() => { /* background revalidation failure is non-fatal */ });
      return;
    }

    setIsLoading(true);
    setError(null);
    const controller = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `${searchUrl}?q=${encodeURIComponent(query)}&limit=${PAGE_SIZE}&page=1`,
          { signal: controller.signal },
        );
        if (res.status >= 500) {
          // 0751: upstream is offline (e.g. CF Worker /studio/search returning
          // sanitized 502 search_unavailable). Don't surface a red error —
          // degrade to client-side filtering of trending and let the user keep
          // working. The banner explains the limited scope.
          setDegraded(true);
          setResults([]);
          setHasMore(false);
          setError(null);
          return;
        }
        if (!res.ok) {
          setResults([]);
          setHasMore(false);
          setError(`search failed (${res.status})`);
          return;
        }
        const data = await res.json();
        const fetchedResults = data.results || [];
        const fetchedHasMore = data.pagination?.hasMore ?? false;
        setResults(fetchedResults);
        setHasMore(fetchedHasMore);
        setPage(1);
        setDegraded(false);
        cacheRef.current.set(cacheKey, { results: fetchedResults, hasMore: fetchedHasMore, timestamp: Date.now() });
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        // Network error → also degrade rather than red-error.
        setDegraded(true);
        setResults([]);
        setHasMore(false);
        setError(null);
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => { clearTimeout(t); controller.abort(); };
  }, [query, searchUrl]);

  const reachedHardCap = page >= maxPages;

  const handleLoadMore = useCallback(async () => {
    if (loadingMore || reachedHardCap) return;
    const nextPage = page + 1;
    setLoadingMore(true);
    loadMoreAbortRef.current = new AbortController();
    try {
      const res = await fetch(
        `${searchUrl}?q=${encodeURIComponent(query)}&limit=${PAGE_SIZE}&page=${nextPage}`,
        { signal: loadMoreAbortRef.current.signal },
      );
      if (!res.ok) return;
      const data = await res.json();
      setResults((prev) => [...prev, ...(data.results || [])]);
      setHasMore(data.pagination?.hasMore ?? false);
      setPage(nextPage);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
    } finally {
      if (!loadMoreAbortRef.current?.signal.aborted) setLoadingMore(false);
    }
  }, [page, query, loadingMore, reachedHardCap, searchUrl]);

  // Infinite scroll observer.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    const container = scrollContainerRef.current;
    if (!sentinel || !container) return;
    if (typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !isLoading && !loadingMore && !reachedHardCap) {
          handleLoadMore();
        }
      },
      { root: container, rootMargin: "100px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, isLoading, loadingMore, reachedHardCap, handleLoadMore]);

  const mapTrendingToResult = (t: TrendingSkillEntry): SearchResult => ({
    name: t.name,
    displayName: t.displayName,
    author: t.author,
    repoUrl: t.repoUrl,
    certTier: t.certTier,
    githubStars: 0,
    highlight: "",
    category: "",
    ownerSlug: t.ownerSlug,
    repoSlug: t.repoSlug,
    skillSlug: t.skillSlug,
  });

  const displayResults: SearchResult[] = (() => {
    const trimmed = query.trim();
    // 0751: degraded mode — filter trending client-side for any non-empty query.
    if (degraded && trimmed.length >= 1 && trendingRef.current) {
      const q = trimmed.toLowerCase();
      return trendingRef.current
        .filter((s) =>
          s.name.toLowerCase().includes(q) ||
          (s.displayName ?? "").toLowerCase().includes(q),
        )
        .slice(0, 30)
        .map(mapTrendingToResult);
    }
    if (trimmed.length >= 2) return results;
    if (trimmed.length === 1 && trendingRef.current) {
      const q = trimmed.toLowerCase();
      return trendingRef.current
        .filter((s) => s.name.toLowerCase().startsWith(q) || s.displayName.toLowerCase().startsWith(q))
        .slice(0, 10)
        .map(mapTrendingToResult);
    }
    if (trimmed.length === 0 && trendingRef.current) {
      return trendingRef.current.slice(0, 10).map(mapTrendingToResult);
    }
    return [];
  })();

  type Item =
    | { type: "skill"; label: string; publisher: string; name: string; command?: string; pluginName?: string; meta: string; certTier: string; isTainted?: boolean; isBlocked?: boolean; repoUrl: string; highlight?: string; githubStars?: number; category?: string; href: string; sourceResult?: SearchResult }
    | { type: "category" | "action"; label: string; publisher: string; name: string; command?: string; pluginName?: string; meta: string; certTier: string; isTainted?: undefined; isBlocked?: undefined; repoUrl: string; highlight?: undefined; githubStars?: undefined; category?: undefined; href: string; sourceResult?: undefined };

  const allItems: Item[] = [
    ...displayResults.map((r): Item => {
      const displaySkillName = r.skillSlug || r.name.split("/").pop() || r.name;
      const publisher = r.ownerSlug && r.repoSlug ? `${r.ownerSlug}/${r.repoSlug}` : r.author;
      return {
        type: "skill" as const,
        label: displaySkillName,
        publisher,
        name: r.name,
        command: r.command ? (r.pluginName ? `${r.pluginName}:${r.command}` : r.command) : undefined,
        pluginName: r.pluginName || undefined,
        meta: r.category || "",
        certTier: r.certTier,
        isTainted: r.isTainted,
        isBlocked: r.isBlocked,
        repoUrl: r.repoUrl,
        highlight: r.highlight,
        githubStars: r.githubStars,
        category: r.category,
        href: skillUrl(r.name),
        sourceResult: r,
      };
    }),
    ...(!query && displayResults.length === 0
      ? CATEGORIES.map((c): Item => ({ type: "category", label: c.label, publisher: "", name: "", meta: "", certTier: "", repoUrl: "", href: c.href }))
      : []),
    ...(!query && displayResults.length === 0
      ? ACTIONS.map((a): Item => ({ type: "action", label: a.label, publisher: "", name: "", meta: "", certTier: "", repoUrl: "", href: a.href }))
      : []),
  ];

  const fireTelemetry = useCallback((skillName: string) => {
    try {
      fetch(telemetrySelectUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skillName, q: queryRef.current.trim(), ts: Date.now() }),
        keepalive: true,
      }).catch(() => { /* telemetry is fire-and-forget */ });
    } catch {
      /* telemetry never blocks navigation */
    }
  }, [telemetrySelectUrl]);

  const navigate = useCallback((href: string, sourceResult?: SearchResult) => {
    if (sourceResult) {
      fireTelemetry(sourceResult.name);
      if (onSelect) {
        try { onSelect(sourceResult, queryRef.current.trim()); } catch { /* hook failure is non-fatal */ }
      }
    }
    setOpen(false);
    if (onNavigate) {
      try { onNavigate(href); } catch { /* hook failure is non-fatal */ }
    }
  }, [onSelect, onNavigate, fireTelemetry]);

  // Listen for the ⌘1-9 jump synthesised in the global handler — react after
  // the next render so `selected` reflects the new index when we activate.
  useEffect(() => {
    function activateAt(e: Event) {
      const idx = (e as CustomEvent<{ index: number }>).detail?.index ?? -1;
      const item = allItems[idx];
      if (!item) return;
      navigate(item.href, item.type === "skill" ? item.sourceResult : undefined);
    }
    window.addEventListener("findSkillsActivateAt", activateAt);
    return () => window.removeEventListener("findSkillsActivateAt", activateAt);
  }, [allItems, navigate]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSelected((s) => Math.min(s + 1, allItems.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSelected((s) => Math.max(s - 1, 0)); }
    else if (e.key === "Enter" && allItems[selected]) {
      const item = allItems[selected];
      navigate(item.href, item.type === "skill" ? item.sourceResult : undefined);
    }
  };

  if (!open) return null;

  let currentGroup = "";

  const showEmptyState = !isLoading && !error && !degraded && query.trim().length >= 2 && results.length === 0;
  const showSkeletons = isLoading && results.length === 0 && query.trim().length >= 2 && !degraded;
  const trimmed = query.trim();

  const retrySearch = () => {
    setDegraded(false);
    const current = query;
    setQuery("");
    setTimeout(() => setQuery(current), 0);
  };

  // Backdrop styling — warm-tinted blur to match the editorial paper aesthetic.
  // Light theme: warm semi-transparent ink. Dark theme: deeper paper.
  const backdropStyle: React.CSSProperties = {
    position: "fixed", inset: 0,
    background: "color-mix(in srgb, var(--color-ink, #191919) 35%, transparent)",
    backdropFilter: "blur(6px) saturate(1.1)",
    WebkitBackdropFilter: "blur(6px) saturate(1.1)",
  };

  // Card styling — warm paper surface with elegant shadow + 12px radius.
  const cardStyle: React.CSSProperties = {
    position: "relative",
    width: "100%",
    maxWidth: 640,
    margin: "0 16px",
    background: "var(--bg-surface, #FFFFFF)",
    color: "var(--text-primary, #191919)",
    borderRadius: 12,
    border: "1px solid var(--color-rule, #E8E1D6)",
    boxShadow:
      "0 1px 0 rgba(255,255,255,0.6) inset," +
      "0 24px 60px -12px rgba(25,20,15,0.28)," +
      "0 12px 24px -8px rgba(25,20,15,0.18)",
    overflow: "hidden",
    fontFamily: SANS,
  };

  return (
    <div
      data-testid="find-skills-palette"
      role="dialog"
      aria-modal="true"
      aria-label="Find verified skills"
      style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: "min(18vh, 144px)" }}
      onClick={() => setOpen(false)}
    >
      <div style={backdropStyle} />

      <style>{`
        @keyframes fsp-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.45; }
        }
        @keyframes fsp-rise {
          from { opacity: 0; transform: translateY(-6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .fsp-rise { animation: none !important; }
          [data-testid="skeleton-row"] > div { animation: none !important; }
        }
      `}</style>

      <div
        className="fsp-rise"
        style={{ ...cardStyle, animation: "fsp-rise 180ms cubic-bezier(0.2, 0, 0, 1)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header: search input row */}
        <div style={{ display: "flex", alignItems: "center", padding: "0 18px", borderBottom: "1px solid var(--color-rule, #E8E1D6)", background: "linear-gradient(180deg, var(--bg-surface, #FFFFFF) 0%, color-mix(in srgb, var(--bg-surface, #FFFFFF) 96%, var(--color-accent, #D4A27F) 4%) 100%)" }}>
          <span aria-hidden="true" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 18, height: 18, marginRight: 10, color: "var(--color-accent-ink, #7A4A24)" }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="7" cy="7" r="4.5" />
              <path d="m13.5 13.5-3.2-3.2" />
            </svg>
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelected(0); }}
            onKeyDown={handleKeyDown}
            placeholder="Search verified skills…"
            role="combobox"
            aria-expanded="true"
            aria-controls="find-skills-listbox"
            aria-autocomplete="list"
            autoFocus
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            style={{
              flex: 1,
              border: "none",
              outline: "none",
              padding: "16px 0",
              fontFamily: SANS,
              fontSize: 16,
              fontWeight: 400,
              letterSpacing: "-0.005em",
              background: "transparent",
              color: "var(--text-primary, #191919)",
              minWidth: 0,
            }}
          />
          {isLoading && (
            <span aria-hidden="true" style={{ display: "inline-flex", marginRight: 10, color: "var(--text-secondary, #5A5651)" }}>
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.4" fill="none" opacity="0.25" />
                <path d="M12.5 7a5.5 5.5 0 0 0-5.5-5.5" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round">
                  <animateTransform attributeName="transform" type="rotate" from="0 7 7" to="360 7 7" dur="0.7s" repeatCount="indefinite" />
                </path>
              </svg>
            </span>
          )}
          <kbd style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: 500, color: "var(--text-secondary, #5A5651)", border: "1px solid var(--color-rule, #E8E1D6)", borderRadius: 4, padding: "2px 6px", background: "var(--bg-canvas, #FBF8F3)" }}>Esc</kbd>
        </div>

        {/* Degraded banner — soft, paper-toned warning instead of harsh red error */}
        {degraded && (
          <div
            data-testid="search-degraded-banner"
            role="status"
            style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "8px 18px",
              fontFamily: MONO, fontSize: 11.5,
              color: "var(--color-accent-ink, #7A4A24)",
              background: "color-mix(in srgb, var(--color-accent, #D4A27F) 12%, transparent)",
              borderBottom: "1px solid color-mix(in srgb, var(--color-accent, #D4A27F) 30%, transparent)",
            }}
          >
            <span aria-hidden="true">◐</span>
            <span style={{ flex: 1 }}>Live search is offline — showing trending matches</span>
            <button
              data-testid="search-retry"
              onClick={retrySearch}
              style={{ fontFamily: MONO, fontSize: 10.5, padding: "3px 8px", borderRadius: 3, border: "1px solid var(--color-accent, #D4A27F)", background: "transparent", color: "var(--color-accent-ink, #7A4A24)", cursor: "pointer" }}
            >
              Retry
            </button>
          </div>
        )}

        {/* Result list — viewport-aware so footer always stays in view */}
        <div ref={scrollContainerRef} role="listbox" id="find-skills-listbox" style={{ maxHeight: "min(56vh, 432px)", overflowY: "auto", padding: "6px 0" }}>
          {showSkeletons && (
            <>
              <SkeletonRow /><SkeletonRow /><SkeletonRow /><SkeletonRow />
            </>
          )}

          {error && !degraded && (
            <div data-testid="search-error" style={{ padding: "20px 18px", textAlign: "center", fontFamily: MONO, fontSize: 12.5, color: "var(--color-ink-muted, #5A5651)" }}>
              <div style={{ marginBottom: 8 }}>{error}</div>
              <button
                data-testid="search-retry"
                onClick={retrySearch}
                style={{ fontFamily: MONO, fontSize: 11, padding: "4px 10px", borderRadius: 4, border: "1px solid var(--color-rule, #E8E1D6)", background: "transparent", color: "var(--text-primary, #191919)", cursor: "pointer" }}
              >
                Retry
              </button>
            </div>
          )}

          {showEmptyState && (
            <div style={{ padding: "28px 18px", textAlign: "center" }}>
              <div style={{ fontFamily: SANS, fontSize: 13, color: "var(--text-secondary, #5A5651)", marginBottom: 6 }}>
                No matches for <span style={{ color: "var(--text-primary, #191919)", fontFamily: MONO }}>"{trimmed}"</span>
              </div>
              <a
                href="/skills"
                style={{ fontFamily: MONO, fontSize: 12, color: "var(--color-action, #2F5B8E)", textDecoration: "none", borderBottom: "1px solid currentColor", paddingBottom: 1 }}
                onClick={(e) => { e.preventDefault(); navigate("/skills"); }}
              >
                Browse by category →
              </a>
            </div>
          )}

          {!showSkeletons && allItems.length === 0 && !showEmptyState && !error && (
            <div style={{ padding: "20px 18px", textAlign: "center", fontFamily: MONO, fontSize: 11.5, color: "var(--text-secondary, #5A5651)" }}>
              Loading trending…
            </div>
          )}

          {!showSkeletons && allItems.map((item, i) => {
            const groupLabel = item.type === "skill"
              ? (degraded ? "TRENDING (FILTERED)" : (trimmed.length >= 2 ? "RESULTS" : "TRENDING"))
              : item.type === "category" ? "CATEGORIES" : "ACTIONS";
            const showGroup = groupLabel !== currentGroup;
            if (showGroup) currentGroup = groupLabel;
            const isSel = i === selected;
            const shortcutHint = i < 9 ? `${isMac ? "⌘" : "Ctrl"} ${i + 1}` : "";
            return (
              <div key={`${item.type}-${item.name || item.label}`}>
                {showGroup && (
                  <div style={{
                    padding: "10px 18px 4px",
                    fontFamily: MONO, fontSize: 9.5, fontWeight: 600,
                    color: "var(--text-secondary, #5A5651)",
                    letterSpacing: "0.12em", textTransform: "uppercase",
                  }}>{groupLabel}</div>
                )}
                {item.type === "skill" ? (
                  <div
                    role="option"
                    aria-selected={isSel}
                    onClick={() => navigate(item.href, item.sourceResult)}
                    onMouseEnter={() => setSelected(i)}
                    style={{
                      position: "relative",
                      padding: "8px 18px 8px 22px",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      background: isSel ? "color-mix(in srgb, var(--color-accent, #D4A27F) 8%, transparent)" : "transparent",
                      transition: "background 120ms ease",
                    }}
                  >
                    {/* Accent left rail when selected */}
                    {isSel && (
                      <span aria-hidden="true" style={{
                        position: "absolute", left: 0, top: 6, bottom: 6, width: 3,
                        background: "var(--color-accent, #D4A27F)",
                        borderRadius: "0 2px 2px 0",
                      }} />
                    )}
                    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                        <span style={{
                          fontFamily: MONO,
                          fontSize: 13,
                          fontWeight: 600,
                          color: "var(--text-primary, #191919)",
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          maxWidth: "100%",
                        }}>{item.label}</span>
                        {item.pluginName && (
                          <span style={{
                            fontSize: 9.5, padding: "1px 5px", borderRadius: 3,
                            color: "var(--color-action, #2F5B8E)",
                            background: "rgba(47,91,142,0.08)",
                            border: "1px solid rgba(47,91,142,0.22)",
                            whiteSpace: "nowrap", flexShrink: 0,
                            fontFamily: MONO,
                          }}>{item.pluginName}</span>
                        )}
                      </div>
                      <div style={{
                        fontSize: 11, color: "var(--text-secondary, #5A5651)",
                        fontFamily: MONO,
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        opacity: 0.85,
                      }}>
                        {item.publisher}
                        {item.highlight && (
                          <>
                            <span style={{ margin: "0 6px", opacity: 0.5 }}>·</span>
                            <span
                              data-testid="search-highlight"
                              dangerouslySetInnerHTML={{ __html: sanitizeHighlight(item.highlight) }}
                            />
                          </>
                        )}
                      </div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                      {item.githubStars != null && item.githubStars > 0 && (
                        <span data-testid="star-count" style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10.5, fontFamily: MONO, color: "var(--text-secondary, #5A5651)", whiteSpace: "nowrap" }}>
                          <svg width={10} height={10} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                            <path d="M8 .25a.75.75 0 01.673.418l1.882 3.815 4.21.612a.75.75 0 01.416 1.279l-3.046 2.97.719 4.192a.75.75 0 01-1.088.791L8 12.347l-3.766 1.98a.75.75 0 01-1.088-.79l.72-4.194L.818 6.374a.75.75 0 01.416-1.28l4.21-.611L7.327.668A.75.75 0 018 .25z" />
                          </svg>
                          {formatStarCount(item.githubStars)}
                        </span>
                      )}
                      <MiniTierBadge tier={item.certTier} isTainted={item.isTainted} isBlocked={item.isBlocked} />
                      {isSel && shortcutHint && (
                        <span aria-hidden="true" style={{ fontFamily: MONO, fontSize: 9.5, color: "var(--text-secondary, #5A5651)", padding: "1px 5px", borderRadius: 3, border: "1px solid var(--color-rule, #E8E1D6)", whiteSpace: "nowrap" }}>
                          {shortcutHint}
                        </span>
                      )}
                    </div>
                  </div>
                ) : (
                  <div
                    role="option"
                    aria-selected={isSel}
                    onClick={() => navigate(item.href)}
                    onMouseEnter={() => setSelected(i)}
                    style={{
                      position: "relative",
                      padding: "7px 18px 7px 22px",
                      cursor: "pointer",
                      background: isSel ? "color-mix(in srgb, var(--color-accent, #D4A27F) 8%, transparent)" : "transparent",
                      fontFamily: MONO,
                      fontSize: 12.5,
                      color: "var(--text-primary, #191919)",
                    }}
                  >
                    {isSel && (
                      <span aria-hidden="true" style={{
                        position: "absolute", left: 0, top: 4, bottom: 4, width: 3,
                        background: "var(--color-accent, #D4A27F)",
                        borderRadius: "0 2px 2px 0",
                      }} />
                    )}
                    {item.label}
                  </div>
                )}
              </div>
            );
          })}

          {hasMore && !isLoading && results.length > 0 && !reachedHardCap && (
            <div ref={sentinelRef} data-testid="scroll-sentinel" style={{ padding: "8px 18px", textAlign: "center" }}>
              {loadingMore && (
                <span style={{ fontFamily: MONO, fontSize: 11, color: "var(--text-secondary, #5A5651)" }}>Loading…</span>
              )}
            </div>
          )}

          {reachedHardCap && results.length > 0 && (
            <div data-testid="hard-cap-link" style={{ padding: "12px 18px", textAlign: "center", fontFamily: MONO, fontSize: 11.5 }}>
              <a
                href={`https://verified-skill.com/skills?q=${encodeURIComponent(query.trim())}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "var(--color-action, #2F5B8E)", textDecoration: "none" }}
              >
                See all results on verified-skill.com →
              </a>
            </div>
          )}
        </div>

        {/* Footer: keyboard hints */}
        <div
          data-testid="palette-footer"
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "8px 18px",
            borderTop: "1px solid var(--color-rule, #E8E1D6)",
            background: "var(--bg-canvas, #FBF8F3)",
            fontFamily: MONO, fontSize: 10.5,
            color: "var(--text-secondary, #5A5651)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <FooterHint keys={["↑", "↓"]} label="navigate" />
            <FooterHint keys={["↵"]} label="open" />
            <FooterHint keys={[isMac ? "⌘" : "Ctrl", "1-9"]} label="jump" />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ opacity: 0.7 }}>{allItems.length > 0 ? `${allItems.length} ${allItems.length === 1 ? "result" : "results"}` : ""}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function FooterHint({ keys, label }: { keys: string[]; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
        {keys.map((k, i) => (
          <kbd key={i} style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            minWidth: 16, height: 16,
            padding: "0 4px",
            fontFamily: MONO, fontSize: 10, fontWeight: 500,
            color: "var(--text-secondary, #5A5651)",
            background: "var(--bg-surface, #FFFFFF)",
            border: "1px solid var(--color-rule, #E8E1D6)",
            borderRadius: 3,
            lineHeight: 1,
          }}>{k}</kbd>
        ))}
      </span>
      <span>{label}</span>
    </span>
  );
}
