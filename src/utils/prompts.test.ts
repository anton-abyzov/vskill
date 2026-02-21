import { describe, it, expect, beforeEach } from "vitest";
import { Readable, Writable } from "node:stream";
import { isTTY, createPrompter } from "./prompts.js";

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
});
