import path from "node:path";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import type { NextConfig } from "next";

// `next dev`: expõe D1 e R2 locais (mesmo estado do wrangler, em .wrangler/state) a getCloudflareContext(). DOs, fila e Containers
// do mesmo Worker não existem aqui; o fluxo completo roda em `npm run preview`. Ver "Ambiente local" em docs/CONTRATO_API.md.
if (process.env.NODE_ENV === "development") initOpenNextCloudflareForDev();

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  turbopack: { root: path.resolve(__dirname) },
  output: "standalone",
  serverExternalPackages: ["mammoth", "officeparser", "xlsx"],
};

export default nextConfig;
