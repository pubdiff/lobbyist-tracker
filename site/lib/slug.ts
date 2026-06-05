// Client-safe utilities. No Node-only imports - safe to import from
// "use client" components.

// Turn a record key ("nsw:L0123", "vic:acme-strategies") into a URL- and
// filesystem-safe slug. Lossy by design; data.ts builds a slug->record map and
// disambiguates the rare collision, so this only needs to be deterministic.
export function keySlug(key: string): string {
  return key
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
