'use client';

import { useState } from 'react';
import { LocateFixed, Search } from 'lucide-react';
import type { Coordinate, GeocodingResult } from '@/types/domain';
import { searchPlaces } from '@/features/api/client';
import { Button } from '@/components/ui';

export function LocationSearch({
  onSelect,
  label = 'Search for a place',
}: {
  onSelect: (coordinate: Coordinate, label: string) => void;
  label?: string;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeocodingResult[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error' | 'empty'>('idle');
  const [locating, setLocating] = useState(false);

  // Search is submitted explicitly — no upstream request per keystroke.
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (query.trim().length < 3) return;
    setStatus('loading');
    try {
      const response = await searchPlaces(query.trim());
      setResults(response.results);
      setStatus(response.results.length === 0 ? 'empty' : 'idle');
    } catch {
      setStatus('error');
    }
  };

  const useMyLocation = () => {
    if (!('geolocation' in navigator)) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        onSelect([position.coords.longitude, position.coords.latitude], 'My location');
      },
      () => setLocating(false),
      { timeout: 10_000 },
    );
  };

  return (
    <div className="space-y-2">
      <form onSubmit={submit} className="flex gap-1.5" role="search">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Town, village or landmark"
          aria-label={label}
          minLength={3}
          data-testid="location-search-input"
          className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 py-2 text-sm"
        />
        <Button
          type="submit"
          variant="secondary"
          aria-label="Search"
          data-testid="location-search-submit"
        >
          <Search aria-hidden size={16} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={useMyLocation}
          aria-label="Use my location"
          disabled={locating}
        >
          <LocateFixed aria-hidden size={16} />
        </Button>
      </form>

      <div aria-live="polite" className="text-xs text-[var(--color-ink-muted)]">
        {status === 'loading' ? 'Searching…' : null}
        {status === 'error'
          ? 'Search is unavailable right now. You can also click the map to set a point.'
          : null}
        {status === 'empty' ? 'No matching places found.' : null}
      </div>

      {results.length > 0 ? (
        <ul className="max-h-40 space-y-1 overflow-y-auto" data-testid="location-results">
          {results.map((result) => (
            <li key={result.id}>
              <button
                type="button"
                className="w-full rounded-md border border-[var(--color-line)] px-2 py-1.5 text-left text-xs hover:bg-[var(--color-surface-muted)]"
                onClick={() => {
                  onSelect(result.coordinate, result.label);
                  setResults([]);
                  setQuery(result.label);
                }}
              >
                {result.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
