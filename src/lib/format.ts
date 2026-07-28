import type { DistanceUnit } from '@/types/domain';

const KM_PER_MILE = 1.609344;

export function metresToUnit(metres: number, unit: DistanceUnit): number {
  return unit === 'mi' ? metres / 1000 / KM_PER_MILE : metres / 1000;
}

export function unitToMetres(value: number, unit: DistanceUnit): number {
  return unit === 'mi' ? value * KM_PER_MILE * 1000 : value * 1000;
}

/** Distance with one decimal — avoids implying false precision. */
export function formatDistance(metres: number, unit: DistanceUnit = 'km'): string {
  return `${metresToUnit(metres, unit).toFixed(1)} ${unit}`;
}

export function formatElevation(metres: number | undefined): string {
  if (metres === undefined || Number.isNaN(metres)) return 'Not available';
  return `${Math.round(metres)} m`;
}

export function formatDuration(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return 'Not available';
  const total = Math.round(seconds / 60);
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return hours > 0 ? `${hours} h ${minutes.toString().padStart(2, '0')} min` : `${minutes} min`;
}

export function formatPercent(value: number, decimals = 0): string {
  if (!Number.isFinite(value)) return '—';
  return `${value.toFixed(decimals)}%`;
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
