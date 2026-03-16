// ---------------------------------------------------------------------------
// judge-cache.ts -- SHA-256 content-hash cache for judge results
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import type { AssertionResult } from "./judge.js";

export interface CacheEntry {
  pass: boolean;
  reasoning: string;
  cachedAt: string;
  judgeModel: string;
}

export interface CacheData {
  version: number;
  entries: Record<string, CacheEntry>;
}

export class JudgeCache {
  private data: CacheData;
  private dirty = false;
  private readonly cachePath: string;

  constructor(private readonly skillDir: string) {
    this.cachePath = join(skillDir, "evals", ".judge-cache.json");
    this.data = this.load();
  }

  private load(): CacheData {
    try {
      if (existsSync(this.cachePath)) {
        const raw = readFileSync(this.cachePath, "utf-8");
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && parsed.version === 1 && typeof parsed.entries === "object") {
          return parsed as CacheData;
        }
      }
    } catch {
      // Corruption recovery: delete corrupted file and start fresh
      try {
        if (existsSync(this.cachePath)) {
          unlinkSync(this.cachePath);
          console.warn(`[judge-cache] Corrupted cache file deleted: ${this.cachePath}`);
        }
      } catch {
        // ignore deletion failure
      }
    }
    return { version: 1, entries: {} };
  }

  static computeKey(assertionText: string, output: string, judgeModel: string): string {
    return createHash("sha256")
      .update(`${assertionText}||${output}||${judgeModel}`)
      .digest("hex");
  }

  async getOrCompute(
    assertionText: string,
    output: string,
    judgeModel: string,
    compute: () => Promise<AssertionResult>,
  ): Promise<AssertionResult> {
    const key = JudgeCache.computeKey(assertionText, output, judgeModel);

    const cached = this.data.entries[key];
    if (cached) {
      // Return cached result, reconstructing the AssertionResult shape
      return {
        id: "", // caller overwrites this
        text: assertionText,
        pass: cached.pass,
        reasoning: cached.reasoning,
      };
    }

    const result = await compute();

    // Store in cache
    this.data.entries[key] = {
      pass: result.pass,
      reasoning: result.reasoning,
      cachedAt: new Date().toISOString(),
      judgeModel,
    };
    this.dirty = true;

    return result;
  }

  has(assertionText: string, output: string, judgeModel: string): boolean {
    const key = JudgeCache.computeKey(assertionText, output, judgeModel);
    return key in this.data.entries;
  }

  get size(): number {
    return Object.keys(this.data.entries).length;
  }

  /**
   * Persist cache to disk. Call after all operations are complete.
   * Also ensures .judge-cache.json is in .gitignore.
   */
  flush(): void {
    if (!this.dirty) return;

    const dir = dirname(this.cachePath);
    mkdirSync(dir, { recursive: true });
    writeFileSync(this.cachePath, JSON.stringify(this.data, null, 2), "utf-8");
    this.dirty = false;

    // T-009: Ensure .judge-cache.json is in .gitignore
    this.ensureGitignore();
  }

  private ensureGitignore(): void {
    const gitignorePath = join(this.skillDir, ".gitignore");
    const pattern = "evals/.judge-cache.json";

    try {
      if (existsSync(gitignorePath)) {
        const content = readFileSync(gitignorePath, "utf-8");
        if (content.includes(pattern)) return;
        appendFileSync(gitignorePath, `\n${pattern}\n`);
      } else {
        writeFileSync(gitignorePath, `${pattern}\n`, "utf-8");
      }
    } catch {
      // Non-critical — don't fail the run for gitignore issues
    }
  }
}
