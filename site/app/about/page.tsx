import type { Metadata } from "next";
import { trackerStats } from "@/lib/data";
import { jurisdictionMeta, JURISDICTION_ORDER } from "@/lib/jurisdictions";
import { withBase } from "@/lib/site-config";
import type { Jurisdiction } from "@/lib/types";

export const metadata: Metadata = {
  title: "Methodology",
  description: "How the Lobbyist Tracker collects, diffs, and publishes Australian lobbyist register data.",
};

const LIVE: Jurisdiction[] = ["federal", "nsw", "vic", "sa", "qld", "wa"];

export default async function AboutPage() {
  const stats = await trackerStats();
  const covered = new Set(stats.byJurisdiction.map((j) => j.code));

  return (
    <div className="space-y-8 max-w-2xl">
      <section>
        <h1 className="text-3xl font-semibold mb-3">Methodology</h1>
        <p>
          Lobbyist Tracker snapshots Australia&apos;s public registers of
          third-party lobbyists once a week, compares each snapshot to the
          previous one, and publishes the differences. It adds no commentary and
          makes no allegations. Every record links back to the government
          register it came from, so any figure here can be checked at source.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold mb-2">What it tracks</h2>
        <p>
          Each register lists the firms registered to lobby government, the
          clients they act for, the employees authorised to lobby, and (in some
          jurisdictions) the firm&apos;s owners. The tracker records changes to
          all of these: firms registering and deregistering, clients added and
          removed, lobbyists joining and leaving, status changes, and two
          higher-interest signals where a register exposes them: clients flagged
          as <strong>foreign principals</strong>, and firms placed on or removed
          from a <strong>compliance watchlist</strong>.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold mb-2">Sources</h2>
        <p className="mb-3">
          One adapter per jurisdiction, reading each register&apos;s own public
          interface. Coverage is expanding; the registers below are live.
        </p>
        <ul className="space-y-2 text-sm">
          {JURISDICTION_ORDER.map((code) => {
            const meta = jurisdictionMeta(code);
            const live = LIVE.includes(code);
            const count = stats.byJurisdiction.find((j) => j.code === code)?.count;
            return (
              <li key={code} className="flex justify-between gap-3 border-b border-[var(--color-rule)] pb-2">
                <span>
                  <a href={meta.registerUrl}>{meta.register}</a>
                  <span className="text-[var(--color-muted)]"> - {meta.name}</span>
                </span>
                <span className="text-[var(--color-muted)] font-mono whitespace-nowrap">
                  {live ? (count !== undefined ? `${count.toLocaleString()} firms` : "live") : "planned"}
                </span>
              </li>
            );
          })}
        </ul>
        {!covered.size ? (
          <p className="text-xs text-[var(--color-muted)] mt-2">
            Firm counts populate after the first scrape commits its data.
          </p>
        ) : null}
      </section>

      <section>
        <h2 className="text-xl font-semibold mb-2">Cadence and reproducibility</h2>
        <p>
          The pipeline runs every Wednesday at 20:00 UTC (Thursday 06:00 AEST) on
          GitHub Actions: fetch, parse, update the index, diff against last week,
          publish the feed, rebuild this site, and post highlights to Bluesky.
          Every snapshot and diff is committed to the{" "}
          <a href="https://github.com/pubdiff/lobbyist-tracker">public repository</a>,
          so the full history is auditable and the build is reproducible from raw
          data.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold mb-2">Reading the data</h2>
        <p>
          Fields are reproduced verbatim from each register. Where a register
          does not expose a field, the tracker records it as empty rather than
          guessing. Registers differ: not all expose ABNs, foreign-principal
          flags, or watchlists, and some list firms with no current clients. A
          &ldquo;former public official&rdquo; note on a lobbyist is the
          register&apos;s own disclosure, not an inference by this project.
          Identity is not resolved across jurisdictions: a firm appearing in two
          registers is shown as two separate records.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold mb-2">Feeds and reuse</h2>
        <p>
          Changes are published as{" "}
          <a href={withBase("/feed.xml")}>RSS</a> and{" "}
          <a href={withBase("/feed.json")}>JSON Feed</a>, and to{" "}
          <a href="https://bsky.app/profile/pubdiff.bsky.social">Bluesky</a>. The
          code is MIT licensed and the data is CC-BY-4.0. This is a{" "}
          <a href="https://github.com/pubdiff">pubdiff</a> tracker.
        </p>
      </section>
    </div>
  );
}
