import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Minimal self-contained output for Docker / Azure Container Apps.
  // Produces .next/standalone with just the files + deps the server needs
  // at runtime (~10x smaller than copying the full node_modules tree).
  output: "standalone",

  // pdf-parse + pdfjs-dist load an internal worker file by relative path at
  // runtime. Turbopack's bundling rewrites those paths and the worker chunk
  // isn't copied into .next. Externalize so they load straight from
  // node_modules at runtime in the server.
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],
};

export default nextConfig;
