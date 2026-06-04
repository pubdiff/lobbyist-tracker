// Compute per-source diffs between the two most recent snapshots.
// Writes data/diffs/<runId>.json with a unified event stream.

import { readdir } from "node:fs/promises";
import { SOURCES } from "./sources/index.ts";
import type {
  Client,
  Diff,
  Event,
  Jurisdiction,
  Lobbyist,
  Owner,
  Person,
  SnapshotFile,
} from "./schema.ts";
import { makeLobbyistKey } from "./schema.ts";
import { SNAPSHOT_DIR, diffPath, isoDate, readJSON, writeJSON } from "./lib.ts";

async function lastTwoSnapshots(jurisdiction: string): Promise<{ prev: string | null; curr: string | null }> {
  const dir = `${SNAPSHOT_DIR}/${jurisdiction}`;
  let files: string[];
  try {
    files = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { prev: null, curr: null };
    throw err;
  }
  const sorted = files.filter((f) => f.endsWith(".json")).sort();
  const curr = sorted[sorted.length - 1] ?? null;
  const prev = sorted.length >= 2 ? sorted[sorted.length - 2]! : null;
  return {
    prev: prev ? `${dir}/${prev}` : null,
    curr: curr ? `${dir}/${curr}` : null,
  };
}

function diffClients(prev: Client[], curr: Client[]): { added: Client[]; removed: string[] } {
  const prevByName = new Map(prev.map((c) => [c.name, c]));
  const currByName = new Map(curr.map((c) => [c.name, c]));
  const added: Client[] = [];
  const removed: string[] = [];
  for (const c of curr) if (!prevByName.has(c.name)) added.push(c);
  for (const c of prev) if (!currByName.has(c.name)) removed.push(c.name);
  return { added, removed };
}

function diffPeople(prev: Person[], curr: Person[]): { added: Person[]; removed: string[] } {
  const prevByName = new Map(prev.map((p) => [p.name, p]));
  const currByName = new Map(curr.map((p) => [p.name, p]));
  const added: Person[] = [];
  const removed: string[] = [];
  for (const p of curr) if (!prevByName.has(p.name)) added.push(p);
  for (const p of prev) if (!currByName.has(p.name)) removed.push(p.name);
  return { added, removed };
}

function diffOwners(prev: Owner[], curr: Owner[]): { added: Owner[]; removed: string[] } {
  const prevByName = new Map(prev.map((o) => [o.name, o]));
  const currByName = new Map(curr.map((o) => [o.name, o]));
  const added: Owner[] = [];
  const removed: string[] = [];
  for (const o of curr) if (!prevByName.has(o.name)) added.push(o);
  for (const o of prev) if (!currByName.has(o.name)) removed.push(o.name);
  return { added, removed };
}

async function diffOneSource(jurisdiction: Jurisdiction): Promise<Diff["perSource"][Jurisdiction]> {
  const { prev, curr } = await lastTwoSnapshots(jurisdiction);
  const empty = { totalCurrent: 0, totalPrevious: 0, isBootstrap: true, events: [] as Event[] };
  if (!curr) return empty;

  const currSnap = await readJSON<SnapshotFile>(curr);
  if (!currSnap) return empty;

  const prevSnap = prev ? await readJSON<SnapshotFile>(prev) : null;

  const prevByKey = new Map<string, Lobbyist>();
  for (const l of prevSnap?.lobbyists ?? []) prevByKey.set(makeLobbyistKey(l), l);
  const currByKey = new Map<string, Lobbyist>();
  for (const l of currSnap.lobbyists) currByKey.set(makeLobbyistKey(l), l);

  const events: Event[] = [];

  // Added
  for (const [key, l] of currByKey) {
    if (!prevByKey.has(key)) {
      events.push({ type: "lobbyist.added", key, lobbyist: l });
    }
  }
  // Removed
  for (const [key, l] of prevByKey) {
    if (!currByKey.has(key)) {
      events.push({ type: "lobbyist.removed", key, lastSeenLegalName: l.legalName });
    }
  }
  // Mutations on records present in both
  for (const [key, curr] of currByKey) {
    const prev = prevByKey.get(key);
    if (!prev) continue;

    if (prev.status !== curr.status) {
      events.push({ type: "status.changed", key, from: prev.status, to: curr.status });
    }
    if (prev.onWatchlist !== curr.onWatchlist && curr.onWatchlist != null) {
      events.push({ type: "watchlist.changed", key, legalName: curr.legalName, onWatchlist: curr.onWatchlist });
    }
    const c = diffClients(prev.clients, curr.clients);
    for (const cl of c.added) {
      events.push({ type: "client.added", key, client: cl });
      if (cl.isForeignPrincipal) {
        events.push({ type: "client.foreignPrincipal.flagged", key, clientName: cl.name, countries: cl.countries });
      }
    }
    for (const name of c.removed) events.push({ type: "client.removed", key, clientName: name });
    // A client that existed before but was only now flagged as a foreign principal.
    const prevClientByName = new Map(prev.clients.map((cl) => [cl.name, cl]));
    for (const cl of curr.clients) {
      const before = prevClientByName.get(cl.name);
      if (before && !before.isForeignPrincipal && cl.isForeignPrincipal) {
        events.push({ type: "client.foreignPrincipal.flagged", key, clientName: cl.name, countries: cl.countries });
      }
    }
    const p = diffPeople(prev.people, curr.people);
    for (const pe of p.added) events.push({ type: "person.added", key, person: pe });
    for (const name of p.removed) events.push({ type: "person.removed", key, personName: name });
    const o = diffOwners(prev.owners, curr.owners);
    for (const ow of o.added) events.push({ type: "owner.added", key, owner: ow });
    for (const name of o.removed) events.push({ type: "owner.removed", key, ownerName: name });
  }

  return {
    totalCurrent: currSnap.count,
    totalPrevious: prevSnap?.count ?? 0,
    isBootstrap: prevSnap === null,
    events,
  };
}

async function main(): Promise<void> {
  const runId = isoDate();
  const perSource = {} as Diff["perSource"];
  for (const src of SOURCES) {
    perSource[src.jurisdiction] = await diffOneSource(src.jurisdiction);
  }

  const events = Object.values(perSource).flatMap((s) => s.events);
  const count = (t: Event["type"]) => events.filter((e) => e.type === t).length;
  const totalCurrent = Object.values(perSource).reduce((n, s) => n + s.totalCurrent, 0);
  const totalPrevious = Object.values(perSource).reduce((n, s) => n + s.totalPrevious, 0);

  const diff: Diff = {
    runId,
    perSource,
    stats: {
      totalCurrent,
      totalPrevious,
      eventCount: events.length,
      addedCount: count("lobbyist.added"),
      removedCount: count("lobbyist.removed"),
      clientAddedCount: count("client.added"),
      clientRemovedCount: count("client.removed"),
      personAddedCount: count("person.added"),
      personRemovedCount: count("person.removed"),
      ownerAddedCount: count("owner.added"),
      ownerRemovedCount: count("owner.removed"),
      foreignPrincipalFlaggedCount: count("client.foreignPrincipal.flagged"),
      watchlistChangedCount: count("watchlist.changed"),
      statusChangedCount: count("status.changed"),
    },
  };

  const out = diffPath(runId);
  await writeJSON(out, diff);
  console.log(`diff: wrote ${out} (${events.length} events)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
