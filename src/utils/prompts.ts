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

// ---------------------------------------------------------------------------
// ANSI helpers
// ---------------------------------------------------------------------------

const ESC = "\x1b[";
const HIDE_CURSOR = `${ESC}?25l`;
const SHOW_CURSOR = `${ESC}?25h`;
const CLEAR_LINE = `${ESC}2K`;

function moveUp(n: number): string {
  return n > 0 ? `${ESC}${n}A` : "";
}

// ---------------------------------------------------------------------------
// Raw mode keypress reader
// ---------------------------------------------------------------------------

const KEY_UP = "\x1b[A";
const KEY_DOWN = "\x1b[B";
const KEY_SPACE = " ";
const KEY_ENTER_CR = "\r";
const KEY_ENTER_LF = "\n";
const KEY_CTRL_C = "\x03";

/**
 * Read a single keypress from stdin in raw mode.
 * Returns the raw key string (may be multi-byte for arrow keys).
 */
function readKey(): Promise<string> {
  return new Promise((resolve) => {
    function onData(data: Buffer) {
      process.stdin.removeListener("data", onData);
      resolve(data.toString());
    }
    process.stdin.on("data", onData);
  });
}

// ---------------------------------------------------------------------------
// Interactive prompter (raw mode, arrow keys, real TTY)
// ---------------------------------------------------------------------------

function createInteractivePrompter(): Prompter {
  const out = process.stdout;

  function write(s: string): void {
    out.write(s);
  }

  return {
    async promptCheckboxList(items: CheckboxItem[], options?: CheckboxOptions): Promise<number[]> {
      const checked = items.map((item) => item.checked ?? false);
      let cursor = 0;
      let scrollOffset = 0;
      let renderedLines = 0;

      // Scrolling viewport: fit within terminal, leave room for header/footer
      const termRows = out.rows || 24;
      const maxVisible = Math.min(items.length, Math.max(8, termRows - 6));

      function selectedCount(): number {
        return checked.filter(Boolean).length;
      }

      function render() {
        // Move up to overwrite previous render
        if (renderedLines > 0) {
          write(moveUp(renderedLines) + "\r");
        }

        // Keep cursor within viewport
        if (cursor < scrollOffset) scrollOffset = cursor;
        if (cursor >= scrollOffset + maxVisible) scrollOffset = cursor - maxVisible + 1;

        const lines: string[] = [];

        // Scroll indicator: above
        if (scrollOffset > 0) {
          lines.push(`${CLEAR_LINE}  \x1b[2m  ↑ ${scrollOffset} more above\x1b[0m`);
        }

        // Visible window
        const end = Math.min(scrollOffset + maxVisible, items.length);
        for (let i = scrollOffset; i < end; i++) {
          const mark = checked[i] ? "x" : " ";
          const pointer = i === cursor ? ">" : " ";
          const desc = items[i].description ? ` \x1b[2m— ${items[i].description}\x1b[0m` : "";
          lines.push(`${CLEAR_LINE}  ${pointer} [${mark}] ${items[i].label}${desc}`);
        }

        // Scroll indicator: below
        const remaining = items.length - end;
        if (remaining > 0) {
          lines.push(`${CLEAR_LINE}  \x1b[2m  ↓ ${remaining} more below\x1b[0m`);
        }

        // Footer with counts and controls
        lines.push(`${CLEAR_LINE}  \x1b[2m${selectedCount()}/${items.length} selected · ↑/↓ move · space toggle · a all · enter done\x1b[0m`);

        write(lines.join("\n") + "\n");
        renderedLines = lines.length;
      }

      // Print title
      if (options?.title) {
        write(`\n${options.title}\n`);
      }

      write(HIDE_CURSOR);
      process.stdin.setRawMode(true);
      process.stdin.resume();

      render();

      try {
        while (true) {
          const key = await readKey();

          if (key === KEY_UP) {
            cursor = cursor > 0 ? cursor - 1 : items.length - 1;
            // Wrap to bottom: scroll to end
            if (cursor === items.length - 1) scrollOffset = Math.max(0, items.length - maxVisible);
            render();
          } else if (key === KEY_DOWN) {
            cursor = cursor < items.length - 1 ? cursor + 1 : 0;
            // Wrap to top: scroll to start
            if (cursor === 0) scrollOffset = 0;
            render();
          } else if (key === KEY_SPACE) {
            checked[cursor] = !checked[cursor];
            render();
          } else if (key.toLowerCase() === "a") {
            const allChecked = checked.every(Boolean);
            checked.fill(!allChecked);
            render();
          } else if (key === KEY_ENTER_CR || key === KEY_ENTER_LF) {
            break;
          } else if (key === KEY_CTRL_C) {
            write(SHOW_CURSOR + "\n");
            process.stdin.setRawMode(false);
            process.exit(0);
          }
        }
      } finally {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        write(SHOW_CURSOR);
      }

      return checked.reduce<number[]>((acc, val, idx) => {
        if (val) acc.push(idx);
        return acc;
      }, []);
    },

    async promptChoice(question: string, choices: ChoiceItem[]): Promise<number> {
      let cursor = 0;
      let renderedLines = 0;

      function render() {
        if (renderedLines > 0) {
          write(moveUp(renderedLines) + "\r");
        }

        const lines: string[] = [];
        for (let i = 0; i < choices.length; i++) {
          const pointer = i === cursor ? ">" : " ";
          const dot = i === cursor ? "●" : "○";
          const hint = choices[i].hint ? ` \x1b[2m(${choices[i].hint})\x1b[0m` : "";
          lines.push(`${CLEAR_LINE}  ${pointer} ${dot} ${choices[i].label}${hint}`);
        }
        lines.push(`${CLEAR_LINE}  \x1b[2m↑/↓ move · enter select\x1b[0m`);

        write(lines.join("\n") + "\n");
        renderedLines = lines.length;
      }

      write(`\n${question}\n`);
      write(HIDE_CURSOR);
      process.stdin.setRawMode(true);
      process.stdin.resume();

      render();

      try {
        while (true) {
          const key = await readKey();

          if (key === KEY_UP) {
            cursor = cursor > 0 ? cursor - 1 : choices.length - 1;
            render();
          } else if (key === KEY_DOWN) {
            cursor = cursor < choices.length - 1 ? cursor + 1 : 0;
            render();
          } else if (key === KEY_ENTER_CR || key === KEY_ENTER_LF) {
            break;
          } else if (key === KEY_CTRL_C) {
            write(SHOW_CURSOR + "\n");
            process.stdin.setRawMode(false);
            process.exit(0);
          }
        }
      } finally {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        write(SHOW_CURSOR);
      }

      return cursor;
    },

    async promptConfirm(question: string, defaultYes?: boolean): Promise<boolean> {
      const hint = defaultYes ? "Y/n" : "y/N";
      write(`${question} (${hint}): `);

      process.stdin.setRawMode(true);
      process.stdin.resume();

      try {
        while (true) {
          const key = await readKey();
          if (key === KEY_ENTER_CR || key === KEY_ENTER_LF) {
            write("\n");
            return !!defaultYes;
          }
          if (key.toLowerCase() === "y") {
            write("y\n");
            return true;
          }
          if (key.toLowerCase() === "n") {
            write("n\n");
            return false;
          }
          if (key === KEY_CTRL_C) {
            write("\n");
            process.stdin.setRawMode(false);
            process.exit(0);
          }
        }
      } finally {
        process.stdin.setRawMode(false);
        process.stdin.pause();
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Text-based prompter (fallback for non-TTY / custom streams / tests)
// ---------------------------------------------------------------------------

function createTextPrompter(input: Readable, output: Writable): Prompter {
  const rl = createInterface({ input, output, terminal: false });

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
    output.write(prompt);
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
    output.write(text + "\n");
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

        if (raw !== "" && line === "") continue;
        if (line === "") break;

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

      if (line === "") return !!defaultYes;
      return line.toLowerCase() === "y";
    },
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a Prompter instance.
 *
 * - When called without arguments on a real TTY → interactive raw mode
 *   (arrow keys, space toggle, proper cursor movement)
 * - When called with custom streams or on non-TTY → text-based fallback
 *   (type numbers, compatible with piped input and tests)
 */
export function createPrompter(input?: Readable, output?: Writable): Prompter {
  const canUseInteractive =
    !input && !output && isTTY() && typeof process.stdin.setRawMode === "function";

  if (canUseInteractive) {
    return createInteractivePrompter();
  }

  return createTextPrompter(input ?? process.stdin, output ?? process.stdout);
}
