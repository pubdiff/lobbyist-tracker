// Registry of all jurisdiction adapters.
// The pipeline (fetch.ts / parse.ts / etc.) iterates over SOURCES.
// Only adapters with `ready: true` are run in the scheduled workflow;
// stubs can be tested locally with `pnpm tsx src/fetch.ts --source nsw --include-unready`.

import type { Source } from "./types.ts";
import { nswSource } from "./nsw.ts";
import { federalSource } from "./federal.ts";
import { vicSource } from "./vic.ts";

export const SOURCES: Source[] = [
  federalSource,
  nswSource,
  vicSource,
  // qldSource,     // TODO
  // waSource,      // TODO
  // saSource,      // TODO
];

export function readySources(): Source[] {
  return SOURCES.filter((s) => s.ready);
}

export function sourceByJurisdiction(j: string): Source | undefined {
  return SOURCES.find((s) => s.jurisdiction === j);
}
