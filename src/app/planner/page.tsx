import { Suspense } from 'react';
import type { Metadata } from 'next';
import { isFixtureMode, serverEnv } from '@/lib/env/server';
import { DataModeBanner } from '@/components/layout/data-mode-banner';
import { Planner } from '@/components/planner/planner';

export const metadata: Metadata = {
  title: 'Planner',
  description:
    'Plan circular, point-to-point, out-and-back, manual and freehand routes with rights-of-way analysis.',
};

export const dynamic = 'force-dynamic';

export default function PlannerPage() {
  const fixtureMode = isFixtureMode(serverEnv());
  return (
    <main className="flex flex-1 flex-col">
      <DataModeBanner fixtureMode={fixtureMode} />
      <Suspense
        fallback={
          <div className="p-6 text-sm text-[var(--color-ink-muted)]" role="status">
            Loading planner…
          </div>
        }
      >
        <Planner fixtureMode={fixtureMode} />
      </Suspense>
    </main>
  );
}
