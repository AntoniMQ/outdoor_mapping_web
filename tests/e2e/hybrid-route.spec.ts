import { expect, test } from '@playwright/test';
import { clickMap, openPlanner } from './helpers';

test.describe('Workflow 3 — hybrid routed and freehand route', () => {
  test('mixes a routed section with a hand-drawn section and warns about it', async ({ page }) => {
    await openPlanner(page, 'manual');

    // Routed section first.
    await clickMap(page, 280, 260);
    await clickMap(page, 380, 220);
    await expect(page.getByTestId('point-list').getByRole('listitem')).toHaveCount(2);

    // Switch to freehand and draw.
    await page.getByTestId('draw-mode-freehand').click();
    const canvas = page.locator('canvas.maplibregl-canvas');
    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + 380, box.y + 220);
    await page.mouse.down();
    await page.mouse.move(box.x + 430, box.y + 250, { steps: 8 });
    await page.mouse.move(box.x + 480, box.y + 210, { steps: 8 });
    await page.mouse.up();
    await expect(page.getByTestId('point-list').getByRole('listitem')).toHaveCount(3);

    // Back to snapping, then add another routed point.
    await page.getByTestId('draw-mode-snap').click();
    await clickMap(page, 540, 260);
    await expect(page.getByTestId('point-list').getByRole('listitem')).toHaveCount(4);

    // The hand-drawn section must be reported as unverified.
    await expect(page.getByTestId('warning-list')).toContainText(/drawn by hand/i, {
      timeout: 30_000,
    });

    const download = page.waitForEvent('download');
    await page.getByTestId('download-gpx').click();
    expect((await download).suggestedFilename()).toMatch(/\.gpx$/);
  });
});
