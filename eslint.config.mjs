import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored, not ours: src/components/charts is the bklit chart library
    // pulled in wholesale by `shadcn add @bklit/*` (see components.json's
    // registries). It ships 28 violations of this project's React Compiler
    // and react-hooks rules, none of which we can fix without forking the
    // library and re-fixing them on every update. Our own wrappers around
    // it (components/retro/*-chart.tsx) are NOT ignored and are still held
    // to the full ruleset.
    "src/components/charts/**",
  ]),
]);

export default eslintConfig;
