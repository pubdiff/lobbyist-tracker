// The subset of src/schema.ts that the site consumes. Mirrored here (rather
// than imported across the package boundary) so the site builds standalone.
// Keep in sync with ../../src/schema.ts.

export type Jurisdiction = "federal" | "nsw" | "vic" | "qld" | "wa" | "sa";

export interface Client {
  name: string;
  abn: string | null;
  isForeignPrincipal: boolean | null;
  countries: string[];
  active: boolean | null;
  startDate: string | null;
  endDate: string | null;
  notes: string | null;
}

export interface Person {
  name: string;
  position: string | null;
  active: boolean | null;
  isFormerPublicOfficial: boolean | null;
  formerRoleNotes: string | null;
}

export interface Owner {
  name: string;
  active: boolean | null;
}

export interface Lobbyist {
  jurisdiction: Jurisdiction;
  registrationId: string;
  legalName: string;
  tradingName: string | null;
  abn: string | null;
  status: string | null;
  onWatchlist: boolean | null;
  registeredAt: string | null;
  address: string | null;
  sourceUrl: string;
  clients: Client[];
  people: Person[];
  owners: Owner[];
}

export interface LobbyistHistoryEntry {
  observedAt: string;
  status: string | null;
  onWatchlist: boolean | null;
  clientCount: number;
  personCount: number;
  ownerCount: number;
}

export interface LobbyistIndexed extends Lobbyist {
  key: string;
  firstSeen: string;
  lastSeen: string;
  history: LobbyistHistoryEntry[];
}

export type Event =
  | { type: "lobbyist.added"; key: string; lobbyist: Lobbyist }
  | { type: "lobbyist.removed"; key: string; lastSeenLegalName: string }
  | { type: "client.added"; key: string; client: Client }
  | { type: "client.removed"; key: string; clientName: string }
  | { type: "person.added"; key: string; person: Person }
  | { type: "person.removed"; key: string; personName: string }
  | { type: "owner.added"; key: string; owner: Owner }
  | { type: "owner.removed"; key: string; ownerName: string }
  | { type: "status.changed"; key: string; from: string | null; to: string | null }
  | { type: "client.foreignPrincipal.flagged"; key: string; clientName: string; countries: string[] }
  | { type: "watchlist.changed"; key: string; legalName: string; onWatchlist: boolean };

export type EventType = Event["type"];

export interface DiffPerSource {
  totalCurrent: number;
  totalPrevious: number;
  isBootstrap: boolean;
  events: Event[];
}

export interface Diff {
  runId: string;
  perSource: Record<Jurisdiction, DiffPerSource>;
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
