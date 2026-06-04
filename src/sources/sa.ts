// South Australian lobbyist register adapter (SA Register of Lobbyists).
//
// Administered under the Lobbyists Act 2015 (moved to the Attorney-General's
// Department in July 2024). The public site at https://www.lobbyists.sa.gov.au
// is a React single-page app backed by a clean, unauthenticated REST API at
// https://saglobbyistapi02prdaue.azurewebsites.net/api - the same shape of
// problem as the federal register, not a scrape. Endpoints used (all public GET):
//
//   GET /lobbyist                       -> every firm (summary + StatusCode).
//   GET /lobbyist/{id}                  -> firm detail (ABN, trading name, owner
//                                          details, address, responsible officer).
//   GET /employee?lobbyistId={id}       -> the firm's people (current + former),
//                                          with a lobbying Restriction field.
//   GET /client?lobbyistId={id}         -> the firm's clients (current + former).
//
// Responses are .NET JSON using the {"$id","$values":[...]} envelope for arrays;
// listOf() unwraps it. fetch() pulls the list then the three detail calls per
// firm, serialising one combined artifact so parse() stays pure. Dev knobs:
// SA_MAX_DETAILS caps firms, SA_DELAY_MS sets pacing (default 150ms).
//
// SA exposes no watchlist or foreign-principal flag (NSW-specific). It does flag
// former senior government representatives the way federal and VIC do: an
// employee carrying the "Section 13(1)(b) of the Lobbyists Act" restriction is a
// former public official, mapped to Person.isFormerPublicOfficial. Owners are a
// comma-separated free-text field (OwnerDetails) split into names.

import type { Client, Lobbyist, Owner, Person } from "../schema.ts";
import type { FetchResult, Source } from "./types.ts";

const API_BASE = "https://saglobbyistapi02prdaue.azurewebsites.net/api/";
const LANDING_URL = "https://www.lobbyists.sa.gov.au/";

const USER_AGENT =
  "Mozilla/5.0 (compatible; PubdiffBot/1.0; +https://pubdiff.github.io/lobbyist-tracker/)";

const DEFAULT_DELAY_MS = 150;

// ---- API response shapes (only the fields we read) ----

interface SaListItem {
  LobbyistId: number;
  StatusCode: string | null;
}

interface SaDetail {
  LobbyistId: number;
  BusinessName: string | null;
  Abn: string | null;
  TradingName: string | null;
  OwnerDetails: string | null;
  Address: string | null;
  Suburb: string | null;
  State: string | null;
  PostCode: string | null;
  StatusCode: string | null;
  RedactedDetails: string | null;
}

interface SaEmployee {
  Name: string | null;
  Position: string | null;
  Restriction: string | null;
  OtherRestrictionDetails: string | null;
  StartDate: string | null;
  EndDate: string | null;
}

interface SaClient {
  Name: string | null;
  StartDate: string | null;
  EndDate: string | null;
}

interface SaFirmRaw {
  detail: SaDetail;
  employees: SaEmployee[];
  clients: SaClient[];
}

// Combined raw artifact fetch() writes and parse() reads.
interface SaRaw {
  firms: Record<string, SaFirmRaw>; // LobbyistId -> firm bundle
}

export const saSource: Source = {
  jurisdiction: "sa",
  label: "South Australia",
  parserVersion: "0.1.0",
  ready: true,

  async fetch(): Promise<FetchResult> {
    const list = listOf<SaListItem>(await getJSON("lobbyist"));
    const ids = list.map((x) => x.LobbyistId).filter((id) => id != null);
    console.log(`  SA: ${ids.length} lobbyists`);

    const maxDetails = envInt("SA_MAX_DETAILS", ids.length);
    const delayMs = envInt("SA_DELAY_MS", DEFAULT_DELAY_MS);
    const targets = ids.slice(0, maxDetails);

    const firms: Record<string, SaFirmRaw> = {};
    let failures = 0;
    for (let i = 0; i < targets.length; i++) {
      const id = targets[i]!;
      try {
        const detail = (await getJSON(`lobbyist/${id}`)) as SaDetail;
        const employees = listOf<SaEmployee>(await getJSON(`employee?lobbyistId=${id}`));
        const clients = listOf<SaClient>(await getJSON(`client?lobbyistId=${id}`));
        firms[String(id)] = { detail, employees, clients };
      } catch (err) {
        failures++;
        console.warn(`  SA lobbyist ${id} failed: ${msg(err)}`);
      }
      if ((i + 1) % 50 === 0) console.log(`  SA: fetched ${i + 1}/${targets.length}`);
      if (i < targets.length - 1 && delayMs > 0) await sleep(delayMs);
    }
    if (failures > 0) console.warn(`  SA: ${failures}/${targets.length} fetches failed`);

    const raw: SaRaw = { firms };
    return { bytes: new TextEncoder().encode(JSON.stringify(raw)), contentType: "json", sourceUrl: LANDING_URL };
  },

  async parse(raw: FetchResult): Promise<Lobbyist[]> {
    const { firms } = JSON.parse(new TextDecoder("utf-8").decode(raw.bytes)) as SaRaw;

    const result: Lobbyist[] = [];
    for (const [id, firm] of Object.entries(firms)) {
      const d = firm.detail;
      if (!d || !d.BusinessName) continue;

      const clients: Client[] = firm.clients
        .filter((c) => c.Name)
        .map((c) => ({
          name: c.Name!.trim(),
          abn: null,
          isForeignPrincipal: null,
          countries: [],
          active: c.EndDate == null,
          startDate: isoDateOf(c.StartDate),
          endDate: isoDateOf(c.EndDate),
          notes: null,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

      const people: Person[] = firm.employees
        .filter((e) => e.Name && e.Name.trim() !== "")
        .map((e) => ({
          name: e.Name!.trim(),
          position: normalise(e.Position),
          active: e.EndDate == null,
          isFormerPublicOfficial: formerOfficial(e.Restriction),
          formerRoleNotes: formerRoleNotes(e.Restriction, e.OtherRestrictionDetails),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

      const owners: Owner[] = splitOwners(d.OwnerDetails)
        .map((name) => ({ name, active: true as boolean | null }))
        .sort((a, b) => a.name.localeCompare(b.name));

      result.push({
        jurisdiction: "sa",
        registrationId: id,
        legalName: d.BusinessName.trim(),
        tradingName: tradingNameOf(d.TradingName, d.BusinessName),
        abn: normaliseAbn(d.Abn),
        status: mapStatus(d.StatusCode),
        onWatchlist: null,
        registeredAt: null, // the API exposes no registration date
        address: composeAddress(d),
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
// Mapping helpers
// ---------------------------------------------------------------------------

// SA's former-senior-government-representative flag is the s13(1)(b) restriction
// under the Lobbyists Act. "None" means no restriction; "" means unspecified;
// other restrictions (e.g. "Other - Not performing lobbying") are not a
// former-official signal.
function formerOfficial(restriction: string | null): boolean | null {
  const r = (restriction ?? "").trim();
  if (r === "") return null;
  if (/13\s*\(1\)\s*\(b\)/.test(r) || /former/i.test(r)) return true;
  return false;
}

function formerRoleNotes(restriction: string | null, other: string | null): string | null {
  if (formerOfficial(restriction) !== true) return null;
  const base = normalise(restriction);
  const extra = normalise(other);
  return extra ? `${base} - ${extra}` : base;
}

// OwnerDetails is a free-text, comma-separated list of owner names
// (e.g. "Daniel Hoare, Dina Hoare").
function splitOwners(ownerDetails: string | null): string[] {
  const s = normalise(ownerDetails);
  if (!s) return [];
  return s
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p !== "");
}

function mapStatus(code: string | null): string | null {
  switch (code) {
    case "STATUS_APPROVED":
      return "Registered";
    case "STATUS_SURRENDERED":
      return "Surrendered";
    default:
      return code ? code.replace(/^STATUS_/, "") : null;
  }
}

function tradingNameOf(trading: string | null, legal: string): string | null {
  const t = normalise(trading);
  return t && t !== legal.trim() ? t : null;
}

function composeAddress(d: SaDetail): string | null {
  const parts = [d.Address, d.Suburb, d.State, d.PostCode].map((p) => normalise(p)).filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

// ---------------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------------

// .NET arrays arrive as {"$id":"1","$values":[...]}; objects keep their fields.
function listOf<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === "object" && Array.isArray((value as { $values?: unknown }).$values)) {
    return (value as { $values: T[] }).$values;
  }
  return [];
}

async function getJSON(path: string): Promise<unknown> {
  const res = await fetch(API_BASE + path, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json", Referer: LANDING_URL },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} on ${path}`);
  return await res.json();
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
  const t = value.replace(/\s+/g, " ").trim();
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
