'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { BoundingBox, RightsOfWayCollection } from '@/types/domain';
import { boundingBoxAreaSqKm } from '@/lib/geo/geometry';
import { fetchRightsOfWay, type RightsOfWayResponse } from '@/features/api/client';

export const RIGHTS_OF_WAY_MIN_ZOOM = 12;

/** Debounced, viewport-bounded rights-of-way loading with request cancellation. */
export function useRightsOfWay(bbox: BoundingBox | null, zoom: number, enabled: boolean) {
  const [debounced, setDebounced] = useState<{ bbox: BoundingBox; zoom: number } | null>(null);

  useEffect(() => {
    if (!bbox) return;
    const timer = setTimeout(() => setDebounced({ bbox, zoom }), 350);
    return () => clearTimeout(timer);
  }, [bbox, zoom]);

  const key = useMemo(() => {
    if (!debounced) return null;
    // Snap the key so small pans reuse the cached response.
    return debounced.bbox.map((value) => (Math.round(value * 200) / 200).toFixed(3)).join(',');
  }, [debounced]);

  const tooLowZoom = zoom < RIGHTS_OF_WAY_MIN_ZOOM;
  const tooLarge = debounced ? boundingBoxAreaSqKm(debounced.bbox) > 400 : false;

  const query = useQuery<RightsOfWayResponse>({
    queryKey: ['rights-of-way', key],
    enabled: enabled && Boolean(debounced) && !tooLowZoom && !tooLarge,
    queryFn: ({ signal }) => fetchRightsOfWay(debounced!.bbox, debounced!.zoom, signal),
    staleTime: 5 * 60_000,
  });

  return {
    ...query,
    tooLowZoom,
    tooLarge,
    collection: (query.data ?? null) as RightsOfWayCollection | null,
  };
}

/** Debounces a value; used to avoid a request per keystroke. */
export function useDebounced<T>(value: T, delayMs = 400): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

export function useAbortableRef(): React.MutableRefObject<AbortController | null> {
  const ref = useRef<AbortController | null>(null);
  useEffect(() => () => ref.current?.abort(), []);
  return ref;
}
