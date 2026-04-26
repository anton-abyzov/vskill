// ---------------------------------------------------------------------------
// EngineSelector — tri-state radio group for the Studio create-skill page.
// Ref: 0734 US-002 (AC-US2-01..AC-US2-07).
//
// Three first-class peer choices:
//   - VSkill skill-builder = cross-universal across 8 universal agents
//   - Anthropic skill-creator = richer Claude-native schema, Claude-only
//   - None = raw author, no engine assistance
//
// Anthropic is NOT a fallback — see ADR 0734-01 for the framing.
// ---------------------------------------------------------------------------

import React from "react";

export type Engine = "vskill" | "anthropic-skill-creator" | "none";

export interface EngineDetection {
  vskillSkillBuilder: boolean;
  anthropicSkillCreator: boolean;
  vskillVersion: string | null;
  anthropicPath: string | null;
}

export const ENGINE_TOOLTIP_VSKILL =
  "Cross-universal — emits the same skill to 8 universal agents (Claude, Codex, Cursor, Cline, Gemini CLI, OpenCode, Kimi, Amp). Constrains output to the common schema across all agents. Recommended for portable skills.";

export const ENGINE_TOOLTIP_ANTHROPIC =
  "Powerful Claude-native engine — Anthropic's built-in skill-creator with a slightly richer schema (more expressive on Claude) but Claude-only. Pick this when you only target Claude Code and want full expressiveness.";

export const ENGINE_TOOLTIP_NONE =
  "Generate raw — no engine assistance, you provide the full SKILL.md body.";

/**
 * Default-engine precedence per AC-US2-03:
 *   VSkill skill-builder > Anthropic skill-creator > none.
 */
export function defaultEngineFromDetection(detection: EngineDetection): Engine {
  if (detection.vskillSkillBuilder) return "vskill";
  if (detection.anthropicSkillCreator) return "anthropic-skill-creator";
  return "none";
}

interface OptionMeta {
  engine: Engine;
  label: string;
  caption: string;
  tooltip: string;
  detected: boolean;
  installable: boolean; // Engines with a known install command (vskill, anthropic) only.
}

function buildOptions(detection: EngineDetection): OptionMeta[] {
  return [
    {
      engine: "vskill",
      label: "VSkill skill-builder",
      caption: detection.vskillSkillBuilder
        ? `installed${detection.vskillVersion ? ` v${detection.vskillVersion}` : ""}`
        : "not installed",
      tooltip: ENGINE_TOOLTIP_VSKILL,
      detected: detection.vskillSkillBuilder,
      installable: true,
    },
    {
      engine: "anthropic-skill-creator",
      label: "Anthropic skill-creator",
      caption: detection.anthropicSkillCreator ? "installed" : "not installed",
      tooltip: ENGINE_TOOLTIP_ANTHROPIC,
      detected: detection.anthropicSkillCreator,
      installable: true,
    },
    {
      engine: "none",
      label: "No engine — generate raw",
      caption: "always available",
      tooltip: ENGINE_TOOLTIP_NONE,
      detected: true,
      installable: false,
    },
  ];
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export interface EngineSelectorProps {
  detection: EngineDetection;
  selected: Engine;
  onSelect: (engine: Engine) => void;
  onInstallClick: (engine: Exclude<Engine, "none">) => void;
}

export function EngineSelector(props: EngineSelectorProps): React.ReactElement {
  const { detection, selected, onSelect, onInstallClick } = props;
  const reducedMotion = React.useMemo(() => prefersReducedMotion(), []);
  const options = React.useMemo(() => buildOptions(detection), [detection]);

  const transitionClass = reducedMotion ? "" : "transition-colors";

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-xs font-semibold text-gray-700">
        Authoring engine
      </legend>
      <div role="tablist" aria-label="Authoring engine" className="flex flex-col gap-1.5">
        {options.map((opt) => {
          const isSelected = selected === opt.engine;
          const showInstall = !opt.detected && opt.installable;
          const baseClasses = [
            "flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm cursor-pointer",
            transitionClass,
            isSelected
              ? "border-blue-600 bg-blue-50"
              : "border-gray-300 bg-white hover:border-gray-400",
          ].filter(Boolean).join(" ");

          const style: React.CSSProperties = !opt.detected
            ? { opacity: 0.6 }
            : {};

          return (
            <div
              key={opt.engine}
              role="tab"
              tabIndex={0}
              data-testid={`engine-selector-${opt.engine}`}
              aria-selected={isSelected ? "true" : "false"}
              title={opt.tooltip}
              style={style}
              className={baseClasses}
              onClick={() => onSelect(opt.engine)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(opt.engine);
                }
              }}
            >
              <div className="flex flex-col">
                <span className="font-medium text-gray-900">{opt.label}</span>
                <span className="text-xs text-gray-500">{opt.caption}</span>
              </div>
              {showInstall && (
                <button
                  type="button"
                  data-testid={`install-${opt.engine}`}
                  className="rounded border border-blue-600 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    onInstallClick(opt.engine as Exclude<Engine, "none">);
                  }}
                >
                  Install
                </button>
              )}
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
