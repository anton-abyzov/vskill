// ---------------------------------------------------------------------------
// vskill version
// ---------------------------------------------------------------------------

import { createRequire } from "node:module";
import { bold, cyan } from "../utils/output.js";

const require = createRequire(import.meta.url);
const pkg = require("../../package.json");

export async function versionCommand(): Promise<void> {
  console.log(`${bold("vskill")} ${cyan(`v${pkg.version}`)}`);
}
