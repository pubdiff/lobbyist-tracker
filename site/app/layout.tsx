import type { Metadata } from "next";
import Link from "next/link";
import { withBase } from "@/lib/site-config";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Lobbyist Tracker - pubdiff",
    template: "%s - Lobbyist Tracker",
  },
  description:
    "Weekly diff of Australia's lobbyist registers (federal and state). Every record links to its government source. A pubdiff tracker.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-AU">
      <head>
        <link
          rel="alternate"
          type="application/rss+xml"
          title="Lobbyist Tracker feed"
          href={withBase("/feed.xml")}
        />
        <link
          rel="alternate"
          type="application/feed+json"
          title="Lobbyist Tracker feed"
          href={withBase("/feed.json")}
        />
      </head>
      <body className="min-h-screen">
        <header className="border-b border-[var(--color-rule)]">
          <div className="max-w-4xl mx-auto px-4 py-5 flex items-baseline justify-between flex-wrap gap-2">
            <Link href="/" className="text-xl font-semibold no-underline text-[var(--color-ink)]">
              Lobbyist Tracker
            </Link>
            <nav className="text-sm flex gap-5 flex-wrap">
              <Link href="/">Changes</Link>
              <Link href="/lobbyists/">Firms</Link>
              <Link href="/about/">Methodology</Link>
              <a href={withBase("/feed.xml")}>RSS</a>
              <a href="https://bsky.app/profile/pubdiff.bsky.social">Bluesky</a>
            </nav>
          </div>
        </header>
        <main className="max-w-4xl mx-auto px-4 py-8">{children}</main>
        <footer className="border-t border-[var(--color-rule)] mt-16">
          <div className="max-w-4xl mx-auto px-4 py-6 text-sm text-[var(--color-muted)]">
            A <a href="https://github.com/pubdiff">pubdiff</a> tracker. Data drawn
            verbatim from the federal and state lobbyist registers; every record
            links to its government source. Code MIT, data CC-BY-4.0.
          </div>
        </footer>
      </body>
    </html>
  );
}
