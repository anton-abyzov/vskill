// Share version handling with server authoring and update paths so editor saves
// retain portable metadata.version while reading legacy root-level versions.
import { readFrontmatterVersion } from "../../../utils/version.js";
export { setFrontmatterVersion } from "../../../utils/version.js";

export function getFrontmatterVersion(content: string): string | null {
  return readFrontmatterVersion(content) ?? null;
}
