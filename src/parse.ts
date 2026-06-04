// Parse latest raw file per source into normalised SnapshotFile.
// Writes data/snapshots/<jurisdiction>/<runId>.json.

import { readdir, readFile } from "node:fs/promises";
import { SOURCES } from "./sources/index.ts";
import type { FetchResult, Source } from "./sources/types.ts";
import type { SnapshotFile } from "./schema.ts";
import { RAW_DIR, isoDate, snapshotPath, writeJSON } from "./lib.ts";

const args = new Set(process.argv.slice(2));
const includeUnready = args.has("--include-unready");

async function findLatestRaw(jurisdiction: string): Promise<{ path: string; ext: string } | null> {
  const dir = `${RAW_DIR}/${jurisdiction}`;
  let files: string[];
  try {
    files = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  const sorted = files.filter((f) => /\.(csv|json|html)$/.test(f)).sort();
  const latest = sorted[sorted.length - 1];
  if (!latest) return null;
  const ext = latest.endsWith(".csv") ? "csv" : latest.endsWith(".html") ? "html" : "json";
  return { path: `${dir}/${latest}`, ext };
}

async function processSource(src: Source, runId: string): Promise<void> {
  const latest = await findLatestRaw(src.jurisdiction);
  if (!latest) {
    console.warn(`parse[${src.jurisdiction}]: no raw file found, skipping`);
    return;
  }
  console.log(`parse[${src.jurisdiction}]: ${latest.path}`);

  const bytes = await readFile(latest.path);
  const raw: FetchResult = {
    bytes: new Uint8Array(bytes),
    contentType: latest.ext as FetchResult["contentType"],
    sourceUrl: "(replayed from local raw file)",
  };

  const lobbyists = await src.parse(raw);
  const snapshot: SnapshotFile = {
    runId,
    fetchedAt: new Date().toISOString(),
    jurisdiction: src.jurisdiction,
    sourceUrl: latest.path,
    parserVersion: src.parserVersion,
    count: lobbyists.length,
    lobbyists,
  };
  const out = snapshotPath(src.jurisdiction, runId);
  await writeJSON(out, snapshot);
  console.log(`  wrote ${out} (${lobbyists.length} lobbyists)`);
}

async function main(): Promise<void> {
  const runId = isoDate();
  const sources = SOURCES.filter((s) => s.ready || includeUnready);
  for (const src of sources) {
    try {
      await processSource(src, runId);
    } catch (err) {
      console.error(`parse[${src.jurisdiction}] FAILED:`, err instanceof Error ? err.message : err);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
