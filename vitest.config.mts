import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname) } },
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["node_modules", "spike/**", "tests/workers/**"], // tests/workers roda à parte: npm run test:workers
    testTimeout: 30000,
    env: { ATLAS_TRIAGEM_LLM: "0" },
  },
});
