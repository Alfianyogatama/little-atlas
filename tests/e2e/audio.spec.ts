/// <reference lib="dom" />
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import idMessages from '../../messages/id.json' with { type: 'json' };

/**
 * Issue #8 (F-07.1, F-07.2, F-07.3, F-07.4, NFR privasi): audio dari file sprite, cadangan Web Speech lokal.
 *
 * Pemutaran direkam lewat `AudioBufferSourceNode.prototype.start(when, offset, duration)`, bukan lewat
 * detail internal Howler. Howler memutar sprite sebagai start(0, startMs / 1000, durationMs / 1000).
 * Fixture: tests/e2e/fixtures/audio (peta valid + MP3 senyap), disajikan same-origin lewat page.route.
 */

interface CatalogEntry {
  alpha2: string;
  kind: 'country' | 'continent';
  hasFlag: boolean;
  name: { id: string; en: string };
  anchor: [number, number];
}
interface Favorite {
  code: string;
  fact: { id: string; en: string };
}
interface SpriteMap {
  clips: Record<string, { sprite: string; startMs: number; durationMs: number }>;
}
interface Start {
  when: number;
  offset: number | null;
  duration: number | null;
}

const catalog = JSON.parse(
  readFileSync('src/content/generated/countries.json', 'utf8'),
) as CatalogEntry[];
const favorites = JSON.parse(readFileSync('src/content/data/favorites.json', 'utf8')) as Favorite[];
const fixtureMap = JSON.parse(
  readFileSync('tests/e2e/fixtures/audio/id/sprites.json', 'utf8'),
) as SpriteMap;
const silentMp3 = readFileSync('tests/e2e/fixtures/audio/id/silent.mp3');
const fixtureMapText = readFileSync('tests/e2e/fixtures/audio/id/sprites.json', 'utf8');

function entry(code: string): CatalogEntry {
  const found = catalog.find((c) => c.alpha2 === code);
  if (!found) throw new Error(`${code} tidak ada di countries.json`);
  return found;
}
function clip(id: string) {
  const found = fixtureMap.clips[id];
  if (!found) throw new Error(`klip ${id} tidak ada di fixture`);
  return found;
}
function fmt(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? `{${key}}`);
}

const japan = entry('JP');
const japanFact = favorites.find((f) => f.code === 'JP')?.fact.id;
if (!japanFact) throw new Error('fakta Jepang tidak ada di favorites.json');
const cardJp = fmt(idMessages.explore_card_label, { name: japan.name.id });
const praiseWords = [
  idMessages.quiz_praise_1,
  idMessages.quiz_praise_2,
  idMessages.quiz_praise_3,
  idMessages.quiz_praise_4,
];

const holder = '[data-camera-lonlat]';
const quizRoot = '[data-quiz-round]';

/** Web Speech tiruan; `voices` kosong = perangkat tanpa mesin TTS (MatePad acuan). */
function speechStub(withVoices: boolean): string {
  return `
  window.__spoken = [];
  class StubUtterance {
    constructor(text) {
      this.text = text === undefined ? '' : text;
      this.lang = '';
      this.rate = 1;
      this.pitch = 1;
      this.voice = null;
      this.onend = null;
    }
  }
  window.SpeechSynthesisUtterance = StubUtterance;
  const stub = {
    getVoices: () => ${withVoices ? "[{ lang: 'id-ID', localService: true, name: 'stub-id' }]" : '[]'},
    speak: (u) => {
      window.__spoken.push(u.text);
      setTimeout(() => u.onend && u.onend(), 0);
    },
    cancel: () => {},
    pause: () => {},
    resume: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    speaking: false,
    pending: false,
    paused: false,
    onvoiceschanged: null,
  };
  Object.defineProperty(window, 'speechSynthesis', { value: stub, configurable: true });
`;
}

/** Merekam setiap start() berkas audio; Howler sendiri memakai start(0, offset, duration) untuk sprite. */
const startRecorder = `
  window.__starts = [];
  const originalStart = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (when, offset, duration) {
    window.__starts.push({
      when: when === undefined ? 0 : when,
      offset: offset === undefined ? null : offset,
      duration: duration === undefined ? null : duration,
    });
    return originalStart.apply(this, arguments);
  };
`;

/** Menyajikan fixture untuk semua permintaan audio same-origin locale id. */
async function serveFixture(page: Page): Promise<void> {
  await page.route('**/audio/id/sprites.json', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: fixtureMapText }),
  );
  await page.route('**/audio/id/*.mp3', (route) =>
    route.fulfill({ status: 200, contentType: 'audio/mpeg', body: silentMp3 }),
  );
}

async function spoken(page: Page): Promise<string[]> {
  return page.evaluate<string[]>('window.__spoken');
}
/** start() yang membawa offset dan durasi = klip sprite; start(0) tanpa argumen milik pembuka kunci Howler. */
async function clipStarts(page: Page): Promise<Start[]> {
  const all = await page.evaluate<Start[]>('window.__starts');
  return all.filter((s) => s.offset !== null && s.duration !== null);
}
function isClip(start: Start, id: string): boolean {
  const c = clip(id);
  return (
    Math.abs((start.offset ?? -1) - c.startMs / 1000) < 0.002 &&
    Math.abs((start.duration ?? -1) - c.durationMs / 1000) < 0.002
  );
}
function indexOfClip(starts: Start[], id: string): number {
  return starts.findIndex((s) => isClip(s, id));
}

/**
 * Penghalang untuk klaim negatif: jeda waktu di sisi halaman (setTimeout), bukan hitungan frame.
 * requestAnimationFrame bergantung pada fps WebGL SwiftShader (bisa 0-6 fps saat mesin sibuk), sedangkan
 * timer tidak. 1500 ms jauh melebihi satu putaran has() + antrean (beberapa microtask dan satu fetch lokal);
 * pelanggaran (suara lokal terpanggil, fetch peta berulang) terjadi dalam putaran itu, jadi tertangkap.
 */
async function settle(page: Page, ms = 1500): Promise<void> {
  await page.evaluate((delay) => new Promise<void>((resolve) => setTimeout(resolve, delay)), ms);
}

function angularDistanceDeg(a: [number, number], b: [number, number]): number {
  const rad = Math.PI / 180;
  const cos =
    Math.sin(a[1] * rad) * Math.sin(b[1] * rad) +
    Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.cos((a[0] - b[0]) * rad);
  return Math.acos(Math.min(1, Math.max(-1, cos))) / rad;
}

async function openAt(page: Page, query: string): Promise<void> {
  await page.goto(`/?debug=1${query}`);
  await expect(page.locator('main[data-state=ready]')).toBeAttached();
}

async function waitFlightDone(page: Page, target: [number, number]): Promise<void> {
  await expect
    .poll(async () => {
      const raw = await page.locator(holder).getAttribute('data-camera-lonlat');
      if (!raw) return 999;
      const [lon, lat] = raw.split(',').map(Number);
      return angularDistanceDeg([lon ?? 0, lat ?? 0], target);
    })
    .toBeLessThan(0.5);
  await expect(page.locator(holder)).toHaveAttribute('data-flying', 'false');
}

/** Ketuk pusat bola (gesture nyata: ini yang membuka kunci audio, F-07.3). */
async function tapGlobeCenter(page: Page): Promise<void> {
  await expect(page.locator(holder)).toHaveAttribute('data-globe-screen', /^-?\d+,-?\d+,\d+$/);
  const raw = (await page.locator(holder).getAttribute('data-globe-screen')) ?? '';
  const [cx = NaN, cy = NaN] = raw.split(',').map(Number);
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('canvas tidak terlihat');
  await page.mouse.click(box.x + cx, box.y + cy);
}

async function openJapanCard(page: Page): Promise<void> {
  await openAt(page, '&lookAt=JP');
  await waitFlightDone(page, japan.anchor);
  await tapGlobeCenter(page);
  await expect(page.getByRole('region', { name: cardJp })).toBeVisible();
}

test('TC-E2E-AUD-1 Jelajah JP: intro:JP lalu fact:JP diputar dari file, Web Speech tidak dipakai', async ({
  page,
}) => {
  await page.addInitScript(speechStub(true));
  await page.addInitScript(startRecorder);
  await serveFixture(page);
  await openJapanCard(page);

  await expect
    .poll(async () => {
      const starts = await clipStarts(page);
      return indexOfClip(starts, 'intro:JP') >= 0 && indexOfClip(starts, 'fact:JP') >= 0;
    })
    .toBe(true);
  const starts = await clipStarts(page);
  // Urutan antrean: intro dulu, fakta sesudahnya; tiap klip tepat sekali.
  expect(starts).toHaveLength(2);
  expect(indexOfClip(starts, 'intro:JP')).toBeLessThan(indexOfClip(starts, 'fact:JP'));

  // Penghalang sebelum klaim negatif: dua klip sudah mulai diputar; beri waktu lebih dari durasi klip
  // terpanjang (1,5 dtk) sebelum memastikan suara lokal tak dipanggil.
  await settle(page, 2000);
  expect(await spoken(page)).toEqual([]);
});

test('TC-E2E-AUD-2 Kuis: pujian dari file, segmen di luar fixture lewat Web Speech, urutan terjaga', async ({
  page,
}) => {
  await page.addInitScript(speechStub(true));
  await page.addInitScript(startRecorder);
  await serveFixture(page);
  await openAt(page, '&quizSeed=7');
  await page.getByRole('button', { name: idMessages.mode_quiz, exact: true }).click();
  await expect(page.locator(quizRoot)).toHaveAttribute('data-quiz-round', '1');
  await expect(page.locator(quizRoot)).toHaveAttribute('data-quiz-phase', 'asking');
  const target = (await page.locator(quizRoot).getAttribute('data-quiz-target')) ?? '';
  expect(target).toMatch(/^[A-Z]{2}$/);
  const askText = fmt(idMessages.quiz_ask_speech, { name: entry(target).name.id });
  const flagText = fmt(idMessages.quiz_praise_flag, { name: entry(target).name.id });
  // ask:<kode> tidak ada di fixture, jadi lewat Web Speech.
  await expect.poll(() => spoken(page)).toContain(askText);
  expect(await clipStarts(page)).toEqual([]);

  const label = fmt(idMessages.quiz_choice_label, { name: entry(target).name.id });
  await page
    .getByRole('region', { name: idMessages.quiz_region_label, exact: true })
    .getByRole('button', { name: label, exact: true })
    .click();

  // praiseFlag:<kode> tidak ada di fixture: diucapkan lewat Web Speech, dan baru setelah pujian dari file.
  await expect.poll(() => spoken(page)).toContain(flagText);
  const starts = await clipStarts(page);
  const praiseIds = ['praise:1', 'praise:2', 'praise:3', 'praise:4'];
  const played = praiseIds.filter((id) => indexOfClip(starts, id) >= 0);
  expect(played).toHaveLength(1);
  expect(starts).toHaveLength(1);
  // Kata pujian tidak boleh ikut diucapkan Web Speech: itu klip file.
  const lines = await spoken(page);
  for (const word of praiseWords) expect(lines).not.toContain(word);
});

test('TC-E2E-AUD-3 tanpa peta sprite dan tanpa suara: kartu tetap jalan, tanpa error, peta di-fetch paling banyak sekali', async ({
  page,
}) => {
  // Remap #49: peta asli kini ter-commit di public/audio, jadi "tanpa peta" dibuat eksplisit dengan meniru
  // fallback SPA yang dulu disajikan preview (200 text/html) untuk /audio/id/sprites.json.
  await page.route('**/audio/id/sprites.json', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><title>app</title>',
    }),
  );
  await page.addInitScript(speechStub(false));
  await page.addInitScript(startRecorder);
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  const spriteRequests: string[] = [];
  page.on('request', (r) => {
    if (r.url().endsWith('/audio/id/sprites.json')) spriteRequests.push(r.url());
  });

  await openJapanCard(page);
  const card = page.getByRole('region', { name: cardJp });
  await expect(card.getByRole('heading', { name: japan.name.id })).toBeVisible();
  await expect(card.getByText(japanFact)).toBeVisible();
  // Penghalang: jaringan tenang berarti intro dan fakta sudah selesai diproses.
  await page.waitForLoadState('networkidle');
  await settle(page);
  expect(spriteRequests.length).toBeGreaterThanOrEqual(1);
  expect(spriteRequests.length).toBeLessThanOrEqual(1);

  // Dengar lagi: antrean baru, tetap tanpa fetch ulang dan tanpa suara.
  await card.getByRole('button', { name: idMessages.explore_listen_again }).click();
  await page.waitForLoadState('networkidle');
  await settle(page);
  expect(spriteRequests.length).toBe(1);
  expect(await spoken(page)).toEqual([]);
  expect(await clipStarts(page)).toEqual([]);
  await expect(card).toBeVisible();
  expect(errors).toEqual([]);
});

test('TC-NFR-privasi-audio semua permintaan audio same-origin', async ({ page, baseURL }) => {
  await page.addInitScript(speechStub(true));
  await page.addInitScript(startRecorder);
  await serveFixture(page);
  const urls: string[] = [];
  page.on('request', (r) => urls.push(r.url()));
  await openJapanCard(page);
  await expect
    .poll(async () => indexOfClip(await clipStarts(page), 'fact:JP'))
    .toBeGreaterThanOrEqual(0);
  await page.waitForLoadState('networkidle');

  const origin = new URL(baseURL ?? 'http://localhost:4174').origin;
  const audioRequests = urls.filter((u) => /\/audio\/|\.mp3(\?|$)/.test(u));
  expect(audioRequests.length).toBeGreaterThanOrEqual(3); // sprites.json + dua grup MP3
  for (const u of audioRequests) expect(new URL(u).origin).toBe(origin);
  const external = urls.filter(
    (u) => !u.startsWith('data:') && !u.startsWith('blob:') && new URL(u).origin !== origin,
  );
  expect(external).toEqual([]);
});
