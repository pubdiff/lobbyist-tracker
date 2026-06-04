// Update cumulative data/_index.json with the latest snapshot from each source.
// Each lobbyist's history grows over time as we observe status / client-count /
// person-count changes.

import { readdir } from "node:fs/promises";
import { SOURCES } from "./sources/index.ts";
import type {
  Lobbyist,
  LobbyistHistoryEntry,
  LobbyistIndex,
  LobbyistIndexed,
  LobbyistKey,
  SnapshotFile,
} from "./schema.ts";
import { makeLobbyistKey } from "./schema.ts";
import { INDEX_PATH, SNAPSHOT_DIR, isoDate, readJSON, writeJSON } from "./lib.ts";

function makeHistoryEntry(l: Lobbyist, observedAt: string): LobbyistHistoryEntry {
  return {
    observedAt,
    status: l.status,
    onWatchlist: l.onWatchlist,
    clientCount: l.clients.length,
    personCount: l.people.length,
    ownerCount: l.owners.length,
  };
}

function historyMatches(a: LobbyistHistoryEntry, b: LobbyistHistoryEntry): boolean {
  return (
    a.status === b.status &&
    a.onWatchlist === b.onWatchlist &&
    a.clientCount === b.clientCount &&
    a.personCount === b.personCount &&
    a.ownerCount === b.ownerCount
  );
}

async function findLatestSnapshot(jurisdiction: string): Promise<string | null> {
  const dir = `${SNAPSHOT_DIR}/${jurisdiction}`;
  let files: string[];
  try {
    files = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  const sorted = files.filter((f) => f.endsWith(".json")).sort();
  const latest = sorted[sorted.length - 1];
  return latest ? `${dir}/${latest}` : null;
}

async function main(): Promise<void> {
  const runId = isoDate();
  const index: LobbyistIndex = (await readJSON<LobbyistIndex>(INDEX_PATH)) ?? {};
  const seenThisRun = new Set<LobbyistKey>();

  for (const src of SOURCES) {
    const path = await findLatestSnapshot(src.jurisdiction);
    if (!path) continue;
    const snapshot = await readJSON<SnapshotFile>(path);
    if (!snapshot) continue;
    console.log(`index-update[${src.jurisdiction}]: ${path} (${snapshot.lobbyists.length})`);

    for (const l of snapshot.lobbyists) {
      const key = makeLobbyistKey(l);
      seenThisRun.add(key);
      const prior = index[key];
      const entry = makeHistoryEntry(l, runId);

      if (!prior) {
        const indexed: LobbyistIndexed = {
          ...l,
          key,
          firstSeen: runId,
          lastSeen: runId,
          history: [entry],
        };
        index[key] = indexed;
      } else {
        const last = prior.history[prior.history.length - 1];
        const newHistory = last && historyMatches(last, entry)
          ? prior.history
          : [...prior.history, entry];
        index[key] = {
          ...l,
          key,
          firstSeen: prior.firstSeen,
          lastSeen: runId,
          history: newHistory,
        };
      }
    }
  }

  await writeJSON(INDEX_PATH, index);
  console.log(`index-update: ${Object.keys(index).length} total lobbyists in index (${seenThisRun.size} seen this run)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
