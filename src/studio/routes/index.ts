// ---------------------------------------------------------------------------
// Studio scope-transfer routes — aggregate registration
// ---------------------------------------------------------------------------
// Registered from src/eval-server/eval-server.ts alongside the existing
// registerSkillCreateRoutes() etc. Keeps all scope-transfer HTTP surface in
// one module so cross-route concerns (SSE headers, error shape) stay
// consistent.
// ---------------------------------------------------------------------------

import type { Router } from "../../eval-server/router.js";
import { registerPromoteRoute } from "./promote.js";
import { registerTestInstallRoute } from "./test-install.js";
import { registerRevertRoute } from "./revert.js";
import { registerOpsRoutes } from "./ops.js";
import { registerDetectEnginesRoute } from "../../eval-server/detect-engines-route.js";
import { registerInstallEngineRoutes } from "../../eval-server/install-engine-routes.js";
import { registerInstallSkillRoutes } from "../../eval-server/install-skill-routes.js";

export function registerScopeTransferRoutes(router: Router, root: string): void {
  registerPromoteRoute(router, root);
  registerTestInstallRoute(router, root);
  registerRevertRoute(router, root);
  registerOpsRoutes(router);
  registerDetectEnginesRoute(router, root);
  registerInstallEngineRoutes(router, root);
  registerInstallSkillRoutes(router);
}
