// ---------------------------------------------------------------------------
// masked-stdin.ts — Read a secret from stdin with character masking.
//
// Two modes:
//   - Piped: `echo "sk-..." | vskill keys set anthropic` — read until EOF
//   - Interactive TTY: raw mode, byte-by-byte read, echo "*" per char
//
// The raw key is NEVER echoed. Backspace/DEL erase one char (and remove a
// star from the display). Ctrl-C aborts with exit 1.
// ---------------------------------------------------------------------------

export interface MaskedStdinIO {
  stdout: { write: (s: string) => boolean };
  stderr: { write: (s: string) => boolean };
}

/**
 * Read from stdin. If input is piped (non-TTY), reads until EOF and returns
 * trimmed text. If TTY, reads interactively with masking (each char echoed
 * as `*`) until Enter.
 */
export async function readSecretFromStdin(
  io: MaskedStdinIO = { stdout: process.stdout, stderr: process.stderr },
): Promise<string> {
  const isTTY = !!process.stdin.isTTY;
  if (!isTTY) {
    return readPiped();
  }
  return readInteractiveMasked(io);
}

function readPiped(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk: Buffer) => chunks.push(chunk));
    process.stdin.once("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8").trim());
    });
    process.stdin.once("error", reject);
  });
}

function readInteractiveMasked(io: MaskedStdinIO): Promise<string> {
  return new Promise((resolve) => {
    const chars: string[] = [];
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw === true;
    if (typeof stdin.setRawMode === "function") stdin.setRawMode(true);
    stdin.resume();

    const onData = (data: Buffer): void => {
      const s = data.toString("utf8");
      for (const ch of s) {
        const code = ch.charCodeAt(0);
        if (code === 3) {
          // Ctrl-C
          cleanup();
          io.stdout.write("\n");
          process.exit(1);
        }
        if (code === 13 || code === 10) {
          // Enter
          cleanup();
          io.stdout.write("\n");
          resolve(chars.join(""));
          return;
        }
        if (code === 127 || code === 8) {
          // Backspace / DEL
          if (chars.length > 0) {
            chars.pop();
            io.stdout.write("\b \b");
          }
          continue;
        }
        chars.push(ch);
        io.stdout.write("*");
      }
    };

    function cleanup(): void {
      stdin.removeListener("data", onData);
      if (typeof stdin.setRawMode === "function") stdin.setRawMode(wasRaw);
      stdin.pause();
    }

    stdin.on("data", onData);
  });
}
