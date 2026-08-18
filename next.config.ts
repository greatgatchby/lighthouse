import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["pg-boss", "postgres", "web-push"],
};

export default nextConfig;
