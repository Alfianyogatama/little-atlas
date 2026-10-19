/// <reference lib="dom" />
import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import enMessages from '../../messages/en.json' with { type: 'json' };
import idMessages from '../../messages/id.json' with { type: 'json' };
import { routeNoAudioMap } from './helpers/no-audio-map';
import { waitForSavedStars } from './helpers/storage';

interface CatalogEntry {
  alpha2: string;
  kind: 'country' | 'continent';
  hasFlag: boolean;
  name: { id: string; en: string };
  anchor: [number, number];
}
interface Favorite {
  code: string;
  level: 1 | 2;
  fact: { id: string; en: string };
}
type Lang = 'id' | 'en';
type Messages = typeof idMessages;

const catalog = JSON.parse(
  readFileSync('src/content/generated/countries.json', 'utf8'),
) as CatalogEntry[];
const favorites = JSON.parse(readFileSync('src/content/data/favorites.json', 'utf8')) as Favorite[];

function entry(code: string): CatalogEntry {
  const found = catalog.find((c) => c.alpha2 === code);
  if (!found) throw new Error(`${code} tidak ada di countries.json`);
  return found;
}

// Kolam soal F-04.1: negara anggota PBB berbendera yang Favorit level 1 (keputusan K1).
const level1Pool = favorites
  .filter((f) => f.level === 1)
  .map((f) => f.code)
  .filter((code) => {
    const c = entry(code);
    return c.kind === 'country' && c.hasFlag;
  });

const messagesFor: Record<Lang, Messages> = { id: idMessages, en: enMessages as Messages };

function fmt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key] ?? `{${key}}`));
}
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const holder = '[data-camera-lonlat]';
const quizRoot = '[data-quiz-round]';

function angularDistanceDeg(a: [number, number], b: [number, number]): number {
  const rad = Math.PI / 180;
  const cos =
    Math.sin(a[1] * rad) * Math.sin(b[1] * rad) +
    Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.cos((a[0] - b[0]) * rad);
  return Math.acos(Math.min(1, Math.max(-1, cos))) / rad;
}

// Stub Web Speech agar tes tidak bergantung pada suara browser headless (sama dengan explore.spec).
const speechStub = `
  window.__spoken = [];
  window.__speechLog = [];
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
    getVoices: () => [
      { lang: 'id-ID', localService: true, name: 'stub-id' },
      { lang: 'en-US', localService: true, name: 'stub-en' },
    ],
    speak: (u) => {
      window.__spoken.push(u.text);
      setTimeout(() => u.onend && u.onend(), 0);
    },
    cancel: () => window.__speechLog.push('<cancel>'),
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

// Pengukur jeda di sisi halaman: waktu tiap pointerup dan waktu tiap pergantian data-quiz-round.
const timingScript = `
  window.__ups = [];
  window.__rounds = [];
  document.addEventListener('pointerup', () => window.__ups.push(performance.now()), true);
  const note = () => {
    const root = document.querySelector('[data-quiz-round]');
    const round = root ? root.getAttribute('data-quiz-round') : null;
    const last = window.__rounds[window.__rounds.length - 1];
    if (round !== null && (!last || last.round !== round)) {
      window.__rounds.push({ round, at: performance.now() });
    }
  };
  new MutationObserver(note).observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['data-quiz-round'],
  });
`;

// REMAP #49: tes di berkas ini menguji teks dan urutan ucapan lewat jalur Web Speech (stub). Sejak klip
// audio asli ter-commit, segmen yang punya klip diputar dari file dan tidak sampai ke stub, jadi peta
// sprite dinonaktifkan di sini. Pemutaran file diuji audio.spec.ts dan audio-real.spec.ts.
test.beforeEach(async ({ page }) => {
  await routeNoAudioMap(page);
  await page.addInitScript(speechStub);
});

async function spoken(page: Page): Promise<string[]> {
  return page.evaluate<string[]>('window.__spoken');
}
async function cancels(page: Page): Promise<number> {
  return page.evaluate<number>("window.__speechLog.filter((s) => s === '<cancel>').length");
}
function countSpoken(lines: string[], needle: string): number {
  return lines.filter((l) => l.includes(needle)).length;
}

/** Penghalang: sejumlah frame berlalu sebelum klaim negatif diperiksa. */
async function frames(page: Page, count = 30): Promise<void> {
  await page.evaluate(`new Promise((resolve) => {
    let n = 0;
    const tick = () => (++n >= ${count} ? resolve() : requestAnimationFrame(tick));
    requestAnimationFrame(tick);
  })`);
}
/** Penghalang waktu di sisi halaman (sama dengan TC-F03-11). */
async function idleMs(page: Page, ms: number): Promise<void> {
  await page.evaluate(`new Promise((resolve) => {
    const start = performance.now();
    const tick = () => (performance.now() - start >= ${ms} ? resolve() : requestAnimationFrame(tick));
    requestAnimationFrame(tick);
  })`);
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

function modeButton(page: Page, lang: Lang, mode: 'explore' | 'quiz'): Locator {
  const msgs = messagesFor[lang];
  return page.getByRole('button', {
    name: mode === 'quiz' ? msgs.mode_quiz : msgs.mode_explore,
    exact: true,
  });
}
function regionOf(page: Page, lang: Lang): Locator {
  return page.getByRole('region', { name: messagesFor[lang].quiz_region_label, exact: true });
}
function choicesOf(region: Locator, lang: Lang): Locator {
  const prefix = messagesFor[lang].quiz_choice_label.split('{')[0] ?? '';
  return region.getByRole('button', { name: new RegExp(`^${escapeRegExp(prefix)}`) });
}
function starsOf(page: Page, lang: Lang, count: number): Locator {
  return page.getByRole('status', {
    name: fmt(messagesFor[lang].quiz_stars_label, { count }),
    exact: true,
  });
}
function askSpeech(lang: Lang, code: string): string {
  return fmt(messagesFor[lang].quiz_ask_speech, { name: entry(code).name[lang] });
}

async function quizAttr(page: Page, name: 'round' | 'phase' | 'target'): Promise<string> {
  return (await page.locator(quizRoot).getAttribute(`data-quiz-${name}`)) ?? '';
}

async function openAt(page: Page, query: string): Promise<void> {
  await page.goto(`/?debug=1${query}`);
  await expect(page.locator('main[data-state=ready]')).toBeAttached();
}

/** Buka aplikasi di Jelajah, ketuk tombol mode kuis, tunggu soal pertama dibacakan. */
async function startQuiz(
  page: Page,
  options: { query?: string; lang?: Lang } = {},
): Promise<{ region: Locator; target: string }> {
  const lang = options.lang ?? 'id';
  await openAt(page, `&quizSeed=7${options.query ?? ''}`);
  await modeButton(page, lang, 'quiz').click();
  const region = regionOf(page, lang);
  await expect(region).toBeVisible();
  await expect(page.locator(quizRoot)).toHaveAttribute('data-quiz-round', '1');
  // Soal baru terkunci (flying) sampai kamera tiba; tes menjawab setelah soal dibacakan (asking).
  await expect(page.locator(quizRoot)).toHaveAttribute('data-quiz-phase', 'asking');
  const target = await quizAttr(page, 'target');
  expect(target).toMatch(/^[A-Z]{2}$/);
  await expect.poll(() => spoken(page)).toContain(askSpeech(lang, target));
  return { region, target };
}

/** Tombol pilihan untuk satu kode negara; nama dari katalog, bukan dari aplikasi. */
function choiceFor(region: Locator, lang: Lang, code: string): Locator {
  const label = fmt(messagesFor[lang].quiz_choice_label, { name: entry(code).name[lang] });
  return region.getByRole('button', { name: label, exact: true });
}

/** Kode pilihan yang bukan target, dibaca dari label tombol lalu dicocokkan ke katalog. */
async function wrongCodeOf(region: Locator, lang: Lang, target: string): Promise<string> {
  const labels = await choicesOf(region, lang).evaluateAll((els) =>
    els.map((el) => el.getAttribute('aria-label') ?? ''),
  );
  const codes = catalog
    .filter((c) =>
      labels.includes(fmt(messagesFor[lang].quiz_choice_label, { name: c.name[lang] })),
    )
    .map((c) => c.alpha2);
  const wrong = codes.filter((c) => c !== target);
  expect(wrong, `pilihan keliru dari ${JSON.stringify(labels)}`).toHaveLength(1);
  return wrong[0] ?? '';
}

function praiseHeard(lines: string[], lang: Lang, code: string): boolean {
  const msgs = messagesFor[lang];
  const flagSentence = fmt(msgs.quiz_praise_flag, { name: entry(code).name[lang] });
  const text = lines.join(' ');
  return [msgs.quiz_praise_1, msgs.quiz_praise_2, msgs.quiz_praise_3, msgs.quiz_praise_4].some(
    (word) => new RegExp(`${escapeRegExp(word)}\\s*${escapeRegExp(flagSentence)}`).test(text),
  );
}

async function rounds(page: Page): Promise<{ round: string; at: number }[]> {
  return page.evaluate<{ round: string; at: number }[]>('window.__rounds');
}
async function pointerUps(page: Page): Promise<number[]> {
  return page.evaluate<number[]>('window.__ups');
}
/** Jeda (ms, diukur di halaman) dari ketukan terakhir sebelum pergantian ke round berikutnya. */
async function delayBeforeRound(page: Page, round: string): Promise<number> {
  await expect
    .poll(async () => (await rounds(page)).some((r) => r.round === round), {
      // Alasan timeout 8000: F-04.9 menjadwalkan soal berikut 3,6-5,5 detik setelah jawaban benar,
      // lebih lama dari timeout expect bawaan.
      timeout: 8000,
    })
    .toBe(true);
  const at = (await rounds(page)).find((r) => r.round === round)?.at ?? NaN;
  const lastTap = (await pointerUps(page)).filter((t) => t <= at).pop() ?? NaN;
  return at - lastTap;
}

test('TC-F04-01 mengetuk Tebak Bendera mengganti layar: kamera ke target, soal dibacakan, 2 pilihan', async ({
  page,
}) => {
  await openAt(page, '&quizSeed=7');
  await expect(modeButton(page, 'id', 'explore')).toHaveAttribute('aria-pressed', 'true');
  await expect(modeButton(page, 'id', 'quiz')).toHaveAttribute('aria-pressed', 'false');
  await expect(regionOf(page, 'id')).toHaveCount(0);
  await expect(page.locator(quizRoot)).toHaveCount(0);

  await modeButton(page, 'id', 'quiz').click();
  const region = regionOf(page, 'id');
  await expect(region).toBeVisible();
  await expect(modeButton(page, 'id', 'quiz')).toHaveAttribute('aria-pressed', 'true');
  await expect(modeButton(page, 'id', 'explore')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator(quizRoot)).toHaveAttribute('data-quiz-round', '1');
  await expect(page.locator(quizRoot)).toHaveAttribute('data-quiz-phase', 'asking');

  const target = await quizAttr(page, 'target');
  expect(level1Pool, 'target harus anggota kolam Favorit level 1').toContain(target);
  const name = entry(target).name.id;

  // Kamera mendekati target dan globe menandai target yang sama.
  await waitCameraNear(page, entry(target).anchor);
  await expect(page.locator(holder)).toHaveAttribute('data-selected', target);
  // K11: kuis tidak memuat bendera ke globe.
  await expect(page.locator(holder)).toHaveAttribute('data-flag', 'none');

  // Soal tertulis dan dibacakan.
  await expect(
    region.getByText(fmt(idMessages.quiz_ask_text, { name }), { exact: true }),
  ).toBeVisible();
  await expect.poll(() => spoken(page)).toContain(askSpeech('id', target));
  await expect(region.getByRole('button', { name: idMessages.quiz_listen_again })).toBeVisible();

  // Dua pilihan: label unik, target ada, semuanya dari kolam dan bukan Antarktika.
  const choices = choicesOf(region, 'id');
  await expect(choices).toHaveCount(2);
  const labels = await choices.evaluateAll((els) =>
    els.map((el) => el.getAttribute('aria-label') ?? ''),
  );
  expect(new Set(labels).size).toBe(2);
  expect(labels).toContain(fmt(idMessages.quiz_choice_label, { name }));
  const codes = catalog
    .filter((c) => labels.includes(fmt(idMessages.quiz_choice_label, { name: c.name.id })))
    .map((c) => c.alpha2);
  expect(codes).toHaveLength(2);
  for (const code of codes) expect(level1Pool).toContain(code);
  expect(codes).not.toContain('AQ');
  for (let i = 0; i < 2; i++) {
    const choice = choices.nth(i);
    await expect(choice).toHaveAttribute('data-state', 'idle');
    await expect(choice).not.toHaveAttribute('aria-disabled', 'true');
    const img = choice.locator('img');
    await expect
      .poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
  }
  // Bintang mulai dari 0, tombol rumah Jelajah tidak ada di kuis, tombol zoom ada.
  await expect(starsOf(page, 'id', 0)).toBeVisible();
  await expect(page.getByRole('button', { name: idMessages.explore_home })).toHaveCount(0);
  await expect(page.getByRole('button', { name: idMessages.globe_zoom_in })).toBeVisible();
});

test('TC-F04-02 jawaban benar: konfeti, pujian, bintang 0 ke 1, soal berikut 2,5-5 detik dengan target berbeda', async ({
  page,
}) => {
  await page.addInitScript(timingScript);
  const { region, target } = await startQuiz(page);
  await expect(starsOf(page, 'id', 0)).toBeVisible();

  await choiceFor(region, 'id', target).click();

  await expect(page.locator(quizRoot)).toHaveAttribute('data-quiz-phase', 'celebrating');
  await expect(choiceFor(region, 'id', target)).toHaveAttribute('data-state', 'correct');
  await expect(starsOf(page, 'id', 1)).toBeVisible();
  await expect(page.locator('[data-confetti]')).toBeAttached();
  await expect.poll(() => page.locator('[data-confetti-piece]').count()).toBeGreaterThan(0);
  await expect.poll(async () => praiseHeard(await spoken(page), 'id', target)).toBe(true);
  // K5: pujian tanpa fakta.
  const fact = favorites.find((f) => f.code === target)?.fact.id ?? '';
  expect(fact).not.toBe('');
  expect((await spoken(page)).join(' ')).not.toContain(fact);

  const delay = await delayBeforeRound(page, '2');
  expect(delay).toBeGreaterThanOrEqual(2500);
  expect(delay).toBeLessThanOrEqual(5000);

  await expect(page.locator(quizRoot)).toHaveAttribute('data-quiz-phase', 'asking');
  expect(await quizAttr(page, 'target')).not.toBe(target);
  await expect(starsOf(page, 'id', 1)).toBeVisible();
  await expect(choicesOf(region, 'id')).toHaveCount(2);
  await expect(page.locator(holder)).toHaveAttribute(
    'data-selected',
    await quizAttr(page, 'target'),
  );
});

test('TC-F04-03 jawaban keliru: pilihan memudar, Coba lagi ya!, bintang tetap, soal sama', async ({
  page,
}) => {
  const { region, target } = await startQuiz(page);
  const wrongCode = await wrongCodeOf(region, 'id', target);
  const wrong = choiceFor(region, 'id', wrongCode);
  const right = choiceFor(region, 'id', target);

  await wrong.click();

  await expect(wrong).toHaveAttribute('aria-disabled', 'true');
  await expect(wrong).toHaveAttribute('data-state', 'dimmed');
  await expect
    .poll(() => wrong.evaluate((el) => Number(getComputedStyle(el).opacity)))
    .toBeLessThan(1);
  // Kontrol positif untuk TC-F04-06: dengan gerak normal, pilihan yang dicoba bergoyang.
  await expect
    .poll(() => wrong.evaluate((el) => getComputedStyle(el).animationName))
    .not.toBe('none');
  await expect.poll(async () => countSpoken(await spoken(page), idMessages.quiz_try_again)).toBe(1);

  // Jawaban yang benar tetap bisa diketuk, dan tidak ada kata atau tanda "salah" untuk anak.
  await expect(right).toHaveAttribute('data-state', 'idle');
  await expect(right).not.toHaveAttribute('aria-disabled', 'true');
  expect(await region.innerText()).not.toMatch(/salah|gagal/i);
  await expect(starsOf(page, 'id', 0)).toBeVisible();
  expect(await quizAttr(page, 'round')).toBe('1');
  expect(await quizAttr(page, 'phase')).toBe('asking');
  expect(await quizAttr(page, 'target')).toBe(target);
  await expect(page.locator('[data-confetti]')).toHaveCount(0);

  // Mengetuk lagi pilihan yang pudar tidak menambah ucapan, bintang, atau mengubah soal.
  await wrong.click({ force: true });
  await frames(page);
  expect(countSpoken(await spoken(page), idMessages.quiz_try_again)).toBe(1);
  await expect(starsOf(page, 'id', 0)).toBeVisible();
  expect(await quizAttr(page, 'phase')).toBe('asking');
  await expect(wrong).toHaveAttribute('data-state', 'dimmed');

  // Setelah keliru, jawaban benar tetap memberi bintang di soal yang sama.
  await right.click();
  await expect(starsOf(page, 'id', 1)).toBeVisible();
  await expect(page.locator(quizRoot)).toHaveAttribute('data-quiz-phase', 'celebrating');
  expect(await quizAttr(page, 'round')).toBe('1');
});

test('TC-F04-04 bintang ke-5 dirayakan dengan teks, suara, dan konfeti besar', async ({ page }) => {
  await page.addInitScript(timingScript);
  const { region, target } = await startQuiz(page, { query: '&quizStars=4' });
  await expect(starsOf(page, 'id', 4)).toBeVisible();

  await choiceFor(region, 'id', target).click();

  await expect(starsOf(page, 'id', 5)).toBeVisible();
  await expect(page.locator(quizRoot)).toHaveAttribute('data-quiz-phase', 'celebrating');
  await expect(
    page.getByText(fmt(idMessages.quiz_celebrate_text, { count: 5 }), { exact: true }),
  ).toBeVisible();
  await expect
    .poll(() => spoken(page))
    .toContain(fmt(idMessages.quiz_celebrate_speech, { count: 5 }));
  // Konfeti perayaan lebih ramai daripada konfeti pujian biasa (14 keping).
  await expect.poll(() => page.locator('[data-confetti-piece]').count()).toBeGreaterThan(14);

  // F-04.9: soal berikut tetap datang sendiri, setelah perayaan yang lebih panjang.
  const delay = await delayBeforeRound(page, '2');
  expect(delay).toBeGreaterThanOrEqual(3500);
  expect(delay).toBeLessThanOrEqual(6500);
  expect(await quizAttr(page, 'target')).not.toBe(target);
  await expect(starsOf(page, 'id', 5)).toBeVisible();
});

test('TC-F04-05 tanpa jawaban, soal tidak berganti sendiri dan pilihan tetap aktif', async ({
  page,
}) => {
  const { region, target } = await startQuiz(page);
  const heard = countSpoken(await spoken(page), askSpeech('id', target));
  expect(heard).toBe(1);

  await idleMs(page, 6500);

  expect(await quizAttr(page, 'round')).toBe('1');
  expect(await quizAttr(page, 'phase')).toBe('asking');
  expect(await quizAttr(page, 'target')).toBe(target);
  const choices = choicesOf(region, 'id');
  await expect(choices).toHaveCount(2);
  for (let i = 0; i < 2; i++) {
    await expect(choices.nth(i)).toHaveAttribute('data-state', 'idle');
    await expect(choices.nth(i)).not.toHaveAttribute('aria-disabled', 'true');
  }
  await expect(starsOf(page, 'id', 0)).toBeVisible();
  // Soal tidak dibacakan ulang tanpa diminta.
  expect(countSpoken(await spoken(page), askSpeech('id', target))).toBe(1);
});

test('TC-F04-05b Dengar lagi membacakan soal sekali lagi', async ({ page }) => {
  const { region, target } = await startQuiz(page);
  await region.getByRole('button', { name: idMessages.quiz_listen_again }).click();
  await expect.poll(async () => countSpoken(await spoken(page), askSpeech('id', target))).toBe(2);
  await frames(page);
  expect(countSpoken(await spoken(page), askSpeech('id', target))).toBe(2);
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('TC-F04-06 tanpa konfeti dan tanpa goyang, tetap ada pudar dan bintang', async ({
    page,
  }) => {
    const { region, target } = await startQuiz(page);
    const wrongCode = await wrongCodeOf(region, 'id', target);
    const wrong = choiceFor(region, 'id', wrongCode);

    await wrong.click();
    await expect(wrong).toHaveAttribute('data-state', 'dimmed');
    await expect(wrong).toHaveAttribute('aria-disabled', 'true');
    await expect
      .poll(() => wrong.evaluate((el) => Number(getComputedStyle(el).opacity)))
      .toBeLessThan(1);
    const motion = await wrong.evaluate((el) =>
      [el, ...Array.from(el.querySelectorAll('*'))].map((node) => {
        const s = getComputedStyle(node);
        return { animationName: s.animationName, animationDuration: s.animationDuration };
      }),
    );
    for (const m of motion) {
      const noAnimation =
        m.animationName === 'none' ||
        m.animationDuration.split(',').every((d) => d.trim() === '0s');
      expect(noAnimation, JSON.stringify(m)).toBe(true);
    }

    await choiceFor(region, 'id', target).click();
    await expect(starsOf(page, 'id', 1)).toBeVisible();
    await expect.poll(async () => praiseHeard(await spoken(page), 'id', target)).toBe(true);
    await frames(page);
    await expect(page.locator('[data-confetti]')).toHaveCount(0);
    await expect(page.locator('[data-confetti-piece]')).toHaveCount(0);
  });
});

for (const [width, height] of [
  [375, 812],
  [768, 1024],
  [1280, 800],
] as const) {
  test(`TC-F04-07 target sentuh, teks, dan tata letak kuis di ${width}x${height}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    const { region, target } = await startQuiz(page);
    // Tunggu dock stabil: kotaknya sama pada dua pembacaan berturut-turut (animasi masuk selesai).
    let last = '';
    await expect
      .poll(async () => {
        const now = JSON.stringify(await region.boundingBox());
        const stable = now === last;
        last = now;
        return stable;
      })
      .toBe(true);

    const buttons = await page.getByRole('button').all();
    expect(buttons.length).toBeGreaterThanOrEqual(5);
    for (const button of buttons) {
      if (!(await button.isVisible())) continue;
      const box = await button.boundingBox();
      const label = (await button.getAttribute('aria-label')) ?? (await button.innerText());
      expect(box?.width ?? 0, `lebar tombol "${label}"`).toBeGreaterThanOrEqual(64);
      expect(box?.height ?? 0, `tinggi tombol "${label}"`).toBeGreaterThanOrEqual(64);
    }

    const ask = region.getByText(fmt(idMessages.quiz_ask_text, { name: entry(target).name.id }), {
      exact: true,
    });
    const askSize = await ask.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(askSize).toBeGreaterThanOrEqual(22);

    const overflow = await region.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    const boxOf = async (locator: Locator, label: string) => {
      const box = await locator.boundingBox();
      if (!box) throw new Error(`${label} tidak terlihat`);
      return box;
    };
    const dock = await boxOf(region, 'dock soal');
    const floating = [
      { label: 'tombol Jelajah', box: await boxOf(modeButton(page, 'id', 'explore'), 'Jelajah') },
      { label: 'tombol Tebak Bendera', box: await boxOf(modeButton(page, 'id', 'quiz'), 'Kuis') },
      { label: 'penghitung bintang', box: await boxOf(starsOf(page, 'id', 0), 'bintang') },
      {
        label: 'zoom masuk',
        box: await boxOf(page.getByRole('button', { name: idMessages.globe_zoom_in }), 'zoom +'),
      },
      {
        label: 'zoom keluar',
        box: await boxOf(page.getByRole('button', { name: idMessages.globe_zoom_out }), 'zoom -'),
      },
    ];
    expect(dock.x, 'dock keluar kiri').toBeGreaterThanOrEqual(0);
    expect(dock.x + dock.width, 'dock keluar kanan').toBeLessThanOrEqual(width);
    expect(dock.y + dock.height, 'dock keluar bawah').toBeLessThanOrEqual(height);
    for (const { label, box } of floating) {
      expect(box.x, `${label} keluar kiri`).toBeGreaterThanOrEqual(0);
      expect(box.y, `${label} keluar atas`).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, `${label} keluar kanan`).toBeLessThanOrEqual(width);
      expect(box.y + box.height, `${label} keluar bawah`).toBeLessThanOrEqual(height);
      const overlapX = Math.min(box.x + box.width, dock.x + dock.width) - Math.max(box.x, dock.x);
      const overlapY = Math.min(box.y + box.height, dock.y + dock.height) - Math.max(box.y, dock.y);
      expect(overlapX > 0 && overlapY > 0, `${label} menimpa dock soal`).toBe(false);
    }
  });
}

test.describe('bahasa Inggris', () => {
  test('TC-F04-08 layar, suara, dan pujian berbahasa Inggris dengan ?lang=en', async ({ page }) => {
    const msgs = enMessages;
    await openAt(page, '&quizSeed=7&lang=en');
    await expect(modeButton(page, 'en', 'explore')).toHaveAttribute('aria-pressed', 'true');
    await modeButton(page, 'en', 'quiz').click();
    const region = regionOf(page, 'en');
    await expect(region).toBeVisible();
    await expect(page.locator(quizRoot)).toHaveAttribute('data-quiz-round', '1');
    const target = await quizAttr(page, 'target');
    const name = entry(target).name.en;

    await expect(
      region.getByText(fmt(msgs.quiz_ask_text, { name }), { exact: true }),
    ).toBeVisible();
    await expect.poll(() => spoken(page)).toContain(askSpeech('en', target));
    await expect(region.getByRole('button', { name: msgs.quiz_listen_again })).toBeVisible();
    await expect(starsOf(page, 'en', 0)).toBeVisible();
    await expect(choicesOf(region, 'en')).toHaveCount(2);
    await expect(choiceFor(region, 'en', target)).toBeVisible();
    // Tidak ada sisa teks Indonesia di layar kuis.
    await expect(page.getByRole('button', { name: idMessages.mode_quiz })).toHaveCount(0);
    await expect(page.getByText(idMessages.quiz_listen_again)).toHaveCount(0);

    const wrongCode = await wrongCodeOf(region, 'en', target);
    await choiceFor(region, 'en', wrongCode).click();
    await expect.poll(() => spoken(page)).toContain(msgs.quiz_try_again);
    await choiceFor(region, 'en', target).click();
    await expect(starsOf(page, 'en', 1)).toBeVisible();
    await expect.poll(async () => praiseHeard(await spoken(page), 'en', target)).toBe(true);
    expect((await spoken(page)).some((line) => line.includes(idMessages.quiz_try_again))).toBe(
      false,
    );
  });
});

// REMAP #10 (ADR-002 revisi 16 Okt, F-11.1): bintang kini disimpan lokal, jadi memuat ulang tidak lagi
// memicu dialog beforeunload dan bintang bertahan. Dulu tes ini menegaskan dialog dan bintang kembali 0.
test('TC-F04-09 setelah 1 bintang, memuat ulang tanpa dialog peringatan dan bintang bertahan', async ({
  page,
}) => {
  const dialogs: string[] = [];
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.type());
    void dialog.accept();
  });
  const { region, target } = await startQuiz(page);
  await choiceFor(region, 'id', target).click();
  await expect(starsOf(page, 'id', 1)).toBeVisible();
  expect(dialogs).toEqual([]);

  // Reload menunggu commit: tulis IndexedDB asinkron, bintang yang didapat sesaat sebelum tab
  // ditutup bisa hilang (ADR-002 revisi 19 Okt). Remap, bukan pelemahan.
  await waitForSavedStars(page, 1);
  await page.reload();
  await expect(page.locator('main[data-state=ready]')).toBeAttached();
  await frames(page);

  expect(dialogs).toEqual([]);
  // Bintang dimuat dari penyimpanan lokal; layar awal setelah reload adalah Jelajah.
  await expect(starsOf(page, 'id', 1)).toBeVisible();
});

test('TC-F04-09b dengan 0 bintang, memuat ulang tidak memicu dialog dan bintang tetap 0', async ({
  page,
}) => {
  const dialogs: string[] = [];
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.type());
    void dialog.accept();
  });
  const { region, target } = await startQuiz(page);
  // Anak sudah mengetuk (aktivasi pengguna ada), tapi jawabannya keliru jadi bintang tetap 0.
  const wrongCode = await wrongCodeOf(region, 'id', target);
  await choiceFor(region, 'id', wrongCode).click();
  await expect(choiceFor(region, 'id', wrongCode)).toHaveAttribute('data-state', 'dimmed');
  await expect(starsOf(page, 'id', 0)).toBeVisible();

  await page.reload();
  await expect(page.locator('main[data-state=ready]')).toBeAttached();
  await frames(page);

  expect(dialogs).toEqual([]);
  await expect(starsOf(page, 'id', 0)).toBeVisible();
});

test('TC-F04-10 bintang bertahan saat ganti mode, tampil di Jelajah, dan soal baru berbeda', async ({
  page,
}) => {
  const { region, target } = await startQuiz(page);
  await choiceFor(region, 'id', target).click();
  await expect(starsOf(page, 'id', 1)).toBeVisible();
  // Tunggu soal kedua; targetnya jadi "soal sebelumnya" saat kuis dibuka lagi.
  await expect
    .poll(() => quizAttr(page, 'round'), { timeout: 8000 }) // soal berikut datang 3,6 detik setelah jawaban benar
    .toBe('2');
  const second = await quizAttr(page, 'target');
  expect(second).not.toBe(target);

  await modeButton(page, 'id', 'explore').click();
  await expect(modeButton(page, 'id', 'explore')).toHaveAttribute('aria-pressed', 'true');
  await expect(regionOf(page, 'id')).toHaveCount(0);
  await expect(page.locator(quizRoot)).toHaveCount(0);
  await expect(starsOf(page, 'id', 1)).toBeVisible();

  await modeButton(page, 'id', 'quiz').click();
  await expect(regionOf(page, 'id')).toBeVisible();
  await expect(page.locator(quizRoot)).toHaveAttribute('data-quiz-phase', 'asking');
  await expect(starsOf(page, 'id', 1)).toBeVisible();
  const third = await quizAttr(page, 'target');
  expect(third, 'soal pertama setelah kembali tidak boleh sama dengan soal terakhir').not.toBe(
    second,
  );
  await expect.poll(() => spoken(page)).toContain(askSpeech('id', third));

  // Bintang terus bertambah dari angka yang dibawa, bukan mulai dari 0 lagi.
  await choiceFor(regionOf(page, 'id'), 'id', third).click();
  await expect(starsOf(page, 'id', 2)).toBeVisible();
});

test('TC-F04-10b ganti mode sebelum menjawab: soal pertama setelah kembali bukan soal yang ditinggalkan', async ({
  page,
}) => {
  // RNG ber-seed dibuat ulang saat layar kuis dipasang lagi, jadi tanpa "soal sebelumnya"
  // dari App, seed yang sama akan memilih target pertama lagi.
  const { target: first } = await startQuiz(page);

  await modeButton(page, 'id', 'explore').click();
  await expect(modeButton(page, 'id', 'explore')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator(quizRoot)).toHaveCount(0);

  await modeButton(page, 'id', 'quiz').click();
  await expect(regionOf(page, 'id')).toBeVisible();
  await expect(page.locator(quizRoot)).toHaveAttribute('data-quiz-phase', 'asking');
  const next = await quizAttr(page, 'target');
  expect(
    next,
    'soal pertama setelah kembali tidak boleh sama dengan soal yang ditinggalkan',
  ).not.toBe(first);
  await expect.poll(() => spoken(page)).toContain(askSpeech('id', next));
  await expect(starsOf(page, 'id', 0)).toBeVisible();
});

/**
 * Ketukan dini: begitu soal pertama dirender (data-quiz-round >= 1) dan dua pilihan ada, skrip di halaman
 * langsung mengetuk pengecoh dan mencatat fase saat itu. Penerbangan kamera ~900 ms, jadi ini terjadi
 * jauh sebelum kamera tiba, tanpa bergantung pada kecepatan Playwright.
 */
function earlyTapScript(labels: Record<string, string>): string {
  return `
    window.__early = null;
    const labels = ${JSON.stringify(labels)};
    const tryEarly = () => {
      if (window.__early) return;
      const root = document.querySelector('[data-quiz-round]');
      if (!root) return;
      const round = Number(root.getAttribute('data-quiz-round') || '0');
      const target = root.getAttribute('data-quiz-target') || '';
      const buttons = Array.from(document.querySelectorAll('button[data-state]'));
      if (round < 1 || !labels[target] || buttons.length !== 2) return;
      const decoy = buttons.find((b) => b.getAttribute('aria-label') !== labels[target]);
      if (!decoy) return;
      window.__early = {
        phase: root.getAttribute('data-quiz-phase'),
        round,
        target,
        decoy: decoy.getAttribute('aria-label'),
      };
      decoy.click();
    };
    new MutationObserver(tryEarly).observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
    });
  `;
}

test('TC-F04-11 ketukan dini saat kamera masih terbang diabaikan, soal dibacakan tepat sekali', async ({
  page,
}) => {
  const labels = Object.fromEntries(
    catalog.map((c) => [c.alpha2, fmt(idMessages.quiz_choice_label, { name: c.name.id })]),
  );
  await page.addInitScript(earlyTapScript(labels));
  await openAt(page, '&quizSeed=7');
  await modeButton(page, 'id', 'quiz').click();
  const region = regionOf(page, 'id');
  await expect(region).toBeVisible();
  await expect.poll(() => page.evaluate('window.__early')).not.toBeNull();
  const early = await page.evaluate<{
    phase: string | null;
    round: number;
    target: string;
    decoy: string;
  }>('window.__early');
  // Syarat tes: ketukan terjadi selagi kamera terbang, bukan setelah soal dibacakan.
  expect(early.phase).toBe('flying');
  expect(early.round).toBe(1);

  // Setelah kamera tiba: soal dibacakan, ketukan dini tidak berbekas.
  await expect(page.locator(quizRoot)).toHaveAttribute('data-quiz-phase', 'asking');
  const target = early.target;
  await expect.poll(async () => countSpoken(await spoken(page), askSpeech('id', target))).toBe(1);
  await frames(page);
  const lines = await spoken(page);
  expect(countSpoken(lines, askSpeech('id', target))).toBe(1);
  expect(countSpoken(lines, idMessages.quiz_try_again)).toBe(0);
  const choices = choicesOf(region, 'id');
  await expect(choices).toHaveCount(2);
  for (let i = 0; i < 2; i++) {
    await expect(choices.nth(i)).toHaveAttribute('data-state', 'idle');
    await expect(choices.nth(i)).not.toHaveAttribute('aria-disabled', 'true');
  }
  expect(await quizAttr(page, 'round')).toBe('1');
  expect(await quizAttr(page, 'target')).toBe(target);
  await expect(starsOf(page, 'id', 0)).toBeVisible();

  // Kontrol positif: setelah dibacakan, pengecoh yang sama bisa dicoba dan memudar.
  await region.getByRole('button', { name: early.decoy, exact: true }).click();
  await expect(region.getByRole('button', { name: early.decoy, exact: true })).toHaveAttribute(
    'data-state',
    'dimmed',
  );
  await expect.poll(async () => countSpoken(await spoken(page), idMessages.quiz_try_again)).toBe(1);
});

test('TC-F04-12 ganti mode saat perayaan: soal basi tidak muncul atau terucap di Jelajah', async ({
  page,
}) => {
  const { region, target } = await startQuiz(page);
  await choiceFor(region, 'id', target).click();
  await expect(starsOf(page, 'id', 1)).toBeVisible();
  await expect.poll(async () => praiseHeard(await spoken(page), 'id', target)).toBe(true);
  const heardBefore = (await spoken(page)).length;
  const cancelsBefore = await cancels(page);

  // Langsung ganti mode, jauh sebelum jadwal soal berikut (3600 ms; REMAP 19 Okt 2026).
  await modeButton(page, 'id', 'explore').click();
  await expect(modeButton(page, 'id', 'explore')).toHaveAttribute('aria-pressed', 'true');
  await expect(regionOf(page, 'id')).toHaveCount(0);
  await expect.poll(() => cancels(page)).toBeGreaterThan(cancelsBefore);

  // Penghalang: lebih dari 4 detik berlalu di sisi halaman sebelum klaim negatif diperiksa.
  await idleMs(page, 4500);

  await expect(page.locator(quizRoot)).toHaveCount(0);
  await expect(regionOf(page, 'id')).toHaveCount(0);
  await expect(modeButton(page, 'id', 'explore')).toHaveAttribute('aria-pressed', 'true');
  await expect(starsOf(page, 'id', 1)).toBeVisible();
  const lines = await spoken(page);
  // Tidak ada ucapan baru (soal, pujian ulang, perayaan) setelah ganti mode.
  expect(lines).toHaveLength(heardBefore);
  expect(
    countSpoken(lines, fmt(idMessages.quiz_praise_flag, { name: entry(target).name.id })),
  ).toBe(1);
  // Hanya satu soal yang pernah dibacakan: soal pertama, tidak ada soal basi.
  const askSuffix = idMessages.quiz_ask_speech.split('}')[1] ?? '#';
  expect(lines.filter((l) => l.endsWith(askSuffix))).toEqual([askSpeech('id', target)]);
});

test('TC-NFR-privasi-kuis tidak ada permintaan ke origin lain saat bermain kuis', async ({
  page,
  baseURL,
}) => {
  const urls: string[] = [];
  page.on('request', (r) => urls.push(r.url()));
  const { region, target } = await startQuiz(page);
  const wrongCode = await wrongCodeOf(region, 'id', target);
  await choiceFor(region, 'id', wrongCode).click();
  await choiceFor(region, 'id', target).click();
  await expect(starsOf(page, 'id', 1)).toBeVisible();
  await expect
    .poll(() => quizAttr(page, 'round'), { timeout: 8000 }) // soal berikut datang 3,6 detik setelah jawaban benar
    .toBe('2');
  await page.waitForLoadState('networkidle');

  const origin = new URL(baseURL ?? 'http://localhost:4174').origin;
  const flagRequests = urls.filter((u) => u.includes('/content/flags/'));
  expect(flagRequests.length).toBeGreaterThan(0);
  for (const u of flagRequests) expect(new URL(u).origin).toBe(origin);
  const external = urls.filter(
    (u) => !u.startsWith('data:') && !u.startsWith('blob:') && new URL(u).origin !== origin,
  );
  expect(external).toEqual([]);
  expect(urls.filter((u) => u.includes('fonts.googleapis.com'))).toEqual([]);
});
