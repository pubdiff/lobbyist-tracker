// Generate RSS 2.0 + JSON Feed 1.1 from recent diffs.
// Writes site/public/feed.xml and site/public/feed.json.
//
// Bootstrap diffs (first snapshot per source) are skipped - the initial
// backfill would otherwise dominate the feed.

import { readdir } from "node:fs/promises";
import type { Diff, Event, LobbyistIndex } from "./schema.ts";
import { DIFF_DIR, FEED_DIR, INDEX_PATH, readJSON, writeText } from "./lib.ts";

const SITE_URL = process.env.SITE_URL ?? "https://pubdiff.github.io/lobbyist-tracker";
const FEED_TITLE = "Lobbyist Tracker - pubdiff";
const FEED_DESCRIPTION =
  "Weekly diff of Australian lobbyist registers (federal + state). Tracks new firms, deregistrations, and client changes. A pubdiff tracker.";
const MAX_ITEMS = 100;
const WEEKS_BACK = 12;

interface FeedItem {
  id: string;
  url: string;
  title: string;
  contentText: string;
  contentHtml: string;
  datePublished: string;
  tags: string[];
}

function fmtAddedItem(runId: string, e: Extract<Event, { type: "lobbyist.added" }>): FeedItem {
  const l = e.lobbyist;
  const clients = l.clients.length > 0 ? `\nClients: ${l.clients.map((c) => c.name).join(", ")}` : "";
  return {
    id: `${runId}:${e.type}:${e.key}`,
    url: `${SITE_URL}/${encodeURIComponent(e.key)}/`,
    title: `NEW lobbyist: ${l.legalName} (${l.jurisdiction.toUpperCase()})`,
    contentText: `Registered lobbyist: ${l.legalName}${clients}`,
    contentHtml: `<p>Registered lobbyist: <strong>${escapeHtml(l.legalName)}</strong> (${l.jurisdiction.toUpperCase()})</p>${
      l.clients.length > 0 ? `<p>Clients: ${l.clients.map((c) => escapeHtml(c.name)).join(", ")}</p>` : ""
    }`,
    datePublished: `${runId}T00:00:00Z`,
    tags: [l.jurisdiction, "added"],
  };
}

function fmtRemovedItem(runId: string, e: Extract<Event, { type: "lobbyist.removed" }>): FeedItem {
  return {
    id: `${runId}:${e.type}:${e.key}`,
    url: `${SITE_URL}/${encodeURIComponent(e.key)}/`,
    title: `REMOVED lobbyist: ${e.lastSeenLegalName}`,
    contentText: `${e.lastSeenLegalName} no longer listed in ${e.key.split(":")[0]?.toUpperCase()} register.`,
    contentHtml: `<p><strong>${escapeHtml(e.lastSeenLegalName)}</strong> no longer listed in ${e.key.split(":")[0]?.toUpperCase()} register.</p>`,
    datePublished: `${runId}T00:00:00Z`,
    tags: [e.key.split(":")[0] ?? "unknown", "removed"],
  };
}

function fmtClientAddedItem(runId: string, e: Extract<Event, { type: "client.added" }>, idx: LobbyistIndex): FeedItem {
  const lob = idx[e.key];
  const name = lob?.legalName ?? e.key;
  return {
    id: `${runId}:${e.type}:${e.key}:${e.client.name}`,
    url: `${SITE_URL}/${encodeURIComponent(e.key)}/`,
    title: `NEW client: ${name} -> ${e.client.name}`,
    contentText: `${name} added client: ${e.client.name}`,
    contentHtml: `<p><strong>${escapeHtml(name)}</strong> added client: <em>${escapeHtml(e.client.name)}</em></p>`,
    datePublished: `${runId}T00:00:00Z`,
    tags: [lob?.jurisdiction ?? "unknown", "client-added"],
  };
}

function fmtForeignPrincipalItem(
  runId: string,
  e: Extract<Event, { type: "client.foreignPrincipal.flagged" }>,
  idx: LobbyistIndex,
): FeedItem {
  const lob = idx[e.key];
  const name = lob?.legalName ?? e.key;
  const where = e.countries.length > 0 ? ` (${e.countries.join(", ")})` : "";
  return {
    id: `${runId}:${e.type}:${e.key}:${e.clientName}`,
    url: `${SITE_URL}/${encodeURIComponent(e.key)}/`,
    title: `FOREIGN PRINCIPAL client: ${name} -> ${e.clientName}${where}`,
    contentText: `${name} acts for foreign-principal client: ${e.clientName}${where}`,
    contentHtml: `<p><strong>${escapeHtml(name)}</strong> acts for foreign-principal client: <em>${escapeHtml(e.clientName)}</em>${escapeHtml(where)}</p>`,
    datePublished: `${runId}T00:00:00Z`,
    tags: [lob?.jurisdiction ?? "unknown", "foreign-principal"],
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

async function listRecentDiffs(): Promise<string[]> {
  let files: string[];
  try {
    files = await readdir(DIFF_DIR);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  return files.filter((f) => f.endsWith(".json")).sort().slice(-WEEKS_BACK);
}

async function main(): Promise<void> {
  const idx = (await readJSON<LobbyistIndex>(INDEX_PATH)) ?? {};
  const files = await listRecentDiffs();

  const items: FeedItem[] = [];
  for (const file of files) {
    const d = await readJSON<Diff>(`${DIFF_DIR}/${file}`);
    if (!d) continue;
    for (const [, perSource] of Object.entries(d.perSource)) {
      if (perSource.isBootstrap) continue;
      for (const e of perSource.events) {
        if (e.type === "lobbyist.added") items.push(fmtAddedItem(d.runId, e));
        else if (e.type === "lobbyist.removed") items.push(fmtRemovedItem(d.runId, e));
        else if (e.type === "client.added") items.push(fmtClientAddedItem(d.runId, e, idx));
        else if (e.type === "client.foreignPrincipal.flagged") items.push(fmtForeignPrincipalItem(d.runId, e, idx));
        // client.removed / person.* / owner.* / status.changed / watchlist.changed:
        // aggregated on per-record page, not in feed
      }
    }
  }

  items.sort((a, b) => (a.datePublished < b.datePublished ? 1 : -1));
  const limited = items.slice(0, MAX_ITEMS);

  await writeText(`${FEED_DIR}/feed.json`, JSON.stringify(buildJsonFeed(limited), null, 2) + "\n");
  await writeText(`${FEED_DIR}/feed.xml`, buildRss(limited));
  console.log(`feed: wrote ${limited.length} items to feed.json + feed.xml`);
}

function buildJsonFeed(items: FeedItem[]): object {
  return {
    version: "https://jsonfeed.org/version/1.1",
    title: FEED_TITLE,
    description: FEED_DESCRIPTION,
    home_page_url: `${SITE_URL}/`,
    feed_url: `${SITE_URL}/feed.json`,
    items: items.map((i) => ({
      id: i.id,
      url: i.url,
      title: i.title,
      content_text: i.contentText,
      content_html: i.contentHtml,
      date_published: i.datePublished,
      tags: i.tags,
    })),
  };
}

function buildRss(items: FeedItem[]): string {
  const itemsXml = items
    .map(
      (i) => `    <item>
      <title>${escapeHtml(i.title)}</title>
      <link>${i.url}</link>
      <guid isPermaLink="false">${i.id}</guid>
      <pubDate>${new Date(i.datePublished).toUTCString()}</pubDate>
      <description>${escapeHtml(i.contentText)}</description>
    </item>`
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escapeHtml(FEED_TITLE)}</title>
    <link>${SITE_URL}/</link>
    <description>${escapeHtml(FEED_DESCRIPTION)}</description>
    <language>en-AU</language>
${itemsXml}
  </channel>
</rss>
`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
