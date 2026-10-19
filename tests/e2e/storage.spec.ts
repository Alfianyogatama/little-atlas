/// <reference lib="dom" />
import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import idMessages from '../../messages/id.json' with { type: 'json' };
import { routeNoAudioMap } from './helpers/no-audio-map';
import { readProgressRow, waitForSavedStars, writeProgressRow } from './helpers/storage';

interface CatalogEntry {
  alpha2: string;
  name: { id: string; en: string };
}
const catalog = JSON.parse(
  readFileSync('src/content/generated/countries.json', 'utf8'),
) as CatalogEntry[];

function fmt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key] ?? `{${key}}`));
}

const quizRoot = '[data-quiz-round]';

// Stub Web Speech agar tes tidak bergantung pada suara browser headless (sama dengan flag-quiz.spec).
const speechStub = `
  window.__spoken = [];
  class StubUtterance {
    constructor(text) { this.text = text === undefined ? '' : text; this.lang = ''; this.rate = 1; this.pitch = 1; this.voice = null; this.onend = null; }
  }
  window.SpeechSynthesisUtterance = StubUtterance;
  const stub = {
    getVoices: () => [{ lang: 'id-ID', localService: true, name: 'stub-id' }],
    speak: (u) => { window.__spoken.push(u.text); setTimeout(() => u.onend && u.onend(), 0); },
    cancel: () => {}, pause: () => {}, resume: () => {},
    addEventListener: () => {}, removeEventListener: () => {},
    speaking: false, pending: false, paused: false, onvoiceschanged: null,
  };
  Object.defineProperty(window, 'speechSynthesis', { value: stub, configurable: true });
`;

test.beforeEach(async ({ page }) => {
  await routeNoAudioMap(page);
  await page.addInitScript(speechStub);
});

function starsOf(page: Page, count: number): Locator {
  return page.getByRole('status', {
    name: fmt(idMessages.quiz_stars_label, { count }),
    exact: true,
  });
}

async function openApp(page: Page, query = ''): Promise<void> {
  await page.goto(`/?debug=1${query}`);
  await expect(page.locator('main[data-state=ready]')).toBeAttached();
}

/** Buka kuis dan jawab soal pertama dengan benar; bintang jadi 1. */
async function earnOneStar(page: Page): Promise<void> {
  await page.getByRole('button', { name: idMessages.mode_quiz, exact: true }).click();
  const region = page.getByRole('region', { name: idMessages.quiz_region_label, exact: true });
  await expect(region).toBeVisible();
  await expect(page.locator(quizRoot)).toHaveAttribute('data-quiz-phase', 'asking');
  const target = (await page.locator(quizRoot).getAttribute('data-quiz-target')) ?? '';
  const found = catalog.find((c) => c.alpha2 === target);
  expect(found, `target ${target} ada di katalog`).toBeDefined();
  const label = fmt(idMessages.quiz_choice_label, { name: found?.name.id ?? '' });
  await region.getByRole('button', { name: label, exact: true }).click();
  await expect(starsOf(page, 1)).toBeVisible();
}

test('TC-F11-01 bintang bertahan setelah reload dan tersimpan di IndexedDB little-atlas', async ({
  page,
}) => {
  await openApp(page, '&quizSeed=7');
  await earnOneStar(page);

  await waitForSavedStars(page, 1);

  await page.reload();
  await expect(page.locator('main[data-state=ready]')).toBeAttached();
  await expect(starsOf(page, 1)).toBeVisible();
});

test('TC-F11-02 bintang v0 di localStorage dimigrasi sekali, key dihapus, reload tetap 7', async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('__seeded')) {
      sessionStorage.setItem('__seeded', '1');
      localStorage.setItem('halo-dunia-stars', '7');
    }
  });
  await openApp(page);
  await expect(starsOf(page, 7)).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('halo-dunia-stars'))).toBeNull();
  await expect
    .poll(() => readProgressRow(page, 'default'))
    .toMatchObject({ profileId: 'default', stars: 7 });

  await page.reload();
  await expect(page.locator('main[data-state=ready]')).toBeAttached();
  await expect(starsOf(page, 7)).toBeVisible();
});

test('TC-F11-03 selama kuis dan reload semua permintaan hanya ke origin aplikasi', async ({
  page,
  baseURL,
}) => {
  const requestUrls: string[] = [];
  page.on('request', (r) => requestUrls.push(r.url()));

  await openApp(page, '&quizSeed=7');
  await earnOneStar(page);
  await waitForSavedStars(page, 1); // reload menunggu commit: tulis IndexedDB asinkron (ADR-002 revisi 19 Okt)
  await page.reload();
  await expect(page.locator('main[data-state=ready]')).toBeAttached();
  await expect(starsOf(page, 1)).toBeVisible();
  await page.waitForLoadState('networkidle');

  expect(requestUrls.length).toBeGreaterThan(0);
  const origin = new URL(baseURL ?? 'http://localhost:4174').origin;
  const external = requestUrls.filter(
    (u) => !u.startsWith('data:') && !u.startsWith('blob:') && new URL(u).origin !== origin,
  );
  expect(external).toEqual([]);
});

test('TC-F11-04 baris progress rusak: bintang 0 tanpa error halaman', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await openApp(page);
  await expect(starsOf(page, 0)).toBeVisible();

  await writeProgressRow(page, {
    profileId: 'default',
    stars: 'x',
    flagQuizLevel: 1,
    flagQuizWindow: [],
  });
  await expect
    .poll(() => readProgressRow(page, 'default'))
    .toMatchObject({ profileId: 'default', stars: 'x' });

  await page.reload();
  await expect(page.locator('main[data-state=ready]')).toBeAttached();
  await expect(starsOf(page, 0)).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test('TC-F11-05 quizStars debug hanya menimpa tampilan awal; setelah reload tanpa param tampil nilai tersimpan', async ({
  page,
}) => {
  await openApp(page, '&quizStars=4');
  await expect(starsOf(page, 4)).toBeVisible();

  await page.goto('/?debug=1');
  await expect(page.locator('main[data-state=ready]')).toBeAttached();
  await expect(starsOf(page, 0)).toBeVisible();
});
