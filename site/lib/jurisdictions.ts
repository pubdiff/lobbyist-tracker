// Jurisdiction codes used by the lobbyist registers, mapped to readable names
// and the home page / methodology links for each source register.

import type { Jurisdiction } from "./types";

interface JurisdictionMeta {
  code: Jurisdiction;
  name: string;       // human-readable
  short: string;      // compact label for chips/tables
  register: string;   // name of the register operator
  registerUrl: string; // landing page of the public register
}

const META: Record<Jurisdiction, JurisdictionMeta> = {
  federal: {
    code: "federal",
    name: "Federal (Commonwealth)",
    short: "Federal",
    register: "Australian Government Register of Lobbyists",
    registerUrl: "https://www.lobbyists.ag.gov.au/register",
  },
  nsw: {
    code: "nsw",
    name: "New South Wales",
    short: "NSW",
    register: "NSW Electoral Commission Lobbyist Register",
    registerUrl: "https://lobbyists.elections.nsw.gov.au/",
  },
  vic: {
    code: "vic",
    name: "Victoria",
    short: "VIC",
    register: "Victorian Register of Lobbyists",
    registerUrl: "https://www.lobbyistsregister.vic.gov.au/",
  },
  sa: {
    code: "sa",
    name: "South Australia",
    short: "SA",
    register: "South Australian Register of Lobbyists",
    registerUrl: "https://www.lobbyists.sa.gov.au/",
  },
  qld: {
    code: "qld",
    name: "Queensland",
    short: "QLD",
    register: "Queensland Register of Lobbyists",
    registerUrl: "https://www.lobbyists.integrity.qld.gov.au/",
  },
  wa: {
    code: "wa",
    name: "Western Australia",
    short: "WA",
    register: "WA Register of Lobbyists",
    registerUrl: "https://lobbyists.wa.gov.au/",
  },
};

// Display order: federal first, then states alphabetically.
export const JURISDICTION_ORDER: Jurisdiction[] = ["federal", "nsw", "vic", "qld", "sa", "wa"];

export function jurisdictionMeta(code: Jurisdiction): JurisdictionMeta {
  return META[code];
}

export function jurisdictionName(code: Jurisdiction): string {
  return META[code]?.name ?? code;
}

export function jurisdictionShort(code: Jurisdiction): string {
  return META[code]?.short ?? code.toUpperCase();
}
