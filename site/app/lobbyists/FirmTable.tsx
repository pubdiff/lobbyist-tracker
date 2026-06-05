"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Jurisdiction } from "@/lib/types";

export interface FirmRow {
  slug: string;
  legalName: string;
  tradingName: string | null;
  jurisdiction: string;       // short label e.g. "NSW"
  jurisdictionCode: Jurisdiction;
  status: string | null;
  clientCount: number;
  peopleCount: number;
  onWatchlist: boolean;
}

export function FirmTable({ rows }: { rows: FirmRow[] }) {
  const [query, setQuery] = useState("");
  const [jurisdiction, setJurisdiction] = useState<string>("all");

  const jurisdictions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows) seen.set(r.jurisdictionCode, r.jurisdiction);
    return [...seen.entries()];
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (jurisdiction !== "all" && r.jurisdictionCode !== jurisdiction) return false;
      if (!q) return true;
      return (
        r.legalName.toLowerCase().includes(q) ||
        (r.tradingName?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [rows, query, jurisdiction]);

  return (
    <div className="space-y-4">
      <div className="flex gap-3 flex-wrap items-center">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search firm or trading name"
          className="border border-[var(--color-rule)] bg-white rounded px-3 py-1.5 text-sm w-64 max-w-full"
          aria-label="Search firms"
        />
        <select
          value={jurisdiction}
          onChange={(e) => setJurisdiction(e.target.value)}
          className="border border-[var(--color-rule)] bg-white rounded px-3 py-1.5 text-sm"
          aria-label="Filter by jurisdiction"
        >
          <option value="all">All jurisdictions</option>
          {jurisdictions.map(([code, label]) => (
            <option key={code} value={code}>
              {label}
            </option>
          ))}
        </select>
        <span className="text-sm text-[var(--color-muted)] font-mono">
          {filtered.length.toLocaleString()} / {rows.length.toLocaleString()}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left border-b border-[var(--color-rule)]">
            <tr>
              <th className="py-2 pr-3">Firm</th>
              <th className="py-2 pr-3 whitespace-nowrap">Jurisdiction</th>
              <th className="py-2 pr-3">Status</th>
              <th className="py-2 pr-3 text-right">Clients</th>
              <th className="py-2 pr-3 text-right">Lobbyists</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.slug} className="border-b border-[var(--color-rule)] align-top">
                <td className="py-2 pr-3">
                  <Link href={`/l/${r.slug}/`}>{r.legalName}</Link>
                  {r.tradingName && r.tradingName !== r.legalName ? (
                    <span className="text-[var(--color-muted)]"> ({r.tradingName})</span>
                  ) : null}
                  {r.onWatchlist ? (
                    <span className="ml-2 text-xs text-[var(--color-flag)] font-semibold uppercase tracking-wide">
                      watchlist
                    </span>
                  ) : null}
                </td>
                <td className="py-2 pr-3 font-mono whitespace-nowrap">{r.jurisdiction}</td>
                <td className="py-2 pr-3">{r.status ?? "-"}</td>
                <td className="py-2 pr-3 text-right font-mono">{r.clientCount}</td>
                <td className="py-2 pr-3 text-right font-mono">{r.peopleCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 ? (
          <p className="text-[var(--color-muted)] text-sm py-4">No firms match that filter.</p>
        ) : null}
      </div>
    </div>
  );
}
