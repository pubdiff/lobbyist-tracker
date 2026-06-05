// Paginated plain-fetch crawler for a Power Apps entity-grid-data.json list,
// driven by a PortalSession captured in session.ts.
//
// Polite pacing between requests. Stops on the first non-2xx so we never punch
// through rate limiting, and treats an empty 200 body as an expired session.

import { PORTAL_USER_AGENT } from "./browser.ts";
import type { EntityGridResponse, PortalRecord, PortalSession } from "./types.ts";

export class PortalGridError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "PortalGridError";
    this.status = status;
  }
}

export interface FetchPageOptions {
  page: number;
  pageSize?: number;
  sortExpression?: string;
}

export async function fetchGridPage(
  session: PortalSession,
  opts: FetchPageOptions,
): Promise<EntityGridResponse> {
  const origin = new URL(session.gridUrl).origin;
  const body = {
    base64SecureConfiguration: session.base64SecureConfiguration,
    sortExpression: opts.sortExpression ?? "",
    search: "",
    page: opts.page,
    pageSize: opts.pageSize ?? 50,
    pagingCookie: "",
    filter: null,
    metaFilter: null,
    nlSearchFilter: "",
    timezoneOffset: 0,
    customParameters: [],
  };

  const response = await fetch(session.gridUrl, {
    method: "POST",
    headers: {
      "User-Agent": PORTAL_USER_AGENT,
      Accept: "application/json, text/javascript, */*; q=0.01",
      "Content-Type": "application/json; charset=utf-8",
      "X-Requested-With": "XMLHttpRequest",
      Origin: origin,
      Referer: origin + "/",
      __RequestVerificationToken: session.requestVerificationToken,
      Cookie: session.cookieHeader,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const snippet = (await response.text()).slice(0, 200);
    throw new PortalGridError(`grid returned ${response.status} on page ${opts.page}: ${snippet}`, response.status);
  }
  const text = await response.text();
  if (!text) {
    throw new PortalGridError(
      `grid returned empty body on page ${opts.page} (HTTP 200); session may have expired`,
      200,
    );
  }
  return JSON.parse(text) as EntityGridResponse;
}

export interface CrawlOptions {
  pageSize?: number;
  delayMs?: number;
  maxPages?: number;
  sortExpression?: string;
  onPage?: (page: number, res: EntityGridResponse) => void;
}

// Crawl every page of the list and return all records concatenated.
export async function crawlGrid(session: PortalSession, opts: CrawlOptions = {}): Promise<PortalRecord[]> {
  const pageSize = opts.pageSize ?? 50;
  const delayMs = opts.delayMs ?? 1500;
  const all: PortalRecord[] = [];
  let page = 1;
  while (true) {
    if (opts.maxPages != null && page > opts.maxPages) break;
    const res = await fetchGridPage(session, { page, pageSize, sortExpression: opts.sortExpression });
    all.push(...res.Records);
    opts.onPage?.(page, res);
    if (!res.MoreRecords || res.Records.length === 0) break;
    page++;
    if (delayMs > 0) await sleep(delayMs);
  }
  return all;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
