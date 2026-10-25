import type { NextConfig } from "next";
const config: NextConfig = {
  serverExternalPackages: ["sharp"],
  experimental: { cpus: 2 },
};
export default config;
