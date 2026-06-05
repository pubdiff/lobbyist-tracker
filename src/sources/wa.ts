// Western Australian lobbyist register adapter (Public Sector Commission).
// https://www.lobbyists.wa.gov.au
//
// WA is a Microsoft Power Apps / Dynamics portal, like QLD and the sibling
// epbc-tracker. Unlike QLD's list (a replayable entity-grid-data.json grid), WA
// renders its firm list client-side and exposes per-firm detail pages at
// /searchdetails/?id=<accountId>. Each detail page's three subgrids
// (Lobbyist Details = people, Owner Details = owners, Client Details = clients)
// load via /_services/entity-subgrid-data.json, whose secure config bakes in the
// parent firm id per page render, so they cannot be replayed generically. We
// therefore drive a headless browser: render the list to enumerate firms, then
// render each firm's detail page and read its rendered sections. See src/portal/.
//
// WA exposes firm Name + ABN and the three relationships. It surfaces no
// watchlist or foreign-principal flag (NSW-specific), and the firm-level detail
// does not expose a per-person former-government-representative flag, so
// Person.isFormerPublicOfficial is null here. See .notes/wa-source.md.
//
// Dev knobs: WA_MAX_DETAILS caps firms, WA_DELAY_MS sets pacing (default 800ms).

import type { Client, Lobbyist, Owner, Person } from "../schema.ts";
import type { FetchResult, Source } from "./types.ts";
import {
  attr,
  installNameShim,
  launchBrowser,
  newPortalContext,
  type PortalRecord,
  type PwContext,
} from "../portal/index.ts";

const HOST = "https://www.lobbyists.wa.gov.au";
const LIST_PAGE = `${HOST}/`;

const DEFAULT_DELAY_MS = 800;
const NAV_TIMEOUT = 60_000;
const RENDER_WAIT_MS = 5000;

interface WaFirmRaw {
  id: string;
  listName: string; // firm name as shown in the list
  name: string | null; // firm name from the detail Company section
  abn: string | null;
  people: string[];
  owners: string[];
  clients: string[];
}

interface WaRaw {
  firms: WaFirmRaw[];
}

export const waSource: Source = {
  jurisdiction: "wa",
  label: "Western Australia",
  parserVersion: "0.1.0",
  ready: true,

  async fetch(): Promise<FetchResult> {
    const delayMs = envInt("WA_DELAY_MS", DEFAULT_DELAY_MS);
    const browser = await launchBrowser();
    try {
      const ctx = await newPortalContext(browser);

      const listing = await enumerateFirms(ctx);
      console.log(`  WA: ${listing.length} firms in list`);

      const maxDetails = envInt("WA_MAX_DETAILS", listing.length) || listing.length;
      const targets = listing.slice(0, maxDetails);

      const firms: WaFirmRaw[] = [];
      let failures = 0;
      for (let i = 0; i < targets.length; i++) {
        const f = targets[i]!;
        try {
          firms.push(await scrapeFirm(ctx, f.id, f.name));
        } catch (err) {
          failures++;
          console.warn(`  WA firm ${f.id} failed: ${msg(err)}`);
        }
        if ((i + 1) % 25 === 0) console.log(`  WA: scraped ${i + 1}/${targets.length} firms`);
        if (i < targets.length - 1 && delayMs > 0) await sleep(delayMs);
      }
      if (failures > 0) console.warn(`  WA: ${failures}/${targets.length} firm fetches failed`);

      const raw: WaRaw = { firms };
      return { bytes: new TextEncoder().encode(JSON.stringify(raw)), contentType: "json", sourceUrl: LIST_PAGE };
    } finally {
      await browser.close();
    }
  },

  async parse(raw: FetchResult): Promise<Lobbyist[]> {
    const { firms } = JSON.parse(new TextDecoder("utf-8").decode(raw.bytes)) as WaRaw;

    const result: Lobbyist[] = [];
    for (const f of firms) {
      const legalName = normalise(f.name) ?? normalise(f.listName);
      if (!legalName) continue;

      const people: Person[] = uniqueSorted(f.people).map((name) => ({
        name,
        position: null,
        active: true,
        isFormerPublicOfficial: null, // not exposed at WA's firm-detail level
        formerRoleNotes: null,
      }));

      const owners: Owner[] = uniqueSorted(f.owners).map((name) => ({ name, active: true as boolean | null }));

      const clients: Client[] = uniqueSorted(f.clients).map((name) => ({
        name,
        abn: null,
        isForeignPrincipal: null,
        countries: [],
        active: true,
        startDate: null,
        endDate: null,
        notes: null,
      }));

      result.push({
        jurisdiction: "wa",
        registrationId: f.id,
        legalName,
        tradingName: null,
        abn: normaliseAbn(f.abn),
        status: null, // WA's public detail does not expose a status field
        onWatchlist: null,
        registeredAt: null,
        address: null,
        sourceUrl: `${HOST}/searchdetails/?id=${f.id}`,
        clients,
        people,
        owners,
      });
    }
    return result.sort((a, b) => a.registrationId.localeCompare(b.registrationId));
  },
};

// ---------------------------------------------------------------------------
// Browser scraping
// ---------------------------------------------------------------------------

// Render the list page and collect every firm's detail id + display name,
// following pagination if the entitylist exposes a next-page control.
async function enumerateFirms(ctx: PwContext): Promise<Array<{ id: string; name: string }>> {
  const page = await ctx.newPage();
  try {
    await installNameShim(page);
    const seen = new Map<string, string>();
    await page.goto(LIST_PAGE, { waitUntil: "networkidle", timeout: NAV_TIMEOUT });
    await page.waitForTimeout(RENDER_WAIT_MS);

    const maxPages = envInt("WA_MAX_LIST_PAGES", 50);
    for (let p = 0; p < maxPages; p++) {
      const links = await page.evaluate(() =>
        [...document.querySelectorAll("a[href*='searchdetails']")].map((a) => ({
          href: (a as HTMLAnchorElement).getAttribute("href") || "",
          name: (a as HTMLElement).innerText.replace(/\s+/g, " ").trim(),
        })),
      );
      const before = seen.size;
      for (const l of links) {
        const m = l.href.match(/id=([0-9a-f-]+)/i);
        if (m && !seen.has(m[1]!)) seen.set(m[1]!, l.name);
      }
      // Try to advance to the next page; stop when there's no next or nothing new.
      const advanced = await page.evaluate(() => {
        const next = document.querySelector<HTMLAnchorElement>(
          "li.next:not(.disabled) a, a[rel='next'], a[aria-label*='Next' i]:not([aria-disabled='true'])",
        );
        if (!next) return false;
        next.click();
        return true;
      });
      if (!advanced) break;
      await page.waitForTimeout(RENDER_WAIT_MS);
      if (seen.size === before) break;
    }
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  } finally {
    await page.close();
  }
}

// Render a firm's detail page and read the Company fields + the three subgrids.
async function scrapeFirm(ctx: PwContext, id: string, listName: string): Promise<WaFirmRaw> {
  const page = await ctx.newPage();
  try {
    await installNameShim(page);

    // The three detail subgrids load via /_services/entity-subgrid-data.json,
    // returning clean CRM records (psc_lobbyist = people, psc_owner = owners,
    // psc_client = clients). Reading these structured responses is far more
    // robust than scraping the rendered data-grid markup (which interleaves the
    // column header and a responsive duplicate row into each cell).
    const byEntity = new Map<string, PortalRecord[]>();
    page.on("response", (res) => {
      if (!res.url().includes("entity-subgrid-data.json")) return;
      void res.text().then((txt) => {
        try {
          const j = JSON.parse(txt) as { Records?: PortalRecord[] };
          for (const rec of j.Records ?? []) {
            const list = byEntity.get(rec.EntityName) ?? [];
            list.push(rec);
            byEntity.set(rec.EntityName, list);
          }
        } catch {
          /* ignore non-JSON / partial bodies */
        }
      });
    });

    await page.goto(`${HOST}/searchdetails/?id=${id}`, { waitUntil: "networkidle", timeout: NAV_TIMEOUT });
    await page.waitForTimeout(RENDER_WAIT_MS);

    const abn = await page.evaluate(() => {
      const clean = (s: string | null | undefined) => (s || "").replace(/\s+/g, " ").trim();
      const ctrl = document.querySelector("[data-name='psc_abn'] .control, .psc_abn .control, #psc_abn");
      const v = clean((ctrl as HTMLElement | null)?.innerText) || clean((ctrl as HTMLInputElement | null)?.value);
      return v || null;
    });

    return {
      id,
      listName,
      name: listName || null, // the list name is the firm's registered name
      abn: abn ?? null,
      people: recordNames(byEntity.get("psc_lobbyist")),
      owners: recordNames(byEntity.get("psc_owner")),
      clients: recordNames(byEntity.get("psc_client")),
    };
  } finally {
    await page.close();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Pull the display name from each subgrid record. The "Name" column maps to the
// psc_name attribute on all three WA entities; fall back to any non-id name-ish
// attribute that isn't a GUID.
function recordNames(records: PortalRecord[] | undefined): string[] {
  if (!records) return [];
  const out: string[] = [];
  for (const rec of records) {
    const name =
      attr(rec, "psc_name") ??
      rec.Attributes.map((a) => a.Name)
        .filter((n) => /name$/i.test(n) && !/id$/i.test(n))
        .map((n) => attr(rec, n))
        .find((v) => v && !/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(v)) ??
      null;
    if (name) out.push(name);
  }
  return out;
}

function uniqueSorted(values: string[]): string[] {
  const set = new Set(values.map((v) => v.replace(/\s+/g, " ").trim()).filter(Boolean));
  return [...set].sort((a, b) => a.localeCompare(b));
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
