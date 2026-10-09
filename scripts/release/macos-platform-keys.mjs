import { pathToFileURL } from "node:url";

/** Generic Tauri bundle filenames carry no architecture information. */
export function macosPlatformKeys(architecture) {
  if (architecture === "aarch64") return ["darwin-aarch64"];
  if (architecture === "x86_64") return ["darwin-x86_64"];
  if (architecture === "universal") return ["darwin-aarch64", "darwin-x86_64"];
  throw new Error("MACOS_ARCH must explicitly identify the generic macOS bundle: aarch64, x86_64 or universal");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(macosPlatformKeys(process.argv[2]).join(" "));
}
