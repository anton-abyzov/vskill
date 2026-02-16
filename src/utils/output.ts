// ---------------------------------------------------------------------------
// Colored console output helpers (ANSI codes, zero dependencies)
// ---------------------------------------------------------------------------

const isColorSupported =
  process.env.FORCE_COLOR !== "0" &&
  process.env.NO_COLOR === undefined &&
  (process.stdout.isTTY || process.env.FORCE_COLOR === "1");

function wrap(code: string, reset: string): (text: string) => string {
  if (!isColorSupported) return (text: string) => text;
  return (text: string) => `${code}${text}${reset}`;
}

// ---- Text formatters ------------------------------------------------------

export const green = wrap("\x1b[32m", "\x1b[39m");
export const red = wrap("\x1b[31m", "\x1b[39m");
export const yellow = wrap("\x1b[33m", "\x1b[39m");
export const cyan = wrap("\x1b[36m", "\x1b[39m");
export const bold = wrap("\x1b[1m", "\x1b[22m");
export const dim = wrap("\x1b[2m", "\x1b[22m");
export const magenta = wrap("\x1b[35m", "\x1b[39m");

// ---- Table output ---------------------------------------------------------

/**
 * Print aligned columns. Each row is an array of strings.
 * Column widths are auto-calculated from the widest cell.
 */
export function table(headers: string[], rows: string[][], gap = 2): string {
  const allRows = [headers, ...rows];
  const colWidths: number[] = [];

  for (const row of allRows) {
    for (let i = 0; i < row.length; i++) {
      const stripped = stripAnsi(row[i] || "");
      colWidths[i] = Math.max(colWidths[i] || 0, stripped.length);
    }
  }

  const lines: string[] = [];

  // Header
  const headerLine = headers
    .map((h, i) => padRight(h, colWidths[i], gap))
    .join("")
    .trimEnd();
  lines.push(bold(headerLine));
  lines.push(
    dim(
      colWidths.map((w) => "-".repeat(w)).join(" ".repeat(gap))
    )
  );

  // Data rows
  for (const row of rows) {
    const line = row
      .map((cell, i) => padRight(cell, colWidths[i], gap))
      .join("")
      .trimEnd();
    lines.push(line);
  }

  return lines.join("\n");
}

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

function padRight(str: string, width: number, gap: number): string {
  const visible = stripAnsi(str);
  const padding = Math.max(0, width - visible.length) + gap;
  return str + " ".repeat(padding);
}

// ---- Spinner --------------------------------------------------------------

export function spinner(message: string): { stop: (final?: string) => void } {
  const frames = ["|", "/", "-", "\\"];
  let i = 0;

  if (!isColorSupported || !process.stdout.isTTY) {
    process.stdout.write(`${message}...\n`);
    return {
      stop: (final?: string) => {
        if (final) process.stdout.write(`${final}\n`);
      },
    };
  }

  const interval = setInterval(() => {
    process.stdout.write(`\r${frames[i % frames.length]} ${message}`);
    i++;
  }, 80);

  return {
    stop: (final?: string) => {
      clearInterval(interval);
      process.stdout.write(`\r${" ".repeat(message.length + 3)}\r`);
      if (final) process.stdout.write(`${final}\n`);
    },
  };
}
