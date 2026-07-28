import type { Metadata } from 'next';
import { serverEnv } from '@/lib/env/server';

export const metadata: Metadata = {
  title: 'Privacy',
  description:
    'What TrailLoop sends to third parties, what it stores and what it does not collect.',
};

export const dynamic = 'force-dynamic';

export default function PrivacyPage() {
  const env = serverEnv();
  const fixture = env.APP_DATA_MODE === 'fixture';

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 text-sm">
      <h1 className="text-3xl font-semibold">Privacy</h1>

      <h2 className="mt-6 text-lg font-semibold">Route coordinates</h2>
      <p className="mt-2">
        Coordinates you place on the map are sent to the TrailLoop server so it can plan routes and
        analyse access.
        {fixture
          ? ' In this deployment the server is running in demo mode: nothing is forwarded to an external routing or map-data provider.'
          : ' In live mode the server forwards those coordinates to the configured routing, elevation and geocoding providers. Requests are made server-side, so those providers see the TrailLoop server rather than your browser.'}
      </p>

      <h2 className="mt-6 text-lg font-semibold">Browser location</h2>
      <p className="mt-2">
        Location is only read if you press “Use my location”, and only after your browser asks for
        permission. If you decline, everything else continues to work — you can search for a place
        or click the map instead. Your location is not stored on the server.
      </p>

      <h2 className="mt-6 text-lg font-semibold">What is retained</h2>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>
          Upstream provider responses (paths in a bounding box, geocoding results) are cached for a
          short period to reduce load on public services.
        </li>
        <li>
          Server logs record request identifiers, timings and error codes. API keys and secrets are
          redacted.
        </li>
        <li>
          Route drafts stay in your browser. There is no account and no cloud route library in this
          release.
        </li>
      </ul>

      <h2 className="mt-6 text-lg font-semibold">Analytics</h2>
      <p className="mt-2">
        No analytics or tracking scripts are loaded unless explicitly configured by the operator of
        this deployment. None are configured by default.
      </p>

      <h2 className="mt-6 text-lg font-semibold">Third-party map tiles</h2>
      <p className="mt-2">
        Basemap tiles are requested by your browser from the configured tile provider, which will
        see your IP address and the tiles you request. The provider is configurable through{' '}
        <code>NEXT_PUBLIC_MAP_STYLE_URL</code>.
      </p>
    </main>
  );
}
