import type { RightsOfWayCategory } from '@/types/domain';

export interface RightsOfWayStyle {
  category: RightsOfWayCategory;
  label: string;
  /** Colour used on the map, legend and inspector — always kept in sync. */
  color: string;
  /** Dash pattern in line-width multiples. Empty array = solid. */
  dashArray: number[];
  width: number;
  /** CSS description of the same pattern, for the legend. */
  legendPattern: string;
  description: string;
}

/**
 * Colour AND pattern differ for every category, so the overlay never relies on
 * colour alone (WCAG 1.4.1).
 */
export const RIGHTS_OF_WAY_STYLES: Record<RightsOfWayCategory, RightsOfWayStyle> = {
  public_footpath: {
    category: 'public_footpath',
    label: 'Public footpath',
    color: '#d99400',
    dashArray: [0.6, 1.4],
    width: 3,
    legendPattern: '2px 4px',
    description: 'Right of way on foot only. Cycling is not confirmed.',
  },
  public_bridleway: {
    category: 'public_bridleway',
    label: 'Public bridleway',
    color: '#2563eb',
    dashArray: [3, 1.6],
    width: 3.4,
    legendPattern: '9px 5px',
    description: 'Right of way on foot, horseback and pedal cycle in England and Wales.',
  },
  restricted_byway: {
    category: 'restricted_byway',
    label: 'Restricted byway',
    color: '#7c3aed',
    dashArray: [4, 1.4, 1, 1.4],
    width: 3.4,
    legendPattern: '12px 4px 3px 4px',
    description: 'Non-motorised vehicles, horses and walkers. No motor vehicles.',
  },
  byway_open_to_all_traffic: {
    category: 'byway_open_to_all_traffic',
    label: 'Byway open to all traffic',
    color: '#dc2626',
    dashArray: [],
    width: 4,
    legendPattern: 'none',
    description: 'Open to all traffic including motor vehicles.',
  },
  permissive: {
    category: 'permissive',
    label: 'Permissive path',
    color: '#059669',
    dashArray: [6, 2.4],
    width: 3,
    legendPattern: '16px 6px',
    description: 'Access allowed by the landowner. Not a statutory right and may be withdrawn.',
  },
  cycleway: {
    category: 'cycleway',
    label: 'Cycleway',
    color: '#0891b2',
    dashArray: [2, 1],
    width: 3,
    legendPattern: '6px 3px',
    description: 'Mapped as a cycleway.',
  },
  road: {
    category: 'road',
    label: 'Road',
    color: '#64748b',
    dashArray: [],
    width: 2,
    legendPattern: 'none',
    description: 'Public carriageway.',
  },
  track: {
    category: 'track',
    label: 'Track (status not mapped)',
    color: '#a16207',
    dashArray: [1.4, 1.4],
    width: 2.6,
    legendPattern: '4px 4px',
    description: 'Physical track with no mapped legal designation.',
  },
  unknown: {
    category: 'unknown',
    label: 'Unknown access',
    color: '#6b7280',
    dashArray: [0.4, 1.6],
    width: 2.4,
    legendPattern: '1px 4px',
    description: 'Access information is missing or conflicting. Verify locally.',
  },
};

export const LEGEND_ORDER: RightsOfWayCategory[] = [
  'public_footpath',
  'public_bridleway',
  'restricted_byway',
  'byway_open_to_all_traffic',
  'permissive',
  'cycleway',
  'track',
  'unknown',
];

export const ACCESS_STATUS_COLORS: Record<string, string> = {
  confirmed: '#059669',
  permissive: '#0891b2',
  uncertain: '#d97706',
  'not-confirmed': '#dc2626',
  prohibited: '#991b1b',
};
