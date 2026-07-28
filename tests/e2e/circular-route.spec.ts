import { expect, test } from '@playwright/test';
import { openPlanner, setStartFromSearch } from './helpers';

test.describe('Workflow 1 — automatic circular route', () => {
  test('generates three alternatives, selects one and exports GPX', async ({ page }) => {
    await openPlanner(page, 'automatic');

    // Demo mode must be declared, never hidden.
    await expect(page.getByTestId('demo-banner')).toBeVisible();

    await page.getByTestId('route-type-circular').click();
    await page.getByTestId('activity-mtb').click();
    await setStartFromSearch(page);

    await page.getByTestId('target-distance').fill('18');
    await page.getByTestId('generate-routes').click();

    const cards = page.getByTestId(/^route-card-/);
    await expect(cards).toHaveCount(3, { timeout: 60_000 });
    await expect(page.getByTestId('route-card-0')).toContainText('Most off-road');
    await expect(page.getByTestId('route-card-1')).toContainText('Balanced');
    await expect(page.getByTestId('route-card-2')).toContainText('Easier');

    // The three options must not be identical.
    const distances = await page.getByTestId(/^route-distance-/).allTextContents();
    expect(new Set(distances).size).toBeGreaterThan(1);

    await page.getByTestId('select-route-1').click();
    await expect(page.getByTestId('select-route-1')).toHaveAttribute('aria-pressed', 'true');

    await expect(page.getByTestId('route-summary')).toContainText('Distance');
    await expect(page.getByTestId('route-summary')).toContainText('Access confidence');
    await expect(page.getByTestId('text-route-summary')).toContainText('off-road');

    const download = page.waitForEvent('download');
    await page.getByTestId('download-gpx').click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/\.gpx$/);
  });

  test('explains why generation is unavailable without a start point', async ({ page }) => {
    await openPlanner(page, 'automatic');
    await expect(page.getByTestId('generate-routes')).toBeDisabled();
    await expect(page.getByRole('note')).toContainText('Set a start point');
  });
});
