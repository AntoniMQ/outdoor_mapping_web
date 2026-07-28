import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

/** Waits for MapLibre to finish loading before interacting with the canvas. */
export async function openPlanner(
  page: Page,
  mode: 'automatic' | 'manual' = 'automatic',
): Promise<void> {
  await page.goto(`/planner?mode=${mode}`);
  await expect(page.getByTestId('map-canvas')).toBeVisible();
  await page.waitForFunction(
    () => document.querySelector('canvas.maplibregl-canvas') !== null,
    undefined,
    {
      timeout: 30_000,
    },
  );
  // Give MapLibre a beat to install sources and layers.
  await page.waitForTimeout(750);
}

export async function clickMap(page: Page, x: number, y: number): Promise<void> {
  const canvas = page.locator('canvas.maplibregl-canvas');
  await canvas.click({ position: { x, y } });
  await page.waitForTimeout(250);
}

export async function setStartFromSearch(page: Page, query = 'chorleywood'): Promise<void> {
  await page.getByTestId('location-search-input').fill(query);
  await page.getByTestId('location-search-submit').click();
  await page.getByTestId('location-results').getByRole('button').first().click();
  await expect(page.getByTestId('start-readout')).toContainText('Start:');
}
