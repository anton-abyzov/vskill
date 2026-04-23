/**
 * Flat ESLint config for vskill.
 *
 * This config registers the custom `vskill/no-raw-color` rule, which bans
 * hex/rgb/hsl literals from studio TypeScript/TSX sources. Colors must flow
 * through the Layer 2 semantic tokens defined in globals.css (see
 * ADR-0674-01). The rule implementation lives at
 * `src/eval-ui/eslint-rules/no-raw-color.ts` and is imported here via its
 * compiled JS output (after `npm run build`) with a source fallback.
 *
 * ESLint is not installed as a devDependency yet; this config is staged so
 * that once `eslint` is added, `npx eslint src/eval-ui/src/**` will pick up
 * the rule automatically. The rule itself is unit-tested in
 * `src/eval-ui/src/__tests__/theme-no-raw-color.test.ts`.
 */

import noRawColor from "./src/eval-ui/eslint-rules/no-raw-color.ts";

const vskillPlugin = {
  rules: {
    "no-raw-color": noRawColor,
  },
};

export default [
  // Studio TSX/TS — raw colors forbidden.
  {
    files: ["src/eval-ui/src/**/*.{ts,tsx}"],
    plugins: {
      vskill: vskillPlugin,
    },
    rules: {
      "vskill/no-raw-color": "error",
    },
  },
  // Tests and the eslint-rules directory itself may use raw colors as
  // fixtures / regression inputs.
  {
    files: [
      "src/eval-ui/src/**/__tests__/**/*.{ts,tsx}",
      "src/eval-ui/eslint-rules/**/*.{ts,tsx}",
    ],
    rules: {
      "vskill/no-raw-color": "off",
    },
  },
  // globals.css is the single source of Layer 1 raw tokens — outside the
  // rule's scope anyway because it only targets .ts/.tsx, but we make the
  // intent explicit for future contributors.
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "src/eval-ui/src/styles/globals.css",
    ],
  },
];
