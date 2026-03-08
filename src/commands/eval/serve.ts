// ---------------------------------------------------------------------------
// vskill eval serve -- start the eval UI web server
// ---------------------------------------------------------------------------

import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { startEvalServer } from "../../eval-server/eval-server.js";
import { yellow, dim } from "../../utils/output.js";

function checkSkillCreator(): void {
  // Check common skill-creator installation locations
  const home = homedir();
  const locations = [
    join(home, ".claude", "plugins", "cache", "claude-plugins-official", "skill-creator"),
    join(home, ".claude", "skills", "skill-creator.md"),
    join(home, ".claude", "plugins", "cache", "specweave", "sw", "1.0.0", "skills", "skill-creator"),
  ];

  const found = locations.some((loc) => existsSync(loc));

  if (!found) {
    console.log(
      yellow("\n  ⚠ Skill-Creator not detected.") +
        "\n\n" +
        dim("  The Skill-Creator skill provides the gold-standard evaluation\n") +
        dim("  methodology (grading, blind A/B comparison, analysis).\n") +
        dim("  The eval UI uses the same methodology natively, but for best\n") +
        dim("  results, install the Skill-Creator skill:\n\n") +
        "  1. In Claude Code, run:  " +
        "/skill-creator:skill-creator" +
        "\n" +
        "  2. Or install via vskill: " +
        "vskill install --repo claude-plugins-official/skill-creator" +
        "\n" +
        "  3. Then reload plugins:   " +
        "Restart Claude Code or run a new session" +
        "\n",
    );
  }
}

export async function runEvalServe(
  root: string,
  port: number,
): Promise<void> {
  checkSkillCreator();

  const resolvedRoot = resolve(root);
  const server = await startEvalServer({ port, root: resolvedRoot });

  // Graceful shutdown
  const shutdown = () => {
    console.log("\nShutting down eval server...");
    server.close(() => process.exit(0));
    // Force exit after 5s
    setTimeout(() => process.exit(0), 5000);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
