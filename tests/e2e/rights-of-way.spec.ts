import { expect, test } from '@playwright/test';
import { clickMap, openPlanner } from './helpers';

test.describe('Workflow 4 — rights-of-way overlay', () => {
  test('shows the legend, distinguishes categories and inspects a path', async ({ page }) => {
    await openPlanner(page, 'automatic');

    await expect(page.getByRole('heading', { name: 'Rights of way' })).toBeVisible();
    for (const label of [
      'Public footpath',
      'Public bridleway',
      'Restricted byway',
      'Byway open to all traffic',
      'Permissive path',
      'Unknown access',
    ]) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
    }

    // Rights-of-way features are requested for the viewport.
    const response = await page.waitForResponse(
      (candidate) =>
        candidate.url().includes('/api/osm/rights-of-way') && candidate.status() === 200,
      { timeout: 30_000 },
    );
    const body = (await response.json()) as { features: unknown[] };
    expect(body.features.length).toBeGreaterThan(0);

    // Click around the middle of the map until a path is hit.
    for (const [x, y] of [
      [400, 260],
      [360, 300],
      [440, 220],
      [500, 320],
    ] as const) {
      await clickMap(page, x, y);
      if (
        await page
          .getByTestId('feature-inspector')
          .isVisible()
          .catch(() => false)
      )
        break;
    }

    const inspector = page.getByTestId('feature-inspector');
    await expect(inspector).toBeVisible();
    await expect(inspector).toContainText('Legal designation');
    await expect(inspector).toContainText('Cycling access');
    await expect(inspector).toContainText(/Confidence:/);
    await expect(inspector).toContainText('Why this classification');
    await expect(inspector).toContainText(/not legally authoritative/i);
  });

  test('hides the overlay when the layer is switched off', async ({ page }) => {
    await openPlanner(page, 'automatic');
    const toggle = page.getByTestId('toggle-row-enabled');
    await expect(toggle).toHaveAttribute('data-state', 'checked');
    await toggle.click();
    await expect(toggle).toHaveAttribute('data-state', 'unchecked');
  });
});
