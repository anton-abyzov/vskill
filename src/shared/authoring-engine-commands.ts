/** Shared display and execution allow-list; request text never supplies argv. */
export const AUTHORING_ENGINE_COMMANDS = {
  "anthropic-skill-creator": { command: "claude", args: ["plugin", "install", "skill-creator"], prerequisite: "claude" },
  vskill: { command: "vskill", args: ["install", "anton-abyzov/vskill/skill-builder"], prerequisite: "vskill" },
};

export function authoringEngineInstallCommand(engine: keyof typeof AUTHORING_ENGINE_COMMANDS): string {
  const { command, args } = AUTHORING_ENGINE_COMMANDS[engine];
  return [command, ...args].join(" ");
}
