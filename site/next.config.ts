import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

// Subpath deployment to pubdiff.github.io/lobbyist-tracker. When a custom
// domain is configured (e.g. lobbyists.pubdiff.com), set NEXT_BASE_PATH="" to
// serve from the root instead.
const BASE_PATH = process.env.NEXT_BASE_PATH ?? "/lobbyist-tracker";

const config: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  outputFileTracingRoot: here,
  basePath: BASE_PATH,
  // Expose BASE_PATH to Server Components for raw <a>/<link> tags that Next.js
  // does not auto-prefix (the RSS auto-discovery links in app/layout.tsx).
  env: {
    NEXT_PUBLIC_BASE_PATH: BASE_PATH,
  },
};

export default config;
