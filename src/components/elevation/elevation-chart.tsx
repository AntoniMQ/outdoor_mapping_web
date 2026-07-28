'use client';

import { useMemo, useState } from 'react';
import type { ElevationProfile } from '@/types/domain';
import { formatDistance, formatElevation } from '@/lib/format';

const WIDTH = 520;
const HEIGHT = 120;
const PADDING = { top: 8, right: 8, bottom: 18, left: 34 };

export function ElevationChart({
  profile,
  onHoverDistance,
}: {
  profile: ElevationProfile;
  onHoverDistance?: (distanceMetres: number | null) => void;
}) {
  const [hover, setHover] = useState<{ x: number; index: number } | null>(null);

  // Large profiles are downsampled for rendering only — export keeps full detail.
  const points = useMemo(() => {
    const source = profile.points;
    if (source.length <= 400) return source;
    const step = (source.length - 1) / 399;
    return Array.from({ length: 400 }, (_, i) => source[Math.round(i * step)]!);
  }, [profile.points]);

  if (points.length < 2) {
    return (
      <p className="text-xs text-[var(--color-ink-muted)]">
        Elevation data is not available for this route.
      </p>
    );
  }

  const maxDistance = points[points.length - 1]!.distanceMetres || 1;
  const min = profile.minElevationMetres;
  const max = Math.max(profile.maxElevationMetres, min + 10);
  const innerWidth = WIDTH - PADDING.left - PADDING.right;
  const innerHeight = HEIGHT - PADDING.top - PADDING.bottom;

  const toX = (distance: number) => PADDING.left + (distance / maxDistance) * innerWidth;
  const toY = (elevation: number) =>
    PADDING.top + innerHeight - ((elevation - min) / (max - min)) * innerHeight;

  const path = points
    .map(
      (point, index) =>
        `${index === 0 ? 'M' : 'L'}${toX(point.distanceMetres).toFixed(1)},${toY(point.elevationMetres).toFixed(1)}`,
    )
    .join(' ');
  const area = `${path} L${toX(maxDistance).toFixed(1)},${(PADDING.top + innerHeight).toFixed(1)} L${PADDING.left},${(PADDING.top + innerHeight).toFixed(1)} Z`;

  const hovered = hover ? points[hover.index] : null;

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-32 w-full"
        role="img"
        aria-label={`Elevation profile. Ascent ${Math.round(profile.ascentMetres)} metres, descent ${Math.round(profile.descentMetres)} metres, highest point ${Math.round(profile.maxElevationMetres)} metres.`}
        onMouseLeave={() => {
          setHover(null);
          onHoverDistance?.(null);
        }}
        onMouseMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const relative = ((event.clientX - rect.left) / rect.width) * WIDTH;
          const ratio = Math.min(1, Math.max(0, (relative - PADDING.left) / innerWidth));
          const index = Math.round(ratio * (points.length - 1));
          setHover({ x: relative, index });
          onHoverDistance?.(points[index]?.distanceMetres ?? null);
        }}
      >
        <path d={area} fill="var(--color-moss)" opacity={0.18} />
        <path d={path} fill="none" stroke="var(--color-moss)" strokeWidth={1.8} />
        <line
          x1={PADDING.left}
          x2={WIDTH - PADDING.right}
          y1={PADDING.top + innerHeight}
          y2={PADDING.top + innerHeight}
          stroke="var(--color-line)"
        />
        <text x={2} y={PADDING.top + 8} fontSize={9} fill="var(--color-ink-muted)">
          {Math.round(max)}m
        </text>
        <text x={2} y={PADDING.top + innerHeight} fontSize={9} fill="var(--color-ink-muted)">
          {Math.round(min)}m
        </text>
        {hovered ? (
          <g>
            <line
              x1={toX(hovered.distanceMetres)}
              x2={toX(hovered.distanceMetres)}
              y1={PADDING.top}
              y2={PADDING.top + innerHeight}
              stroke="var(--color-route)"
              strokeDasharray="3 3"
            />
            <circle
              cx={toX(hovered.distanceMetres)}
              cy={toY(hovered.elevationMetres)}
              r={3}
              fill="var(--color-route)"
            />
          </g>
        ) : null}
      </svg>
      <figcaption className="mt-1 text-xs text-[var(--color-ink-muted)]">
        {hovered
          ? `${formatDistance(hovered.distanceMetres)} · ${formatElevation(hovered.elevationMetres)}`
          : `Ascent ${formatElevation(profile.ascentMetres)} · Descent ${formatElevation(profile.descentMetres)}${profile.isSyntheticData ? ' · synthetic terrain (demo)' : ''}`}
      </figcaption>
    </figure>
  );
}
