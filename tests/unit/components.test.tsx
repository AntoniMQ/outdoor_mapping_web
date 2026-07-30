import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AnalysedRoute, RightsOfWayFeature } from '@/types/domain';
import { classifyPath } from '@/features/rights-of-way/access-policy';
import { createInitialState, editorReducer } from '@/features/manual-routing/reducer';
import { FeatureInspector } from '@/components/rights-of-way/feature-inspector';
import { RouteCard } from '@/components/route-results/route-card';
import { WarningList } from '@/components/route-results/warning-list';
import { ManualToolbar } from '@/components/route-editor/manual-toolbar';
import { RightsOfWayLegend } from '@/components/rights-of-way/legend';

function makeFeature(tags: Record<string, string>): RightsOfWayFeature {
  return {
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: [
        [-0.5, 51.65],
        [-0.49, 51.65],
      ],
    },
    properties: {
      osmType: 'way',
      osmId: 12345,
      tags,
      classification: classifyPath(tags, 'england-wales'),
      source: 'fixture',
      sourceUpdatedAt: '2026-01-01T00:00:00Z',
    },
  };
}

const analysedRoute: AnalysedRoute = {
  route: {
    id: 'r1',
    geometry: {
      type: 'LineString',
      coordinates: [
        [-0.5, 51.65],
        [-0.49, 51.65],
      ],
    },
    distanceMetres: 25_000,
    bbox: [-0.5, 51.6, -0.4, 51.7],
    segments: [],
    provider: 'fixture',
    warnings: [],
    isSyntheticData: true,
  },
  analysis: {
    distanceMetres: 25_000,
    durationSeconds: 7_200,
    ascentMetres: 420,
    descentMetres: 415,
    hasElevationData: true,
    surface: { pavedPercent: 20, unpavedPercent: 60, unknownPercent: 20, offRoadPercent: 72 },
    designation: {
      publicFootpathPercent: 4,
      publicBridlewayPercent: 45,
      restrictedBywayPercent: 6,
      bywayOpenToAllTrafficPercent: 3,
      permissivePercent: 2,
      roadPercent: 30,
      otherPercent: 10,
    },
    access: {
      confirmedPercent: 78,
      permissivePercent: 2,
      uncertainPercent: 16,
      notConfirmedPercent: 4,
      prohibitedPercent: 0,
    },
    coverage: { accessDataPercent: 84, surfaceDataPercent: 70, technicalDataPercent: 22 },
    repeatedPercent: 5,
    warnings: [],
    jurisdiction: 'england-wales',
    matchedDistanceMetres: 21_000,
    isSyntheticData: true,
  },
  label: 'Most off-road',
  rationale: ['Within 2% of your target distance.'],
};

describe('FeatureInspector', () => {
  it('shows designation, access, confidence and the reasoning', async () => {
    render(
      <FeatureInspector
        feature={makeFeature({
          highway: 'track',
          designation: 'public_bridleway',
          surface: 'compacted',
        })}
        onClose={() => {}}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Public bridleway' })).toBeInTheDocument();
    expect(screen.getByText('Cycling: confirmed')).toBeInTheDocument();
    expect(screen.getByText(/Confidence: medium/)).toBeInTheDocument();
    expect(screen.getByText(/Countryside Act 1968/)).toBeInTheDocument();
    expect(screen.getByText('way/12345')).toBeInTheDocument();
    expect(screen.getByText(/not legally authoritative/i)).toBeInTheDocument();
  });

  it('says "Not mapped" instead of inventing values', () => {
    render(<FeatureInspector feature={makeFeature({ highway: 'path' })} onClose={() => {}} />);
    expect(screen.getAllByText('Not mapped').length).toBeGreaterThan(3);
  });

  it('warns that cycling is not confirmed on a public footpath', () => {
    render(
      <FeatureInspector
        feature={makeFeature({ highway: 'footway', designation: 'public_footpath' })}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText('Cycling: not-confirmed')).toBeInTheDocument();
  });

  it('can be closed from the keyboard', async () => {
    const onClose = vi.fn();
    render(<FeatureInspector feature={makeFeature({ highway: 'path' })} onClose={onClose} />);
    await userEvent.tab();
    await userEvent.keyboard('{Enter}');
    expect(onClose).toHaveBeenCalled();
  });
});

describe('RouteCard', () => {
  it('shows the headline figures and the selection rationale', async () => {
    const onSelect = vi.fn();
    render(<RouteCard result={analysedRoute} index={0} selected={false} onSelect={onSelect} />);
    expect(screen.getByText('Most off-road')).toBeInTheDocument();
    expect(screen.getByTestId('route-distance-0')).toHaveTextContent('25.0 km');
    expect(screen.getByText('72%')).toBeInTheDocument();
    expect(screen.getByText('78%')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('select-route-0'));
    expect(onSelect).toHaveBeenCalled();
  });

  it('marks the selected card with aria-pressed', () => {
    render(<RouteCard result={analysedRoute} index={1} selected onSelect={() => {}} />);
    expect(screen.getByTestId('select-route-1')).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('WarningList', () => {
  it('lists warnings with the affected distance', () => {
    render(
      <WarningList
        warnings={[
          {
            code: 'PUBLIC_FOOTPATH_CYCLING_UNCONFIRMED',
            severity: 'critical',
            message: '1.2 km follows paths where cycling is not confirmed.',
            affectedDistanceMetres: 1_200,
            segmentIndexes: [3, 4],
          },
        ]}
      />,
    );
    expect(screen.getByLabelText('Route warnings')).toBeInTheDocument();
    expect(screen.getByText(/cycling is not confirmed/)).toBeInTheDocument();
    expect(screen.getByText(/Affects 1.2 km across 2 sections/)).toBeInTheDocument();
  });

  it('says so when there are no warnings', () => {
    render(<WarningList warnings={[]} />);
    expect(screen.getByText(/No access or surface warnings/)).toBeInTheDocument();
  });
});

describe('ManualToolbar', () => {
  const state = editorReducer(
    editorReducer(createInitialState('mtb'), { type: 'add-point', coordinate: [-0.5, 51.65] }),
    { type: 'add-point', coordinate: [-0.49, 51.66] },
  );

  it('disables undo and redo when there is no history', () => {
    render(
      <ManualToolbar
        state={state}
        canUndo={false}
        canRedo={false}
        dispatch={() => {}}
        onUndo={() => {}}
        onRedo={() => {}}
      />,
    );
    expect(screen.getByTestId('undo')).toBeDisabled();
    expect(screen.getByTestId('redo')).toBeDisabled();
  });

  it('only offers to close the loop once there are three points', () => {
    render(
      <ManualToolbar
        state={state}
        canUndo
        canRedo
        dispatch={() => {}}
        onUndo={() => {}}
        onRedo={() => {}}
      />,
    );
    expect(screen.getByTestId('close-loop')).toBeDisabled();
  });

  it('dispatches reverse and delete actions', async () => {
    const dispatch = vi.fn();
    render(
      <ManualToolbar
        state={state}
        canUndo
        canRedo
        dispatch={dispatch}
        onUndo={() => {}}
        onRedo={() => {}}
      />,
    );
    await userEvent.click(screen.getByTestId('reverse-route'));
    expect(dispatch).toHaveBeenCalledWith({ type: 'reverse' });
    await userEvent.click(screen.getByTestId('delete-point-0'));
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'delete-point' }));
  });
});

describe('RightsOfWayLegend', () => {
  it('lists every rights-of-way category and can be collapsed', async () => {
    render(<RightsOfWayLegend />);
    expect(screen.getByText('Public footpath')).toBeInTheDocument();
    expect(screen.getByText('Byway open to all traffic')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /collapse legend/i }));
    expect(screen.queryByText('Public footpath')).not.toBeInTheDocument();
  });
});
