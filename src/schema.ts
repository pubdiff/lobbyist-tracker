// Schema for lobbyist register records.
//
// Each Australian jurisdiction's register exposes some subset of the same
// conceptual entities: Lobbyist (the registered firm), Client (orgs it acts
// for), Person (employees authorised to lobby), and Engagement (the
// relationship over time). Where a register doesn't expose a field, the
// adapter sets it to null - never silently drops it.
//
// Identity across registers (e.g. is the "ABC Strategies" in NSW the same
// firm as in QLD) is intentionally NOT resolved here. That's the
// entity-resolution layer's problem. Each record's primary key is
// jurisdiction-scoped.

export type Jurisdiction = "federal" | "nsw" | "vic" | "qld" | "wa" | "sa";

export interface Lobbyist {
  jurisdiction: Jurisdiction;
  registrationId: string;          // jurisdiction-issued ID, or slug fallback
  legalName: string;               // firm's legal name as listed
  tradingName: string | null;      // if listed separately
  abn: string | null;
  status: string | null;           // raw status text from the register
  onWatchlist: boolean | null;     // NSW flags lobbyists on its compliance watchlist; null where not exposed
  registeredAt: string | null;     // ISO date if exposed
  address: string | null;
  sourceUrl: string;               // permalink (or best available) on the register

  clients: Client[];
  people: Person[];                // employees authorised to lobby
  owners: Owner[];                 // persons/entities with a management or financial interest
}

export interface Client {
  name: string;                    // verbatim, as listed
  abn: string | null;              // client ABN where the register exposes it
  isForeignPrincipal: boolean | null; // some registers (NSW) flag foreign-principal clients
  countries: string[];             // associated country(ies) for a foreign principal; [] otherwise
  active: boolean | null;          // some registers list historical (inactive) clients
  startDate: string | null;        // ISO date if exposed
  endDate: string | null;          // ISO date if exposed (some registers show historical clients)
  notes: string | null;
}

export interface Person {
  name: string;
  position: string | null;
  active: boolean | null;          // some registers list historical (inactive) employees
  isFormerPublicOfficial: boolean | null; // some registers flag this
  formerRoleNotes: string | null;
}

// A person or entity with a management / financial interest in the lobbyist
// firm. Distinct from an employee: owners aren't necessarily lobbyists, but the
// register exposes them as part of the firm's accountability surface.
export interface Owner {
  name: string;
  active: boolean | null;
}

// Per-record key used everywhere. Globally unique across the tracker.
export type LobbyistKey = string; // e.g. "nsw:L0123"

export function makeLobbyistKey(l: Pick<Lobbyist, "jurisdiction" | "registrationId">): LobbyistKey {
  return `${l.jurisdiction}:${l.registrationId}`;
}

// ---------------------------------------------------------------------------
// History / index
// ---------------------------------------------------------------------------

export interface LobbyistHistoryEntry {
  observedAt: string;              // ISO date (YYYY-MM-DD)
  status: string | null;
  onWatchlist: boolean | null;
  clientCount: number;
  personCount: number;
  ownerCount: number;
}

export interface LobbyistIndexed extends Lobbyist {
  key: LobbyistKey;
  firstSeen: string;               // ISO date (YYYY-MM-DD)
  lastSeen: string;                // ISO date (YYYY-MM-DD)
  history: LobbyistHistoryEntry[];
}

export type LobbyistIndex = Record<LobbyistKey, LobbyistIndexed>;

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

export type Event =
  | { type: "lobbyist.added"; key: LobbyistKey; lobbyist: Lobbyist }
  | { type: "lobbyist.removed"; key: LobbyistKey; lastSeenLegalName: string }
  | { type: "client.added"; key: LobbyistKey; client: Client }
  | { type: "client.removed"; key: LobbyistKey; clientName: string }
  | { type: "person.added"; key: LobbyistKey; person: Person }
  | { type: "person.removed"; key: LobbyistKey; personName: string }
  | { type: "owner.added"; key: LobbyistKey; owner: Owner }
  | { type: "owner.removed"; key: LobbyistKey; ownerName: string }
  | { type: "status.changed"; key: LobbyistKey; from: string | null; to: string | null }
  // A client newly flagged as a foreign principal (or the firm's first foreign
  // principal client). High public-interest signal, surfaced separately.
  | { type: "client.foreignPrincipal.flagged"; key: LobbyistKey; clientName: string; countries: string[] }
  | { type: "watchlist.changed"; key: LobbyistKey; legalName: string; onWatchlist: boolean };

export interface Diff {
  runId: string;                   // ISO date of this run (YYYY-MM-DD)
  perSource: Record<Jurisdiction, {
    totalCurrent: number;
    totalPrevious: number;
    isBootstrap: boolean;
    events: Event[];
  }>;
  stats: {
    totalCurrent: number;
    totalPrevious: number;
    eventCount: number;
    addedCount: number;
    removedCount: number;
    clientAddedCount: number;
    clientRemovedCount: number;
    personAddedCount: number;
    personRemovedCount: number;
    ownerAddedCount: number;
    ownerRemovedCount: number;
    foreignPrincipalFlaggedCount: number;
    watchlistChangedCount: number;
    statusChangedCount: number;
  };
}

// ---------------------------------------------------------------------------
// Snapshot files
// ---------------------------------------------------------------------------

export interface SnapshotFile {
  runId: string;                   // ISO date (YYYY-MM-DD)
  fetchedAt: string;               // ISO 8601 timestamp
  jurisdiction: Jurisdiction;
  sourceUrl: string;
  parserVersion: string;
  count: number;
  lobbyists: Lobbyist[];
}

// ---------------------------------------------------------------------------
// Bluesky idempotency log
// ---------------------------------------------------------------------------

export interface PostedRecord {
  // event-fingerprint -> ISO timestamp posted at.
  // Fingerprints encode the event type + key + payload so reruns never repost.
  [eventFingerprint: string]: string;
}
