import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  turbopack: { root: path.resolve(__dirname) },
  output: "standalone",
  serverExternalPackages: ["mammoth", "officeparser", "xlsx"],
};

export default nextConfig;
