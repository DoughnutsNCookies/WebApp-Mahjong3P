import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // The rules engine must stay pure TypeScript so it also runs in Node (bot simulations, a future
  // multiplayer server, self-play training).
  {
    files: ["src/engine/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: ["react", "react-*", "react/*", "next", "next/*", "@/*"] }],
      "no-restricted-globals": ["error", "window", "document", "localStorage", "sessionStorage", "navigator"],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
