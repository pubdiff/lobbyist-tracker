// NSW lobbyist register adapter.
//
// The NSW Electoral Commission maintains the Register of Third-Party Lobbyists
// under the Lobbying of Government Officials Act 2011. Despite the data.nsw.gov.au
// "dataset" implying a CSV download, the real register is a server-rendered
// Salesforce Visualforce app (behind Cloudflare):
//
//   https://lobbyists.elections.nsw.gov.au/whoisontheregister
//
// Data arrives in two tiers (see .notes/nsw-source.md for the full reverse-eng):
//
//   1. List page  - one GET. ~460 lobbyists across status-grouped tables
//      (tableSort2..5). Each row carries a stable 18-char Salesforce record id
//      (used as registrationId) plus legal name, ABN, trading name, watchlist
//      flag and status.
//   2. Per-lobbyist detail - one JSF/RichFaces Ajax POST per record, replaying
//      the page ViewState. Returns the clients (incl. foreign-principal flag +
//      country), employees and owners for that firm.
//
// fetch() does the whole crawl and serialises a single combined JSON artifact
// (list HTML + per-id detail HTML) so parse() stays pure and replayable from a
// saved raw file. Dev knobs: NSW_MAX_DETAILS caps the number of detail POSTs,
// NSW_DELAY_MS sets the inter-request delay (default 1500ms).

import type { Client, Lobbyist, Owner, Person } from "../schema.ts";
import type { FetchResult, Source } from "./types.ts";

const REGISTER_URL = "https://lobbyists.elections.nsw.gov.au/whoisontheregister";
// Human-facing landing page, used for the "View on source" link per record.
const LANDING_URL =
  "https://elections.nsw.gov.au/electoral-funding/public-register-and-lists/register-of-third-party-lobbyists";

// Identify ourselves transparently to the register.
const USER_AGENT =
  "Mozilla/5.0 (compatible; PubdiffBot/1.0; +https://pubdiff.github.io/lobbyist-tracker/)";

const DEFAULT_DELAY_MS = 1500;

// Shape of the combined raw artifact fetch() writes and parse() reads.
interface NswRaw {
  listHtml: string;
  details: Record<string, string>; // salesforceId -> detail partial HTML
}

export const nswSource: Source = {
  jurisdiction: "nsw",
  label: "NSW",
  parserVersion: "0.2.0",
  ready: true, // list + detail validated end-to-end against the live register

  async fetch(): Promise<FetchResult> {
    let session = await bootstrap();
    const listEntries = parseListRows(session.html);
    console.log(`  NSW: ${listEntries.length} lobbyists on list page`);

    const maxDetails = envInt("NSW_MAX_DETAILS", listEntries.length);
    const delayMs = envInt("NSW_DELAY_MS", DEFAULT_DELAY_MS);
    const targets = listEntries.slice(0, maxDetails);

    const details: Record<string, string> = {};
    let failures = 0;
    for (let i = 0; i < targets.length; i++) {
      const e = targets[i]!;
      try {
        details[e.id] = await fetchDetail(session, e.id, e.legalName);
      } catch (err) {
        // The ViewState is session-scoped; over ~460 POSTs it can expire. Re-bootstrap
        // once and retry this record before counting it a failure.
        try {
          console.warn(`  NSW detail ${e.id} failed (${msg(err)}); re-bootstrapping session`);
          session = await bootstrap();
          details[e.id] = await fetchDetail(session, e.id, e.legalName);
        } catch (err2) {
          failures++;
          console.warn(`  NSW detail ${e.id} (${e.legalName}) failed after retry: ${msg(err2)}`);
        }
      }
      if ((i + 1) % 50 === 0) console.log(`  NSW: fetched ${i + 1}/${targets.length} details`);
      if (i < targets.length - 1 && delayMs > 0) await sleep(delayMs);
    }
    if (failures > 0) console.warn(`  NSW: ${failures}/${targets.length} detail fetches failed`);

    const raw: NswRaw = { listHtml: session.html, details };
    const bytes = new TextEncoder().encode(JSON.stringify(raw));
    return { bytes, contentType: "json", sourceUrl: REGISTER_URL };
  },

  async parse(raw: FetchResult): Promise<Lobbyist[]> {
    const text = new TextDecoder("utf-8").decode(raw.bytes);
    const { listHtml, details } = JSON.parse(text) as NswRaw;
    const entries = parseListRows(listHtml);

    return entries
      .map((e): Lobbyist => {
        const detailHtml = details[e.id];
        const detail = detailHtml ? parseDetail(detailHtml) : { clients: [], people: [], owners: [] };
        return {
          jurisdiction: "nsw",
          registrationId: e.id,
          legalName: e.legalName,
          tradingName: e.tradingName,
          abn: e.abn,
          status: e.status,
          onWatchlist: e.onWatchlist,
          registeredAt: null, // NSW exposes per-record "Date Added" on clients/employees, not a firm registration date
          address: null,
          sourceUrl: LANDING_URL,
          clients: detail.clients,
          people: detail.people,
          owners: detail.owners,
        };
      })
      .sort((a, b) => a.registrationId.localeCompare(b.registrationId));
  },
};

// ---------------------------------------------------------------------------
// Session bootstrap + detail fetch
// ---------------------------------------------------------------------------

interface Session {
  html: string;
  cookieHeader: string;
  viewState: string;
  viewStateVersion: string;
  viewStateMac: string;
}

async function bootstrap(): Promise<Session> {
  const res = await fetch(REGISTER_URL, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html,*/*;q=0.1" },
  });
  if (!res.ok) {
    throw new Error(`NSW list fetch failed: ${res.status} ${res.statusText} (${REGISTER_URL})`);
  }
  const html = await res.text();
  const cookieHeader = parseSetCookie(res.headers);

  const viewState = hiddenInput(html, "com.salesforce.visualforce.ViewState");
  const viewStateVersion = hiddenInput(html, "com.salesforce.visualforce.ViewStateVersion");
  const viewStateMac = hiddenInput(html, "com.salesforce.visualforce.ViewStateMAC");
  if (!viewState) {
    throw new Error("NSW bootstrap: ViewState not found on list page (page structure changed?)");
  }
  return { html, cookieHeader, viewState, viewStateVersion, viewStateMac };
}

async function fetchDetail(session: Session, id: string, name: string): Promise<string> {
  // Replays the showLobbyDetails() A4J postback. The component ids (j_id0:j_id14*)
  // are stable Visualforce-generated names on this page.
  const body = new URLSearchParams({
    AJAXREQUEST: "_viewRoot",
    "j_id0:j_id14": "j_id0:j_id14",
    "j_id0:j_id14:j_id15": "j_id0:j_id14:j_id15",
    selectedLobbyistId: id,
    selectedLobbyistName: name,
    "com.salesforce.visualforce.ViewState": session.viewState,
    "com.salesforce.visualforce.ViewStateVersion": session.viewStateVersion,
    "com.salesforce.visualforce.ViewStateMAC": session.viewStateMac,
  });

  const res = await fetch(REGISTER_URL, {
    method: "POST",
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "*/*",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      Referer: REGISTER_URL,
      ...(session.cookieHeader ? { Cookie: session.cookieHeader } : {}),
    },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new Error(`detail POST ${res.status} ${res.statusText}`);
  }
  const text = await res.text();
  if (!text || !/lobTab[234]/.test(text)) {
    throw new Error("detail response missing detail tables (session expired?)");
  }
  return text;
}

// ---------------------------------------------------------------------------
// List parsing
// ---------------------------------------------------------------------------

interface ListEntry {
  id: string;
  legalName: string;
  abn: string | null;
  tradingName: string | null;
  onWatchlist: boolean | null;
  status: string | null;
}

function parseListRows(html: string): ListEntry[] {
  const entries: ListEntry[] = [];
  const seen = new Set<string>();
  // The status-grouped tables are tableSort2..N. Parse every tableSort table;
  // de-dup by id in case a firm appears in more than one.
  for (const table of extractTablesByIdPrefix(html, "tableSort")) {
    for (const row of tableRows(table)) {
      const cells = rowCells(row);
      if (cells.length < 5) continue;
      const trigger = /showLobbyDetails\('([^']+)',\s*'((?:[^'\\]|\\.)*)'\)/.exec(cells[0]!.html);
      if (!trigger) continue;
      const id = trigger[1]!;
      if (seen.has(id)) continue;
      seen.add(id);
      entries.push({
        id,
        legalName: text(cells[0]!.html),
        abn: normalise(text(cells[1]!.html)),
        tradingName: normalise(text(cells[2]!.html)),
        onWatchlist: parseYesNo(text(cells[3]!.html)) ?? parseChecked(cells[3]!.html),
        status: normalise(text(cells[4]!.html)),
      });
    }
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Detail parsing
// ---------------------------------------------------------------------------

interface Detail {
  clients: Client[];
  people: Person[];
  owners: Owner[];
}

function parseDetail(html: string): Detail {
  return {
    clients: parseClients(html),
    people: parseEmployees(html),
    owners: parseOwners(html),
  };
}

function parseClients(html: string): Client[] {
  const table = firstTableById(html, "lobTab2");
  if (!table) return [];
  const clients: Client[] = [];
  for (const row of dataRows(table)) {
    const c = rowCells(row);
    if (c.length < 6) continue;
    const name = text(c[0]!.html);
    if (name === "") continue;
    const countries = text(c[4]!.html)
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter((s) => s !== "");
    clients.push({
      name,
      abn: normalise(text(c[1]!.html)),
      isForeignPrincipal: parseYesNo(text(c[3]!.html)),
      countries,
      active: parseChecked(c[2]!.html),
      startDate: normaliseDate(text(c[5]!.html)),
      endDate: null,
      notes: null,
    });
  }
  return clients.sort((a, b) => a.name.localeCompare(b.name));
}

function parseEmployees(html: string): Person[] {
  const table = firstTableById(html, "lobTab3");
  if (!table) return [];
  const people: Person[] = [];
  for (const row of dataRows(table)) {
    const c = rowCells(row);
    if (c.length < 3) continue;
    const name = text(c[0]!.html);
    if (name === "") continue;
    people.push({
      name,
      position: normalise(text(c[1]!.html)),
      active: parseChecked(c[2]!.html),
      isFormerPublicOfficial: null,
      formerRoleNotes: null,
    });
  }
  return people.sort((a, b) => a.name.localeCompare(b.name));
}

function parseOwners(html: string): Owner[] {
  const table = firstTableById(html, "lobTab4");
  if (!table) return [];
  const owners: Owner[] = [];
  for (const row of dataRows(table)) {
    const c = rowCells(row);
    if (c.length < 2) continue;
    const name = text(c[0]!.html);
    if (name === "") continue;
    owners.push({ name, active: parseChecked(c[1]!.html) });
  }
  return owners.sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// HTML helpers - minimal table extraction tuned to this register's Visualforce
// output. Replace with a parser library only if NSW ships markup this can't
// handle.
// ---------------------------------------------------------------------------

function extractTablesByIdPrefix(html: string, prefix: string): string[] {
  const tables: string[] = [];
  const re = new RegExp(`<table[^>]*\\bid="${prefix}[^"]*"[^>]*>([\\s\\S]*?)</table>`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) tables.push(m[1]!);
  return tables;
}

function firstTableById(html: string, id: string): string | null {
  const re = new RegExp(`<table[^>]*\\bid="${id}"[^>]*>([\\s\\S]*?)</table>`, "i");
  const m = re.exec(html);
  return m ? m[1]! : null;
}

function tableRows(tableInner: string): string[] {
  const rows: string[] = [];
  const re = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tableInner)) !== null) rows.push(m[1]!);
  return rows;
}

// Rows containing data cells (<td>), skipping the header row (<th> only).
function dataRows(tableInner: string): string[] {
  return tableRows(tableInner).filter((r) => /<td[\s>]/i.test(r));
}

interface Cell {
  html: string;
}

function rowCells(rowInner: string): Cell[] {
  const cells: Cell[] = [];
  const re = /<td[^>]*>([\s\S]*?)<\/td>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rowInner)) !== null) cells.push({ html: m[1]! });
  return cells;
}

function text(cellHtml: string): string {
  return decodeEntities(cellHtml.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#160;|&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));
}

// Active/watchlist columns render as a checkbox image, not text.
function parseChecked(cellHtml: string): boolean | null {
  if (/checkbox_checked/i.test(cellHtml)) return true;
  if (/checkbox_unchecked/i.test(cellHtml)) return false;
  return null;
}

function parseYesNo(value: string): boolean | null {
  const v = value.trim().toLowerCase();
  if (v === "yes" || v === "true" || v === "y") return true;
  if (v === "no" || v === "false" || v === "n") return false;
  return null;
}

function normalise(value: string): string | null {
  const t = value.trim();
  return t === "" || t === "N/A" || t === "NA" ? null : t;
}

function normaliseDate(value: string): string | null {
  const s = normalise(value);
  if (s == null) return null;
  // NSW renders "dd/mm/yyyy h:mm AM/PM"; keep just the ISO date.
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    const [, d, mo, y] = m;
    return `${y}-${mo!.padStart(2, "0")}-${d!.padStart(2, "0")}`;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return s;
}

function hiddenInput(html: string, name: string): string {
  const re = new RegExp(`<input[^>]*name="${escapeRe(name)}"[^>]*value="([^"]*)"`, "i");
  const m = re.exec(html);
  return m ? m[1]! : "";
}

function parseSetCookie(headers: Headers): string {
  // Node's fetch exposes combined set-cookie via getSetCookie(); fall back to the
  // single header. We only need the cookie name=value pairs for the POST.
  const getSetCookie = (headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
  const raw = getSetCookie ? getSetCookie.call(headers) : [headers.get("set-cookie") ?? ""];
  return raw
    .filter(Boolean)
    .map((c) => c.split(";", 1)[0]!.trim())
    .filter((c) => c.includes("="))
    .join("; ");
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
