import { FlaskConical } from 'lucide-react';

export function DataModeBanner({ fixtureMode }: { fixtureMode: boolean }) {
  if (!fixtureMode) return null;
  return (
    <div
      role="status"
      data-testid="demo-banner"
      className="flex items-center gap-2 border-b border-amber-300 bg-amber-100 px-4 py-1.5 text-xs text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
    >
      <FlaskConical aria-hidden size={14} />
      <span>
        <strong>Demo data — not live mapping information.</strong> Routes, paths and elevation are
        generated from a deterministic synthetic network so the app works without API credentials.
      </span>
    </div>
  );
}
