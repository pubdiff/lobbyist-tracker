// Build-time constants shared by Server Components.
// Sourced from next.config.ts via process.env.

export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

// Helper for plain <a> / <link> tags that Next.js does not auto-prefix.
// Next.js's <Link> component prepends basePath automatically; this is only for
// raw HTML elements (the RSS auto-discovery <link>s in app/layout.tsx).
export function withBase(path: string): string {
  if (path.startsWith("http")) return path;
  return BASE_PATH + path;
}
