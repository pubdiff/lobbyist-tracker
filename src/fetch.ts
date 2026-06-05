// Fetch raw data from every ready source.
// Writes raw bytes to data/raw/<jurisdiction>/<runId>.<ext>.
//
// Sources marked ready=false are skipped unless --include-unready is passed
// (useful while iterating on a new adapter locally).

import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { SOURCES } from "./sources/index.ts";
import { RAW_DIR, isoDate } from "./lib.ts";

const args = new Set(process.argv.slice(2));
const includeUnready = args.has("--include-unready");

async function main(): Promise<void> {
  const runId = isoDate();
  const sources = SOURCES.filter((s) => s.ready || includeUnready);
  if (sources.length === 0) {
    console.warn("fetch: no ready sources (pass --include-unready to run stubs)");
    return;
  }

  const failures: { jurisdiction: string; error: string }[] = [];

  // Sources are independent (each writes its own raw file and owns its own
  // browser/session), so fetch them concurrently. Sequentially the run is the
  // SUM of every source - WA's ~128 per-firm browser renders alone push that
  // past CI's timeout. Concurrently the wall-clock is the slowest single source.
  await Promise.all(
    sources.map(async (src) => {
      console.log(`fetch[${src.jurisdiction}]: ${src.label}`);
      try {
        const raw = await src.fetch();
        const ext = raw.contentType === "csv" ? "csv" : raw.contentType === "html" ? "html" : "json";
        const out = `${RAW_DIR}/${src.jurisdiction}/${runId}.${ext}`;
        await mkdir(dirname(out), { recursive: true });
        await writeFile(out, raw.bytes);
        console.log(`  wrote ${out} (${raw.bytes.byteLength} bytes from ${raw.sourceUrl})`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`  FAILED [${src.jurisdiction}]: ${message}`);
        failures.push({ jurisdiction: src.jurisdiction, error: message });
      }
    }),
  );

  // Don't blow up the whole run if one jurisdiction is down. Other sources
  // still need to make it through parse/diff/feed. The diff for the failed
  // source just won't update this week.
  if (failures.length === sources.length) {
    throw new Error(`fetch: all ${sources.length} sources failed`);
  }
  if (failures.length > 0) {
    console.warn(`fetch: ${failures.length}/${sources.length} sources failed; continuing`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
