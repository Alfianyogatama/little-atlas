/// <reference lib="dom" />
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import idMessages from '../../messages/id.json' with { type: 'json' };
import { AudioSpriteMapSchema } from '../../src/content/schema';

/**
 * Issue #49 (T14): e2e dengan peta audio ASLI yang ter-commit di public/audio/id (65 klip).
 *
 * Kontrak tambahan:
 * - Tanpa page.route untuk audio: sprites.json dan MP3 disajikan build (dist-e2e) apa adanya.
 * - Peta dibaca dari berkas repo (public/audio/id/sprites.json) dan divalidasi AudioSpriteMapSchema;
 *   offset/durasi yang diharapkan = startMs/1000 dan durationMs/1000 dari peta itu.
 * - Pemutaran direkam lewat AudioBufferSourceNode.prototype.start(when, offset, duration), seperti audio.spec.ts.
 * - Klip yang tidak ada di peta asli (intro:*, ask:*, praiseFlag:*) harus lewat Web Speech tiruan.
 * - Fakta asli: fact:AU/MG/MY/TL belum ada; JP ada. Tes ini tidak bergantung pada yang belum ada.
 */

interface CatalogEntry {
  alpha2: string;
  name: { id: string; en: string };
  anchor: [number, number];
}
interface Start {
  when: number;
  offset: number | null;
  duration: number | null;
}

const catalog = JSON.parse(
  readFileSync('src/content/generated/countries.json', 'utf8'),
) as CatalogEntry[];
const realMap = AudioSpriteMapSchema.parse(
  JSON.parse(readFileSync('public/audio/id/sprites.json', 'utf8')),
);

function entry(code: string): CatalogEntry {
  const found = catalog.find((c) => c.alpha2 === code);
  if (!found) throw new Error(`${code} tidak ada di countries.json`);
  return found;
}
function clip(id: string) {
  const found = realMap.clips[id];
  if (!found) throw new Error(`klip ${id} tidak ada di peta asli`);
  return found;
}
function fmt(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? `{${key}}`);
}

const japan = entry('JP');
const cardJp = fmt(idMessages.explore_card_label, { name: japan.name.id });
const introJp = fmt(idMessages.explore_intro, { name: japan.name.id });

const holder = '[data-camera-lonlat]';
const quizRoot = '[data-quiz-round]';

/** Web Speech tiruan dengan satu suara id (bukan perangkat tanpa TTS). */
const speechStub = `
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
    getVoices: () => [{ lang: 'id-ID', localService: true, name: 'stub-id' }],
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

/** Penghalang untuk klaim negatif: timer di sisi halaman, bukan hitungan frame (WebGL SwiftShader lambat). */
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

/** Ketuk pusat bola (gesture nyata yang membuka kunci audio). */
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

test('peta asli: valid, 65 klip, intro/ask/praiseFlag tidak ada (prasyarat tes REAL)', () => {
  expect(Object.keys(realMap.clips)).toHaveLength(65);
  expect(realMap.clips['fact:JP']).toBeDefined();
  expect(realMap.clips['intro:JP']).toBeUndefined();
  expect(Object.keys(realMap.clips).filter((id) => /^(intro|ask|praiseFlag):/.test(id))).toEqual(
    [],
  );
});

test('TC-E2E-AUD-REAL-1 Jelajah JP: fact:JP dari file asli (offset/durasi sesuai peta), intro:JP lewat Web Speech', async ({
  page,
}) => {
  await page.addInitScript(speechStub);
  await page.addInitScript(startRecorder);
  await openJapanCard(page);

  // Build menyajikan peta yang sama dengan berkas repo (bukan fallback SPA atau salinan basi).
  const served = await page.request.get('/audio/id/sprites.json');
  expect(served.ok()).toBe(true);
  expect(await served.json()).toEqual(
    JSON.parse(readFileSync('public/audio/id/sprites.json', 'utf8')),
  );

  await expect
    .poll(async () => indexOfClip(await clipStarts(page), 'fact:JP'))
    .toBeGreaterThanOrEqual(0);
  const starts = await clipStarts(page);
  // Hanya fakta yang dari file; intro tidak ada di peta sehingga tidak ada klip lain.
  expect(starts).toHaveLength(1);
  const fact = clip('fact:JP');
  expect(starts[0]?.offset).toBeCloseTo(fact.startMs / 1000, 3);
  expect(starts[0]?.duration).toBeCloseTo(fact.durationMs / 1000, 3);

  // Intro diucapkan lewat Web Speech dengan teks intro; teks fakta tidak boleh ikut diucapkan.
  await expect.poll(() => spoken(page)).toContain(introJp);
  // Penghalang sebelum klaim negatif: lewati durasi klip fakta.
  await settle(page, 2500);
  expect(await spoken(page)).toEqual([introJp]);
});

test('TC-E2E-AUD-REAL-2 Kuis: praise:N dari file asli, praiseFlag lewat Web Speech', async ({
  page,
}) => {
  await page.addInitScript(speechStub);
  await page.addInitScript(startRecorder);
  await openAt(page, '&quizSeed=7');
  await page.getByRole('button', { name: idMessages.mode_quiz, exact: true }).click();
  await expect(page.locator(quizRoot)).toHaveAttribute('data-quiz-round', '1');
  await expect(page.locator(quizRoot)).toHaveAttribute('data-quiz-phase', 'asking');
  const target = (await page.locator(quizRoot).getAttribute('data-quiz-target')) ?? '';
  expect(target).toMatch(/^[A-Z]{2}$/);
  const name = entry(target).name.id;
  const askText = fmt(idMessages.quiz_ask_speech, { name });
  const flagText = fmt(idMessages.quiz_praise_flag, { name });
  // ask:<kode> tidak ada di peta asli: pertanyaan lewat Web Speech, tanpa klip file.
  await expect.poll(() => spoken(page)).toContain(askText);
  expect(await clipStarts(page)).toEqual([]);

  await page
    .getByRole('region', { name: idMessages.quiz_region_label, exact: true })
    .getByRole('button', { name: fmt(idMessages.quiz_choice_label, { name }), exact: true })
    .click();

  await expect.poll(() => spoken(page)).toContain(flagText);
  const starts = await clipStarts(page);
  expect(starts).toHaveLength(1);
  const played = ['praise:1', 'praise:2', 'praise:3', 'praise:4'].filter(
    (id) => indexOfClip(starts, id) >= 0,
  );
  expect(played).toHaveLength(1);
  const praise = clip(played[0] ?? '');
  expect(starts[0]?.offset).toBeCloseTo(praise.startMs / 1000, 3);
  expect(starts[0]?.duration).toBeCloseTo(praise.durationMs / 1000, 3);
  // Kata pujian adalah klip file, bukan Web Speech.
  const lines = await spoken(page);
  for (const word of [
    idMessages.quiz_praise_1,
    idMessages.quiz_praise_2,
    idMessages.quiz_praise_3,
    idMessages.quiz_praise_4,
  ]) {
    expect(lines).not.toContain(word);
  }
});

test('TC-E2E-AUD-REAL-3 privasi: semua permintaan audio same-origin, tidak ada host lain', async ({
  page,
  baseURL,
}) => {
  await page.addInitScript(speechStub);
  await page.addInitScript(startRecorder);
  const urls: string[] = [];
  page.on('request', (r) => urls.push(r.url()));
  await openJapanCard(page);
  await expect
    .poll(async () => indexOfClip(await clipStarts(page), 'fact:JP'))
    .toBeGreaterThanOrEqual(0);
  await page.waitForLoadState('networkidle');

  const origin = new URL(baseURL ?? 'http://localhost:4174').origin;
  const audioRequests = urls.filter((u) => new URL(u).pathname.startsWith('/audio/'));
  expect(audioRequests.some((u) => new URL(u).pathname === '/audio/id/sprites.json')).toBe(true);
  expect(
    audioRequests.some((u) => /^\/audio\/id\/fact-1-[0-9a-f]{8}\.mp3$/.test(new URL(u).pathname)),
  ).toBe(true);
  for (const u of audioRequests) expect(new URL(u).origin).toBe(origin);
  const external = urls.filter(
    (u) => !u.startsWith('data:') && !u.startsWith('blob:') && new URL(u).origin !== origin,
  );
  expect(external).toEqual([]);
});
