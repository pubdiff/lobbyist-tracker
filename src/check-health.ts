// Multi-source data-health guardrail.
//
// The failure that motivated this: VIC's fetch 403'd on CI, fetch.ts caught it
// and continued, so the run produced NO vic snapshot and silently published a
// week that simply lacked Victoria - looking like "no VIC changes" rather than
// "VIC scraper broke". For an accountability tool a silent missing source is the
// worst failure mode.
//
// This runs as a final step (if: always()) AFTER the data is committed, so the
// healthy sources still publish; a dropped or crashed source just turns the run
// red so it gets noticed and fixed, instead of failing silently. It checks, for
// the current run, that every ready source produced a snapshot and that its
// count didn't collapse versus the prior snapshot (a partial fetch).
//
// Exit non-zero if any ready source is unhealthy.

import { readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { readySources } from "./sources/index.ts";
import { SNAPSHOT_DIR, readJSON } from "./lib.ts";

export interface SourceVerdict {
  ok: boolean;
  reason: string;
}

// Pure decision, unit-testable. `present` = a snapshot exists for THIS run.
// prevCount === null means no prior snapshot to compare (first/bootstrap run).
export function assessSourceHealth(
  present: boolean,
  prevCount: number | null,
  curCount: number | null,
  maxDropFraction = 0.3,
): SourceVerdict {
  if (!present || curCount === null) {
    return { ok: false, reason: "no snapshot for this run - fetch/parse dropped this source" };
  }
  if (curCount === 0) {
    return { ok: false, reason: "snapshot has 0 records (fetch/parse likely broke)" };
  }
  if (prevCount === null || prevCount === 0) {
    return { ok: true, reason: `${curCount} records (no prior snapshot to compare)` };
  }
  const drop = (prevCount - curCount) / prevCount;
  if (drop > maxDropFraction) {
    return {
      ok: false,
      reason: `count dropped ${(drop * 100).toFixed(1)}% (${prevCount} -> ${curCount}) over the ${(maxDropFraction * 100).toFixed(0)}% guardrail - likely a partial fetch, not real churn`,
    };
  }
  return { ok: true, reason: `${prevCount} -> ${curCount} (within guardrail)` };
}

interface SnapshotFile {
  count: number;
}

// Sorted snapshot dates (YYYY-MM-DD) for one source, oldest -> newest.
async function snapshotDates(source: string): Promise<string[]> {
  try {
    return (await readdir(`${SNAPSHOT_DIR}/${source}`))
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, ""))
      .sort();
  } catch {
    return [];
  }
}

async function count(source: string, date: string): Promise<number | null> {
  const snap = await readJSON<SnapshotFile>(`${SNAPSHOT_DIR}/${source}/${date}.json`);
  return snap?.count ?? null;
}

async function main(): Promise<void> {
  const maxDrop = Number(process.env.HEALTH_MAX_DROP ?? "0.3");
  const sources = readySources().map((s) => s.jurisdiction);

  // The current run id is the newest snapshot date across all ready sources -
  // so a source whose newest snapshot is older than that has dropped this run.
  const dates: Record<string, string[]> = {};
  let currentRunId = "";
  for (const s of sources) {
    dates[s] = await snapshotDates(s);
    const newest = dates[s]!.at(-1);
    if (newest && newest > currentRunId) currentRunId = newest;
  }
  if (!currentRunId) {
    console.log("check-health: no snapshots found, skipping");
    return;
  }

  console.log(`check-health: run ${currentRunId}, ${sources.length} ready sources`);
  const failures: string[] = [];
  for (const s of sources) {
    const ds = dates[s]!;
    const present = ds.at(-1) === currentRunId;
    const curCount = present ? await count(s, currentRunId) : null;
    // prior = the snapshot before the current run (or the latest one if dropped).
    const priorDate = present ? ds.at(-2) : ds.at(-1);
    const prevCount = priorDate ? await count(s, priorDate) : null;
    const v = assessSourceHealth(present, prevCount, curCount, maxDrop);
    console.log(`  ${(v.ok ? "OK  " : "FAIL")} ${s}: ${v.reason}`);
    if (!v.ok) failures.push(s);
  }

  if (failures.length > 0) {
    console.error(`check-health: FAILED for ${failures.length} source(s): ${failures.join(", ")}`);
    console.error("  Healthy sources still published; this run is marked failed so the drop gets fixed.");
    process.exit(1);
  }
  console.log("check-health: all ready sources healthy");
}

// Only run as a CLI entry, not when imported by tests.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error("check-health failed:", err);
    process.exit(1);
  });
}
