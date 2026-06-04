// Post the latest diff's headline events to Bluesky.
// Behaviour:
// - Reads the latest diff file
// - Skips per-source bootstrap diffs
// - Posts each lobbyist.added / lobbyist.removed / client.added (capped)
// - Idempotency: writes data/_posted.json keyed by event fingerprint
//
// Env:
//   BSKY_HANDLE         e.g. lobbyists.pubdiff.com or lobbyists.bsky.social
//   BSKY_APP_PASSWORD   from Bluesky Settings - Privacy - App Passwords
//   BSKY_DRY_RUN=1      print posts instead of sending

import { readdir } from "node:fs/promises";
import { AtpAgent, RichText } from "@atproto/api";
import type { Diff, Event, LobbyistIndex, PostedRecord } from "./schema.ts";
import { DIFF_DIR, INDEX_PATH, POSTED_PATH, readJSON, writeJSON } from "./lib.ts";

const MAX_POSTS_PER_RUN = 25;
const DRY_RUN = process.env.BSKY_DRY_RUN === "1";

function fingerprint(runId: string, e: Event): string {
  switch (e.type) {
    case "lobbyist.added": return `${runId}:added:${e.key}`;
    case "lobbyist.removed": return `${runId}:removed:${e.key}`;
    case "client.added": return `${runId}:client-added:${e.key}:${e.client.name}`;
    case "client.removed": return `${runId}:client-removed:${e.key}:${e.clientName}`;
    case "person.added": return `${runId}:person-added:${e.key}:${e.person.name}`;
    case "person.removed": return `${runId}:person-removed:${e.key}:${e.personName}`;
    case "owner.added": return `${runId}:owner-added:${e.key}:${e.owner.name}`;
    case "owner.removed": return `${runId}:owner-removed:${e.key}:${e.ownerName}`;
    case "client.foreignPrincipal.flagged": return `${runId}:foreign-principal:${e.key}:${e.clientName}`;
    case "watchlist.changed": return `${runId}:watchlist:${e.key}:${e.onWatchlist}`;
    case "status.changed": return `${runId}:status:${e.key}:${e.from ?? ""}->${e.to ?? ""}`;
  }
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

function formatPost(e: Event, idx: LobbyistIndex): string | null {
  if (e.type === "lobbyist.added") {
    const l = e.lobbyist;
    const lines = [`NEW lobbyist: ${l.legalName}`, l.jurisdiction.toUpperCase()];
    if (l.clients.length > 0) {
      lines.push(`Clients: ${l.clients.slice(0, 3).map((c) => c.name).join(", ")}${l.clients.length > 3 ? ` (+${l.clients.length - 3} more)` : ""}`);
    }
    return truncate(lines.join("\n"), 300);
  }
  if (e.type === "lobbyist.removed") {
    const jur = e.key.split(":")[0]?.toUpperCase() ?? "?";
    return truncate(`REMOVED: ${e.lastSeenLegalName}\nNo longer in ${jur} register.`, 300);
  }
  if (e.type === "client.added") {
    const lob = idx[e.key];
    const name = lob?.legalName ?? e.key;
    const jur = lob?.jurisdiction.toUpperCase() ?? "?";
    return truncate(`NEW client: ${name} (${jur})\n-> ${e.client.name}`, 300);
  }
  if (e.type === "client.foreignPrincipal.flagged") {
    const lob = idx[e.key];
    const name = lob?.legalName ?? e.key;
    const where = e.countries.length > 0 ? ` (${e.countries.join(", ")})` : "";
    return truncate(`FOREIGN PRINCIPAL client: ${name}\n-> ${e.clientName}${where}`, 300);
  }
  if (e.type === "watchlist.changed") {
    const jur = e.key.split(":")[0]?.toUpperCase() ?? "?";
    return truncate(
      e.onWatchlist
        ? `WATCHLIST: ${e.legalName} added to the ${jur} lobbyist watchlist.`
        : `WATCHLIST: ${e.legalName} removed from the ${jur} lobbyist watchlist.`,
      300,
    );
  }
  // Other event types not posted - they're aggregated on the site.
  return null;
}

function shouldPost(e: Event): boolean {
  return (
    e.type === "lobbyist.added" ||
    e.type === "lobbyist.removed" ||
    e.type === "client.added" ||
    e.type === "client.foreignPrincipal.flagged" ||
    e.type === "watchlist.changed"
  );
}

async function latestDiffPath(): Promise<string | null> {
  let files: string[];
  try {
    files = await readdir(DIFF_DIR);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  const latest = files.filter((f) => f.endsWith(".json")).sort().pop();
  return latest ? `${DIFF_DIR}/${latest}` : null;
}

async function main(): Promise<void> {
  const diffFile = await latestDiffPath();
  if (!diffFile) { console.log("post: no diff to post"); return; }
  const diff = await readJSON<Diff>(diffFile);
  if (!diff) { console.log("post: failed to read diff"); return; }

  const idx = (await readJSON<LobbyistIndex>(INDEX_PATH)) ?? {};
  const posted: PostedRecord = (await readJSON<PostedRecord>(POSTED_PATH)) ?? {};

  // Gather postable events, skipping bootstrap diffs.
  const toPost: Event[] = [];
  for (const [, perSource] of Object.entries(diff.perSource)) {
    if (perSource.isBootstrap) continue;
    for (const e of perSource.events) {
      if (!shouldPost(e)) continue;
      const fp = fingerprint(diff.runId, e);
      if (posted[fp]) continue;
      toPost.push(e);
    }
  }
  if (toPost.length === 0) { console.log("post: nothing new to post"); return; }

  // Prioritise added > removed > client.added; cap to MAX_POSTS_PER_RUN.
  const priority = {
    "client.foreignPrincipal.flagged": 0,
    "watchlist.changed": 1,
    "lobbyist.added": 2,
    "lobbyist.removed": 3,
    "client.added": 4,
  } as const;
  toPost.sort((a, b) => (priority[a.type as keyof typeof priority] ?? 9) - (priority[b.type as keyof typeof priority] ?? 9));
  const slice = toPost.slice(0, MAX_POSTS_PER_RUN);
  const dropped = toPost.length - slice.length;
  console.log(`post: ${slice.length} posts (${dropped} dropped over cap)`);

  if (DRY_RUN) {
    for (const e of slice) {
      const text = formatPost(e, idx);
      if (!text) continue;
      console.log("--- DRY RUN ---");
      console.log(text);
    }
    return;
  }

  const handle = process.env.BSKY_HANDLE;
  const appPassword = process.env.BSKY_APP_PASSWORD;
  if (!handle || !appPassword) {
    throw new Error("BSKY_HANDLE and BSKY_APP_PASSWORD env vars required (or set BSKY_DRY_RUN=1)");
  }

  const agent = new AtpAgent({ service: "https://bsky.social" });
  await agent.login({ identifier: handle, password: appPassword });

  let root: { uri: string; cid: string } | null = null;
  let parent: { uri: string; cid: string } | null = null;
  for (const e of slice) {
    const text = formatPost(e, idx);
    if (!text) continue;
    const rt = new RichText({ text });
    await rt.detectFacets(agent);
    const reply = root && parent ? { root, parent } : undefined;
    const res = await agent.post({ text: rt.text, facets: rt.facets, ...(reply ? { reply } : {}) });
    if (!root) root = res;
    parent = res;
    posted[fingerprint(diff.runId, e)] = new Date().toISOString();
    console.log(`posted: ${text.split("\n")[0]}`);
  }

  await writeJSON(POSTED_PATH, posted);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
