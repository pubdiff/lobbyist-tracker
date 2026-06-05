import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { allSlugs, recordBySlug } from "@/lib/data";
import { jurisdictionMeta } from "@/lib/jurisdictions";
import type { Client, LobbyistIndexed, Person } from "@/lib/types";

// Only the slugs we generate exist.
export const dynamicParams = false;

// `output: export` rejects a dynamic route whose generateStaticParams returns
// an empty array. That happens on the very first deploy, before any scrape has
// committed data. Emit one sentinel param in that case; the page resolves it to
// notFound(), so no real page ships for it.
const NO_DATA_SENTINEL = "__no-data__";

export async function generateStaticParams(): Promise<{ slug: string }[]> {
  const slugs = await allSlugs();
  if (slugs.length === 0) return [{ slug: NO_DATA_SENTINEL }];
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const rec = await recordBySlug(slug);
  if (!rec) return { title: "Firm not found" };
  return {
    title: rec.legalName,
    description: `Lobbyist register entry for ${rec.legalName} (${jurisdictionMeta(rec.jurisdiction).name}).`,
  };
}

export default async function LobbyistPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const rec = await recordBySlug(slug);
  if (!rec) notFound();

  const meta = jurisdictionMeta(rec.jurisdiction);
  const activeClients = rec.clients.filter((c) => c.active !== false);
  const formerClients = rec.clients.filter((c) => c.active === false);
  const activePeople = rec.people.filter((p) => p.active !== false);
  const formerPeople = rec.people.filter((p) => p.active === false);

  return (
    <div className="space-y-8">
      <div>
        <Link href="/lobbyists/" className="text-sm">
          ← All firms
        </Link>
      </div>

      <section>
        <div className="flex items-baseline gap-3 flex-wrap mb-1">
          <h1 className="text-3xl font-semibold">{rec.legalName}</h1>
          {rec.onWatchlist ? (
            <span className="text-xs text-[var(--color-flag)] font-semibold uppercase tracking-wide">
              compliance watchlist
            </span>
          ) : null}
        </div>
        {rec.tradingName && rec.tradingName !== rec.legalName ? (
          <p className="text-[var(--color-muted)]">Trading as {rec.tradingName}</p>
        ) : null}
        <p className="mt-2 text-sm">
          <a href={meta.registerUrl} className="no-underline hover:underline">
            {meta.register}
          </a>
        </p>
      </section>

      <section className="grid grid-cols-2 sm:grid-cols-4 gap-4 border-y border-[var(--color-rule)] py-5 text-sm">
        <Field label="Jurisdiction" value={meta.name} />
        <Field label="Status" value={rec.status ?? "-"} />
        <Field label="ABN" value={rec.abn ?? "-"} mono />
        <Field label="Registration ID" value={rec.registrationId} mono />
        <Field label="Registered" value={rec.registeredAt ?? "-"} mono />
        <Field label="First tracked" value={rec.firstSeen} mono />
        <Field label="Last seen" value={rec.lastSeen} mono />
        <Field label="Clients / Lobbyists" value={`${rec.clients.length} / ${rec.people.length}`} mono />
      </section>

      {rec.address ? (
        <section>
          <h2 className="text-sm uppercase tracking-wider text-[var(--color-muted)] mb-1">Address</h2>
          <p className="text-sm">{rec.address}</p>
        </section>
      ) : null}

      <PeopleSection title="Authorised lobbyists" people={activePeople} />
      {formerPeople.length ? <PeopleSection title="Former lobbyists" people={formerPeople} muted /> : null}

      <ClientsSection title="Clients" clients={activeClients} />
      {formerClients.length ? <ClientsSection title="Former clients" clients={formerClients} muted /> : null}

      {rec.owners.length ? (
        <section>
          <h2 className="text-xl font-semibold mb-3">Owners and interests</h2>
          <ul className="text-sm space-y-1">
            {rec.owners.map((o, i) => (
              <li key={`${o.name}-${i}`} className={o.active === false ? "text-[var(--color-muted)]" : ""}>
                {o.name}
                {o.active === false ? <span className="text-[var(--color-muted)]"> (former)</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <HistorySection rec={rec} />

      <section className="border-t border-[var(--color-rule)] pt-5">
        <a href={rec.sourceUrl} className="font-medium">
          View this entry on the {meta.short} register →
        </a>
        <p className="text-xs text-[var(--color-muted)] mt-2">
          All fields above are reproduced from the government register. Where the
          register does not expose a field, it shows as &ldquo;-&rdquo;.
        </p>
      </section>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-[var(--color-muted)]">{label}</div>
      <div className={mono ? "font-mono" : ""}>{value}</div>
    </div>
  );
}

function PeopleSection({ title, people, muted }: { title: string; people: Person[]; muted?: boolean }) {
  if (people.length === 0) {
    return (
      <section>
        <h2 className="text-xl font-semibold mb-3">{title}</h2>
        <p className="text-sm text-[var(--color-muted)]">None listed.</p>
      </section>
    );
  }
  return (
    <section>
      <h2 className="text-xl font-semibold mb-3">
        {title} <span className="text-[var(--color-muted)] font-normal text-base">({people.length})</span>
      </h2>
      <ul className="text-sm space-y-2">
        {people.map((p, i) => (
          <li key={`${p.name}-${i}`} className={muted ? "text-[var(--color-muted)]" : ""}>
            <span className="font-medium">{p.name}</span>
            {p.position ? <span className="text-[var(--color-muted)]"> - {p.position}</span> : null}
            {p.isFormerPublicOfficial ? (
              <div className="text-xs text-[var(--color-flag)] mt-0.5">
                Former public official{p.formerRoleNotes ? `: ${p.formerRoleNotes}` : ""}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ClientsSection({ title, clients, muted }: { title: string; clients: Client[]; muted?: boolean }) {
  if (clients.length === 0) {
    return (
      <section>
        <h2 className="text-xl font-semibold mb-3">{title}</h2>
        <p className="text-sm text-[var(--color-muted)]">None listed.</p>
      </section>
    );
  }
  return (
    <section>
      <h2 className="text-xl font-semibold mb-3">
        {title} <span className="text-[var(--color-muted)] font-normal text-base">({clients.length})</span>
      </h2>
      <ul className="text-sm space-y-2">
        {clients.map((c, i) => (
          <li key={`${c.name}-${i}`} className={muted ? "text-[var(--color-muted)]" : ""}>
            <span className="font-medium">{c.name}</span>
            {c.abn ? <span className="text-[var(--color-muted)] font-mono text-xs"> ABN {c.abn}</span> : null}
            {c.isForeignPrincipal ? (
              <span className="ml-2 text-xs text-[var(--color-flag)] font-semibold uppercase tracking-wide">
                foreign principal{c.countries.length ? ` (${c.countries.join(", ")})` : ""}
              </span>
            ) : null}
            {c.notes ? <div className="text-xs text-[var(--color-muted)] mt-0.5">{c.notes}</div> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function HistorySection({ rec }: { rec: LobbyistIndexed }) {
  if (rec.history.length <= 1) return null;
  return (
    <section>
      <h2 className="text-xl font-semibold mb-3">Observation history</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left border-b border-[var(--color-rule)]">
            <tr>
              <th className="py-2 pr-3">Observed</th>
              <th className="py-2 pr-3">Status</th>
              <th className="py-2 pr-3 text-right">Clients</th>
              <th className="py-2 pr-3 text-right">Lobbyists</th>
              <th className="py-2 pr-3 text-right">Owners</th>
            </tr>
          </thead>
          <tbody>
            {[...rec.history].reverse().map((h) => (
              <tr key={h.observedAt} className="border-b border-[var(--color-rule)]">
                <td className="py-2 pr-3 font-mono whitespace-nowrap">{h.observedAt}</td>
                <td className="py-2 pr-3">{h.status ?? "-"}</td>
                <td className="py-2 pr-3 text-right font-mono">{h.clientCount}</td>
                <td className="py-2 pr-3 text-right font-mono">{h.personCount}</td>
                <td className="py-2 pr-3 text-right font-mono">{h.ownerCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
