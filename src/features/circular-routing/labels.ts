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
/**
 * Describes a route from the analysis in hand. Generation-time rationale is
 * written before any path data exists, so it must be replaced once analysis
 * lands — otherwise a card explains itself with figures that contradict the
 * ones printed directly above.
 */
export function describeRoute(route: AnalysedRoute, targetDistanceMetres?: number): string[] {
  const { analysis } = route;
  if (!analysis.analysed) {
    return [
      'This route has not been checked against mapped path data, so its surface and access figures are unknown.',
    ];
  }

  const reasons: string[] = [];
  if (targetDistanceMetres) {
    const delta = ((analysis.distanceMetres - targetDistanceMetres) / targetDistanceMetres) * 100;
    reasons.push(
      Math.abs(delta) <= 10
        ? `Within ${Math.abs(delta).toFixed(0)}% of your target distance.`
        : `${delta > 0 ? 'Longer' : 'Shorter'} than requested by ${Math.abs(delta).toFixed(0)}%.`,
    );
  }
  reasons.push(`${analysis.surface.offRoadPercent.toFixed(0)}% off-road by distance.`);
  reasons.push(
    `${analysis.access.confirmedPercent.toFixed(0)}% of the distance has confirmed access for this activity.`,
  );
  if (analysis.access.uncertainPercent > 10) {
    reasons.push(`${analysis.access.uncertainPercent.toFixed(0)}% has uncertain mapped access.`);
  }
  if (analysis.access.notConfirmedPercent > 1) {
    reasons.push(
      `${analysis.access.notConfirmedPercent.toFixed(0)}% follows paths where cycling is not confirmed.`,
    );
  }
  if (analysis.repeatedPercent > 15) {
    reasons.push(`Retraces ${analysis.repeatedPercent.toFixed(0)}% of its own distance.`);
  }
  return reasons;
}

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
