import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // The rules engine and analyzer must stay pure TypeScript so they also run in Node (bot
  // simulations, a future multiplayer server, self-play training).
  {
    files: ["src/engine/**/*.ts", "src/analyzer/**/*.ts"],
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
    // The training's Python environment (PyTorch ships some JavaScript of its own) and run outputs.
    "training/.venv/**",
    "training/runs/**",
  ]),
]);

export default eslintConfig;
