import type { Metadata } from "next";
import { loadLobbyists, slugForKey } from "@/lib/data";
import { jurisdictionShort } from "@/lib/jurisdictions";
import { FirmTable, type FirmRow } from "./FirmTable";

export const metadata: Metadata = {
  title: "Firms",
  description: "Every firm currently or formerly on Australia's federal and state lobbyist registers.",
};

export default async function LobbyistsPage() {
  const all = await loadLobbyists();
  const rows: FirmRow[] = await Promise.all(
    all.map(async (rec) => ({
      slug: (await slugForKey(rec.key)) ?? "",
      legalName: rec.legalName,
      tradingName: rec.tradingName,
      jurisdiction: jurisdictionShort(rec.jurisdiction),
      jurisdictionCode: rec.jurisdiction,
      status: rec.status,
      clientCount: rec.clients.length,
      peopleCount: rec.people.length,
      onWatchlist: rec.onWatchlist === true,
    })),
  );

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-3xl font-semibold mb-2">Registered firms</h1>
        <p className="text-[var(--color-muted)] max-w-2xl">
          {rows.length.toLocaleString()} firms across the tracked registers.
          Status text is reproduced verbatim from each register. Use the filter
          to search by name or jurisdiction.
        </p>
      </section>
      <FirmTable rows={rows} />
    </div>
  );
}
