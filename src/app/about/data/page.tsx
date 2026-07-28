import type { Metadata } from 'next';
import Link from 'next/link';
import { LEGEND_ORDER, RIGHTS_OF_WAY_STYLES } from '@/features/rights-of-way/styles';
import { serverEnv, isFixtureMode } from '@/lib/env/server';

export const metadata: Metadata = {
  title: 'Data and attribution',
  description:
    'Where TrailLoop data comes from, how rights of way are classified, and the limits of that data.',
};

export const dynamic = 'force-dynamic';

export default function DataPage() {
  const env = serverEnv();
  const fixture = isFixtureMode(env);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
      <h1 className="text-3xl font-semibold">Data and attribution</h1>

      <section className="mt-6 space-y-3 text-sm">
        <h2 className="text-lg font-semibold">OpenStreetMap</h2>
        <p>
          Path geometry and tags come from OpenStreetMap. Map data © OpenStreetMap contributors,
          available under the{' '}
          <a
            className="underline"
            href="https://opendatacommons.org/licenses/odbl/"
            rel="noreferrer noopener"
            target="_blank"
          >
            Open Database Licence (ODbL)
          </a>
          . Analysis produced by TrailLoop is a produced work derived from that data; attribution is
          shown wherever OSM-derived information is displayed.
        </p>
      </section>

      <section className="mt-6 space-y-3 text-sm">
        <h2 className="text-lg font-semibold">Physical path type is not legal designation</h2>
        <p>
          <code>highway=*</code> describes what a way physically is. <code>designation=*</code>{' '}
          records its legal status in England and Wales. A way tagged <code>highway=track</code>{' '}
          with <code>designation=public_bridleway</code> is a public bridleway that happens to be a
          track — TrailLoop shows both facts separately and never infers legal designation from the
          physical type alone.
        </p>
        <ul className="mt-2 space-y-1.5">
          {LEGEND_ORDER.map((category) => {
            const style = RIGHTS_OF_WAY_STYLES[category];
            return (
              <li key={category} className="flex items-start gap-2">
                <span
                  aria-hidden
                  className="mt-2 inline-block h-0 w-8 shrink-0 border-t-[3px]"
                  style={{
                    borderColor: style.color,
                    borderStyle: style.dashArray.length ? 'dashed' : 'solid',
                  }}
                />
                <span>
                  <strong>{style.label}.</strong> {style.description}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="mt-6 space-y-3 text-sm">
        <h2 className="text-lg font-semibold">Access confidence</h2>
        <p>Each section is given a confidence level:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>High</strong> — an explicit designation plus compatible explicit mode access, or
            an authoritative imported local-authority source.
          </li>
          <li>
            <strong>Medium</strong> — a recognised legal designation with no contradictory access
            tags, or explicit bicycle access with no formal designation.
          </li>
          <li>
            <strong>Low</strong> — inferred only from the physical highway type.
          </li>
          <li>
            <strong>Unknown</strong> — insufficient or conflicting tags. Missing data is never
            treated as permission.
          </li>
        </ul>
      </section>

      <section className="mt-6 space-y-3 text-sm">
        <h2 className="text-lg font-semibold">Jurisdiction</h2>
        <p>
          England-and-Wales rights-of-way rules are applied only inside England and Wales. Elsewhere
          — including Scotland, where statutory access rights differ substantially — TrailLoop shows
          the raw mapped tags, applies only unambiguous explicit restrictions, and displays a
          jurisdiction warning.
        </p>
      </section>

      <section className="mt-6 space-y-3 text-sm">
        <h2 className="text-lg font-semibold">Providers in this deployment</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Data mode: <code>{env.APP_DATA_MODE}</code>
            {fixture ? ' (synthetic demo data)' : ''}
          </li>
          <li>
            Routing: <code>{env.ROUTING_PROVIDER}</code>
          </li>
          <li>
            Rights of way: <code>{env.RIGHTS_OF_WAY_PROVIDER}</code>
          </li>
          <li>
            Geocoding: <code>{env.GEOCODING_PROVIDER}</code>
          </li>
          <li>
            Elevation: <code>{env.ELEVATION_PROVIDER}</code>
          </li>
        </ul>
        {fixture ? (
          <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
            This deployment is running in demo mode. Routes, paths, names and elevation are
            synthetic and are not live OpenStreetMap or routing data.
          </p>
        ) : null}
      </section>

      <section className="mt-6 space-y-3 text-sm">
        <h2 className="text-lg font-semibold">Limitations</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>OpenStreetMap access tags are incomplete and vary by area and mapper.</li>
          <li>
            The Definitive Map held by the local highway authority is the legal record, not OSM.
          </li>
          <li>Diversions, temporary closures and permissive-path withdrawals may not be mapped.</li>
          <li>
            Surface and technical tags are frequently missing; coverage figures show how much is
            known.
          </li>
          <li>
            Route-to-path matching can be ambiguous where ways run in parallel; those sections are
            marked uncertain.
          </li>
        </ul>
      </section>

      <section className="mt-6 space-y-3 text-sm">
        <h2 className="text-lg font-semibold">Improving the data</h2>
        <p>
          If a path is mis-tagged, the fix belongs in OpenStreetMap. Add or correct{' '}
          <code>designation</code>, <code>bicycle</code>, <code>foot</code>, <code>surface</code>{' '}
          and <code>prow_ref</code> tags via{' '}
          <a
            className="underline"
            href="https://www.openstreetmap.org"
            rel="noreferrer noopener"
            target="_blank"
          >
            openstreetmap.org
          </a>{' '}
          and TrailLoop will reflect the change on its next data refresh.
        </p>
        <p>
          See also the{' '}
          <Link className="underline" href="/privacy">
            privacy notice
          </Link>
          .
        </p>
      </section>
    </main>
  );
}
