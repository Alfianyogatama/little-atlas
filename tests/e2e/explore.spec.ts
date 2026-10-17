/// <reference lib="dom" />
import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import enMessages from '../../messages/en.json' with { type: 'json' };
import idMessages from '../../messages/id.json' with { type: 'json' };
import { routeNoAudioMap } from './helpers/no-audio-map';

interface CatalogEntry {
  alpha2: string;
  name: { id: string; en: string };
  anchor: [number, number];
}
interface Favorite {
  code: string;
  icon: { image: string; label: { id: string; en: string } };
  fact: { id: string; en: string };
}

const catalog = JSON.parse(
  readFileSync('src/content/generated/countries.json', 'utf8'),
) as CatalogEntry[];
const favorites = JSON.parse(readFileSync('src/content/data/favorites.json', 'utf8')) as Favorite[];

function entry(code: string): CatalogEntry {
  const found = catalog.find((c) => c.alpha2 === code);
  if (!found) throw new Error(`${code} tidak ada di countries.json`);
  return found;
}
const japan = entry('JP');
const indonesia = entry('ID');
const japanFact = favorites.find((f) => f.code === 'JP')?.fact;
if (!japanFact) throw new Error('fakta Jepang tidak ada di favorites.json');

function fill(template: string, name: string): string {
  return template.replace('{name}', name);
}

const holder = '[data-camera-lonlat]';
const introJp = fill(idMessages.explore_intro, japan.name.id);
const cardJp = fill(idMessages.explore_card_label, japan.name.id);
const flagJp = fill(idMessages.explore_flag_alt, japan.name.id);

function angularDistanceDeg(a: [number, number], b: [number, number]): number {
  const rad = Math.PI / 180;
  const cos =
    Math.sin(a[1] * rad) * Math.sin(b[1] * rad) +
    Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.cos((a[0] - b[0]) * rad);
  return Math.acos(Math.min(1, Math.max(-1, cos))) / rad;
}

// Stub Web Speech agar tes tidak bergantung pada suara browser headless.
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

async function waitFlightDone(page: Page, target: [number, number]): Promise<void> {
  await waitCameraNear(page, target);
  await expect(page.locator(holder)).toHaveAttribute('data-flying', 'false');
}

async function globeCircle(page: Page): Promise<{ cx: number; cy: number; r: number }> {
  await expect(page.locator(holder)).toHaveAttribute('data-globe-screen', /^-?\d+,-?\d+,\d+$/);
  const raw = (await page.locator(holder).getAttribute('data-globe-screen')) ?? '';
  const [cx = NaN, cy = NaN, r = NaN] = raw.split(',').map(Number);
  return { cx, cy, r };
}

async function canvasBox(page: Page) {
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('canvas tidak terlihat');
  return box;
}

/** Ketuk pusat bola menurut data-globe-screen (koordinat relatif ke kanvas). */
async function tapGlobeCenter(page: Page, dx = 0): Promise<void> {
  const { cx, cy } = await globeCircle(page);
  const box = await canvasBox(page);
  await page.mouse.click(box.x + cx + dx, box.y + cy);
}

async function openJapanCard(page: Page): Promise<Locator> {
  await openAt(page, '&lookAt=JP');
  await waitFlightDone(page, japan.anchor);
  await tapGlobeCenter(page);
  const card = page.getByRole('region', { name: cardJp });
  await expect(card).toBeVisible();
  return card;
}

test('TC-F03-01 mengetuk Jepang membuka kartu, bendera, dan suara', async ({ page }) => {
  const card = await openJapanCard(page);
  await expect(card.getByRole('img', { name: flagJp })).toBeVisible();
  await expect(card.getByRole('heading', { name: japan.name.id })).toBeVisible();
  await expect.poll(() => spoken(page)).toContain(introJp);
});

test('TC-F03-02 fakta Favorit tampil di kartu dan dibaca setelah intro', async ({ page }) => {
  const card = await openJapanCard(page);
  await expect(card.getByText(japanFact.id)).toBeVisible();
  await expect.poll(async () => countSpoken(await spoken(page), japanFact.id)).toBeGreaterThan(0);
  const lines = await spoken(page);
  const introAt = lines.findIndex((l) => l.includes(introJp));
  const factAt = lines.findIndex((l) => l.includes(japanFact.id));
  expect(introAt).toBeGreaterThanOrEqual(0);
  // Intro dan fakta boleh satu ucapan atau dua; urutan intro dulu.
  if (introAt === factAt) {
    const line = lines[factAt] ?? '';
    expect(line.indexOf(introJp)).toBeLessThan(line.indexOf(japanFact.id));
  } else {
    expect(introAt).toBeLessThan(factAt);
  }
});

test('TC-F03-08 kartu Favorit menampilkan ilustrasi ikon yang termuat, non-Favorit tidak', async ({
  page,
}) => {
  const jpIconLabel = favorites.find((f) => f.code === 'JP')?.icon.label.id;
  if (!jpIconLabel) throw new Error('label ikon Jepang tidak ada di favorites.json');
  const card = await openJapanCard(page);
  const icon = card.getByRole('img', { name: jpIconLabel, exact: true });
  await expect(icon).toBeVisible();
  await expect(icon).toHaveAttribute('src', /\/content\/icons\/jp\.webp$/);
  await expect
    .poll(() => icon.evaluate((el) => (el as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
  const size = await icon.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { w: r.width, h: r.height };
  });
  expect(Math.abs(size.w - 56)).toBeLessThanOrEqual(1);
  expect(Math.abs(size.h - 56)).toBeLessThanOrEqual(1);

  // Non-Favorit (Kolombia): kartu terbuka, hanya bendera sebagai gambar.
  const colombia = entry('CO');
  expect(favorites.some((f) => f.code === 'CO')).toBe(false);
  await openAt(page, '&lookAt=CO');
  await waitFlightDone(page, colombia.anchor);
  await tapGlobeCenter(page);
  const coCard = page.getByRole('region', {
    name: fill(idMessages.explore_card_label, colombia.name.id),
  });
  await expect(coCard).toBeVisible();
  await expect(
    coCard.getByRole('img', { name: fill(idMessages.explore_flag_alt, colombia.name.id) }),
  ).toBeVisible();
  await expect(coCard.getByRole('img')).toHaveCount(1);
});

test('TC-F03-08b kartu Antarktika menampilkan ikon penguin dan tanpa bendera', async ({ page }) => {
  const aq = entry('AQ');
  const aqIconLabel = (
    JSON.parse(readFileSync('src/content/data/continent-facts.json', 'utf8')) as {
      AQ: { icon: { label: { id: string } } };
    }
  ).AQ.icon.label.id;
  await openAt(page, '&lookAt=AQ');
  await waitFlightDone(page, aq.anchor);
  await tapGlobeCenter(page);
  const card = page.getByRole('region', { name: fill(idMessages.explore_card_label, aq.name.id) });
  await expect(card).toBeVisible();
  const icon = card.getByRole('img', { name: aqIconLabel, exact: true });
  await expect(icon).toBeVisible();
  await expect(icon).toHaveAttribute('src', /\/content\/icons\/aq\.webp$/);
  await expect
    .poll(() => icon.evaluate((el) => (el as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
  await expect(
    card.getByRole('img', { name: idMessages.explore_flag_alt.split('{')[0] ?? '' }),
  ).toHaveCount(0);
  await expect(card.getByRole('img')).toHaveCount(1);
});

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`TC-F03-08c latar slot ikon (${scheme})`, () => {
    test.use({ colorScheme: scheme });
    test(`TC-F03-08c ${scheme} slot ikon kartu berlatar --icon-slot`, async ({ page }) => {
      const jpIconLabel = favorites.find((f) => f.code === 'JP')?.icon.label.id;
      if (!jpIconLabel) throw new Error('label ikon Jepang tidak ada di favorites.json');
      const card = await openJapanCard(page);
      const icon = card.getByRole('img', { name: jpIconLabel, exact: true });
      await expect(icon).toBeVisible();
      const style = await icon.evaluate((el) => {
        const s = getComputedStyle(el);
        return { bg: s.backgroundColor, border: s.borderTopColor };
      });
      expect(style.bg).toBe('rgb(221, 243, 255)');
      expect(style.border).not.toBe(style.bg);
    });
  });
}

test('TC-F03-03 tombol rumah terbang ke Indonesia dan membuka kartunya', async ({ page }) => {
  await openJapanCard(page);
  await page.getByRole('button', { name: idMessages.explore_home }).click();
  const card = page.getByRole('region', {
    name: fill(idMessages.explore_card_label, indonesia.name.id),
  });
  await expect(card).toBeVisible();
  await expect.poll(() => spoken(page)).toContain(idMessages.explore_intro_home);
  await waitFlightDone(page, indonesia.anchor);
});

test('TC-F03-04 Dengar lagi menambah tepat satu kemunculan intro', async ({ page }) => {
  const card = await openJapanCard(page);
  await expect.poll(async () => countSpoken(await spoken(page), introJp)).toBe(1);
  await card.getByRole('button', { name: idMessages.explore_listen_again }).click();
  await expect.poll(async () => countSpoken(await spoken(page), introJp)).toBe(2);
  // Penghalang: beberapa frame berlalu sebelum klaim "tepat satu" diperiksa ulang.
  await page.evaluate(`new Promise((resolve) => {
    let n = 0;
    const tick = () => (++n >= 30 ? resolve() : requestAnimationFrame(tick));
    requestAnimationFrame(tick);
  })`);
  expect(countSpoken(await spoken(page), introJp)).toBe(2);
});

test('TC-F03-05 Tutup kartu menghapus kartu, pilihan, dan menghentikan suara', async ({ page }) => {
  const card = await openJapanCard(page);
  await expect.poll(() => spoken(page)).toContain(introJp);
  const before = await cancels(page);
  await card.getByRole('button', { name: idMessages.explore_close_card }).click();
  await expect(page.getByRole('region', { name: cardJp })).toHaveCount(0);
  await expect(page.locator(holder)).toHaveAttribute('data-selected', '');
  await expect.poll(() => cancels(page)).toBeGreaterThan(before);
});

test('TC-F03-06 mengetuk laut menutup kartu dan membacakan kalimat laut', async ({ page }) => {
  await openJapanCard(page);
  const box = await canvasBox(page);
  await tapGlobeCenter(page, Math.round(box.height * 0.12));
  await expect(page.getByRole('region', { name: cardJp })).toHaveCount(0);
  await expect.poll(() => spoken(page)).toContain(idMessages.explore_ocean);
});

test('TC-F03-07 putar otomatis menyala setelah sekitar 6 detik diam tanpa kartu', async ({
  page,
}) => {
  await openAt(page, '');
  await expect(page.getByRole('region')).toHaveCount(0);
  // Alasan timeout 9000: F-03 menyalakan putar otomatis setelah ~6 detik diam,
  // jadi tes baru ini memang butuh lebih dari timeout expect bawaan.
  await expect
    .poll(() => page.locator(holder).getAttribute('data-auto-rotate'), { timeout: 9000 })
    .toBe('true');
});

for (const [width, height] of [
  [375, 812],
  [768, 1024],
  [1280, 800],
] as const) {
  test(`TC-F03-09 kartu memenuhi target sentuh, teks, dan bendera di ${width}x${height}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    const card = await openJapanCard(page);
    const buttons = await page.getByRole('button').all();
    expect(buttons.length).toBeGreaterThanOrEqual(3);
    for (const button of buttons) {
      if (!(await button.isVisible())) continue;
      const box = await button.boundingBox();
      const label = (await button.getAttribute('aria-label')) ?? (await button.innerText());
      expect(box?.width ?? 0, `lebar tombol "${label}"`).toBeGreaterThanOrEqual(64);
      expect(box?.height ?? 0, `tinggi tombol "${label}"`).toBeGreaterThanOrEqual(64);
    }
    const heading = card.getByRole('heading', { level: 2 });
    const headingSize = await heading.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(headingSize).toBeGreaterThanOrEqual(22);
    const factSize = await card
      .getByText(japanFact.id)
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(factSize).toBeGreaterThanOrEqual(22);
    const flag = card.getByRole('img', { name: flagJp });
    const flagBox = await flag.boundingBox();
    expect(flagBox?.width ?? 0).toBeGreaterThanOrEqual(120);
    expect(await flag.evaluate((el) => getComputedStyle(el).transform)).toBe('none');
    const overflow = await card.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test('TC-F03-10 kartu muncul kurang dari 100 ms setelah ketukan', async ({ page }) => {
  await page.addInitScript(`
    window.__tapAt = null;
    window.__cardAt = null;
    document.addEventListener('pointerup', () => {
      if (window.__tapAt === null) window.__tapAt = performance.now();
    }, true);
    new MutationObserver(() => {
      if (window.__tapAt !== null && window.__cardAt === null
        && document.querySelector('[aria-label="${cardJp}"]')) {
        window.__cardAt = performance.now();
      }
    }).observe(document, { childList: true, subtree: true, attributes: true });
  `);
  await openAt(page, '&lookAt=JP');
  await waitFlightDone(page, japan.anchor);
  await tapGlobeCenter(page);
  await expect(page.getByRole('region', { name: cardJp })).toBeVisible();
  const tapAt = await page.evaluate<number | null>('window.__tapAt');
  const cardAt = await page.evaluate<number | null>('window.__cardAt');
  expect(tapAt).not.toBeNull();
  expect(cardAt).not.toBeNull();
  expect((cardAt ?? Infinity) - (tapAt ?? 0)).toBeLessThan(100);
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('TC-F03-11 kartu tanpa animasi dan putar otomatis tetap mati', async ({ page }) => {
    const card = await openJapanCard(page);
    const motion = await card.evaluate((el) =>
      [el, ...Array.from(el.querySelectorAll('*'))].map((node) => {
        const s = getComputedStyle(node);
        return {
          animationName: s.animationName,
          animationDuration: s.animationDuration,
          transitionDuration: s.transitionDuration,
        };
      }),
    );
    for (const m of motion) {
      const noAnimation =
        m.animationName === 'none' ||
        m.animationDuration.split(',').every((d) => d.trim() === '0s');
      expect(noAnimation, JSON.stringify(m)).toBe(true);
      expect(m.transitionDuration.split(',').every((d) => d.trim() === '0s')).toBe(true);
    }
    // Penghalang waktu di sisi halaman: 6,5 detik berlalu sebelum klaim negatif diperiksa.
    await page.evaluate(`new Promise((resolve) => {
      const start = performance.now();
      const tick = () => (performance.now() - start >= 6500 ? resolve() : requestAnimationFrame(tick));
      requestAnimationFrame(tick);
    })`);
    await expect(page.locator(holder)).toHaveAttribute('data-auto-rotate', 'false');
    await expect(card).toBeVisible();
  });
});

for (const [width, height] of [
  [375, 812],
  [768, 1024],
] as const) {
  test(`TC-F03-12 tombol zoom tidak menimpa bola di ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await openAt(page, '');
    const { cx, cy, r } = await globeCircle(page);
    const canvas = await canvasBox(page);
    for (const name of [idMessages.globe_zoom_in, idMessages.globe_zoom_out]) {
      const box = await page.getByRole('button', { name }).boundingBox();
      if (!box) throw new Error(`tombol ${name} tidak terlihat`);
      const nearestX = Math.min(Math.max(canvas.x + cx, box.x), box.x + box.width);
      const nearestY = Math.min(Math.max(canvas.y + cy, box.y), box.y + box.height);
      const distance = Math.hypot(nearestX - (canvas.x + cx), nearestY - (canvas.y + cy));
      expect(distance, `tombol "${name}" menimpa bola`).toBeGreaterThanOrEqual(r);
    }
  });
}

for (const [width, height] of [
  [375, 812],
  [768, 1024],
] as const) {
  test(`TC-F03-14 tombol zoom tidak menimpa kartu dan tombolnya di ${width}x${height}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    const card = await openJapanCard(page);
    // Tunggu kartu stabil: kotaknya sama pada dua pembacaan berturut-turut (animasi masuk selesai).
    let last = '';
    await expect
      .poll(async () => {
        const now = JSON.stringify(await card.boundingBox());
        const stable = now === last;
        last = now;
        return stable;
      })
      .toBe(true);
    const boxOf = async (locator: Locator, label: string) => {
      const box = await locator.boundingBox();
      if (!box) throw new Error(`${label} tidak terlihat`);
      return box;
    };
    const others = [
      { label: 'kartu', box: await boxOf(card, 'kartu') },
      {
        label: 'Tutup kartu',
        box: await boxOf(
          page.getByRole('button', { name: idMessages.explore_close_card }),
          'Tutup kartu',
        ),
      },
      {
        label: 'Kembali ke Indonesia',
        box: await boxOf(
          page.getByRole('button', { name: idMessages.explore_home }),
          'Kembali ke Indonesia',
        ),
      },
    ];
    for (const name of [idMessages.globe_zoom_in, idMessages.globe_zoom_out]) {
      const zoom = await boxOf(page.getByRole('button', { name }), name);
      expect(zoom.x, `"${name}" keluar kiri viewport`).toBeGreaterThanOrEqual(0);
      expect(zoom.y, `"${name}" keluar atas viewport`).toBeGreaterThanOrEqual(0);
      expect(zoom.x + zoom.width, `"${name}" keluar kanan viewport`).toBeLessThanOrEqual(width);
      expect(zoom.y + zoom.height, `"${name}" keluar bawah viewport`).toBeLessThanOrEqual(height);
      for (const { label, box } of others) {
        const overlapX = Math.min(zoom.x + zoom.width, box.x + box.width) - Math.max(zoom.x, box.x);
        const overlapY =
          Math.min(zoom.y + zoom.height, box.y + box.height) - Math.max(zoom.y, box.y);
        expect(overlapX > 0 && overlapY > 0, `"${name}" menimpa ${label}`).toBe(false);
      }
    }
  });
}

test.describe('bahasa Inggris', () => {
  // REMAP #53: dulu test.use({ locale: 'en-US' }) memilih Inggris; sekarang lewat lang=en.
  test('TC-F03-13 kartu, tombol, dan suara berbahasa Inggris', async ({ page }) => {
    await openAt(page, '&lang=en&lookAt=JP');
    await waitFlightDone(page, japan.anchor);
    await tapGlobeCenter(page);
    const card = page.getByRole('region', {
      name: fill(enMessages.explore_card_label, japan.name.en),
    });
    await expect(card).toBeVisible();
    await expect(card.getByRole('button', { name: enMessages.explore_close_card })).toBeVisible();
    await expect.poll(() => spoken(page)).toContain(fill(enMessages.explore_intro, japan.name.en));
  });
});

test('TC-NFR-privasi-jelajah tidak ada permintaan ke origin lain saat menjelajah', async ({
  page,
  baseURL,
}) => {
  const urls: string[] = [];
  page.on('request', (r) => urls.push(r.url()));
  const card = await openJapanCard(page);
  await card.getByRole('button', { name: idMessages.explore_listen_again }).click();
  const box = await canvasBox(page);
  await tapGlobeCenter(page, Math.round(box.height * 0.12));
  await expect.poll(() => spoken(page)).toContain(idMessages.explore_ocean);
  await page.getByRole('button', { name: idMessages.explore_home }).click();
  await expect(
    page.getByRole('region', { name: fill(idMessages.explore_card_label, indonesia.name.id) }),
  ).toBeVisible();
  await waitFlightDone(page, indonesia.anchor);
  await page.waitForLoadState('networkidle');
  const origin = new URL(baseURL ?? 'http://localhost:4173').origin;
  const iconRequests = urls.filter((u) => u.includes('/content/icons/'));
  expect(iconRequests.length).toBeGreaterThan(0);
  for (const u of iconRequests) expect(new URL(u).origin).toBe(origin);
  const external = urls.filter(
    (u) => !u.startsWith('data:') && !u.startsWith('blob:') && new URL(u).origin !== origin,
  );
  expect(external).toEqual([]);
  expect(urls.filter((u) => u.includes('fonts.googleapis.com'))).toEqual([]);
});
