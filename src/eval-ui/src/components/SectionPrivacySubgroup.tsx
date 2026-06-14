// ---------------------------------------------------------------------------
// 0848 T-003 — private/public sub-grouping inside a SidebarSection.
//
// When a section's source-repo skills mix private and public origins, the flat
// plugin-grouped list gets split into two collapsible sub-headers:
//
//   🔒 Private repos (N)
//   🌐 Public repos (N)
//
// Single-class sections (all-private, all-public, or all-unknown — i.e. no
// private repos at all) render the children unchanged: there is nothing to
// disambiguate, so we don't add visual noise.
//
// Collapse state persists per agent + section under
//   vskill-sidebar-{agent}-section-{name}-private-collapsed
// (the public sub-group reuses the same key with a `-public-` segment).
//
// Visibility is the repo-visibility signal (was the skill installed from a
// private GitHub repo), resolved client-side via the connected-repos join —
// the same signal SkillRow's PrivateRepoChip uses.
// ---------------------------------------------------------------------------

import { useState, useCallback, type ReactNode } from "react";
import type { SkillInfo } from "../types";
import type { ConnectedRepoDTO } from "../types/account";
import { parseGithubRepoSlug } from "../hooks/useSkillRepoVisibility";
import { PluginGroup } from "./PluginGroup";
import type { SelectedKey } from "./PluginGroup";

export type SectionItems = Array<[plugin: string, skills: SkillInfo[]]>;

interface Props {
  /** Per-plugin grouped skills for this section. */
  items: SectionItems;
  /** Agent id — scopes the collapse storage key. */
  agentId: string;
  /** Section name (e.g. "own" / "installed") — scopes the collapse key. */
  sectionName: string;
  repoVisibilityLookup?: Map<string, ConnectedRepoDTO>;
  selectedKey: SelectedKey | null;
  onSelect: (skill: SkillInfo) => void;
  onContextMenu?: (event: React.MouseEvent<HTMLButtonElement>, skill: SkillInfo) => void;
  dirtySkillIds?: Set<string>;
  /**
   * Fallback renderer used when the section is single-class (no split needed).
   * Keeps the existing SectionList output byte-for-byte identical so the
   * common case is unaffected.
   */
  children: ReactNode;
}

function skillIsPrivate(
  skill: SkillInfo,
  lookup: Map<string, ConnectedRepoDTO> | undefined,
): boolean {
  if (!lookup) return false;
  const slug = parseGithubRepoSlug(skill.repoUrl);
  if (!slug) return false;
  const match = lookup.get(slug);
  return match?.isPrivate === true;
}

/**
 * Split per-plugin items into two item-lists by skill visibility. A plugin
 * that has skills of both classes appears in BOTH lists (filtered to its
 * matching skills) so the private/public counts stay accurate per skill.
 */
function splitByVisibility(
  items: SectionItems,
  lookup: Map<string, ConnectedRepoDTO> | undefined,
): { privateItems: SectionItems; publicItems: SectionItems; privateCount: number; publicCount: number } {
  const privateItems: SectionItems = [];
  const publicItems: SectionItems = [];
  let privateCount = 0;
  let publicCount = 0;
  for (const [plugin, skills] of items) {
    const priv: SkillInfo[] = [];
    const pub: SkillInfo[] = [];
    for (const s of skills) {
      if (skillIsPrivate(s, lookup)) priv.push(s);
      else pub.push(s);
    }
    if (priv.length > 0) {
      privateItems.push([plugin, priv]);
      privateCount += priv.length;
    }
    if (pub.length > 0) {
      publicItems.push([plugin, pub]);
      publicCount += pub.length;
    }
  }
  return { privateItems, publicItems, privateCount, publicCount };
}

function readCollapsed(key: string): boolean {
  try {
    const v = localStorage.getItem(key);
    if (v != null) return v === "true";
  } catch {
    /* ignore */
  }
  return false;
}

function writeCollapsed(key: string, collapsed: boolean): void {
  try {
    localStorage.setItem(key, collapsed ? "true" : "false");
  } catch {
    /* private browsing — ignore */
  }
}

export function SectionPrivacySubgroup({
  items,
  agentId,
  sectionName,
  repoVisibilityLookup,
  selectedKey,
  onSelect,
  onContextMenu,
  dirtySkillIds,
  children,
}: Props) {
  const { privateItems, publicItems, privateCount, publicCount } = splitByVisibility(
    items,
    repoVisibilityLookup,
  );

  // Single-class section (no private repos, or no public ones): render the
  // unchanged children so the common case is byte-identical to before.
  if (privateCount === 0 || publicCount === 0) {
    return <>{children}</>;
  }

  const privateKey = `vskill-sidebar-${agentId}-section-${sectionName}-private-collapsed`;
  const publicKey = `vskill-sidebar-${agentId}-section-${sectionName}-public-collapsed`;

  return (
    <div data-testid="section-privacy-subgroups">
      <SubGroup
        testId="sidebar-subgroup-private"
        storageKey={privateKey}
        icon="🔒"
        label="Private repos"
        count={privateCount}
        items={privateItems}
        repoVisibilityLookup={repoVisibilityLookup}
        selectedKey={selectedKey}
        onSelect={onSelect}
        onContextMenu={onContextMenu}
        dirtySkillIds={dirtySkillIds}
      />
      <SubGroup
        testId="sidebar-subgroup-public"
        storageKey={publicKey}
        icon="🌐"
        label="Public repos"
        count={publicCount}
        items={publicItems}
        repoVisibilityLookup={repoVisibilityLookup}
        selectedKey={selectedKey}
        onSelect={onSelect}
        onContextMenu={onContextMenu}
        dirtySkillIds={dirtySkillIds}
      />
    </div>
  );
}

function SubGroup({
  testId,
  storageKey,
  icon,
  label,
  count,
  items,
  repoVisibilityLookup,
  selectedKey,
  onSelect,
  onContextMenu,
  dirtySkillIds,
}: {
  testId: string;
  storageKey: string;
  icon: string;
  label: string;
  count: number;
  items: SectionItems;
  repoVisibilityLookup?: Map<string, ConnectedRepoDTO>;
  selectedKey: SelectedKey | null;
  onSelect: (skill: SkillInfo) => void;
  onContextMenu?: (event: React.MouseEvent<HTMLButtonElement>, skill: SkillInfo) => void;
  dirtySkillIds?: Set<string>;
}) {
  const [collapsed, setCollapsed] = useState<boolean>(() => readCollapsed(storageKey));
  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      writeCollapsed(storageKey, next);
      return next;
    });
  }, [storageKey]);

  const groupId = `${testId}-group`;
  return (
    <div>
      <button
        type="button"
        data-testid={testId}
        aria-expanded={!collapsed}
        aria-controls={groupId}
        onClick={toggle}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          width: "100%",
          padding: "6px 12px 4px 14px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          color: "var(--text-secondary)",
          fontFamily: "var(--font-sans)",
          textAlign: "left",
        }}
      >
        <span aria-hidden="true" style={{ fontSize: 11 }}>{icon}</span>
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "var(--text-secondary)",
          }}
        >
          {label}
        </span>
        <span
          style={{
            fontSize: 10,
            color: "var(--text-tertiary)",
            fontVariantNumeric: "tabular-nums",
            fontFamily: "var(--font-mono)",
          }}
        >
          ({count})
        </span>
      </button>
      {!collapsed && (
        <div id={groupId} role="group">
          {items.map(([plugin, list]) => (
            <PluginGroup
              key={plugin}
              plugin={plugin}
              skills={list}
              selectedKey={selectedKey}
              onSelect={onSelect}
              onContextMenu={onContextMenu}
              dirtySkillIds={dirtySkillIds}
              repoVisibilityLookup={repoVisibilityLookup}
            />
          ))}
        </div>
      )}
    </div>
  );
}
