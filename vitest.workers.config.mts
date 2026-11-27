// Testes de integração no runtime local do Worker (wrangler/Miniflare). `npm run test:workers`.
// Não usa @cloudflare/vitest-pool-workers (exige vitest 4): o Vitest roda em Node e fala com o workerd pelo createTestHarness.
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname) } },
  test: {
    include: ["tests/workers/**/*.test.ts"],
    exclude: ["node_modules"],
    testTimeout: 60000,
    hookTimeout: 120000,
    // Cada arquivo sobe o seu workerd; em série para não disputar portas e CPU.
    fileParallelism: false,
  },
});
