// Queensland lobbyist register adapter (Office of the Queensland Integrity
// Commissioner). https://lobbyists.integrity.qld.gov.au
//
// QLD is a Microsoft Power Apps / Dynamics portal, the same platform as the
// sibling epbc-tracker and as WA. Its "Search lobbyists" list is an entitylist
// control that loads via POST /_services/entity-grid-data.json/<guid> and needs
// a server-encrypted session triple absent from a plain GET, so we bootstrap a
// session in a headless browser once, then paginate with plain fetch. See
// src/portal/. (The list GUID is 44f6b10d-7da7-ed11-aad0-00224814b8f0.)
//
// Data model, important to how this maps to our schema:
//   - Each list row is a registered *individual lobbyist*, not a firm:
//     dpc_lobbyistname (person), dpc_tradingname (the firm they lobby under),
//     dpc_position, dpc_formerseniorgovernmentrepresentative (Yes/No), status.
//     We group rows by trading name into one Lobbyist (firm) per name, with the
//     people as that firm's authorised lobbyists.
//   - dpc_formerseniorgovernmentrepresentative is QLD's own former-senior-
//     government-representative flag -> Person.isFormerPublicOfficial.
//   - QLD publishes NO registered firm<->client relationship and no owners: the
//     client register (Search-clients) is a flat list of names with no link to
//     firms, and a firm's clients appear only per-contact in the Lobbying
//     Activity (contact) register. So clients[] and owners[] are empty here and
//     onWatchlist / foreign-principal are null (QLD has no such flags). The
//     contact-log linkage is a documented future enrichment; we do not synthesise
//     a client relationship the register does not itself publish. See
//     .notes/qld-source.md.

import type { Lobbyist, Person } from "../schema.ts";
import type { FetchResult, Source } from "./types.ts";
import { bootstrapEntityList, crawlGrid, flatten, yesNo } from "../portal/index.ts";

const HOST = "https://lobbyists.integrity.qld.gov.au";
const LIST_PAGE = `${HOST}/Lobbying-Register/Search-lobbyists/`;

const DEFAULT_DELAY_MS = 1500;

// One flattened list row, as written to the raw artifact by fetch().
interface QldRow {
  dpc_lobbyistid: string | null;
  dpc_lobbyistname: string | null;
  dpc_tradingname: string | null;
  dpc_position: string | null;
  dpc_formerseniorgovernmentrepresentative: string | null;
  statecode: string | null;
  statuscode: string | null;
}

interface QldRaw {
  rows: QldRow[];
}

export const qldSource: Source = {
  jurisdiction: "qld",
  label: "Queensland",
  parserVersion: "0.1.0",
  ready: true,

  async fetch(): Promise<FetchResult> {
    const session = await bootstrapEntityList({ listPageUrl: LIST_PAGE });
    console.log(`  QLD: bootstrapped session, crawling list`);

    const records = await crawlGrid(session, {
      pageSize: 50,
      delayMs: envInt("QLD_DELAY_MS", DEFAULT_DELAY_MS),
      maxPages: envInt("QLD_MAX_PAGES", 0) || undefined,
      onPage: (page, res) => console.log(`  QLD: page ${page} (+${res.Records.length}, more=${res.MoreRecords})`),
    });
    console.log(`  QLD: ${records.length} lobbyist rows`);

    const rows: QldRow[] = records.map((rec) => {
      const f = flatten(rec);
      return {
        dpc_lobbyistid: f.dpc_lobbyistid ?? rec.Id,
        dpc_lobbyistname: f.dpc_lobbyistname ?? null,
        dpc_tradingname: f.dpc_tradingname ?? null,
        dpc_position: f.dpc_position ?? null,
        dpc_formerseniorgovernmentrepresentative: f.dpc_formerseniorgovernmentrepresentative ?? null,
        statecode: f.statecode ?? null,
        statuscode: f.statuscode ?? null,
      };
    });

    const raw: QldRaw = { rows };
    return { bytes: new TextEncoder().encode(JSON.stringify(raw)), contentType: "json", sourceUrl: LIST_PAGE };
  },

  async parse(raw: FetchResult): Promise<Lobbyist[]> {
    const { rows } = JSON.parse(new TextDecoder("utf-8").decode(raw.bytes)) as QldRaw;

    // Group person-rows into firms by trading name. Rows with no trading name
    // fall back to the person's own name (sole operators listed without one).
    const firms = new Map<string, QldRow[]>();
    for (const row of rows) {
      const firmName = normalise(row.dpc_tradingname) ?? normalise(row.dpc_lobbyistname);
      if (!firmName) continue;
      const list = firms.get(firmName) ?? [];
      list.push(row);
      firms.set(firmName, list);
    }

    const result: Lobbyist[] = [];
    for (const [firmName, group] of firms) {
      const people: Person[] = group
        .filter((r) => normalise(r.dpc_lobbyistname))
        .map((r) => ({
          name: normalise(r.dpc_lobbyistname)!,
          position: normalise(r.dpc_position),
          active: r.statecode == null ? null : r.statecode.toLowerCase() === "active",
          isFormerPublicOfficial: yesNo(r.dpc_formerseniorgovernmentrepresentative),
          formerRoleNotes: null,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

      result.push({
        jurisdiction: "qld",
        registrationId: slug(firmName),
        legalName: firmName,
        tradingName: null,
        abn: null, // not exposed on the QLD register
        status: firmStatus(group),
        onWatchlist: null,
        registeredAt: null,
        address: null,
        sourceUrl: LIST_PAGE,
        clients: [], // QLD publishes no firm<->client relationship; see header
        people,
        owners: [], // QLD has no owner concept distinct from listed people
      });
    }
    return result.sort((a, b) => a.registrationId.localeCompare(b.registrationId));
  },
};

// A firm is Approved if any of its people's registrations is; otherwise report
// the first status seen. (Rows within a firm share a status in practice.)
function firmStatus(group: QldRow[]): string | null {
  const statuses = group.map((r) => normalise(r.statuscode)).filter(Boolean) as string[];
  if (statuses.some((s) => /approv/i.test(s))) return "Approved";
  return statuses[0] ?? null;
}

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalise(value: string | null | undefined): string | null {
  if (value == null) return null;
  const t = value.replace(/\s+/g, " ").trim();
  return t === "" ? null : t;
}

function envInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (v == null || v.trim() === "") return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}
