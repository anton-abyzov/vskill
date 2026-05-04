// 0823 T-014 — Read-only file tree used by SourcePanel.
//
// Renders a flat list of paths as a collapsible folder tree. Files are
// surfaced via data-testid="source-tree-item" with data-path="<rel>" and
// data-active when matching the active selection. Empty states get
// data-testid="source-tree-empty".
//
// AC-US1-07 (0823 F-003): keyboard navigation. The container is focusable
// (tabIndex 0). ArrowDown / ArrowUp move selection through visible items
// (folders included; expanded children are part of the visible flow). Enter
// activates a file (calls onSelect) or toggles a folder. Escape blurs the
// tree so focus returns to the surrounding tab bar.
import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { SkillFileEntry } from "../types";

interface Props {
  files: SkillFileEntry[];
  activePath: string;
  onSelect: (path: string) => void;
}

interface TreeNode {
  name: string;
  path: string;
  type: "file" | "dir";
  size: number;
  children: TreeNode[];
}

function buildTree(files: SkillFileEntry[]): TreeNode {
  const root: TreeNode = { name: "", path: "", type: "dir", size: 0, children: [] };
  // Files-only entries are sufficient — directories are inferred from path segments.
  for (const f of files) {
    if (f.type !== "file") continue;
    const segments = f.path.split("/");
    let cursor = root;
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const isLeaf = i === segments.length - 1;
      let next = cursor.children.find((c) => c.name === seg);
      if (!next) {
        next = {
          name: seg,
          path: segments.slice(0, i + 1).join("/"),
          type: isLeaf ? "file" : "dir",
          size: isLeaf ? f.size : 0,
          children: [],
        };
        cursor.children.push(next);
      }
      cursor = next;
    }
  }
  // Sort: dirs first, then files, both alphabetical.
  const sortRecursive = (n: TreeNode) => {
    n.children.sort((a, b) => {
      if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    n.children.forEach(sortRecursive);
  };
  sortRecursive(root);
  return root;
}

function ext(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

function fileGlyph(name: string): string {
  const e = ext(name);
  if (name === "SKILL.md") return "📘";
  if (e === "md") return "📄";
  if (e === "ts" || e === "tsx" || e === "js" || e === "jsx") return "📜";
  if (e === "json" || e === "yaml" || e === "yml" || e === "toml") return "🔧";
  if (e === "sh" || e === "bash") return "🖥";
  if (e === "png" || e === "jpg" || e === "jpeg" || e === "gif" || e === "webp" || e === "svg") return "🖼";
  return "📄";
}

function NodeRow({
  node,
  depth,
  activePath,
  focusedPath,
  onSelect,
  expanded,
  onToggle,
}: {
  node: TreeNode;
  depth: number;
  activePath: string;
  focusedPath: string | undefined;
  onSelect: (path: string) => void;
  expanded: Set<string>;
  onToggle: (path: string) => void;
}) {
  if (node.type === "dir") {
    const isOpen = expanded.has(node.path);
    const isFocused = node.path === focusedPath;
    return (
      <div>
        <button
          type="button"
          data-testid="source-tree-item"
          data-path={node.path}
          data-type="dir"
          data-focused={isFocused ? "true" : "false"}
          role="treeitem"
          aria-expanded={isOpen}
          onClick={() => onToggle(node.path)}
          style={{
            width: "100%",
            textAlign: "left",
            background: isFocused ? "var(--surface-2)" : "transparent",
            border: "none",
            padding: `4px 8px 4px ${depth * 12 + 8}px`,
            color: "var(--text-secondary)",
            fontFamily: "var(--font-sans)",
            fontSize: 12,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <span style={{ width: 10, display: "inline-block" }}>{isOpen ? "▾" : "▸"}</span>
          <span>📁</span>
          <span>{node.name}</span>
        </button>
        {isOpen && (
          <div role="group">
            {node.children.map((c) => (
              <NodeRow
                key={c.path}
                node={c}
                depth={depth + 1}
                activePath={activePath}
                focusedPath={focusedPath}
                onSelect={onSelect}
                expanded={expanded}
                onToggle={onToggle}
              />
            ))}
          </div>
        )}
      </div>
    );
  }
  const isActive = node.path === activePath;
  const isFocused = node.path === focusedPath;
  return (
    <button
      type="button"
      data-testid="source-tree-item"
      data-path={node.path}
      data-type="file"
      data-active={isActive ? "true" : "false"}
      data-focused={isFocused ? "true" : "false"}
      role="treeitem"
      aria-selected={isActive}
      onClick={() => onSelect(node.path)}
      style={{
        width: "100%",
        textAlign: "left",
        background: isActive ? "var(--surface-3)" : isFocused ? "var(--surface-2)" : "transparent",
        border: "none",
        padding: `4px 8px 4px ${depth * 12 + 8}px`,
        color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
        fontFamily: "var(--font-sans)",
        fontSize: 12,
        fontWeight: isActive ? 600 : 400,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: 6,
      }}
    >
      <span style={{ width: 10, display: "inline-block" }}> </span>
      <span>{fileGlyph(node.name)}</span>
      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{node.name}</span>
    </button>
  );
}

export function SourceFileTree({ files, activePath, onSelect }: Props) {
  const tree = useMemo(() => buildTree(files), [files]);
  const initialExpanded = useMemo(() => {
    const set = new Set<string>();
    // Auto-expand the folder containing the active path.
    if (activePath && activePath.includes("/")) {
      const parts = activePath.split("/");
      for (let i = 1; i < parts.length; i++) {
        set.add(parts.slice(0, i).join("/"));
      }
    }
    // Also expand all top-level dirs by default for discoverability.
    tree.children.forEach((c) => {
      if (c.type === "dir") set.add(c.path);
    });
    return set;
  }, [tree, activePath]);
  const [expanded, setExpanded] = useState<Set<string>>(initialExpanded);

  // Sync expanded state when the file list (and thus the derived initialExpanded)
  // changes — useState only honors initialExpanded on the first render, so without
  // this effect the tree stays collapsed when files arrive after mount.
  useEffect(() => {
    setExpanded((prev) => {
      const next = new Set(prev);
      let changed = false;
      initialExpanded.forEach((p) => {
        if (!next.has(p)) {
          next.add(p);
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [initialExpanded]);

  const onToggle = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  // 0823 F-003: build the visible-item flow for keyboard nav. Walks the tree
  // in render order (depth-first), respecting the current expanded set. Items
  // whose ancestors are collapsed are excluded.
  const visibleItems = useMemo(() => {
    const out: { path: string; type: "file" | "dir" }[] = [];
    const walk = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        out.push({ path: n.path, type: n.type });
        if (n.type === "dir" && expanded.has(n.path)) walk(n.children);
      }
    };
    walk(tree.children);
    return out;
  }, [tree, expanded]);

  // 0823 F-003: focus index follows activePath when present; otherwise tracks
  // the user's keyboard cursor independently (so ArrowDown/Up traverses even
  // before the user has selected anything).
  const containerRef = useRef<HTMLDivElement>(null);
  const [focusIdx, setFocusIdx] = useState<number>(() =>
    Math.max(0, visibleItems.findIndex((i) => i.path === activePath)),
  );
  useEffect(() => {
    const idx = visibleItems.findIndex((i) => i.path === activePath);
    if (idx >= 0) setFocusIdx(idx);
  }, [activePath, visibleItems]);

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (visibleItems.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusIdx((i) => Math.min(visibleItems.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = visibleItems[focusIdx];
      if (!target) return;
      if (target.type === "dir") onToggle(target.path);
      else onSelect(target.path);
    } else if (e.key === "Escape") {
      e.preventDefault();
      // Blur the tree — outer tab bar receives focus via the browser's
      // standard sequential nav.
      containerRef.current?.blur();
    }
  };

  if (tree.children.length === 0) {
    return (
      <div
        data-testid="source-tree-empty"
        style={{
          padding: 16,
          fontSize: 12,
          color: "var(--text-tertiary)",
          fontFamily: "var(--font-sans)",
        }}
      >
        No files found.
      </div>
    );
  }

  return (
    <div
      data-testid="source-file-tree"
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      role="tree"
      aria-label="Skill files"
      style={{ paddingTop: 4, paddingBottom: 4, outline: "none" }}
    >
      {tree.children.map((c) => (
        <NodeRow
          key={c.path}
          node={c}
          depth={0}
          activePath={activePath}
          focusedPath={visibleItems[focusIdx]?.path}
          onSelect={onSelect}
          expanded={expanded}
          onToggle={onToggle}
        />
      ))}
    </div>
  );
}
