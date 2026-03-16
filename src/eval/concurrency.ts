// ---------------------------------------------------------------------------
// concurrency.ts -- cooperative semaphore for limiting concurrent LLM calls
// Shared module: imported by both eval-server/ and commands/eval/
// ---------------------------------------------------------------------------

export const DEFAULT_CONCURRENCY = 3;

export class Semaphore {
  private running = 0;
  private queue: Array<() => void> = [];

  constructor(private readonly limit: number = DEFAULT_CONCURRENCY) {
    if (limit < 1) throw new Error("Semaphore limit must be >= 1");
  }

  async acquire(): Promise<void> {
    if (this.running < this.limit) {
      this.running++;
      return;
    }
    return new Promise<void>((resolve) => this.queue.push(() => {
      this.running++;
      resolve();
    }));
  }

  release(): void {
    if (this.running <= 0) return; // idempotent — no underflow
    this.running--;
    const next = this.queue.shift();
    if (next) next();
  }

  get available(): number {
    return Math.max(0, this.limit - this.running);
  }

  get pending(): number {
    return this.queue.length;
  }

  get active(): number {
    return this.running;
  }
}

// Per-skill semaphore registry — ensures one semaphore per skill
const registry = new Map<string, Semaphore>();

export function getSkillSemaphore(skillKey: string, limit = DEFAULT_CONCURRENCY): Semaphore {
  let sem = registry.get(skillKey);
  if (!sem) {
    sem = new Semaphore(limit);
    registry.set(skillKey, sem);
  }
  return sem;
}
