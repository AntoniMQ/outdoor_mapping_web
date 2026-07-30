import { FlaskConical } from 'lucide-react';

export function DataModeBanner({
  fixtureMode,
  syntheticParts,
}: {
  fixtureMode: boolean;
  /** Human-readable list, e.g. "routes and elevation". Empty when everything is live. */
  syntheticParts?: string;
}) {
  if (!fixtureMode) return null;
  const parts =
    syntheticParts && syntheticParts.length > 0 ? syntheticParts : 'routes, paths and elevation';
  return (
    <div
      role="status"
      data-testid="demo-banner"
      className="flex items-center gap-2 border-b border-amber-300 bg-amber-100 px-4 py-1.5 text-xs text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
    >
      <FlaskConical aria-hidden size={14} />
      <span>
        <strong>Demo data in use.</strong> On this deployment, {parts}{' '}
        {parts.includes(' and ') ? 'are' : 'is'} generated from a deterministic synthetic network
        rather than live services. Everything else shown is real data.
      </span>
    </div>
  );
}
