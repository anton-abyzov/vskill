import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
// real-sse tests spin up real node:http servers — they must bypass the
// shimNodeBuiltinsForBrowser plugin that stubs out node:* modules.
const REAL_SSE_GLOB = "**/*.real-sse.*.test.ts";

// 0703 follow-up: shim node:* built-ins that agents-registry + resolve-binary
// transitively pull in. The UI never actually executes `detectInstalled` etc.
// (server-only), but rollup still parses the module graph and errors on
// named imports like `{ exec }` or `{ delimiter }` that aren't exported by
// vite's stock `__vite-browser-external` stub. We satisfy every named
// export with a no-op that throws if accidentally invoked at runtime.
const shimNodeBuiltinsForBrowser = {
  name: "shim-node-builtins-for-browser",
  enforce: "pre" as const,
  resolveId(source: string, importer?: string) {
    // real-sse integration tests boot real node:http servers — let node:* through
    if (importer?.includes(".real-sse.")) return null;
    if (source.startsWith("node:")) return "\0shimNode";
    return null;
  },
  load(id: string) {
    if (id === "\0shimNode") {
      return `
        const NO = new Proxy(function(){}, { get: (_t, p) => (p === "__esModule" ? true : () => { throw new Error("node:* used in browser bundle: " + String(p)); }) });
        export default NO;
        export const exec = NO;
        export const execSync = NO;
        export const existsSync = NO;
        export const readFileSync = NO;
        export const readdirSync = NO;
        export const writeFileSync = NO;
        export const mkdirSync = NO;
        export const statSync = NO;
        export const homedir = NO;
        export const tmpdir = NO;
        export const platform = NO;
        export const join = NO;
        export const delimiter = ":";
        export const promisify = NO;
        export const EventEmitter = NO;
      `;
    }
    return null;
  },
};

export default defineConfig({
  plugins: [shimNodeBuiltinsForBrowser, react(), tailwindcss()],
  root: path.resolve(__dirname),
  build: {
    outDir: path.resolve(__dirname, "../../dist/eval-ui"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("@fontsource-variable/")) {
            return "fonts";
          }
          return undefined;
        },
      },
    },
  },
  server: {
    port: 3078,
    proxy: {
      "/api": "http://localhost:3077",
    },
  },
});
