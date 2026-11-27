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
    ".open-next/**", // saída do build OpenNext/Cloudflare
    ".wrangler/**", // estado local do wrangler
    "components/ui/**", // snippets gerados pelo Chakra CLI
    "spike/**", // Worker descartável da fase 0, fora do app
  ]),
]);

export default eslintConfig;
