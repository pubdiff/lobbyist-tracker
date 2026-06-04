# lobbyist-tracker

Weekly diff of Australian lobbyist registers. A [pubdiff](https://github.com/pubdiff) tracker.

Each jurisdiction's register publishes only the current state of who is registered as a third-party lobbyist for whom. The lists change without history. This tracker snapshots them weekly, surfaces what changed (new lobbyists, new clients, deregistrations), and publishes RSS + Bluesky alerts.

## Sources tracked

| Jurisdiction | Register | Status |
|---|---|---|
| NSW | NSW Electoral Commission Register of Third-Party Lobbyists | live - list + per-firm detail (clients, foreign principals, employees, owners, watchlist) |
| Federal | Attorney-General's Department Register of Lobbyists | live - JSON API (clients, employees incl. former-representative flag, owners) |
| VIC | Victorian Public Sector Commission Lobbyist Register | live - sitemap + per-firm page (clients incl. former, employees incl. former-role flag, owners) |
| QLD | Queensland Integrity Commissioner Lobbyists Register | planned |
| WA | WA Public Sector Commission Lobbyists Register | planned |
| SA | SA Department of the Premier and Cabinet Lobbyist Register | planned |

TAS, ACT, NT do not maintain registers (or maintain only minimal ones).

## What changes get surfaced

Per source, each weekly run produces a diff of:

- **Added** lobbyists (new firms registering)
- **Removed** lobbyists (firms deregistered or struck off)
- **Client changes** (new client added to an existing lobbyist, client removed)
- **Foreign-principal flags** (a client newly disclosed as a foreign principal, with country)
- **Personnel changes** (employees and owners listed, where exposed)
- **Watchlist changes** (a firm added to or removed from the regulator's compliance watchlist)
- **Status changes** (e.g. active -> suspended -> deregistered)

The shape of "what we can see change" varies by source. NSW's register exposes the richest detail (clients, foreign principals, employees, owners, watchlist); other jurisdictions expose less. Per-source caveats live in `METHODOLOGY.md`.

## How it works

```
[ N jurisdiction registers ] -> [ per-source adapter: fetch + parse ]
  -> [ normalised Lobbyist + Client + Engagement records ]
  -> [ data/snapshots/<source>/YYYY-MM-DD.json ]
  -> [ diff vs prior snapshot ]
  -> [ data/diffs/YYYY-MM-DD.json + cumulative _index.json ]
  -> [ RSS + JSON Feed + Bluesky post ]
  -> [ static Next.js site at lobbyists.pubdiff.com ]
```

Runs every Wednesday 06:00 AEST via GitHub Actions. Source code is the methodology.

## Architecture

This tracker is multi-source where [epbc-tracker](https://github.com/pubdiff/epbc-tracker) is single-source. Each jurisdiction is a `Source` adapter (`src/sources/<jurisdiction>.ts`) implementing a small contract: `fetch()` and `parse()`. The pipeline scripts (`src/fetch.ts`, `src/parse.ts`, etc.) loop over every registered adapter and write per-source snapshot files.

This is the second pubdiff tracker. Shared utilities will be extracted to `@pubdiff/core` once two consumers exist.

## Develop

```bash
pnpm install
pnpm run fetch       # download all sources to data/raw/
pnpm run parse       # normalise to data/snapshots/<source>/<date>.json
pnpm run index-update
pnpm run diff
pnpm run feed
pnpm run post        # set BSKY_DRY_RUN=1 to print instead of send

# shorthand:
pnpm run scrape      # everything except the Bluesky post
pnpm run scrape:full # including the Bluesky post
```

## Licence

- Code: MIT (see `LICENSE`)
- Data in `data/`: CC-BY-4.0 (see `LICENSE-DATA`)

## Methodology

See [METHODOLOGY.md](METHODOLOGY.md).
