// ---------------------------------------------------------------------------
// Studio detect-engines route — GET /api/studio/detect-engines
// ---------------------------------------------------------------------------
// Reports availability of the two skill-authoring engines so the Studio
// CreateSkillPage can render its EngineSelector with accurate state.
//
// Both engines are first-class peer choices:
//   - VSkill skill-builder = cross-universal across 8 agents
//   - Anthropic skill-creator = richer Claude-native schema, Claude-only
//
// Ref: .specweave/increments/0734-studio-create-skill-engine-selector
// ACs: AC-US1-01, AC-US1-02, AC-US1-05
// ---------------------------------------------------------------------------

import * as http from "node:http";

import type { Router } from "./router.js";
import { sendJson } from "./router.js";
import { isSkillCreatorInstalled, findSkillCreatorPath } from "../utils/skill-creator-detection.js";
import { isSkillBuilderInstalled } from "../utils/skill-builder-detection.js";

export interface DetectEnginesResponse {
  vskillSkillBuilder: boolean;
  anthropicSkillCreator: boolean;
  vskillVersion: string | null;
  anthropicPath: string | null;
}

export function registerDetectEnginesRoute(router: Router, root: string): void {
  router.get(
    "/api/studio/detect-engines",
    async (req: http.IncomingMessage, res: http.ServerResponse) => {
      const skillBuilder = isSkillBuilderInstalled(root);
      const skillCreator = isSkillCreatorInstalled(root);
      const skillCreatorPath = skillCreator ? findSkillCreatorPath(root) : null;

      const body: DetectEnginesResponse = {
        vskillSkillBuilder: skillBuilder.installed,
        anthropicSkillCreator: skillCreator,
        vskillVersion: skillBuilder.version,
        anthropicPath: skillCreatorPath,
      };

      sendJson(res, body, 200, req);
    },
  );
}
