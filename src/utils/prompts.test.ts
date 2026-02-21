import { describe, it, expect, beforeEach } from "vitest";
import { Readable, Writable } from "node:stream";
import { isTTY, createPrompter, isEscapeSequence, parseToggleInput } from "./prompts.js";

describe("isTTY", () => {
  it("returns false when stdin.isTTY is undefined", () => {
    const original = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: undefined, configurable: true });
    expect(isTTY()).toBe(false);
    Object.defineProperty(process.stdin, "isTTY", { value: original, configurable: true });
  });

  it("returns true when both stdin and stdout are TTY", () => {
    const origIn = process.stdin.isTTY;
    const origOut = process.stdout.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    expect(isTTY()).toBe(true);
    Object.defineProperty(process.stdin, "isTTY", { value: origIn, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: origOut, configurable: true });
  });
});

describe("createPrompter", () => {
  let output: Writable;
  let outputData: string;

  beforeEach(() => {
    outputData = "";
    output = new Writable({
      write(chunk, _encoding, callback) {
        outputData += chunk.toString();
        callback();
      },
    });
  });

  function makeInput(data: string): Readable {
    let pushed = false;
    return new Readable({
      read() {
        if (!pushed) {
          pushed = true;
          this.push(data);
          this.push(null);
        }
      },
    });
  }

  describe("promptCheckboxList", () => {
    it("returns all indices when user types 'a' then Enter", async () => {
      const input = makeInput("a\n\n");
      const prompter = createPrompter(input, output);

      const result = await prompter.promptCheckboxList([
        { label: "skill-one", description: "First skill" },
        { label: "skill-two", description: "Second skill" },
        { label: "skill-three", description: "Third skill" },
      ]);

      expect(result).toEqual([0, 1, 2]);
    });

    it("toggles individual items off when pre-checked", async () => {
      const input = makeInput("2\n\n");
      const prompter = createPrompter(input, output);

      const result = await prompter.promptCheckboxList([
        { label: "skill-one", checked: true },
        { label: "skill-two", checked: true },
        { label: "skill-three", checked: true },
      ]);

      // Item 2 (index 1) was toggled off
      expect(result).toEqual([0, 2]);
    });

    it("toggles individual items on when unchecked", async () => {
      const input = makeInput("2\n\n");
      const prompter = createPrompter(input, output);

      const result = await prompter.promptCheckboxList([
        { label: "skill-one", checked: false },
        { label: "skill-two", checked: false },
        { label: "skill-three", checked: false },
      ]);

      // Only item 2 (index 1) was toggled on
      expect(result).toEqual([1]);
    });

    it("displays title when provided", async () => {
      const input = makeInput("a\n\n");
      const prompter = createPrompter(input, output);

      await prompter.promptCheckboxList(
        [{ label: "test-skill" }],
        { title: "Select skills to install" },
      );

      expect(outputData).toContain("Select skills to install");
    });
  });

  describe("promptChoice", () => {
    it("returns selected index (0-based) for valid input", async () => {
      const input = makeInput("2\n");
      const prompter = createPrompter(input, output);

      const result = await prompter.promptChoice("Install scope:", [
        { label: "Project", hint: "recommended" },
        { label: "Global", hint: "~/ directories" },
      ]);

      expect(result).toBe(1);
    });

    it("returns 0 for first choice", async () => {
      const input = makeInput("1\n");
      const prompter = createPrompter(input, output);

      const result = await prompter.promptChoice("Method:", [
        { label: "Symlink", hint: "recommended" },
        { label: "Copy" },
      ]);

      expect(result).toBe(0);
    });

    it("displays choices with hints", async () => {
      const input = makeInput("1\n");
      const prompter = createPrompter(input, output);

      await prompter.promptChoice("Scope:", [
        { label: "Project", hint: "recommended" },
        { label: "Global" },
      ]);

      expect(outputData).toContain("Project");
      expect(outputData).toContain("recommended");
      expect(outputData).toContain("Global");
    });
  });

  describe("promptConfirm", () => {
    it("returns true on 'y' input", async () => {
      const input = makeInput("y\n");
      const prompter = createPrompter(input, output);

      const result = await prompter.promptConfirm("Proceed?", false);
      expect(result).toBe(true);
    });

    it("returns false on 'n' input", async () => {
      const input = makeInput("n\n");
      const prompter = createPrompter(input, output);

      const result = await prompter.promptConfirm("Proceed?", true);
      expect(result).toBe(false);
    });

    it("returns default on empty input (defaultYes=true)", async () => {
      const input = makeInput("\n");
      const prompter = createPrompter(input, output);

      const result = await prompter.promptConfirm("Proceed?", true);
      expect(result).toBe(true);
    });

    it("returns default on empty input (defaultYes=false)", async () => {
      const input = makeInput("\n");
      const prompter = createPrompter(input, output);

      const result = await prompter.promptConfirm("Proceed?", false);
      expect(result).toBe(false);
    });

    it("displays question with Y/n when defaultYes is true", async () => {
      const input = makeInput("y\n");
      const prompter = createPrompter(input, output);

      await prompter.promptConfirm("Proceed?", true);
      expect(outputData).toContain("Y/n");
    });

    it("displays question with y/N when defaultYes is false", async () => {
      const input = makeInput("y\n");
      const prompter = createPrompter(input, output);

      await prompter.promptConfirm("Proceed?", false);
      expect(outputData).toContain("y/N");
    });
  });

  describe("escape sequence handling in promptCheckboxList", () => {
    it("ignores arrow key escape sequences and processes subsequent input", async () => {
      // Simulate: up arrow (ignored), then toggle item 1, then confirm
      const input = makeInput("\x1b[A\n1\n\n");
      const prompter = createPrompter(input, output);

      const result = await prompter.promptCheckboxList([
        { label: "skill-one", checked: false },
        { label: "skill-two", checked: false },
        { label: "skill-three", checked: false },
      ]);

      // Arrow key ignored; only item 1 (index 0) toggled on
      expect(result).toEqual([0]);
    });

    it("ignores mixed escape+input line like \\x1b[A\\x1b[B6 and parses the 6", async () => {
      // Simulate what real terminal sends: arrow escapes + number on same readline
      const input = makeInput("\x1b[A\x1b[B6\n\n");
      const prompter = createPrompter(input, output);

      const result = await prompter.promptCheckboxList([
        { label: "s1", checked: false },
        { label: "s2", checked: false },
        { label: "s3", checked: false },
        { label: "s4", checked: false },
        { label: "s5", checked: false },
        { label: "s6", checked: false },
      ]);

      // Escape sequences stripped; "6" parsed → item 6 (index 5) toggled
      expect(result).toEqual([5]);
    });

    it("toggles a range of items with '1-2' input", async () => {
      const input = makeInput("1-2\n\n");
      const prompter = createPrompter(input, output);

      const result = await prompter.promptCheckboxList([
        { label: "skill-one", checked: false },
        { label: "skill-two", checked: false },
        { label: "skill-three", checked: false },
      ]);

      expect(result).toEqual([0, 1]);
    });

    it("toggles comma-separated items with '1,3' input", async () => {
      const input = makeInput("1,3\n\n");
      const prompter = createPrompter(input, output);

      const result = await prompter.promptCheckboxList([
        { label: "skill-one", checked: false },
        { label: "skill-two", checked: false },
        { label: "skill-three", checked: false },
      ]);

      expect(result).toEqual([0, 2]);
    });

    it("render output includes usage instructions", async () => {
      const input = makeInput("\n");
      const prompter = createPrompter(input, output);

      await prompter.promptCheckboxList([{ label: "test-skill" }]);

      expect(outputData).toContain("Enter=done");
    });
  });

  describe("escape sequence handling in promptChoice", () => {
    it("ignores arrow key escape sequences and waits for valid input", async () => {
      // Down arrow (ignored), then "1"
      const input = makeInput("\x1b[B\n1\n");
      const prompter = createPrompter(input, output);

      const result = await prompter.promptChoice("Scope:", [
        { label: "Project" },
        { label: "Global" },
      ]);

      // Arrow key ignored; "1" accepted → index 0
      expect(result).toBe(0);
    });
  });
});

describe("isEscapeSequence", () => {
  it("returns true for up arrow escape sequence", () => {
    expect(isEscapeSequence("\x1b[A")).toBe(true);
  });

  it("returns true for down arrow escape sequence", () => {
    expect(isEscapeSequence("\x1b[B")).toBe(true);
  });

  it("returns true for right arrow escape sequence", () => {
    expect(isEscapeSequence("\x1b[C")).toBe(true);
  });

  it("returns true for left arrow escape sequence", () => {
    expect(isEscapeSequence("\x1b[D")).toBe(true);
  });

  it("returns true for multiple chained escape sequences", () => {
    expect(isEscapeSequence("\x1b[A\x1b[B")).toBe(true);
  });

  it("returns false for a normal number", () => {
    expect(isEscapeSequence("1")).toBe(false);
  });

  it("returns false for toggle-all 'a'", () => {
    expect(isEscapeSequence("a")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isEscapeSequence("")).toBe(false);
  });

  it("returns false for mixed escape + real input", () => {
    // "\x1b[A6" has a real "6" after stripping → not purely escape sequences
    expect(isEscapeSequence("\x1b[A6")).toBe(false);
  });
});

describe("parseToggleInput", () => {
  it("parses single number '2' → [1]", () => {
    expect(parseToggleInput("2", 5)).toEqual([1]);
  });

  it("parses range '1-3' → [0, 1, 2]", () => {
    expect(parseToggleInput("1-3", 5)).toEqual([0, 1, 2]);
  });

  it("parses comma-separated '1,3,5' → [0, 2, 4]", () => {
    expect(parseToggleInput("1,3,5", 5)).toEqual([0, 2, 4]);
  });

  it("parses mixed '1-3,5' → [0, 1, 2, 4]", () => {
    expect(parseToggleInput("1-3,5", 10)).toEqual([0, 1, 2, 4]);
  });

  it("rejects invalid range '5-2' → []", () => {
    expect(parseToggleInput("5-2", 5)).toEqual([]);
  });

  it("rejects out-of-bounds '0' → []", () => {
    expect(parseToggleInput("0", 5)).toEqual([]);
  });

  it("rejects out-of-bounds '999' with maxIndex 5 → []", () => {
    expect(parseToggleInput("999", 5)).toEqual([]);
  });

  it("deduplicates '1,1,2' → [0, 1]", () => {
    expect(parseToggleInput("1,1,2", 5)).toEqual([0, 1]);
  });

  it("returns empty for non-numeric input", () => {
    expect(parseToggleInput("abc", 5)).toEqual([]);
  });

  it("returns sorted result for range", () => {
    expect(parseToggleInput("3-5", 10)).toEqual([2, 3, 4]);
  });
});
