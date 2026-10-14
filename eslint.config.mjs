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
    // Keep the Next.js (Node) linter scoped to the frontend. Deno/Supabase backend
    // code is linted/tested by Deno and has its own config.
    "supabase/**",
    "scripts/**",
    "docs/**",
    ".github/**",
  ]),
]);

export default eslintConfig;
