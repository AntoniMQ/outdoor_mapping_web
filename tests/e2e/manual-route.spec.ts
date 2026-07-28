import { expect, test } from '@playwright/test';
import { clickMap, openPlanner } from './helpers';

test.describe('Workflow 2 — manual route editing', () => {
  test('adds points, inserts a shaping point, undoes, redoes, closes the loop and exports', async ({
    page,
  }) => {
    await openPlanner(page, 'manual');

    await clickMap(page, 300, 260);
    await clickMap(page, 420, 200);
    await expect(page.getByTestId('point-list').getByRole('listitem')).toHaveCount(2);

    await clickMap(page, 460, 320);
    await expect(page.getByTestId('point-list').getByRole('listitem')).toHaveCount(3);

    // Routed sections must resolve rather than stay pending.
    await expect(page.getByTestId('route-summary')).toBeVisible({ timeout: 30_000 });

    const before = await page.getByTestId('point-list').getByRole('listitem').count();
    await page.getByTestId('undo').click();
    await expect(page.getByTestId('point-list').getByRole('listitem')).toHaveCount(before - 1);
    await page.getByTestId('redo').click();
    await expect(page.getByTestId('point-list').getByRole('listitem')).toHaveCount(before);

    await page.getByTestId('close-loop').click();
    await expect(page.getByTestId('open-loop')).toBeVisible();

    const download = page.waitForEvent('download');
    await page.getByTestId('download-gpx').click();
    expect((await download).suggestedFilename()).toMatch(/\.gpx$/);
  });

  test('keeps the route when a point is deleted', async ({ page }) => {
    await openPlanner(page, 'manual');
    await clickMap(page, 280, 240);
    await clickMap(page, 400, 300);
    await clickMap(page, 500, 220);
    await page.getByTestId('delete-point-1').click();
    await expect(page.getByTestId('point-list').getByRole('listitem')).toHaveCount(2);
  });
});
