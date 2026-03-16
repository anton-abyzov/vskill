// ---------------------------------------------------------------------------
// SkillFileBrowser — collapsible file tree strip for the editor panel
// ---------------------------------------------------------------------------

import { useState, useMemo } from "react";
import type { SkillFileEntry } from "../types";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface TreeNode {
  name: string;
  path: string;
  type: "file" | "dir";
  size: number;
  children: TreeNode[];
}

function buildTree(entries: SkillFileEntry[]): TreeNode[] {
  const roots: TreeNode[] = [];
  const byPath = new Map<string, TreeNode>();

  // First pass: create all nodes
  for (const entry of entries) {
    const parts = entry.path.split("/");
    const name = parts[parts.length - 1];
    const node: TreeNode = { name, path: entry.path, type: entry.type, size: entry.size, children: [] };
    byPath.set(entry.path, node);
  }

  // Second pass: wire parents
  for (const entry of entries) {
    const parts = entry.path.split("/");
    if (parts.length === 1) {
      const node = byPath.get(entry.path);
      if (node) roots.push(node);
    } else {
      const parentPath = parts.slice(0, -1).join("/");
      const parent = byPath.get(parentPath);
      const node = byPath.get(entry.path);
      if (parent && node) parent.children.push(node);
    }
  }

  return roots;
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width="10" height="10" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s" }}
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}

interface TreeItemProps {
  node: TreeNode;
  depth: number;
  activeFile: string;
  onSelect: (path: string) => void;
}

function TreeItem({ node, depth, activeFile, onSelect }: TreeItemProps) {
  const [expanded, setExpanded] = useState(true);
  const isActive = node.path === activeFile;

  if (node.type === "dir") {
    return (
      <div>
        <button
          onClick={() => setExpanded(!expanded)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            width: "100%",
            paddingLeft: `${4 + depth * 14}px`,
            paddingTop: 2,
            paddingBottom: 2,
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--text-secondary)",
            fontSize: 11,
            fontFamily: "var(--font-mono, monospace)",
            textAlign: "left",
          }}
        >
          <ChevronIcon expanded={expanded} />
          <FolderIcon />
          <span>{node.name}/</span>
        </button>
        {expanded && node.children.map((child) => (
          <TreeItem key={child.path} node={child} depth={depth + 1} activeFile={activeFile} onSelect={onSelect} />
        ))}
      </div>
    );
  }

  return (
    <button
      onClick={() => onSelect(node.path)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        width: "100%",
        paddingLeft: `${4 + depth * 14}px`,
        paddingTop: 2,
        paddingBottom: 2,
        background: isActive ? "var(--accent-muted)" : "none",
        border: "none",
        cursor: "pointer",
        color: isActive ? "var(--accent)" : "var(--text-tertiary)",
        fontSize: 11,
        fontFamily: "var(--font-mono, monospace)",
        textAlign: "left",
        borderRadius: 3,
      }}
    >
      <span style={{ width: 10 }} />
      <FileIcon />
      <span style={{ flex: 1 }}>{node.name}</span>
      <span style={{ fontSize: 9, color: "var(--text-tertiary)", marginRight: 4, whiteSpace: "nowrap" }}>
        {formatFileSize(node.size)}
      </span>
    </button>
  );
}

interface SkillFileBrowserProps {
  files: SkillFileEntry[];
  activeFile: string;
  onSelect: (path: string) => void;
  onRefresh: () => void;
}

export function SkillFileBrowser({ files, activeFile, onSelect, onRefresh }: SkillFileBrowserProps) {
  const [expanded, setExpanded] = useState(false);
  const tree = useMemo(() => buildTree(files), [files]);

  return (
    <div style={{ borderBottom: "1px solid var(--border-subtle)", background: "var(--surface-0)" }}>
      {/* Collapsed strip — always visible */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "3px 8px",
          cursor: "pointer",
          userSelect: "none",
        }}
        onClick={() => setExpanded(!expanded)}
      >
        <ChevronIcon expanded={expanded} />
        <FolderIcon />
        <span
          style={{
            fontSize: 11,
            fontFamily: "var(--font-mono, monospace)",
            color: "var(--text-secondary)",
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {activeFile}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); onRefresh(); }}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--text-tertiary)",
            padding: "2px 4px",
            display: "flex",
            alignItems: "center",
            borderRadius: 3,
          }}
          title="Refresh file list"
        >
          <RefreshIcon />
        </button>
      </div>

      {/* Expanded tree */}
      {expanded && (
        <div
          style={{
            maxHeight: 240,
            overflowY: "auto",
            padding: "2px 4px 4px",
          }}
        >
          {tree.length === 0 ? (
            <div style={{ fontSize: 11, color: "var(--text-tertiary)", padding: "4px 8px" }}>
              No files found
            </div>
          ) : (
            tree.map((node) => (
              <TreeItem key={node.path} node={node} depth={0} activeFile={activeFile} onSelect={(path) => { onSelect(path); setExpanded(false); }} />
            ))
          )}
        </div>
      )}
    </div>
  );
}
