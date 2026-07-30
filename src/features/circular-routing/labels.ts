import type { AnalysedRoute, CandidateLabelKey } from '@/types/domain';

export const CANDIDATE_LABELS: Record<CandidateLabelKey, string> = {
  'most-off-road': 'Most off-road',
  balanced: 'Balanced',
  easier: 'Easier / lower risk',
};

function easeScore(route: AnalysedRoute): number {
  const { analysis } = route;
  const climbPerKm = analysis.ascentMetres / Math.max(1, analysis.distanceMetres / 1000);
  return (
    analysis.access.confirmedPercent / 100 +
    analysis.coverage.accessDataPercent / 200 -
    climbPerKm / 60 -
    analysis.access.uncertainPercent / 200
  );
}

/**
 * Assigns the three headline labels. Shared by the server (when analysis runs
 * inline) and the client (when analysis is deferred), so a route is described
 * the same way whichever path produced it.
 *
 * Routes that have not been analysed carry no meaningful off-road or access
 * figures, so they keep neutral positional labels instead.
 */
export function labelAlternatives<T extends AnalysedRoute>(routes: T[]): T[] {
  if (routes.length === 0) return [];
  if (!routes.every((route) => route.analysis.analysed)) {
    return routes.map((route, index) => ({
      ...route,
      label: `Option ${index + 1}`,
      labelKey: undefined,
    }));
  }

  const remaining = [...routes];
  const chosen: T[] = [];

  const take = (labelKey: CandidateLabelKey, compare: (a: T, b: T) => number) => {
    if (remaining.length === 0) return;
    remaining.sort(compare);
    const pick = remaining.shift()!;
    chosen.push({ ...pick, label: CANDIDATE_LABELS[labelKey], labelKey });
  };

  take(
    'most-off-road',
    (a, b) => b.analysis.surface.offRoadPercent - a.analysis.surface.offRoadPercent,
  );
  take('balanced', (a, b) => (b.score ?? 0) - (a.score ?? 0));
  take('easier', (a, b) => easeScore(b) - easeScore(a));

  return chosen;
}
