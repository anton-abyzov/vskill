// ---------------------------------------------------------------------------
// SkillFileTree — visualizes the folder structure of a skill being created
// ---------------------------------------------------------------------------

interface TreeNode {
  name: string;
  type: "file" | "dir";
  children?: TreeNode[];
}

function FolderIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function TreeItem({ node, depth = 0 }: { node: TreeNode; depth?: number }) {
  return (
    <>
      <div
        className="flex items-center gap-1.5 py-0.5"
        style={{
          paddingLeft: `${depth * 16}px`,
          color: node.type === "dir" ? "var(--text-secondary)" : "var(--text-tertiary)",
          fontSize: 12,
          fontFamily: "var(--font-mono, monospace)",
        }}
      >
        {node.type === "dir" ? <FolderIcon /> : <FileIcon />}
        <span>{node.name}{node.type === "dir" ? "/" : ""}</span>
      </div>
      {node.children?.map((child) => (
        <TreeItem key={child.name} node={child} depth={depth + 1} />
      ))}
    </>
  );
}

/** Build tree from the files that will be created for this skill */
function buildTree(skillName: string, hasEvals: boolean, isDraft: boolean): TreeNode {
  const evalsChildren: TreeNode[] = [];
  if (hasEvals) {
    evalsChildren.push({ name: "evals.json", type: "file" });
  }
  evalsChildren.push({ name: "history", type: "dir" });

  const children: TreeNode[] = [
    { name: "SKILL.md", type: "file" },
    { name: "evals", type: "dir", children: evalsChildren },
  ];

  if (isDraft) {
    children.push({ name: "draft.json", type: "file" });
  }

  return {
    name: skillName || "{skill}",
    type: "dir",
    children,
  };
}

interface SkillFileTreeProps {
  skillName: string;
  hasEvals: boolean;
  isDraft: boolean;
}

export function SkillFileTree({ skillName, hasEvals, isDraft }: SkillFileTreeProps) {
  const tree = buildTree(skillName, hasEvals, isDraft);

  return (
    <div className="glass-card p-4">
      <h3
        className="text-[13px] font-semibold mb-3 flex items-center gap-2"
        style={{ color: "var(--text-primary)" }}
      >
        <div
          className="w-5 h-5 rounded-md flex items-center justify-center"
          style={{ background: "var(--accent-muted)" }}
        >
          <FolderIcon />
        </div>
        Skill Structure
      </h3>
      <div
        className="rounded-lg px-3 py-2"
        style={{
          background: "var(--surface-0)",
          border: "1px solid var(--border-subtle)",
        }}
      >
        <TreeItem node={tree} />
      </div>
    </div>
  );
}
