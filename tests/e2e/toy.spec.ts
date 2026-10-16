/// <reference lib="dom" />
import { expect, test, type Locator, type Page } from '@playwright/test';

interface Look {
  width: string;
  style: string;
  color: string;
  opacity: string;
  background: string;
  text: string;
}

/** Warna token diresolusi browser ke rgb() lewat elemen bantu. */
async function tokenRgb(page: Page, token: string): Promise<string> {
  return page.evaluate((name) => {
    const probe = document.createElement('div');
    probe.style.color = `var(${name})`;
    document.body.appendChild(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  }, token);
}

async function look(button: Locator): Promise<Look> {
  return button.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      width: s.borderTopWidth,
      style: s.borderTopStyle,
      color: s.borderTopColor,
      opacity: s.opacity,
      background: s.backgroundColor,
      text: s.color,
    };
  });
}

async function open(page: Page): Promise<Locator> {
  await page.goto('/');
  await expect(page.locator('main[data-state=ready]')).toBeAttached();
  const zoomIn = page.getByRole('button', { name: 'Perbesar' });
  await expect(zoomIn).toBeVisible();
  return zoomIn;
}

async function expectSize64(button: Locator): Promise<void> {
  const box = await button.boundingBox();
  expect(Math.abs((box?.width ?? 0) - 64)).toBeLessThanOrEqual(0.5);
  expect(Math.abs((box?.height ?? 0) - 64)).toBeLessThanOrEqual(0.5);
}

test.describe('tombol mainan, siang', () => {
  test('TC-28-01 tombol Perbesar tepat 64x64 termasuk garis', async ({ page }) => {
    await expectSize64(await open(page));
  });

  test('TC-28-02 keadaan biasa: garis 3px solid berwarna ink', async ({ page }) => {
    const zoomIn = await open(page);
    const ink = await tokenRgb(page, '--ink');
    const l = await look(zoomIn);
    expect(l.width).toBe('3px');
    expect(l.style).toBe('solid');
    expect(l.color).toBe(ink);
  });

  test('TC-28-03 nonaktif: tanpa opacity, latar toy-edge, garis dan ikon tetap ink', async ({
    page,
  }) => {
    const zoomIn = await open(page);
    for (let i = 0; i < 20 && (await zoomIn.getAttribute('aria-disabled')) !== 'true'; i++) {
      await zoomIn.click();
    }
    await expect(zoomIn).toHaveAttribute('aria-disabled', 'true');
    const ink = await tokenRgb(page, '--ink');
    const edge = await tokenRgb(page, '--toy-edge');
    const l = await look(zoomIn);
    expect(l.opacity).toBe('1');
    expect(l.width).toBe('3px');
    expect(l.style).toBe('solid');
    expect(l.color).toBe(ink);
    expect(l.background).toBe(edge);
    expect(l.text).toBe(ink);
    await expectSize64(zoomIn);
  });
});

test.describe('tombol mainan, malam', () => {
  test.use({ colorScheme: 'dark' });

  test('TC-28-04 tema malam: garis 3px solid berwarna ink malam', async ({ page }) => {
    const zoomIn = await open(page);
    const ink = await tokenRgb(page, '--ink');
    expect(ink).toBe('rgb(255, 244, 214)');
    const l = await look(zoomIn);
    expect(l.width).toBe('3px');
    expect(l.style).toBe('solid');
    expect(l.color).toBe(ink);
  });
});
