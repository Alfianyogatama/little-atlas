import { expect, test, type Page } from '@playwright/test';
import enMessages from '../../messages/en.json' with { type: 'json' };
import idMessages from '../../messages/id.json' with { type: 'json' };

async function open(page: Page, query = ''): Promise<void> {
  await page.goto(`/${query}`);
  await expect(page.locator('main[data-state=ready]')).toBeAttached();
}

test.describe('bahasa perangkat id-ID (default)', () => {
  test.use({ locale: 'id-ID' });

  test('TC-F06-01 html lang id dan tombol zoom berbahasa Indonesia', async ({ page }) => {
    await open(page);
    await expect(page.locator('html')).toHaveAttribute('lang', 'id');
    await expect(page.getByRole('button', { name: idMessages.globe_zoom_in })).toBeVisible();
    await expect(page.getByRole('button', { name: idMessages.globe_zoom_out })).toBeVisible();
  });

  test('TC-F06-03 ?debug=1&lang=en mengganti bahasa saat runtime', async ({ page }) => {
    await open(page, '?debug=1&lang=en');
    // Tandai canvas dan catat jumlah build globe; ganti bahasa terjadi setelah ready.
    const canvas = page.locator('canvas');
    await expect(canvas).toHaveCount(1);
    const canvasHandle = await canvas.evaluateHandle((el) => el);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('button', { name: enMessages.globe_zoom_in })).toBeVisible();
    await expect(page.getByRole('button', { name: enMessages.globe_zoom_out })).toBeVisible();
    await expect(page.getByRole('button', { name: idMessages.globe_zoom_in })).toHaveCount(0);
    await expect(page.getByRole('button', { name: idMessages.globe_zoom_out })).toHaveCount(0);
    // Tanpa remount: canvas sama, tetap satu, dan globe dibangun tepat sekali.
    await expect(canvas).toHaveCount(1);
    expect(await canvas.evaluate((el, old) => el === old, canvasHandle)).toBe(true);
    expect(await page.evaluate(() => performance.getEntriesByName('globe-build').length)).toBe(1);
  });

  test('TC-F06-04 ?lang=en tanpa debug diabaikan', async ({ page }) => {
    await open(page, '?lang=en');
    await expect(page.locator('html')).toHaveAttribute('lang', 'id');
    await expect(page.getByRole('button', { name: idMessages.globe_zoom_in })).toBeVisible();
    await expect(page.getByRole('button', { name: enMessages.globe_zoom_in })).toHaveCount(0);
  });
});

test.describe('bahasa perangkat en-US', () => {
  test.use({ locale: 'en-US' });

  test('TC-F06-02 html lang en dan tombol zoom berbahasa Inggris', async ({ page }) => {
    await open(page);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('button', { name: enMessages.globe_zoom_in })).toBeVisible();
    await expect(page.getByRole('button', { name: enMessages.globe_zoom_out })).toBeVisible();
  });
});
