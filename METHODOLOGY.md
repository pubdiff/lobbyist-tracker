# Methodology

How this tracker collects, normalises, and surfaces changes to Australian lobbyist registers.

## Sources

Each Australian jurisdiction with a third-party lobbyist register is treated as an independent source. The register URLs are stored in `src/sources/<jurisdiction>.ts` alongside the adapter that fetches and parses them. The source link for each record is preserved in the snapshot and shown on every per-record page.

| Jurisdiction | Authority | Format | Update cadence (observed) |
|---|---|---|---|
| NSW | NSW Electoral Commission | Server-rendered Salesforce register (list page + per-firm Ajax detail) | Continuous |
| Federal | Attorney-General's Department | Public JSON API (Angular SPA backend) | Continuous |
| VIC | Victorian Public Sector Commission | Server-rendered register (sitemap + per-firm page) | Continuous |
| QLD | Queensland Integrity Commissioner | HTML register | Continuous |
| WA | WA Public Sector Commission | HTML register | Continuous |
| SA | SA Department of the Premier and Cabinet | HTML register | Continuous |

Each adapter records the **exact source URL** it fetched in the snapshot file. If a register moves, the diff for the affected week will reflect the changeover and a note is added to this document.

### NSW source detail

The NSW register at `lobbyists.elections.nsw.gov.au/whoisontheregister` is not a downloadable file despite its data.nsw.gov.au listing. It is a Salesforce Visualforce app. The adapter fetches it in two tiers: one GET for the list of ~460 firms (each carrying a stable Salesforce record id used as the `registrationId`), then one JSF/RichFaces Ajax POST per firm (replaying the page ViewState) to retrieve that firm's clients, employees, owners and the register's own change history. Requests are politely paced and identify a `PubdiffBot` user agent. Full reverse-engineering notes live in `.notes/nsw-source.md`.

### Federal source detail

The federal register at `lobbyists.ag.gov.au` is an Angular SPA backed by a public JSON API at `api.lobbyists.ag.gov.au` (no auth required for read access). The adapter calls `statistics/lobbyists` for the list of ~385 current organisations (each with a stable `organisationId` used as the `registrationId`), then `search/organisations/{id}/profile` per org for its current clients, employees and owners. Unlike NSW, the federal register exposes whether each employee is a former government representative (`isFormerRepresentative`), captured as `isFormerPublicOfficial` with the prior role in the notes; it does not have a watchlist or foreign-principal flag. Full notes live in `.notes/federal-source.md`.

### Victorian source detail

The Victorian register at `lobbyists.vic.gov.au` is a server-rendered Drupal site (the Victorian Public Sector Commission's). Its on-site search loads over AJAX with no clean JSON endpoint, so the adapter enumerates firms from the site's `sitemap.xml`, which lists every firm page (`/search-the-register/<slug>`, the slug used as the `registrationId`). It then fetches one server-rendered page per firm for that firm's official entity name, ABN, registration status and date, owners, employees and clients (both current and former, the latter carrying a removal date). Like the federal register and unlike NSW, VIC discloses former government roles: each employee may carry a former-role statement (e.g. a former ministerial adviser), captured as `isFormerPublicOfficial` with the statement in the notes. VIC exposes no watchlist or foreign-principal flag. Full notes live in `.notes/vic-source.md`.

## Schema

Every register exposes some subset of the same conceptual entities:

- **Lobbyist** - the registered firm (the entity that is bound by the lobbying code). May carry a regulator **watchlist** flag.
- **Client** - an organisation the lobbyist acts for. Where exposed, we record the client ABN, whether it is a **foreign principal**, and the associated country(ies).
- **Engagement** - the relationship `(lobbyist, client)` at a point in time. Some registers also expose start dates, end dates, or the responsible employee.
- **Person** - individuals listed as employees / contractors of the lobbyist firm authorised to lobby on its behalf.
- **Owner** - a person or entity with a management or financial interest in the lobbyist firm. Distinct from an employee; recorded where the register exposes it (NSW does).

The normalised TypeScript types in `src/schema.ts` are the canonical definition. Where a register doesn't expose a field, that field is `null` on the record - never silently dropped.

### Identity / primary keys

- **Lobbyist**: composite key `(jurisdiction, registrationId)`. Where a register doesn't issue a stable ID, we fall back to a slug of the firm's legal name, recorded in the adapter's source notes.
- **Client**: composite key `(jurisdiction, lobbyistKey, clientName)`. Client identity across registers is intentionally NOT resolved here - that's the entity-resolution layer's job, not this tracker's. We record names verbatim.
- **Person**: composite key `(jurisdiction, lobbyistKey, personName)`.

## Diff semantics

Per source, each weekly run compares the current snapshot against the previous week's snapshot and emits four event types:

1. **lobbyist.added** - a new lobbyist firm appears in the register.
2. **lobbyist.removed** - a lobbyist no longer appears. Could be deregistration, suspension, or a register restructure - the diff records the disappearance, not the cause.
3. **client.added** / **client.removed** - the lobbyist's client list changed.
4. **client.foreignPrincipal.flagged** - a client is newly disclosed as a foreign principal (either a new client that is a foreign principal, or an existing client now flagged). Surfaced separately because of its public-interest weight.
5. **person.added** / **person.removed** - the lobbyist's listed employees changed.
6. **owner.added** / **owner.removed** - the lobbyist's listed owners changed.
7. **watchlist.changed** - the firm was added to or removed from the regulator's compliance watchlist.
8. **status.changed** - the firm's registration status changed (e.g. active -> suspended).

Field-level changes on existing records (e.g. firm name spelling, address) are tracked but de-emphasised in alerts.

## Bootstrap diffs

The first snapshot per source has no prior to diff against. Its "diff" surfaces every record as added. We label these as bootstrap diffs (`stats.totalPrevious === 0`) and skip them when posting to Bluesky and when building RSS items, so the feed isn't drowned in the initial backfill.

## What we don't do (yet)

- **Entity resolution across registers.** A lobbyist firm registered in NSW and federally appears as two distinct records here. Joining them is a downstream entity-resolution problem.
- **Ex-politician detection.** Where a register exposes its own former-representative flag (the federal register does, via `isFormerRepresentative`; the Victorian register does, via a per-employee former-role statement), we pass it through faithfully. What we do NOT do is independently match a named lobbyist against a list of former MPs / ministers / staffers when the register itself doesn't flag it. That inference is out of scope for v1.
- **Lobbying contact / meeting logs.** Registers expose who is registered, not what they did. Contact logs are largely not published.

## Identity / OPSEC posture

Lobbyist registers are public and real-name-safe. This tracker re-publishes facts already on government websites. Per pubdiff's posture: no editorialisation, every record links to source, methodology and reproducibility are part of the deliverable.

## Reproducibility

- Every snapshot file records `sourceUrl`, `fetchedAt`, and the parser version.
- The full Git history of `data/snapshots/` IS the history of the registers, week by week.
- Anyone can re-run the pipeline locally and re-derive every diff from raw snapshots.

## Contact

Issues, corrections, and data questions: https://github.com/pubdiff/lobbyist-tracker/issues
