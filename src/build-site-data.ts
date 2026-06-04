// Build the JSON payload the static site consumes.
// Writes site/public/data/lobbyists.json (full index, sorted) and
// site/public/data/diff-latest.json (most recent diff).
//
// The site reads these at build time; the script keeps the import surface
// thin and lets us swap data shape without touching the Next.js app.

import { readdir } from "node:fs/promises";
import type { Diff, LobbyistIndex } from "./schema.ts";
import { DIFF_DIR, FEED_DIR, INDEX_PATH, readJSON, writeJSON } from "./lib.ts";

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
  const idx = (await readJSON<LobbyistIndex>(INDEX_PATH)) ?? {};
  const sorted = Object.values(idx).sort((a, b) => a.legalName.localeCompare(b.legalName));
  await writeJSON(`${FEED_DIR}/data/lobbyists.json`, sorted);
  console.log(`build-site-data: wrote ${sorted.length} lobbyists to site/public/data/lobbyists.json`);

  const diffPath = await latestDiffPath();
  if (diffPath) {
    const diff = await readJSON<Diff>(diffPath);
    if (diff) {
      await writeJSON(`${FEED_DIR}/data/diff-latest.json`, diff);
      console.log(`build-site-data: wrote latest diff (${diff.runId})`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
