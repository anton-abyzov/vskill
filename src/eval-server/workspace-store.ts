// ---------------------------------------------------------------------------
// 0698 T-011: user-global workspace registry.
//
// Persisted at ~/.vskill/workspace.json (injected as `workspaceDir` for tests).
// Functions are pure (no hidden state) — pass WorkspaceConfig through and get
// a new config back. The disk write is atomic: we write to <file>.tmp then
// rename, so a crash mid-write can't leave workspace.json half-baked.
// ---------------------------------------------------------------------------

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

export interface ProjectConfig {
  id: string;
  name: string;
  path: string;
  colorDot: string;
  addedAt: string;
  lastActiveAt?: string;
}

export interface WorkspaceConfig {
  version: 1;
  activeProjectId: string | null;
  projects: ProjectConfig[];
}

const WORKSPACE_FILE = "workspace.json";

function defaultWorkspace(): WorkspaceConfig {
  return { version: 1, activeProjectId: null, projects: [] };
}

/**
 * Load the workspace from disk. Seeds a default empty config if the file
 * does not exist or is unparseable. Does NOT create the directory.
 */
export function loadWorkspace(workspaceDir: string): WorkspaceConfig {
  const file = join(workspaceDir, WORKSPACE_FILE);
  if (!existsSync(file)) return defaultWorkspace();
  try {
    const raw = readFileSync(file, "utf8");
    const data = JSON.parse(raw) as Partial<WorkspaceConfig>;
    if (data.version !== 1 || !Array.isArray(data.projects)) return defaultWorkspace();
    return {
      version: 1,
      activeProjectId: typeof data.activeProjectId === "string" ? data.activeProjectId : null,
      projects: data.projects.filter(isProjectConfig),
    };
  } catch {
    return defaultWorkspace();
  }
}

function isProjectConfig(v: unknown): v is ProjectConfig {
  const r = v as Partial<ProjectConfig>;
  return (
    typeof r === "object" &&
    r !== null &&
    typeof r.id === "string" &&
    typeof r.name === "string" &&
    typeof r.path === "string" &&
    typeof r.colorDot === "string" &&
    typeof r.addedAt === "string"
  );
}

/**
 * Save the workspace atomically (tmp file + rename). Creates workspaceDir if
 * needed. Caller is responsible for passing a valid config.
 */
export function saveWorkspace(workspaceDir: string, ws: WorkspaceConfig): void {
  if (!existsSync(workspaceDir)) mkdirSync(workspaceDir, { recursive: true });
  const file = join(workspaceDir, WORKSPACE_FILE);
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(ws, null, 2) + "\n", "utf8");
  renameSync(tmp, file);
}

export interface AddProjectInput {
  path: string;
  name?: string;
}

export function addProject(
  workspaceDir: string,
  ws: WorkspaceConfig,
  input: AddProjectInput,
): WorkspaceConfig {
  if (!existsSync(input.path)) {
    throw new Error(`Project path does not exist: ${input.path}`);
  }
  if (!statSync(input.path).isDirectory()) {
    throw new Error(`Project path is not a directory: ${input.path}`);
  }
  if (ws.projects.some((p) => p.path === input.path)) {
    throw new Error(`Duplicate project path already registered: ${input.path}`);
  }

  const id = projectIdFromPath(input.path);
  const name = input.name ?? basenameOf(input.path);
  const newProject: ProjectConfig = {
    id,
    name,
    path: input.path,
    colorDot: colorDotForPath(input.path),
    addedAt: new Date().toISOString(),
  };

  const next: WorkspaceConfig = {
    version: 1,
    activeProjectId: ws.activeProjectId ?? id, // first add becomes active
    projects: [...ws.projects, newProject],
  };
  saveWorkspace(workspaceDir, next);
  return next;
}

export function removeProject(
  workspaceDir: string,
  ws: WorkspaceConfig,
  id: string,
): WorkspaceConfig {
  const index = ws.projects.findIndex((p) => p.id === id);
  if (index === -1) throw new Error(`Project id not found: ${id}`);

  const next: WorkspaceConfig = {
    version: 1,
    activeProjectId: ws.activeProjectId === id ? null : ws.activeProjectId,
    projects: ws.projects.filter((p) => p.id !== id),
  };
  saveWorkspace(workspaceDir, next);
  return next;
}

export function setActiveProject(
  workspaceDir: string,
  ws: WorkspaceConfig,
  id: string | null,
): WorkspaceConfig {
  if (id === null) {
    const next: WorkspaceConfig = { ...ws, activeProjectId: null };
    saveWorkspace(workspaceDir, next);
    return next;
  }

  const index = ws.projects.findIndex((p) => p.id === id);
  if (index === -1) throw new Error(`Project id not found: ${id}`);

  const now = new Date().toISOString();
  const updatedProjects = ws.projects.map((p, i) =>
    i === index ? { ...p, lastActiveAt: now } : p,
  );
  const next: WorkspaceConfig = {
    version: 1,
    activeProjectId: id,
    projects: updatedProjects,
  };
  saveWorkspace(workspaceDir, next);
  return next;
}

// -----------------------------------------------------------------------------
// Helpers (exported for tests)
// -----------------------------------------------------------------------------

/**
 * Deterministic, path-stable id. Uses the first 10 hex chars of sha256(path).
 * Short enough for JSON + URL use, long enough to avoid collisions at
 * realistic workspace sizes (~10^12 addressable ids).
 */
export function projectIdFromPath(absolutePath: string): string {
  return createHash("sha256").update(absolutePath).digest("hex").slice(0, 10);
}

function basenameOf(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

/**
 * Deterministic OKLCH color dot per project path. Uses sha256 to produce a
 * stable hue (0-360) with fixed lightness + chroma suitable for both light
 * and dark themes.
 */
function colorDotForPath(absolutePath: string): string {
  const h = createHash("sha256").update(absolutePath).digest();
  const hue = h.readUInt16BE(0) % 360;
  return `oklch(0.72 0.13 ${hue})`;
}
