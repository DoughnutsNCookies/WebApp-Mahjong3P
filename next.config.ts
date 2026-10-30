import type { NextConfig } from "next";

// Static export: the whole game runs in the browser, so the build is plain files (out/) that any web
// server can host.
const nextConfig: NextConfig = {
  output: "export",
};

export default nextConfig;
