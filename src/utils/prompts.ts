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
  }

  return {
    async promptCheckboxList(items: CheckboxItem[], options?: CheckboxOptions): Promise<number[]> {
      const checked = items.map((item) => item.checked ?? false);

      if (options?.title) {
        writeLine(`\n${options.title}`);
      }

      renderCheckbox(items, checked);

      while (true) {
        const line = await ask("> ");

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

        const num = parseInt(line, 10);
        if (num >= 1 && num <= items.length) {
          checked[num - 1] = !checked[num - 1];
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
        const line = await ask("> ");
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
