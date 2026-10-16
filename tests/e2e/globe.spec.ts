import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

interface CatalogEntry {
  alpha2: string;
  anchor: [number, number];
}

const catalog = JSON.parse(
  readFileSync('src/content/generated/countries.json', 'utf8'),
) as CatalogEntry[];
const japan = catalog.find((c) => c.alpha2 === 'JP');

function angularDistanceDeg(a: [number, number], b: [number, number]): number {
  const rad = Math.PI / 180;
  const cos =
    Math.sin(a[1] * rad) * Math.sin(b[1] * rad) +
    Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.cos((a[0] - b[0]) * rad);
  return Math.acos(Math.min(1, Math.max(-1, cos))) / rad;
}

test('?lookAt=JP memusatkan kamera ke Jepang setelah globe siap', async ({ page }) => {
  if (!japan) throw new Error('anchor Jepang tidak ada di countries.json');
  await page.goto('/?debug=1&lookAt=JP');
  await expect(page.locator('main[data-state=ready]')).toBeAttached();
  const holder = page.locator('[data-camera-lonlat]');
  await expect
    .poll(async () => {
      const raw = await holder.getAttribute('data-camera-lonlat');
      if (!raw) return 999;
      const [lon, lat] = raw.split(',').map(Number);
      return angularDistanceDeg([lon ?? 0, lat ?? 0], japan.anchor);
    })
    .toBeLessThan(10);
});

const holder = '[data-camera-lonlat]';

async function openAt(page: Page, query: string): Promise<void> {
  await page.goto(`/?debug=1${query}`);
  await expect(page.locator('main[data-state=ready]')).toBeAttached();
}

async function waitCameraNear(page: Page, target: [number, number], maxDeg = 0.5): Promise<void> {
  await expect
    .poll(async () => {
      const raw = await page.locator(holder).getAttribute('data-camera-lonlat');
      if (!raw) return 999;
      const [lon, lat] = raw.split(',').map(Number);
      return angularDistanceDeg([lon ?? 0, lat ?? 0], target);
    })
    .toBeLessThan(maxDeg);
}

async function canvasBox(page: Page) {
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('canvas tidak terlihat');
  return box;
}

async function tapCenter(page: Page, dx = 0, dy = 0): Promise<void> {
  const box = await canvasBox(page);
  await page.mouse.click(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
}

async function drawCalls(page: Page): Promise<number> {
  return Number(await page.locator(holder).getAttribute('data-draw-calls'));
}

async function cameraDistance(page: Page): Promise<number> {
  return Number(await page.locator(holder).getAttribute('data-camera-distance'));
}

test('TC-F02-01 mengetuk Jepang menyorot Jepang', async ({ page }) => {
  if (!japan) throw new Error('anchor Jepang tidak ada di countries.json');
  await openAt(page, '&lookAt=JP');
  await waitCameraNear(page, japan.anchor);
  await tapCenter(page);
  await expect(page.locator(holder)).toHaveAttribute('data-selected', 'JP');
});

test('TC-F02-02 menyeret globe tidak memilih negara tetapi memutar kamera', async ({ page }) => {
  if (!japan) throw new Error('anchor Jepang tidak ada di countries.json');
  await openAt(page, '&lookAt=JP');
  await waitCameraNear(page, japan.anchor);
  const before = await page.locator(holder).getAttribute('data-camera-lonlat');
  const box = await canvasBox(page);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 200, cy, { steps: 25 });
  await page.mouse.up();
  await expect.poll(() => page.locator(holder).getAttribute('data-camera-lonlat')).not.toBe(before);
  await expect(page.locator(holder)).toHaveAttribute('data-selected', '');
});

test('TC-ADR006-01 paling banyak 5 draw call saat diam dan saat bendera tampil', async ({
  page,
}) => {
  if (!japan) throw new Error('anchor Jepang tidak ada di countries.json');
  await openAt(page, '&lookAt=JP');
  await waitCameraNear(page, japan.anchor);
  await expect.poll(() => drawCalls(page)).toBeGreaterThan(0);
  expect(await drawCalls(page)).toBeLessThanOrEqual(5);
  await tapCenter(page);
  await expect(page.locator(holder)).toHaveAttribute('data-selected', 'JP');
  // Kontrak: Globe menulis data-flag="loaded" saat tekstur bendera terpasang.
  await expect(page.locator(holder)).toHaveAttribute('data-flag', 'loaded');
  await expect.poll(() => drawCalls(page)).toBeGreaterThan(0);
  expect(await drawCalls(page)).toBeLessThanOrEqual(5);
});

test('TC-F02-03 mengetuk laut mengosongkan pilihan', async ({ page }) => {
  if (!japan) throw new Error('anchor Jepang tidak ada di countries.json');
  await openAt(page, '&lookAt=JP');
  await waitCameraNear(page, japan.anchor);
  await tapCenter(page);
  await expect(page.locator(holder)).toHaveAttribute('data-selected', 'JP');
  // Setelah terbang selesai kamera tetap di Jepang; geser ketukan ke Pasifik di timurnya.
  const box = await canvasBox(page);
  await tapCenter(page, Math.round(box.height * 0.12), 0);
  await expect(page.locator(holder)).toHaveAttribute('data-selected', '');
});

test('TC-F02-04 tombol zoom besar, berlabel, dan membatasi jarak kamera', async ({ page }) => {
  await openAt(page, '');
  const zoomIn = page.getByRole('button', { name: 'Perbesar' });
  const zoomOut = page.getByRole('button', { name: 'Perkecil' });
  await expect(zoomIn).toBeVisible();
  await expect(zoomOut).toBeVisible();
  for (const button of [zoomIn, zoomOut]) {
    const box = await button.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(64);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(64);
  }
  // Kontrak: data-camera-distance = panjang vektor posisi kamera.
  await expect.poll(() => cameraDistance(page)).toBeGreaterThan(0);
  const start = await cameraDistance(page);
  await zoomIn.click();
  await expect.poll(() => cameraDistance(page)).toBeLessThan(start);
  for (let i = 0; i < 20 && (await zoomIn.getAttribute('aria-disabled')) !== 'true'; i++) {
    await zoomIn.click();
  }
  await expect(zoomIn).toHaveAttribute('aria-disabled', 'true');
});

test('TC-F02-06 reduced motion mematikan putar otomatis dan lompatan', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(`
    window.__jumpSeen = false;
    new MutationObserver((records) => {
      for (const r of records) if (r.target.dataset.jumping === 'true') window.__jumpSeen = true;
    }).observe(document, { attributes: true, attributeFilter: ['data-jumping'], subtree: true });
  `);
  await openAt(page, '&lookAt=JP');
  await expect(page.locator(holder)).toHaveAttribute('data-auto-rotate', 'false');
  await tapCenter(page);
  await expect(page.locator(holder)).toHaveAttribute('data-selected', 'JP');
  // Penghalang: beberapa frame berlalu setelah pilihan sebelum klaim negatif diperiksa.
  await page.evaluate(`new Promise((resolve) => {
    let n = 0;
    const tick = () => (++n >= 30 ? resolve() : requestAnimationFrame(tick));
    requestAnimationFrame(tick);
  })`);
  await expect(page.locator(holder)).toHaveAttribute('data-jumping', 'false');
  expect(await page.evaluate('window.__jumpSeen')).toBe(false);
});

test('TC-NFR-privasi tidak ada permintaan ke origin lain saat memilih Jepang', async ({
  page,
  baseURL,
}) => {
  if (!japan) throw new Error('anchor Jepang tidak ada di countries.json');
  const urls: string[] = [];
  page.on('request', (r) => urls.push(r.url()));
  await openAt(page, '&lookAt=JP');
  await waitCameraNear(page, japan.anchor);
  await tapCenter(page);
  await expect(page.locator(holder)).toHaveAttribute('data-selected', 'JP');
  await page.waitForLoadState('networkidle');
  const origin = new URL(baseURL ?? 'http://localhost:4173').origin;
  const external = urls.filter(
    (u) => !u.startsWith('data:') && !u.startsWith('blob:') && new URL(u).origin !== origin,
  );
  expect(external).toEqual([]);
});
