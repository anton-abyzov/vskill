#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Post-`npm rebuild` verification for esbuild.
//
// The whole sidecar bundle (scripts/desktop/bundle-sidecar.mjs) goes through
// the esbuild JS API, which shells out to a platform-specific NATIVE binary.
// Under the committed `.npmrc` (`ignore-scripts=true`) that binary is not
// linked at install time — `npm run setup` has to rebuild it explicitly.
//
// The failure this guards against is silent: `npm rebuild <pkg>` exits 0 when
// it matches nothing, so a hoisting change or a renamed package turns setup
// into a no-op and the first symptom is a broken Windows desktop build. Here we
// actually drive the binary, so a no-op rebuild fails the setup step instead.
// ---------------------------------------------------------------------------

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

let esbuild;
try {
  esbuild = require("esbuild");
} catch (err) {
  console.error(
    "[verify-esbuild] esbuild is not resolvable. It is a declared devDependency; " +
      "run `npm ci --ignore-scripts && npm run setup`.",
  );
  console.error(String(err));
  process.exit(1);
}

// Prove the native binary runs, not just that the JS wrapper resolves.
try {
  const out = await esbuild.transform("export const x = 1 as number;", {
    loader: "ts",
  });
  if (!out.code.includes("x = 1")) {
    throw new Error(`unexpected transform output: ${JSON.stringify(out.code)}`);
  }
} catch (err) {
  console.error(
    "[verify-esbuild] esbuild resolved but its native binary did not run. " +
      "This is the ignore-scripts trap: `npm run setup` must rebuild esbuild " +
      "(`npm rebuild --ignore-scripts=false esbuild`) before the sidecar can bundle.",
  );
  console.error(String(err));
  process.exit(1);
}

console.log(`[verify-esbuild] ok — esbuild ${esbuild.version} native binary works`);
