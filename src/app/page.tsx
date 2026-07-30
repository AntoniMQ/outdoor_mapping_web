import Link from 'next/link';
import { Bike, Compass, Download, Map, PencilRuler, ShieldQuestion } from 'lucide-react';
import { BRAND } from '@/lib/env/client';
import { formatList, isFixtureMode, serverEnv, syntheticProviders } from '@/lib/env/server';
import { DataModeBanner } from '@/components/layout/data-mode-banner';

const FEATURES = [
  {
    icon: Compass,
    title: 'Circular routes from a start point',
    body: 'Give a start and a target distance. TrailLoop generates and ranks candidate loops, then offers three meaningfully different options.',
  },
  {
    icon: Map,
    title: 'Point-to-point and out-and-back',
    body: 'Route between places with optional via points, or ride out and back with a clear figure for how much is repeated.',
  },
  {
    icon: PencilRuler,
    title: 'Manual and freehand planning',
    body: 'Click to add waypoints, drag to reshape, insert shaping points, undo and redo — or draw a section by hand and mix it with routed sections.',
  },
  {
    icon: ShieldQuestion,
    title: 'Rights of way, made legible',
    body: 'Footpaths, bridleways, restricted byways, byways open to all traffic, permissive paths and unknown-access paths are drawn distinctly by colour and pattern.',
  },
  {
    icon: Bike,
    title: 'Access confidence, not guesswork',
    body: 'Every section gets a cycling access status, a confidence level and the reasons behind it. Missing data is labelled as missing.',
  },
  {
    icon: Download,
    title: 'GPX export',
    body: 'Download a GPX 1.1 file with waypoints, elevation where available and hand-drawn sections preserved.',
  },
];

export const dynamic = 'force-dynamic';

export default function HomePage() {
  const env = serverEnv();
  const fixtureMode = isFixtureMode(env);
  const syntheticParts = formatList(syntheticProviders(env));
  return (
    <main className="flex flex-1 flex-col">
      <DataModeBanner fixtureMode={fixtureMode} syntheticParts={syntheticParts} />
      <section className="border-b border-[var(--color-line)] bg-[var(--color-surface)]">
        <div className="mx-auto max-w-5xl px-4 py-14">
          <p className="text-xs font-semibold tracking-[0.2em] text-[var(--color-moss)] uppercase">
            OpenStreetMap route planning · England and Wales
          </p>
          <h1 className="mt-3 max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl">
            {BRAND.name}. {BRAND.tagline}
          </h1>
          <p className="mt-4 max-w-2xl text-base text-[var(--color-ink-muted)]">
            An outdoor route planner for mountain biking, gravel, road cycling and hiking that shows
            what the map actually records about access — public footpaths, bridleways, restricted
            byways, byways open to all traffic, permissive paths, and the sections where the data
            simply is not there yet.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link
              href="/planner"
              className="rounded-md bg-[var(--color-moss)] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[var(--color-moss-strong)] dark:text-[#0b0f0c]"
            >
              Open the planner
            </Link>
            <Link
              href="/about/data"
              className="rounded-md border border-[var(--color-line)] px-5 py-2.5 text-sm font-semibold hover:bg-[var(--color-surface-muted)]"
            >
              How the data works
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-5xl px-4 py-12">
        <h2 className="text-xl font-semibold">What it does</h2>
        <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <article
              key={feature.title}
              className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-4"
            >
              <feature.icon aria-hidden size={20} className="text-[var(--color-moss)]" />
              <h3 className="mt-2 text-sm font-semibold">{feature.title}</h3>
              <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{feature.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="border-t border-[var(--color-line)] bg-[var(--color-surface)]">
        <div className="mx-auto max-w-5xl px-4 py-10">
          <h2 className="text-lg font-semibold">What it does not claim</h2>
          <p className="mt-2 max-w-3xl text-sm text-[var(--color-ink-muted)]">
            OpenStreetMap is not a legal record. TrailLoop presents{' '}
            <em>mapped access information</em> with a confidence level and its reasoning, and flags
            uncertainty rather than hiding it. Local-authority Definitive Map records and on-site
            signage take precedence. Verify locally where access is uncertain.
          </p>
        </div>
      </section>
    </main>
  );
}
