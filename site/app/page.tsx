import Link from "next/link";
import { latestChanges, trackerStats, type ChangeItem } from "@/lib/data";
import { jurisdictionMeta } from "@/lib/jurisdictions";

export default async function ChangesPage() {
  const [stats, changes] = await Promise.all([trackerStats(), latestChanges()]);
  const hasData = stats.totalFirms > 0;

  return (
    <div className="space-y-10">
      <section>
        <h1 className="text-3xl font-semibold mb-2">Lobbyist Tracker</h1>
        <p className="text-[var(--color-muted)] max-w-2xl">
          A weekly diff of Australia&apos;s registers of third-party lobbyists,
          federal and state. New firms, deregistrations, client changes, foreign
          principals, and compliance-watchlist movements are surfaced as the
          registers publish them. Every record links to its government source.
        </p>
        {changes.runId ? (
          <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--color-muted)]">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-full bg-green-600" aria-hidden />
              Latest run {changes.runId}
            </span>
          </div>
        ) : null}
      </section>

      {hasData ? (
        <section className="grid grid-cols-2 sm:grid-cols-4 gap-4 border-y border-[var(--color-rule)] py-5">
          <Stat label="Registered firms" value={stats.totalFirms.toLocaleString()} />
          <Stat label="Clients" value={stats.totalClients.toLocaleString()} />
          <Stat label="Authorised lobbyists" value={stats.totalPeople.toLocaleString()} />
          <Stat label="Jurisdictions" value={String(stats.byJurisdiction.length)} />
        </section>
      ) : null}

      <section>
        <h2 className="text-xl font-semibold mb-4">Latest changes</h2>
        {!changes.runId ? (
          <p className="text-[var(--color-muted)]">
            No diff has been published yet. The first weekly run will populate
            this page. Until then, browse the{" "}
            <Link href="/lobbyists/">register of firms</Link> or read the{" "}
            <Link href="/about/">methodology</Link>.
          </p>
        ) : changes.groups.every((g) => g.items.length === 0) ? (
          <p className="text-[var(--color-muted)]">
            No changes in the latest run ({changes.runId}). The registers were
            unchanged across all tracked jurisdictions.
          </p>
        ) : (
          <div className="space-y-8">
            {changes.groups.map((group) => (
              <JurisdictionGroup key={group.jurisdiction} group={group} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function JurisdictionGroup({
  group,
}: {
  group: { jurisdiction: Parameters<typeof jurisdictionMeta>[0]; isBootstrap: boolean; totalCurrent: number; items: ChangeItem[] };
}) {
  const meta = jurisdictionMeta(group.jurisdiction);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-3 border-b border-[var(--color-rule)] pb-2">
        <h3 className="text-lg font-semibold">
          <a href={meta.registerUrl} className="no-underline text-[var(--color-ink)] hover:underline">
            {meta.name}
          </a>
        </h3>
        <span className="text-xs text-[var(--color-muted)] font-mono">
          {group.totalCurrent.toLocaleString()} firms tracked
        </span>
      </div>
      {group.isBootstrap ? (
        <p className="text-sm text-[var(--color-muted)]">
          First snapshot of this register. Baseline established; changes appear
          from the next run.
        </p>
      ) : group.items.length === 0 ? (
        <p className="text-sm text-[var(--color-muted)]">No changes this run.</p>
      ) : (
        <ul className="space-y-3">
          {group.items.map((item, i) => (
            <ChangeRow key={`${item.key}-${item.headline}-${i}`} item={item} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ChangeRow({ item }: { item: ChangeItem }) {
  return (
    <li className="border-b border-[var(--color-rule)] pb-3">
      <div className="flex items-baseline gap-2 flex-wrap">
        <span
          className={`text-xs uppercase tracking-wider ${
            item.highlight ? "text-[var(--color-flag)] font-semibold" : "text-[var(--color-muted)]"
          }`}
        >
          {item.headline}
        </span>
      </div>
      <div className="mt-1">
        {item.slug ? (
          <Link href={`/l/${item.slug}/`} className="font-medium text-[var(--color-ink)] no-underline hover:underline">
            {item.legalName}
          </Link>
        ) : (
          <span className="font-medium">{item.legalName}</span>
        )}
        {item.detail ? (
          <span className="text-sm text-[var(--color-muted)]"> - {item.detail}</span>
        ) : null}
      </div>
      {item.sourceUrl ? (
        <div className="text-xs mt-1">
          <a href={item.sourceUrl}>View on register →</a>
        </div>
      ) : null}
    </li>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-[var(--color-muted)]">{label}</div>
      <div className="text-lg font-semibold font-mono">{value}</div>
    </div>
  );
}
