// Build-time data loading. Reads the JSON that src/build-site-data.ts writes
// into site/public/data/ on every scrape run. Runs only in Server Components /
// generateStaticParams. Every loader degrades gracefully to empty when the
// data files are absent (e.g. before the first scrape has committed them).

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { keySlug } from "./slug";
import { JURISDICTION_ORDER } from "./jurisdictions";
import type {
  Diff,
  Event,
  Jurisdiction,
  LobbyistIndexed,
} from "./types";

export type { Diff, Event, Jurisdiction, LobbyistIndexed } from "./types";
export { keySlug } from "./slug";

const PUBLIC_DATA = join(process.cwd(), "public", "data");
const LOBBYISTS_PATH = join(PUBLIC_DATA, "lobbyists.json");
const DIFF_PATH = join(PUBLIC_DATA, "diff-latest.json");

async function readJSON<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

let lobbyistsCache: LobbyistIndexed[] | null = null;
export async function loadLobbyists(): Promise<LobbyistIndexed[]> {
  if (lobbyistsCache) return lobbyistsCache;
  const raw = (await readJSON<LobbyistIndexed[]>(LOBBYISTS_PATH)) ?? [];
  lobbyistsCache = [...raw].sort((a, b) => a.legalName.localeCompare(b.legalName));
  return lobbyistsCache;
}

let diffCache: { diff: Diff | null } | null = null;
export async function loadDiff(): Promise<Diff | null> {
  if (diffCache) return diffCache.diff;
  diffCache = { diff: await readJSON<Diff>(DIFF_PATH) };
  return diffCache.diff;
}

// ---------------------------------------------------------------------------
// Slug table: maps each record key to a stable, unique, URL-safe slug.
// ---------------------------------------------------------------------------

interface SlugTable {
  bySlug: Map<string, LobbyistIndexed>;
  byKey: Map<string, string>;
}

let slugTableCache: SlugTable | null = null;
async function slugTable(): Promise<SlugTable> {
  if (slugTableCache) return slugTableCache;
  const all = await loadLobbyists();
  const bySlug = new Map<string, LobbyistIndexed>();
  const byKey = new Map<string, string>();
  // Sort by key so slug assignment (and collision suffixes) is deterministic.
  for (const rec of [...all].sort((a, b) => a.key.localeCompare(b.key))) {
    let slug = keySlug(rec.key);
    if (bySlug.has(slug)) {
      let n = 2;
      while (bySlug.has(`${slug}-${n}`)) n++;
      slug = `${slug}-${n}`;
    }
    bySlug.set(slug, rec);
    byKey.set(rec.key, slug);
  }
  slugTableCache = { bySlug, byKey };
  return slugTableCache;
}

export async function allSlugs(): Promise<string[]> {
  return [...(await slugTable()).bySlug.keys()];
}

export async function recordBySlug(slug: string): Promise<LobbyistIndexed | null> {
  return (await slugTable()).bySlug.get(slug) ?? null;
}

export async function slugForKey(key: string): Promise<string | null> {
  return (await slugTable()).byKey.get(key) ?? null;
}

// ---------------------------------------------------------------------------
// Aggregate stats for the home and methodology pages.
// ---------------------------------------------------------------------------

export interface TrackerStats {
  totalFirms: number;
  totalClients: number;
  totalPeople: number;
  totalOwners: number;
  foreignPrincipalClients: number;
  formerOfficials: number;
  onWatchlist: number;
  firstSeen: string | null;
  lastSeen: string | null;
  byJurisdiction: Array<{ code: Jurisdiction; count: number }>;
}

export async function trackerStats(): Promise<TrackerStats> {
  const all = await loadLobbyists();
  const counts = new Map<Jurisdiction, number>();
  let totalClients = 0;
  let totalPeople = 0;
  let totalOwners = 0;
  let foreignPrincipalClients = 0;
  let formerOfficials = 0;
  let onWatchlist = 0;
  let firstSeen: string | null = null;
  let lastSeen: string | null = null;

  for (const rec of all) {
    counts.set(rec.jurisdiction, (counts.get(rec.jurisdiction) ?? 0) + 1);
    totalClients += rec.clients.length;
    totalPeople += rec.people.length;
    totalOwners += rec.owners.length;
    foreignPrincipalClients += rec.clients.filter((c) => c.isForeignPrincipal).length;
    formerOfficials += rec.people.filter((p) => p.isFormerPublicOfficial).length;
    if (rec.onWatchlist) onWatchlist++;
    if (!firstSeen || rec.firstSeen < firstSeen) firstSeen = rec.firstSeen;
    if (!lastSeen || rec.lastSeen > lastSeen) lastSeen = rec.lastSeen;
  }

  const byJurisdiction = JURISDICTION_ORDER.filter((code) => counts.has(code)).map(
    (code) => ({ code, count: counts.get(code) ?? 0 }),
  );

  return {
    totalFirms: all.length,
    totalClients,
    totalPeople,
    totalOwners,
    foreignPrincipalClients,
    formerOfficials,
    onWatchlist,
    firstSeen,
    lastSeen,
    byJurisdiction,
  };
}

// ---------------------------------------------------------------------------
// Change feed: flatten the latest diff's events into display rows, enriched
// with the firm's current name and source link from the index.
// ---------------------------------------------------------------------------

export interface ChangeItem {
  jurisdiction: Jurisdiction;
  key: string;
  slug: string | null;
  legalName: string;       // best available name for the firm
  sourceUrl: string | null; // source register permalink, if the firm is in the index
  headline: string;        // short category label
  detail: string | null;   // the specific thing that changed
  highlight: boolean;      // high-public-interest events (foreign principal, watchlist)
}

function headlineFor(event: Event): { headline: string; detail: string | null; highlight: boolean } {
  switch (event.type) {
    case "lobbyist.added":
      return { headline: "New firm registered", detail: null, highlight: false };
    case "lobbyist.removed":
      return { headline: "Firm deregistered", detail: null, highlight: false };
    case "client.added":
      return { headline: "Client added", detail: event.client.name, highlight: false };
    case "client.removed":
      return { headline: "Client removed", detail: event.clientName, highlight: false };
    case "person.added":
      return { headline: "Lobbyist added", detail: event.person.name, highlight: false };
    case "person.removed":
      return { headline: "Lobbyist removed", detail: event.personName, highlight: false };
    case "owner.added":
      return { headline: "Owner added", detail: event.owner.name, highlight: false };
    case "owner.removed":
      return { headline: "Owner removed", detail: event.ownerName, highlight: false };
    case "status.changed":
      return {
        headline: "Status changed",
        detail: `${event.from ?? "(none)"} → ${event.to ?? "(none)"}`,
        highlight: false,
      };
    case "client.foreignPrincipal.flagged": {
      const where = event.countries.length ? ` (${event.countries.join(", ")})` : "";
      return {
        headline: "Foreign principal flagged",
        detail: `${event.clientName}${where}`,
        highlight: true,
      };
    }
    case "watchlist.changed":
      return {
        headline: event.onWatchlist ? "Added to compliance watchlist" : "Removed from compliance watchlist",
        detail: null,
        highlight: true,
      };
  }
}

function nameFromEvent(event: Event): string | null {
  if (event.type === "lobbyist.added") return event.lobbyist.legalName;
  if (event.type === "lobbyist.removed") return event.lastSeenLegalName;
  if (event.type === "watchlist.changed") return event.legalName;
  return null;
}

export interface JurisdictionChanges {
  jurisdiction: Jurisdiction;
  isBootstrap: boolean;
  totalCurrent: number;
  items: ChangeItem[];
}

export async function latestChanges(): Promise<{ runId: string | null; groups: JurisdictionChanges[] }> {
  const diff = await loadDiff();
  if (!diff) return { runId: null, groups: [] };
  const index = new Map((await loadLobbyists()).map((r) => [r.key, r]));
  const table = await slugTable();

  const groups: JurisdictionChanges[] = [];
  for (const jurisdiction of JURISDICTION_ORDER) {
    const source = diff.perSource[jurisdiction];
    if (!source) continue;
    const items: ChangeItem[] = source.events.map((event) => {
      const rec = index.get(event.key);
      const { headline, detail, highlight } = headlineFor(event);
      return {
        jurisdiction,
        key: event.key,
        slug: table.byKey.get(event.key) ?? null,
        legalName: rec?.legalName ?? nameFromEvent(event) ?? event.key,
        sourceUrl: rec?.sourceUrl ?? null,
        headline,
        detail,
        highlight,
      };
    });
    if (items.length === 0 && source.totalCurrent === 0) continue;
    groups.push({
      jurisdiction,
      isBootstrap: source.isBootstrap,
      totalCurrent: source.totalCurrent,
      items: sortChangeItems(items),
    });
  }
  return { runId: diff.runId, groups };
}

// Surface high-interest events first, then group by firm name for readability.
function sortChangeItems(items: ChangeItem[]): ChangeItem[] {
  return [...items].sort((a, b) => {
    if (a.highlight !== b.highlight) return a.highlight ? -1 : 1;
    return a.legalName.localeCompare(b.legalName) || a.headline.localeCompare(b.headline);
  });
}
