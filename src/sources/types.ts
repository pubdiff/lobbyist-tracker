// The contract every jurisdiction adapter implements.
//
// Adapters are intentionally split into fetch (network) and parse (pure).
// The pipeline calls them in order, writing raw bytes between the two so we
// have a debuggable artifact on disk per run.
//
// Why this shape:
// - One adapter per source keeps quirks local. NSW's CSV and QLD's HTML
//   shouldn't leak into each other.
// - `fetch` returns raw bytes + a content type. The pipeline persists those
//   to data/raw/<jurisdiction>/<runId>.<ext> before calling parse.
// - `parse` is pure: raw bytes in, Lobbyist[] out. No network, no fs.
//   Re-runnable from an old raw file.
// - `parserVersion` is bumped on breaking changes to the parse output so old
//   snapshots remain interpretable.

import type { Jurisdiction, Lobbyist } from "../schema.ts";

export interface FetchResult {
  bytes: Uint8Array;
  contentType: "csv" | "json" | "html";
  // The URL we actually hit, recorded in the snapshot for reproducibility.
  // If pagination is involved, the canonical landing URL.
  sourceUrl: string;
}

export interface Source {
  jurisdiction: Jurisdiction;
  /** Human-readable label, used in feed/site headings. */
  label: string;
  /** Bumped on breaking changes to parse() output. */
  parserVersion: string;
  /** Set true once the adapter is fit to publish. v0 stubs are not. */
  ready: boolean;

  fetch(): Promise<FetchResult>;
  parse(raw: FetchResult): Promise<Lobbyist[]>;
}
