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

  // The payroll RapidStart generator reads a template binary from disk via
  // process.cwd(). Standalone output otherwise wouldn't include arbitrary
  // files outside node_modules — list them explicitly here.
  outputFileTracingIncludes: {
    "/api/payroll/rapidstart": ["./lib/rapidStart/payroll_je_template.rapidstart"],
  },
};

export default nextConfig;
