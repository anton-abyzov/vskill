// 0741 T-008..T-013: SearchPaletteCore — eval-ui port of
// vskill-platform/src/app/components/SearchPalette.tsx (~680 LOC).
//
// Differences from source:
//   - `"use client"` directive dropped (no SSR in Vite).
//   - `useRouter`/`router.push()` replaced by an `onNavigate(href)` callback
//     prop. Default no-op so tests can assert without React Router.
//   - `next/link` dropped — all links use plain <a>; external links carry
//     `target="_blank" rel="noopener noreferrer"`.
//   - `@/lib/...` imports rewritten to relative paths into eval-ui/src/lib.
//   - Endpoints default to the studio variants:
//        searchUrl       → /api/v1/studio/search
//        trendingUrl     → /api/v1/stats
//        telemetrySelect → /api/v1/studio/telemetry/search-select
//   - Listens for `window.openFindSkills` (NOT `openSearch` — that name belongs
//     to the existing CommandPalette).
//   - `MiniTierBadge` stays inline (per increment 0741 brief).
//   - `onSelect` always fires for skill results (used for telemetry by the
//     FindSkillsPalette shell).

import { useState, useEffect, useRef, useCallback } from "react";
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

/** Public shape of a single search result. */
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

/** Escape HTML entities to prevent XSS when using dangerouslySetInnerHTML. */
function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Client-side highlight: wrap query matches in <b> tags. HTML-safe. */
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

const MONO = "var(--font-geist-mono)";

function MiniTierBadge({ tier, isTainted, isBlocked }: { tier: string; isTainted?: boolean; isBlocked?: boolean }) {
  // BLOCKED short-circuits everything — the most security-critical signal.
  if (isBlocked) {
    return (
      <span
        data-testid="mini-tier-badge"
        data-tier="BLOCKED"
        style={{
          display: "inline-flex", alignItems: "center", gap: "0.2rem",
          padding: "0.1rem 0.35rem", height: "16px", borderRadius: "3px",
          fontFamily: MONO, fontSize: "0.5625rem", fontWeight: 600,
          letterSpacing: "0.03em", whiteSpace: "nowrap" as const,
          color: "var(--status-danger-text)", backgroundColor: "var(--status-danger-bg)", border: "1px solid var(--status-danger-border)",
          lineHeight: 1,
        }}
      >
        BLOCKED
      </span>
    );
  }

  if (isTainted) {
    return (
      <span
        data-testid="mini-tier-badge"
        data-tier="TAINTED"
        style={{
          display: "inline-flex", alignItems: "center", gap: "0.2rem",
          padding: "0.1rem 0.35rem", height: "16px", borderRadius: "3px",
          fontFamily: MONO, fontSize: "0.5625rem", fontWeight: 600,
          letterSpacing: "0.03em", whiteSpace: "nowrap" as const,
          color: "var(--tier-tainted)", backgroundColor: "var(--tier-tainted-bg)", border: "1px solid var(--tier-tainted-border)",
          lineHeight: 1,
        }}
      >
        Tainted
      </span>
    );
  }

  const tierStyles: Record<string, { color: string; bg: string; border: string }> = {
    CERTIFIED: { color: "var(--tier-certified)", bg: "var(--tier-certified-bg)", border: "var(--tier-certified-border)" },
    VERIFIED: { color: "var(--tier-verified)", bg: "var(--tier-verified-bg)", border: "var(--tier-verified-border)" },
    REJECTED: { color: "var(--status-danger-text)", bg: "var(--status-danger-bg)", border: "var(--status-danger-border)" },
    BLOCKED: { color: "var(--status-danger-text)", bg: "var(--status-danger-bg)", border: "var(--status-danger-border)" },
  };

  const style = tierStyles[tier];
  if (!style) return null;

  return (
    <span
      data-testid="mini-tier-badge"
      data-tier={tier}
      style={{
        display: "inline-flex", alignItems: "center", gap: "0.2rem",
        padding: "0.1rem 0.35rem", height: "16px", borderRadius: "3px",
        fontFamily: MONO, fontSize: "0.5625rem", fontWeight: 600,
        letterSpacing: "0.03em", whiteSpace: "nowrap" as const,
        color: style.color, backgroundColor: style.bg, border: `1px solid ${style.border}`,
        lineHeight: 1,
      }}
    >
      {formatTierLabel(tier)}
    </span>
  );
}

function SkeletonRow() {
  return (
    <div
      data-testid="skeleton-row"
      style={{
        padding: "0.625rem 1rem",
        display: "flex",
        alignItems: "center",
        gap: "0.75rem",
      }}
    >
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "0.25rem" }}>
        <div style={{ height: 14, width: "35%", borderRadius: 4, background: "var(--border, #e5e7eb)", animation: "pulse 1.5s ease-in-out infinite" }} />
        <div style={{ height: 10, width: "55%", borderRadius: 4, background: "var(--border, #e5e7eb)", animation: "pulse 1.5s ease-in-out infinite", animationDelay: "0.2s" }} />
      </div>
      <div style={{ height: 16, width: 60, borderRadius: 3, background: "var(--border, #e5e7eb)", animation: "pulse 1.5s ease-in-out infinite", animationDelay: "0.4s" }} />
    </div>
  );
}

/** Check if the target of a keydown is an interactive element (input, textarea, contentEditable). */
function isInteractiveTarget(e: KeyboardEvent): boolean {
  const tag = (e.target as HTMLElement)?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if ((e.target as HTMLElement)?.isContentEditable) return true;
  return false;
}

export interface SearchPaletteCoreProps {
  /** Fires when a skill result is picked (mouse or Enter). */
  onSelect?: (result: SearchResult, query: string) => void;
  /** Fires for category/action items + as a fallback for skill rows. Default: no-op. */
  onNavigate?: (href: string) => void;
  /** Search API. Defaults to studio proxy variant. */
  searchUrl?: string;
  /** Trending API. Defaults to studio /api/v1/stats. */
  trendingUrl?: string;
  /** Fire-and-forget telemetry endpoint for select events. */
  telemetrySelectUrl?: string;
  /** Hard cap for paginated load-more (10 pages × 20 = 200 results). */
  maxPages?: number;
  /** When true the palette is rendered open immediately (test override). */
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
  const inputRef = useRef<HTMLInputElement>(null);
  const loadMoreAbortRef = useRef<AbortController | null>(null);
  const openWithQueryRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const cacheRef = useRef<Map<string, { results: SearchResult[]; hasMore: boolean; timestamp: number }>>(new Map());
  const trendingRef = useRef<TrendingSkillEntry[] | null>(null);
  const [, setTrendingLoaded] = useState(false);

  // Stable query ref so navigate stays referentially stable (matches platform F-005/G-005).
  const queryRef = useRef(query);
  useEffect(() => { queryRef.current = query; }, [query]);

  // Fetch trending once per mount.
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
  }, []);

  // Focus input when opened; abort load-more on close.
  useEffect(() => {
    if (open) {
      if (openWithQueryRef.current) {
        openWithQueryRef.current = false;
        setResults([]);
        setSelected(0);
        setPage(1);
        setHasMore(false);
        setIsLoading(false);
        setError(null);
      } else {
        setQuery("");
        setResults([]);
        setSelected(0);
        setPage(1);
        setHasMore(false);
        setIsLoading(false);
        setError(null);
      }
      setTimeout(() => {
        inputRef.current?.focus();
        if (inputRef.current) {
          const len = inputRef.current.value.length;
          inputRef.current.setSelectionRange(len, len);
        }
      }, 50);
    } else {
      loadMoreAbortRef.current?.abort();
    }
  }, [open]);

  // Debounced search (150ms, min 2 chars) with AbortController + SWR cache.
  useEffect(() => {
    if (!query.trim() || query.trim().length < 2) {
      setResults([]);
      setHasMore(false);
      setPage(1);
      setError(null);
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
      fetch(`${searchUrl}?q=${encodeURIComponent(query)}&limit=${PAGE_SIZE}&page=1`)
        .then((res) => res.json())
        .then((data) => {
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
        if (!res.ok) {
          // Surface 5xx as inline error w/ retry — palette MUST stay mounted.
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
        cacheRef.current.set(cacheKey, { results: fetchedResults, hasMore: fetchedHasMore, timestamp: Date.now() });
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setResults([]);
        setHasMore(false);
        setError("search failed");
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

  const allItems = [
    ...displayResults.map((r) => {
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
        sourceResult: r as SearchResult | undefined,
      };
    }),
    ...(!query && displayResults.length === 0
      ? CATEGORIES.map((c) => ({ type: "category" as const, label: c.label, publisher: "", name: "", command: undefined, pluginName: undefined, meta: "", certTier: "", isTainted: undefined, isBlocked: undefined, repoUrl: "", highlight: undefined, githubStars: undefined, category: undefined, href: c.href, sourceResult: undefined as SearchResult | undefined }))
      : []),
    ...(!query && displayResults.length === 0
      ? ACTIONS.map((a) => ({ type: "action" as const, label: a.label, publisher: "", name: "", command: undefined, pluginName: undefined, meta: "", certTier: "", isTainted: undefined, isBlocked: undefined, repoUrl: "", highlight: undefined, githubStars: undefined, category: undefined, href: a.href, sourceResult: undefined as SearchResult | undefined }))
      : []),
  ];

  // Fire-and-forget telemetry for skill selections (T-027).
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

  const showEmptyState = !isLoading && !error && query.trim().length >= 2 && results.length === 0;
  const showSkeletons = isLoading && results.length === 0 && query.trim().length >= 2;

  // Force a fetch retry — used by the inline 5xx error UI.
  const retrySearch = () => {
    const current = query;
    setQuery("");
    setTimeout(() => setQuery(current), 0);
  };

  return (
    <div
      data-testid="find-skills-palette"
      role="dialog"
      aria-modal="true"
      aria-label="Find verified skills"
      style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: "min(20vh, 160px)" }}
      onClick={() => setOpen(false)}
    >
      {/* Backdrop */}
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", backdropFilter: "blur(4px)" }} />

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>

      <div
        style={{ position: "relative", width: "100%", maxWidth: 600, margin: "0 1rem", background: "var(--bg)", borderRadius: "8px", border: "1px solid var(--border)", boxShadow: "0 20px 60px rgba(0,0,0,0.15)", overflow: "hidden" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", padding: "0 1rem" }}>
          <span style={{ color: "var(--text-faint)", fontFamily: MONO, fontSize: "0.875rem", marginRight: "0.5rem" }}>{"/"}</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelected(0); }}
            onKeyDown={handleKeyDown}
            placeholder="Search skills, categories..."
            role="combobox"
            aria-expanded="true"
            aria-controls="find-skills-listbox"
            aria-autocomplete="list"
            style={{ flex: 1, border: "none", outline: "none", padding: "1rem 0", fontFamily: MONO, fontSize: "0.9375rem", background: "transparent", color: "var(--text)" }}
          />
          <kbd style={{ fontFamily: MONO, fontSize: "0.75rem", color: "var(--text-faint)", border: "1px solid var(--border)", borderRadius: "4px", padding: "2px 6px" }}>Esc</kbd>
        </div>

        <div ref={scrollContainerRef} role="listbox" id="find-skills-listbox" style={{ maxHeight: 480, overflowY: "auto", padding: "0.375rem 0" }}>
          {showSkeletons && (
            <>
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
            </>
          )}

          {error && (
            <div data-testid="search-error" style={{ padding: "1.5rem 1rem", textAlign: "center", fontFamily: MONO, fontSize: "0.8125rem", color: "var(--status-danger-text)" }}>
              <div style={{ marginBottom: "0.5rem" }}>{error}</div>
              <button
                data-testid="search-retry"
                onClick={retrySearch}
                style={{ fontFamily: MONO, fontSize: "0.75rem", padding: "0.25rem 0.75rem", borderRadius: "4px", border: "1px solid var(--border)", background: "transparent", color: "var(--text)", cursor: "pointer" }}
              >
                Retry
              </button>
            </div>
          )}

          {showEmptyState && (
            <div style={{ padding: "2rem 1rem", textAlign: "center", fontFamily: MONO, fontSize: "0.8125rem" }}>
              <div style={{ color: "var(--text-faint)", marginBottom: "0.5rem" }}>No results found</div>
              <a
                href="/skills"
                style={{ color: "var(--link-accent)", textDecoration: "none", fontSize: "0.8125rem" }}
                onClick={(e) => { e.preventDefault(); navigate("/skills"); }}
              >
                Browse by category
              </a>
            </div>
          )}

          {!showSkeletons && allItems.map((item, i) => {
            const groupLabel = item.type === "skill" ? "SKILLS" : item.type === "category" ? "CATEGORIES" : "ACTIONS";
            const showGroup = groupLabel !== currentGroup;
            if (showGroup) currentGroup = groupLabel;
            return (
              <div key={`${item.type}-${item.name || item.label}`}>
                {showGroup && (
                  <div style={{ padding: "0.5rem 1rem 0.25rem", fontFamily: MONO, fontSize: "0.625rem", fontWeight: 600, color: "var(--text-faint)", letterSpacing: "0.06em", textTransform: "uppercase" }}>{groupLabel}</div>
                )}
                {item.type === "skill" ? (
                  <div
                    role="option"
                    aria-selected={i === selected}
                    onClick={() => navigate(item.href, item.sourceResult)}
                    onMouseEnter={() => setSelected(i)}
                    style={{
                      padding: "0.5rem 1rem",
                      cursor: "pointer",
                      display: "grid",
                      gridTemplateColumns: "1fr auto",
                      gap: "0.375rem 1rem",
                      alignItems: "start",
                      background: i === selected ? "var(--bg-hover, rgba(128,128,128,0.1))" : "transparent",
                      fontFamily: MONO,
                    }}
                  >
                    <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: "0.125rem" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
                        <span style={{ fontSize: "0.8125rem", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          <span style={{ color: "var(--text)" }}>{item.label}</span>
                        </span>
                        {item.pluginName && (
                          <span style={{ fontSize: "0.5625rem", background: "rgba(13, 148, 136, 0.1)", padding: "0.05rem 0.3rem", borderRadius: "3px", color: "var(--link-accent)", border: "1px solid rgba(13, 148, 136, 0.25)", whiteSpace: "nowrap", flexShrink: 0 }}>
                            {item.pluginName}
                          </span>
                        )}
                      </div>
                      {(item.highlight || item.name) && (
                        <div
                          data-testid="search-highlight"
                          style={{ fontSize: "0.6875rem", color: "var(--text-faint)", lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                          dangerouslySetInnerHTML={{ __html: item.highlight ? sanitizeHighlight(item.highlight) : (query ? highlightMatches(item.name || item.label, query) : escapeHtml(item.name || "")) }}
                        />
                      )}
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexShrink: 0 }}>
                      {item.githubStars != null && item.githubStars > 0 && (
                        <span
                          data-testid="star-count"
                          style={{ display: "inline-flex", alignItems: "center", gap: "0.15rem", fontSize: "0.625rem", color: "var(--text-faint)", whiteSpace: "nowrap" }}
                        >
                          <svg width={10} height={10} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                            <path d="M8 .25a.75.75 0 01.673.418l1.882 3.815 4.21.612a.75.75 0 01.416 1.279l-3.046 2.97.719 4.192a.75.75 0 01-1.088.791L8 12.347l-3.766 1.98a.75.75 0 01-1.088-.79l.72-4.194L.818 6.374a.75.75 0 01.416-1.28l4.21-.611L7.327.668A.75.75 0 018 .25z" />
                          </svg>
                          {formatStarCount(item.githubStars)}
                        </span>
                      )}
                      <MiniTierBadge tier={item.certTier} isTainted={item.isTainted} isBlocked={item.isBlocked} />
                      <span style={{ color: "var(--text-faint)", fontSize: "0.625rem", whiteSpace: "nowrap", maxWidth: 80, overflow: "hidden", textOverflow: "ellipsis" }}>{item.meta}</span>
                    </div>
                  </div>
                ) : (
                  <div
                    role="option"
                    aria-selected={i === selected}
                    onClick={() => navigate(item.href)}
                    onMouseEnter={() => setSelected(i)}
                    style={{
                      padding: "0.5rem 1rem",
                      cursor: "pointer",
                      background: i === selected ? "var(--bg-hover, rgba(128,128,128,0.1))" : "transparent",
                      fontFamily: MONO,
                      fontSize: "0.8125rem",
                      color: "var(--text)",
                    }}
                  >
                    {item.label}
                  </div>
                )}
              </div>
            );
          })}

          {hasMore && !isLoading && results.length > 0 && !reachedHardCap && (
            <div ref={sentinelRef} data-testid="scroll-sentinel" style={{ padding: "0.5rem 1rem", textAlign: "center" }}>
              {loadingMore && (
                <span style={{ fontFamily: MONO, fontSize: "0.75rem", color: "var(--text-faint)" }}>Loading...</span>
              )}
            </div>
          )}

          {reachedHardCap && results.length > 0 && (
            <div data-testid="hard-cap-link" style={{ padding: "1rem", textAlign: "center", fontFamily: MONO, fontSize: "0.75rem" }}>
              <a
                href={`https://verified-skill.com/skills?q=${encodeURIComponent(query.trim())}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "var(--link-accent)", textDecoration: "none" }}
              >
                See all results on verified-skill.com →
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
