import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";

export function isTTY(): boolean {
  return !!(process.stdin.isTTY && process.stdout.isTTY);
}

export interface CheckboxItem {
  label: string;
  description?: string;
  checked?: boolean;
}

export interface CheckboxOptions {
  title?: string;
}

export interface ChoiceItem {
  label: string;
  hint?: string;
}

export interface Prompter {
  promptCheckboxList(items: CheckboxItem[], options?: CheckboxOptions): Promise<number[]>;
  promptChoice(question: string, choices: ChoiceItem[]): Promise<number>;
  promptConfirm(question: string, defaultYes?: boolean): Promise<boolean>;
}

/**
 * Strip ANSI CSI escape sequences (e.g. arrow keys) from a line.
 * Returns the remaining content trimmed.
 */
function stripEscapeSequences(line: string): string {
  return line.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").trim();
}

/**
 * Returns true if the line consists entirely of ANSI escape sequences
 * (no real typed content). Used to detect stray arrow-key input.
 */
export function isEscapeSequence(line: string): boolean {
  return line.length > 0 && stripEscapeSequences(line).length === 0;
}

/**
 * Parse a toggle input string into 0-based indices.
 *
 * Supported formats (1-based user input):
 *   "3"       → [2]
 *   "1-3"     → [0, 1, 2]
 *   "1,3,5"   → [0, 2, 4]
 *   "1-3,5"   → [0, 1, 2, 4]
 *
 * Invalid ranges (start > end) or out-of-bounds entries are silently ignored.
 * Returns a sorted, deduplicated array of 0-based indices.
 */
export function parseToggleInput(input: string, maxIndex: number): number[] {
  const indices = new Set<number>();
  const tokens = input.split(",");

  for (const token of tokens) {
    const trimmed = token.trim();
    const dashIdx = trimmed.indexOf("-");

    if (dashIdx > 0) {
      // Range: e.g. "1-3"
      const start = parseInt(trimmed.slice(0, dashIdx), 10);
      const end = parseInt(trimmed.slice(dashIdx + 1), 10);
      if (isNaN(start) || isNaN(end) || start > end) continue;
      for (let i = start; i <= end; i++) {
        const idx = i - 1;
        if (idx >= 0 && idx < maxIndex) indices.add(idx);
      }
    } else {
      // Single number
      const num = parseInt(trimmed, 10);
      if (isNaN(num)) continue;
      const idx = num - 1;
      if (idx >= 0 && idx < maxIndex) indices.add(idx);
    }
  }

  return Array.from(indices).sort((a, b) => a - b);
}

export function createPrompter(input?: Readable, output?: Writable): Prompter {
  const inp = input ?? process.stdin;
  const out = output ?? process.stdout;

  const rl = createInterface({ input: inp, output: out, terminal: false });

  // Line queue: lines arriving before ask() is called get buffered here
  const lineQueue: string[] = [];
  const waiters: Array<(line: string) => void> = [];

  rl.on("line", (line) => {
    const waiter = waiters.shift();
    if (waiter) {
      waiter(line.trim());
    } else {
      lineQueue.push(line.trim());
    }
  });

  function ask(prompt: string): Promise<string> {
    out.write(prompt);
    return new Promise((resolve) => {
      const buffered = lineQueue.shift();
      if (buffered !== undefined) {
        resolve(buffered);
      } else {
        waiters.push(resolve);
      }
    });
  }

  function writeLine(text: string): void {
    out.write(text + "\n");
  }

  function renderCheckbox(items: CheckboxItem[], checked: boolean[]): void {
    for (let i = 0; i < items.length; i++) {
      const mark = checked[i] ? "x" : " ";
      const desc = items[i].description ? ` - ${items[i].description}` : "";
      writeLine(`  ${i + 1}) [${mark}] ${items[i].label}${desc}`);
    }
    writeLine(`  a) Toggle all`);
    writeLine(`  Type: number, range (1-3), list (1,3,5). Enter=done`);
  }

  return {
    async promptCheckboxList(items: CheckboxItem[], options?: CheckboxOptions): Promise<number[]> {
      const checked = items.map((item) => item.checked ?? false);

      if (options?.title) {
        writeLine(`\n${options.title}`);
      }

      renderCheckbox(items, checked);

      while (true) {
        const raw = await ask("> ");
        const line = stripEscapeSequences(raw);

        // Only escape sequences (e.g. arrow key alone) — silently ignore
        if (raw !== "" && line === "") {
          continue;
        }

        if (line === "") {
          break;
        }

        if (line.toLowerCase() === "a") {
          const allChecked = checked.every(Boolean);
          for (let i = 0; i < checked.length; i++) {
            checked[i] = !allChecked;
          }
          renderCheckbox(items, checked);
          continue;
        }

        const indices = parseToggleInput(line, items.length);
        if (indices.length > 0) {
          for (const idx of indices) {
            checked[idx] = !checked[idx];
          }
          renderCheckbox(items, checked);
        }
      }

      rl.close();
      return checked.reduce<number[]>((acc, val, idx) => {
        if (val) acc.push(idx);
        return acc;
      }, []);
    },

    async promptChoice(question: string, choices: ChoiceItem[]): Promise<number> {
      writeLine(`\n${question}`);
      for (let i = 0; i < choices.length; i++) {
        const hint = choices[i].hint ? ` (${choices[i].hint})` : "";
        writeLine(`  ${i + 1}) ${choices[i].label}${hint}`);
      }

      while (true) {
        const raw = await ask("> ");
        const line = stripEscapeSequences(raw);
        // Only escape sequences — ignore
        if (raw !== "" && line === "") continue;
        const num = parseInt(line, 10);
        if (num >= 1 && num <= choices.length) {
          rl.close();
          return num - 1;
        }
      }
    },

    async promptConfirm(question: string, defaultYes?: boolean): Promise<boolean> {
      const hint = defaultYes ? "Y/n" : "y/N";
      const line = await ask(`${question} (${hint}): `);
      rl.close();

      if (line === "") {
        return !!defaultYes;
      }

      return line.toLowerCase() === "y";
    },
  };
}
