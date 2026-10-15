import { expect, test } from '@playwright/test';

test('halaman awal terbuka tanpa error dan tanpa permintaan keluar', async ({ page, baseURL }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const requestUrls: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('request', (r) => requestUrls.push(r.url()));

  await page.goto('/');
  await expect(page.getByRole('main')).toBeAttached();
  await page.waitForLoadState('networkidle');

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);

  const origin = new URL(baseURL ?? 'http://localhost:4173').origin;
  const external = requestUrls.filter(
    (u) => !u.startsWith('data:') && !u.startsWith('blob:') && new URL(u).origin !== origin,
  );
  expect(external).toEqual([]);
});
