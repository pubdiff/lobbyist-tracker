// Types for Microsoft Power Apps / Dynamics 365 portals.
//
// QLD (lobbyists.integrity.qld.gov.au) and WA (lobbyists.wa.gov.au) are both
// Power Apps portals, the same platform the sibling epbc-tracker scrapes. Their
// list controls ("entitylist") load through a POST to
//   /_services/entity-grid-data.json/<listGuid>
// which needs a session triple that is NOT present in a plain GET of the page:
// auth cookies, an anti-forgery token, and a server-encrypted view config
// (base64SecureConfiguration). We capture that triple by driving a real
// headless browser once (the entitylist fires the POST itself on render), then
// replay paginated POSTs with plain fetch. See session.ts / grid.ts.
//
// This module is deliberately host-agnostic: every site-specific value (host,
// list page URL, grid endpoint) is passed in. It is the copy-first precursor to
// the long-planned @pubdiff/core; epbc-tracker has its own near-identical copy.

export interface PortalSession {
  /** Cookie header string to echo on every grid POST. */
  cookieHeader: string;
  /** Anti-forgery token, sent as the __RequestVerificationToken header. */
  requestVerificationToken: string;
  /** Server-encrypted view configuration lifted from the captured POST body. */
  base64SecureConfiguration: string;
  /** Absolute entity-grid-data.json URL the browser actually POSTed to. */
  gridUrl: string;
}

export interface EntityGridResponse {
  MoreRecords: boolean;
  Records: PortalRecord[];
  ItemCount: number;
}

export interface PortalRecord {
  Id: string; // primary-key GUID
  EntityName: string; // CRM logical entity name, e.g. "dpc_lobbyist"
  Attributes: PortalAttribute[];
}

export interface PortalAttribute {
  Name: string;
  Type?: string;
  Value: unknown;
  DisplayValue?: unknown;
}
