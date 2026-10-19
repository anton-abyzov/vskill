// 0932: an in-memory GitHub + verified-skill.com for install tests. Routes a
// global fetch stub and records every request so tests can count GitHub REST
// calls and assert which commit each file was read from.
import { createHash } from "node:crypto";

export interface FakeRepo {
  owner: string;
  repo: string;
  defaultBranch: string;
  headSha: string;
  /** commit sha -> { repo-relative path -> content } */
  commits: Record<string, Record<string, string>>;
  private?: boolean;
  marketplace?: string;
}

export interface FakeRegistryVersion {
  version: string;
  gitSha?: string;
  contentHash?: string;
  certTier?: string;
}

export interface FakeNetworkOptions {
  repos: FakeRepo[];
  /** "owner/repo/skill" -> published versions, newest first */
  registry?: Record<string, FakeRegistryVersion[]>;
  /** "owner/repo/skill" -> security report body */
  security?: Record<string, unknown>;
  /** Rate-limit every api.github.com request. */
  rateLimited?: boolean;
  /** Registry unreachable (network error for verified-skill.com). */
  registryDown?: boolean;
  /** query -> search results (`/api/v1/skills/search?q=`) */
  search?: Record<string, Array<Record<string, unknown>>>;
}

export const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

export function createFakeNetwork(opts: FakeNetworkOptions) {
  const calls: string[] = [];
  const find = (owner: string, repo: string) =>
    opts.repos.find((r) => r.owner.toLowerCase() === owner.toLowerCase() && r.repo.toLowerCase() === repo.toLowerCase());
  const resolveRef = (r: FakeRepo, ref: string): string | null => {
    if (ref === "HEAD" || ref === r.defaultBranch) return r.headSha;
    if (r.commits[ref]) return ref;
    return null;
  };

  const fetchImpl = async (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    const u = new URL(url);

    if (u.hostname === "api.github.com") {
      if (opts.rateLimited) {
        return json({ message: "API rate limit exceeded" }, 403, { "x-ratelimit-remaining": "0" });
      }
      const m = u.pathname.match(/^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/);
      if (!m) return json({ message: "Not Found" }, 404);
      const r = find(m[1], m[2]);
      if (!r) return json({ message: "Not Found" }, 404);
      const rest = m[3] ?? "";
      if (rest === "") {
        return json({ default_branch: r.defaultBranch, private: !!r.private, visibility: r.private ? "private" : "public" });
      }
      const commit = rest.match(/^\/commits\/(.+)$/);
      if (commit) {
        const sha = resolveRef(r, decodeURIComponent(commit[1]));
        return sha ? json({ sha }) : json({ message: "No commit found" }, 422);
      }
      const tree = rest.match(/^\/git\/trees\/(.+)$/);
      if (tree) {
        const treeish = decodeURIComponent(tree[1]);
        const [ref, dir = ""] = treeish.split(":");
        const sha = resolveRef(r, ref);
        if (!sha) return json({ message: "Not Found" }, 404);
        const files = r.commits[sha];
        const prefix = dir ? `${dir}/` : "";
        const entries = Object.entries(files)
          .filter(([p]) => p.startsWith(prefix))
          .map(([p, c]) => ({ path: p.slice(prefix.length), mode: "100644", type: "blob", size: Buffer.byteLength(c) }));
        if (dir && entries.length === 0) return json({ message: "Not Found" }, 404);
        return json({ sha: `tree-${sha}`, tree: entries, truncated: false });
      }
      const contents = rest.match(/^\/contents\/(.+)$/);
      if (contents) {
        const path = decodeURIComponent(contents[1]);
        if (path === ".claude-plugin/marketplace.json" && r.marketplace) {
          return json({ content: Buffer.from(r.marketplace).toString("base64"), encoding: "base64" });
        }
        const sha = resolveRef(r, u.searchParams.get("ref") ?? "HEAD");
        const body = sha ? r.commits[sha][path] : undefined;
        if (body === undefined) return json({ message: "Not Found" }, 404);
        return new Response(body, { status: 200 });
      }
      return json({ message: "Not Found" }, 404);
    }

    if (u.hostname === "raw.githubusercontent.com") {
      const [, owner, repo, ref, ...pathParts] = u.pathname.split("/");
      const r = find(owner, repo);
      if (!r || r.private) return new Response("404: Not Found", { status: 404 });
      const sha = resolveRef(r, decodeURIComponent(ref));
      const path = pathParts.map(decodeURIComponent).join("/");
      if (path === ".claude-plugin/marketplace.json" && r.marketplace) return new Response(r.marketplace);
      const body = sha ? r.commits[sha][path] : undefined;
      return body === undefined ? new Response("404: Not Found", { status: 404 }) : new Response(body);
    }

    if (u.hostname === "verified-skill.com" || u.hostname === "localhost") {
      if (opts.registryDown) throw new TypeError("fetch failed");
      const versions = u.pathname.match(/^\/api\/v1\/skills\/([^/]+)\/([^/]+)\/([^/]+)\/versions$/);
      if (versions) {
        const key = [versions[1], versions[2], versions[3]].map(decodeURIComponent).join("/");
        const list = opts.registry?.[key];
        if (!list) return json({ error: "Skill not found" }, 404);
        return json({
          versions: list.map((v, i) => ({ certTier: "VERIFIED", createdAt: `2026-10-${10 + i}T00:00:00Z`, ...v })),
          count: list.length,
        });
      }
      if (u.pathname === "/api/v1/skills/search") {
        const results = opts.search?.[u.searchParams.get("q") ?? ""] ?? [];
        return json({ results, pagination: { hasMore: false } });
      }
      const security = u.pathname.match(/^\/api\/v1\/skills\/([^/]+)\/([^/]+)\/([^/]+)\/security$/);
      if (security) {
        const key = [security[1], security[2], security[3]].map(decodeURIComponent).join("/");
        const body = opts.security?.[key];
        return body ? json(body) : json({ error: "Skill not found" }, 404);
      }
      return json({ ok: true });
    }

    throw new Error(`fake-network: unexpected request ${url}`);
  };

  return {
    fetch: fetchImpl,
    calls,
    githubRestCalls: () => calls.filter((c) => c.startsWith("https://api.github.com/")),
    rawCalls: () => calls.filter((c) => c.startsWith("https://raw.githubusercontent.com/")),
  };
}
