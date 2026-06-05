// Victorian lobbyist register adapter (Victorian Register of Lobbyists).
//
// Run by the Victorian Public Sector Commission at https://www.lobbyists.vic.gov.au.
// Unlike NSW (Salesforce) and federal (a JSON API), VIC is a server-rendered
// Drupal site. Two tiers, both plain GETs:
//
//   GET /sitemap.xml                          -> every firm page URL
//                                                (/search-the-register/<slug>) with a
//                                                lastmod. The slug is stable and used
//                                                as the registrationId.
//   GET /search-the-register/<slug>           -> that firm's server-rendered detail page:
//                                                official entity name, ABN, registration
//                                                status + date, owners, employees and
//                                                clients (current and former).
//
// The on-site search is a Drupal View loaded over AJAX with no clean JSON
// endpoint, so the sitemap is the enumeration path: it lists every firm page
// directly, no view-state replay needed.
//
// fetch() reads the sitemap then one GET per firm, serialising a single combined
// JSON artifact so parse() stays pure and replayable. Dev knobs: VIC_MAX_DETAILS
// caps firm fetches, VIC_DELAY_MS sets pacing (default 1000ms).
//
// VIC exposes no watchlist and no foreign-principal flag (NSW-specific), so
// onWatchlist and Client.isForeignPrincipal are null here. Like federal, it
// discloses former government roles: each employee may carry a former-role
// statement (e.g. "A chief of staff... in the private office of a Commonwealth
// or state minister"), mapped to Person.isFormerPublicOfficial + formerRoleNotes.

import type { Client, Lobbyist, Owner, Person } from "../schema.ts";
import type { FetchResult, Source } from "./types.ts";

const REGISTER_BASE = "https://www.lobbyists.vic.gov.au";
const SITEMAP_URL = `${REGISTER_BASE}/sitemap.xml`;
const LANDING_URL = `${REGISTER_BASE}/lobbyists-and-government-affairs-directors-register`;
const FIRM_PATH = "/search-the-register/";

const USER_AGENT =
  "Mozilla/5.0 (compatible; PubdiffBot/1.0; +https://pubdiff.github.io/lobbyist-tracker/)";

const DEFAULT_DELAY_MS = 1000;

// Combined raw artifact fetch() writes and parse() reads: firm slug -> page HTML.
interface VicRaw {
  firms: Record<string, string>;
}

export const vicSource: Source = {
  jurisdiction: "vic",
  label: "Victoria",
  parserVersion: "0.1.0",
  ready: true,

  async fetch(): Promise<FetchResult> {
    const sitemap = await getText(SITEMAP_URL);
    const slugs = extractFirmSlugs(sitemap);
    console.log(`  VIC: ${slugs.length} firm pages in sitemap`);

    const maxDetails = envInt("VIC_MAX_DETAILS", slugs.length);
    const delayMs = envInt("VIC_DELAY_MS", DEFAULT_DELAY_MS);
    const targets = slugs.slice(0, maxDetails);

    const firms: Record<string, string> = {};
    let failures = 0;
    for (let i = 0; i < targets.length; i++) {
      const slug = targets[i]!;
      try {
        firms[slug] = await getText(`${REGISTER_BASE}${FIRM_PATH}${slug}`);
      } catch (err) {
        failures++;
        console.warn(`  VIC firm ${slug} failed: ${msg(err)}`);
      }
      if ((i + 1) % 50 === 0) console.log(`  VIC: fetched ${i + 1}/${targets.length} firms`);
      if (i < targets.length - 1 && delayMs > 0) await sleep(delayMs);
    }
    if (failures > 0) console.warn(`  VIC: ${failures}/${targets.length} firm fetches failed`);

    const raw: VicRaw = { firms };
    return { bytes: new TextEncoder().encode(JSON.stringify(raw)), contentType: "json", sourceUrl: LANDING_URL };
  },

  async parse(raw: FetchResult): Promise<Lobbyist[]> {
    const { firms } = JSON.parse(new TextDecoder("utf-8").decode(raw.bytes)) as VicRaw;

    const result: Lobbyist[] = [];
    for (const [slug, html] of Object.entries(firms)) {
      const legalName = pAfterH3(html, "Official entity name");
      if (!legalName) continue; // not a firm page (defensive)

      const displayName = titleDisplayName(html);
      const tradingName = displayName && displayName !== legalName ? displayName : null;

      const reg = parseRegistration(html);

      result.push({
        jurisdiction: "vic",
        registrationId: slug,
        legalName,
        tradingName,
        abn: normaliseAbn(pAfterH3(html, "Australian Business Number (ABN)")),
        status: reg.status,
        onWatchlist: null,
        registeredAt: reg.registeredAt,
        address: null,
        sourceUrl: `${REGISTER_BASE}${FIRM_PATH}${slug}`,
        clients: parseClients(html),
        people: parseEmployees(html),
        owners: parseOwners(html),
      });
    }
    return result.sort((a, b) => a.registrationId.localeCompare(b.registrationId));
  },
};

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

// Drupal field machine names that wrap each section. Stable across the site.
const SECTION_MARKERS = [
  "field--name-field-owners",
  "field--name-field-employees",
  "field--name-field-clients",
];

function extractFirmSlugs(sitemapXml: string): string[] {
  const slugs = new Set<string>();
  const re = /\/search-the-register\/([a-z0-9-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sitemapXml)) !== null) slugs.add(m[1]!);
  return [...slugs].sort();
}

function titleDisplayName(html: string): string | null {
  const m = html.match(/<title>([^<]*)<\/title>/i);
  if (!m) return null;
  // "TG Public Affairs | lobbyists.vic.gov.au" -> "TG Public Affairs"
  return normalise(decodeEntities(m[1]!.split("|")[0]!));
}

// Find `<h3>LABEL</h3>` then the text of the following `<p>`.
function pAfterH3(html: string, label: string): string | null {
  const h3 = html.indexOf(`<h3>${label}</h3>`);
  if (h3 < 0) return null;
  const m = html.slice(h3).match(/<p>([\s\S]*?)<\/p>/);
  return m ? normalise(decodeEntities(stripTags(m[1]!))) : null;
}

// The Registration <p> is: "Registered <time datetime="2019-03-18...">18 Mar 2019</time>".
// Status is the text before the <time>; registeredAt is that time's date.
function parseRegistration(html: string): { status: string | null; registeredAt: string | null } {
  const h3 = html.indexOf("<h3>Registration</h3>");
  if (h3 < 0) return { status: null, registeredAt: null };
  const m = html.slice(h3).match(/<p>([\s\S]*?)<\/p>/);
  if (!m) return { status: null, registeredAt: null };
  const block = m[1]!;
  const status = normalise(decodeEntities(stripTags(block.split("<time")[0]!)));
  const t = block.match(/<time[^>]*datetime="(\d{4}-\d{2}-\d{2})/);
  return { status, registeredAt: t ? t[1]! : null };
}

function parseOwners(html: string): Owner[] {
  const section = sliceSection(html, "field--name-field-owners");
  if (!section) return [];
  return articleNames(section)
    .map((name) => ({ name, active: true as boolean | null }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function parseEmployees(html: string): Person[] {
  const section = sliceSection(html, "field--name-field-employees");
  if (!section) return [];
  const people: Person[] = [];
  for (const block of articleBlocks(section)) {
    const name = fieldText(block, "field--name-label");
    if (!name) continue;
    const position = fieldText(block, "field--name-field-contact-title");
    // The former-government-role disclosure is a bare <p> inside the article,
    // distinct from the job title (which sits in field-contact-title).
    const note = normalise(decodeEntities(stripTags(firstBareParagraph(block) ?? "")));
    people.push({
      name,
      position,
      active: true,
      isFormerPublicOfficial: note ? true : null,
      formerRoleNotes: note,
    });
  }
  return people.sort((a, b) => a.name.localeCompare(b.name));
}

function parseClients(html: string): Client[] {
  const section = sliceSection(html, "field--name-field-clients");
  if (!section) return [];
  const clients: Client[] = [];
  for (const block of articleBlocks(section)) {
    const name = fieldText(block, "field--name-label");
    if (!name) continue;
    const isFormer = block.includes("field--name-field-date-removed");
    clients.push({
      name,
      abn: null,
      isForeignPrincipal: null,
      countries: [],
      active: !isFormer,
      startDate: dateAfterField(block, "field--name-field-date-added"),
      endDate: dateAfterField(block, "field--name-field-date-removed"),
      notes: null,
    });
  }
  return clients.sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// HTML helpers
// ---------------------------------------------------------------------------

// Slice from a section's field-container marker to the next section marker
// (or end of document). Returns null if the section isn't present.
function sliceSection(html: string, marker: string): string | null {
  const start = html.indexOf(marker);
  if (start < 0) return null;
  let end = html.length;
  for (const other of SECTION_MARKERS) {
    if (other === marker) continue;
    const idx = html.indexOf(other, start + marker.length);
    if (idx >= 0 && idx < end) end = idx;
  }
  return html.slice(start, end);
}

// Each item in a section is wrapped in an <article>. Return the inner markup of
// each, dropping the pre-first-article preamble (intro paragraphs, headings).
function articleBlocks(section: string): string[] {
  return section
    .split(/<article\b[^>]*>/)
    .slice(1)
    .map((piece) => piece.split("</article>")[0]!);
}

// Names of every article in a section (used where only the name matters).
function articleNames(section: string): string[] {
  return articleBlocks(section)
    .map((b) => fieldText(b, "field--name-label"))
    .filter((n): n is string => n !== null);
}

// Text content of the first `<div class="...<fieldClass>...">TEXT</div>`.
function fieldText(html: string, fieldClass: string): string | null {
  const re = new RegExp(`class="[^"]*${fieldClass}[^"]*">([\\s\\S]*?)</div>`);
  const m = html.match(re);
  return m ? normalise(decodeEntities(stripTags(m[1]!))) : null;
}

// The date in the first `<time datetime="YYYY-MM-DD...">` after a field marker.
function dateAfterField(html: string, fieldClass: string): string | null {
  const i = html.indexOf(fieldClass);
  if (i < 0) return null;
  const m = html.slice(i).match(/<time[^>]*datetime="(\d{4}-\d{2}-\d{2})/);
  return m ? m[1]! : null;
}

// First bare `<p>` not carrying a Drupal field class (the former-role note).
function firstBareParagraph(html: string): string | null {
  const m = html.match(/<p>([\s\S]*?)<\/p>/);
  return m ? m[1]! : null;
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, " ");
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#160;|&nbsp;/g, " ");
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

// ---------------------------------------------------------------------------
// Network / misc
// ---------------------------------------------------------------------------

async function getText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} on ${url}`);
  return await res.text();
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
