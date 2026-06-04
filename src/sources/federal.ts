// Federal lobbyist register adapter (Australian Government Register of Lobbyists).
//
// Run by the Attorney-General's Department at https://lobbyists.ag.gov.au. Unlike
// NSW (a server-rendered Salesforce page), the federal register is an Angular SPA
// backed by a clean public JSON API at https://api.lobbyists.ag.gov.au - no auth,
// no recaptcha for read access. Two endpoints carry everything we need:
//
//   GET statistics/lobbyists                     -> every current org with a stable
//                                                   organisationId (used as registrationId).
//   GET search/organisations/{id}/profile        -> that org's current summary + clients,
//                                                   lobbyists (employees) and stakeholders
//                                                   (owners). (The history/organisations/{id}
//                                                   endpoint, by contrast, returns only
//                                                   deregistered historical associations.)
//
// fetch() pulls the org list then one detail call per org, serialising a single
// combined JSON artifact so parse() stays pure and replayable. Dev knobs:
// FED_MAX_DETAILS caps detail calls, FED_DELAY_MS sets pacing (default 300ms).
//
// Federal does not expose a watchlist or a foreign-principal flag (those are
// NSW-specific), so onWatchlist and Client.isForeignPrincipal are null here. It
// does expose something NSW doesn't: whether an employee is a former government
// representative (isFormerRepresentative), mapped to Person.isFormerPublicOfficial.

import type { Client, Lobbyist, Owner, Person } from "../schema.ts";
import type { FetchResult, Source } from "./types.ts";

const API_BASE = "https://api.lobbyists.ag.gov.au/";
const LANDING_URL = "https://lobbyists.ag.gov.au/register";

const USER_AGENT =
  "Mozilla/5.0 (compatible; PubdiffBot/1.0; +https://pubdiff.github.io/lobbyist-tracker/)";

const DEFAULT_DELAY_MS = 300;

// ---- API response shapes (only the fields we read) ----

interface StatsResponse {
  data: { organisationId: string; displayName: string }[];
}

interface OrgDetail {
  summary: {
    id: string;
    displayName: string;
    tradingName: string | null;
    abn: string | null;
    registeredOn: string | null;
    dateDeregistered: string | null;
    isDeregistered: boolean;
  } | null;
  clients: ApiClient[];
  lobbyists: ApiLobbyist[];
  stakeholders: ApiStakeholder[];
}

interface ApiClient {
  displayName: string;
  abn: string | null;
  clientNotes: string | null;
  datePublished: string | null;
  dateDeregistered: string | null;
}

interface ApiLobbyist {
  displayName: string;
  position: string | null;
  isFormerRepresentative: boolean | null;
  previousPosition: string | null;
  previousPositionOther: string | null;
  dateDeregistered: string | null;
}

interface ApiStakeholder {
  // The profile endpoint leaves displayName null for stakeholders and carries the
  // name across firstName/lastName (individuals) or businessName (entities).
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  businessName: string | null;
  dateDeregistered: string | null;
  isDeregistered: boolean | null;
}

// Combined raw artifact fetch() writes and parse() reads.
interface FederalRaw {
  details: Record<string, OrgDetail>; // organisationId -> detail
}

export const federalSource: Source = {
  jurisdiction: "federal",
  label: "Federal",
  parserVersion: "0.1.0",
  ready: true,

  async fetch(): Promise<FetchResult> {
    const stats = await getJSON<StatsResponse>("statistics/lobbyists");
    const orgIds = stats.data.map((d) => d.organisationId);
    console.log(`  Federal: ${orgIds.length} organisations`);

    const maxDetails = envInt("FED_MAX_DETAILS", orgIds.length);
    const delayMs = envInt("FED_DELAY_MS", DEFAULT_DELAY_MS);
    const targets = orgIds.slice(0, maxDetails);

    const details: Record<string, OrgDetail> = {};
    let failures = 0;
    for (let i = 0; i < targets.length; i++) {
      const id = targets[i]!;
      try {
        details[id] = await getJSON<OrgDetail>(`search/organisations/${id}/profile`);
      } catch (err) {
        failures++;
        console.warn(`  Federal detail ${id} failed: ${msg(err)}`);
      }
      if ((i + 1) % 50 === 0) console.log(`  Federal: fetched ${i + 1}/${targets.length} details`);
      if (i < targets.length - 1 && delayMs > 0) await sleep(delayMs);
    }
    if (failures > 0) console.warn(`  Federal: ${failures}/${targets.length} detail fetches failed`);

    const raw: FederalRaw = { details };
    return { bytes: new TextEncoder().encode(JSON.stringify(raw)), contentType: "json", sourceUrl: LANDING_URL };
  },

  async parse(raw: FetchResult): Promise<Lobbyist[]> {
    const { details } = JSON.parse(new TextDecoder("utf-8").decode(raw.bytes)) as FederalRaw;

    const result: Lobbyist[] = [];
    for (const [organisationId, detail] of Object.entries(details)) {
      const s = detail.summary;
      if (!s) continue;
      // Snapshot reflects the register's current state: only entries that haven't
      // been deregistered. The API keeps deregistered history; we filter it so
      // diff added/removed semantics stay meaningful. (NSW, by contrast, lists
      // historical clients inline, so it keeps them with active=false.)
      const clients: Client[] = detail.clients
        .filter((c) => c.dateDeregistered == null)
        .map((c) => ({
          name: c.displayName,
          abn: normaliseAbn(c.abn),
          isForeignPrincipal: null,
          countries: [],
          active: true,
          startDate: isoDateOf(c.datePublished),
          endDate: null,
          notes: normalise(c.clientNotes),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

      const people: Person[] = detail.lobbyists
        .filter((l) => l.dateDeregistered == null)
        .map((l) => ({
          name: l.displayName,
          position: normalise(l.position),
          active: true,
          isFormerPublicOfficial: l.isFormerRepresentative ?? null,
          formerRoleNotes: normalise(l.previousPosition) ?? normalise(l.previousPositionOther),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

      const owners: Owner[] = detail.stakeholders
        .filter((st) => st.dateDeregistered == null && st.isDeregistered !== true)
        .map((st) => ({ name: stakeholderName(st), active: true }))
        .filter((o) => o.name !== "")
        .sort((a, b) => a.name.localeCompare(b.name));

      result.push({
        jurisdiction: "federal",
        registrationId: organisationId,
        legalName: s.displayName,
        tradingName: normalise(s.tradingName),
        abn: normaliseAbn(s.abn),
        status: s.isDeregistered ? "Deregistered" : "Registered",
        onWatchlist: null,
        registeredAt: isoDateOf(s.registeredOn),
        address: null,
        sourceUrl: LANDING_URL,
        clients,
        people,
        owners,
      });
    }
    return result.sort((a, b) => a.registrationId.localeCompare(b.registrationId));
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(API_BASE + path, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json", Referer: LANDING_URL },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} on ${path}`);
  return (await res.json()) as T;
}

function stakeholderName(st: ApiStakeholder): string {
  if (st.businessName && st.businessName.trim() !== "") return st.businessName.trim();
  const full = `${st.firstName ?? ""} ${st.lastName ?? ""}`.replace(/\s+/g, " ").trim();
  if (full !== "") return full;
  return (st.displayName ?? "").trim();
}

function isoDateOf(value: string | null): string | null {
  if (!value) return null;
  const m = value.match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : null;
}

function normaliseAbn(value: string | null): string | null {
  const s = normalise(value);
  return s ? s.replace(/\s+/g, "") : null;
}

function normalise(value: string | null | undefined): string | null {
  if (value == null) return null;
  const t = value.trim();
  return t === "" ? null : t;
}

function envInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (v == null || v.trim() === "") return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
