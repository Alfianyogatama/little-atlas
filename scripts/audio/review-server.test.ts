import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AudioManifestSchema, type AudioManifest } from '../../src/content/schema';
import { textHash, type InventoryEntry } from './inventory';
import {
  loadReport,
  rawFileName,
  upsertItem,
  type PendingItem,
  type PendingReport,
} from './report';
import { createHandler, toView } from './review-server';

// Kontrak tambahan yang ditetapkan tes ini (issue #49, server tinjau audio):
// - createHandler(port, deps): (req: Request) => Promise<Response>, dengan
//   deps = { rawDir, manifestPath, reportPath: (locale) => string, inventory: (locale) => InventoryEntry[],
//   now: () => Date }. WAV mentah ada di `<rawDir>/<loc>/<nama>.wav`; `currentHash` untuk approve diambil
//   dari inventory(locale) berdasarkan id (id tidak ada di inventaris -> 400).
// - GET / -> 200 text/html (lang="id") untuk locale `?loc=id|en` (bawaan id): memuat teks klip, transkrip,
//   `<audio` dengan sumber `/raw/<file>` item; semua teks dan transkrip di-escape; tanpa emoji.
// - GET /raw/<loc>/<nama>.wav: hanya loc id|en dan nama ^[A-Za-z0-9_-]{1,80}\.wav$ (termasuk bentuk
//   ter-encode %2e%2e, %2f); selain itu 400. Nama sah -> 200 `audio/wav` berisi byte berkas.
// - POST /approve dan POST /reject (JSON { locale, id, file[, note] }): Origin harus persis
//   http://127.0.0.1:<port> atau http://localhost:<port>, kalau tidak (atau tanpa Origin) 403 dan tidak ada
//   perubahan data. id harus lolos regex ClipId (400). ReviewError -> 400 dengan pesannya. Sukses -> 200.
// - toView({ report, manifest, inventory }) murni -> kartu [{ id, text, takes: [{ file, take, flag, score,
//   transcript, approved, stale }] }] urut: flagRank take terburuk di kartu, lalu skor terendah, lalu id.
//   `approved` = manifest (locale, id).raw === file; `stale` = textHash item != hash inventaris untuk id.

const PORT = 4322;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const HASH = 'abcdef0123456789'.repeat(4);
const NOW = new Date('2026-10-17T02:00:00.000Z');
const EMOJI = /\p{Extended_Pictographic}/u;

type Flag = 'kosong' | 'bahasa' | 'beda' | 'periksa' | 'ok';

function makeItem(
  id: string,
  text: string,
  take: number,
  flag: Flag | null = 'ok',
  score = 0.97,
  over: Partial<PendingItem> = {},
): PendingItem {
  const hash = textHash(text);
  return {
    id,
    locale: 'id',
    text,
    textHash: hash,
    take,
    file: `id/${rawFileName(id, hash, take)}`,
    model: 'gemini-tts-model',
    voice: 'Aoede',
    styleHash: HASH,
    generatedAt: '2026-10-17T01:00:00.000Z',
    durationMs: 1800,
    whisper:
      flag === null
        ? null
        : {
            model: 'medium',
            transcript: `transkrip ${id}`,
            language: 'id',
            languageProbability: 0.99,
            score,
            flag,
          },
    rejected: null,
    ...over,
  };
}

const entryFor = (item: Pick<PendingItem, 'id' | 'text' | 'locale'>): InventoryEntry => ({
  id: item.id,
  locale: item.locale,
  text: item.text,
  textHash: textHash(item.text),
  category: 'intro',
  batch: 1,
});

const reportOf = (items: PendingItem[]): PendingReport => ({ version: 1, locale: 'id', items });
const manifestOf = (raws: PendingItem[]): AudioManifest => ({
  version: 1,
  clips: raws.map((i) => ({
    id: i.id,
    locale: i.locale,
    text: i.text,
    textHash: i.textHash,
    attempt: 1,
    raw: i.file,
    model: i.model,
    voice: i.voice,
    styleHash: i.styleHash,
    take: i.take,
    generatedAt: i.generatedAt,
    durationMs: i.durationMs,
    whisper: { model: 'medium', transcript: 'x', score: 0.97, flag: 'ok' },
    reviewedAt: '2026-10-17T01:30:00.000Z',
  })),
});

describe('toView', () => {
  it('TC-AUD49-REV-7 urutan kartu: flag terburuk, lalu skor naik, lalu id', () => {
    const items = [
      makeItem('fact:BR', 'Fakta Brasil', 1, 'ok', 0.95),
      makeItem('tryAgain', 'Coba lagi', 1, 'ok', 0.99),
      makeItem('fact:AR', 'Fakta Argentina', 1, 'ok', 0.91),
      makeItem('ocean', 'Lautan', 1, 'periksa', 0.85),
      makeItem('introHome', 'Halo dunia', 1, 'beda', 0.6),
      makeItem('fact:JP', 'Fakta Jepang', 1, 'bahasa', 0.5),
      makeItem('celebrateMany', 'Hore semua', 1, 'kosong', 0),
    ];
    const cards = toView({
      report: reportOf(items),
      manifest: manifestOf([]),
      inventory: items.map(entryFor),
    });
    expect(cards.map((c) => c.id)).toEqual([
      'celebrateMany',
      'fact:JP',
      'introHome',
      'ocean',
      'fact:AR',
      'fact:BR',
      'tryAgain',
    ]);
  });

  it('TC-AUD49-REV-7 flag sama dan skor sama: urut menurut id; skor mengalahkan id', () => {
    const items = [
      makeItem('intro:ZA', 'Ini Afrika Selatan', 1, 'periksa', 0.8),
      makeItem('intro:BR', 'Ini Brasil', 1, 'periksa', 0.8),
      makeItem('intro:AR', 'Ini Argentina', 1, 'periksa', 0.88),
      makeItem('intro:YE', 'Ini Yaman', 1, 'periksa', 0.76),
    ];
    const cards = toView({
      report: reportOf(items),
      manifest: manifestOf([]),
      inventory: items.map(entryFor),
    });
    expect(cards.map((c) => c.id)).toEqual(['intro:YE', 'intro:BR', 'intro:ZA', 'intro:AR']);
  });

  it('TC-AUD49-REV-7 take berdampingan dalam satu kartu; take terburuk menentukan urutan kartu', () => {
    const items = [
      makeItem('fact:US', 'Fakta Amerika', 1, 'ok', 0.99),
      makeItem('fact:US', 'Fakta Amerika', 2, 'kosong', 0),
      makeItem('fact:JP', 'Fakta Jepang', 1, 'bahasa', 0.5),
      makeItem('fact:BR', 'Fakta Brasil', 1, 'ok', 0.92),
    ];
    const cards = toView({
      report: reportOf(items),
      manifest: manifestOf([]),
      inventory: items.map(entryFor),
    });
    expect(cards.map((c) => c.id)).toEqual(['fact:US', 'fact:JP', 'fact:BR']);
    const us = cards.find((c) => c.id === 'fact:US');
    expect(us?.takes.map((t) => t.take).sort()).toEqual([1, 2]);
    expect(us?.text).toBe('Fakta Amerika');
  });

  it('TC-AUD49-REV-8 menandai take yang disetujui; take lain id sama tidak', () => {
    const take1 = makeItem('intro:JP', 'Ini Jepang', 1);
    const take2 = makeItem('intro:JP', 'Ini Jepang', 2);
    const cards = toView({
      report: reportOf([take1, take2]),
      manifest: manifestOf([take2]),
      inventory: [entryFor(take1)],
    });
    const takes = cards[0]?.takes ?? [];
    expect(takes.find((t) => t.file === take2.file)?.approved).toBe(true);
    expect(takes.find((t) => t.file === take1.file)?.approved).toBe(false);
  });

  it('TC-AUD49-REV-8 menandai take basi bila hash berbeda dari inventaris; yang terkini tidak', () => {
    const lama = makeItem('intro:JP', 'Ini Jepang', 1);
    const terkini = makeItem('intro:BR', 'Ini Brasil', 1);
    const cards = toView({
      report: reportOf([lama, terkini]),
      manifest: manifestOf([]),
      inventory: [
        entryFor({ id: 'intro:JP', locale: 'id', text: 'Ini negara Jepang' }),
        entryFor(terkini),
      ],
    });
    const stale = (id: string) => cards.find((c) => c.id === id)?.takes[0]?.stale;
    expect(stale('intro:JP')).toBe(true);
    expect(stale('intro:BR')).toBe(false);
  });

  it('TC-AUD49-REV-8 manifest locale lain tidak menandai disetujui', () => {
    const item = makeItem('intro:JP', 'Ini Jepang', 1);
    const en = { ...makeItem('intro:JP', 'This is Japan', 1), locale: 'en' as const };
    const cards = toView({
      report: reportOf([item]),
      manifest: manifestOf([{ ...en, file: item.file }]),
      inventory: [entryFor(item)],
    });
    expect(cards[0]?.takes[0]?.approved).toBe(false);
  });
});

describe('createHandler', () => {
  let dir: string;
  let manifestPath: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'audio-review-server-'));
    manifestPath = join(dir, 'data', 'audio-manifest.json');
    mkdirSync(join(dir, 'raw', 'id'), { recursive: true });
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const jp = makeItem('intro:JP', 'Ini Jepang', 1);

  function setup(items: PendingItem[] = [jp], inventory: InventoryEntry[] = items.map(entryFor)) {
    const path = join(dir, 'report-id.json');
    let report = loadReport(path, 'id');
    for (const i of items) report = upsertItem(path, report, i);
    return createHandler(PORT, {
      rawDir: join(dir, 'raw'),
      manifestPath,
      reportPath: (locale: 'id' | 'en') => join(dir, `report-${locale}.json`),
      inventory: (locale: 'id' | 'en') => inventory.filter((e) => e.locale === locale),
      now: () => NOW,
    });
  }

  const post = (
    handler: (r: Request) => Promise<Response>,
    path: string,
    body: unknown,
    origin: string | null = ORIGIN,
  ) =>
    handler(
      new Request(`${ORIGIN}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(origin === null ? {} : { origin }),
        },
        body: JSON.stringify(body),
      }),
    );
  const get = (handler: (r: Request) => Promise<Response>, path: string) =>
    handler(new Request(`${ORIGIN}${path}`));
  const approveBody = (item: PendingItem = jp) => ({
    locale: item.locale,
    id: item.id,
    file: item.file,
  });
  const rejectedOf = (file: string) =>
    loadReport(join(dir, 'report-id.json'), 'id').items.find((i) => i.file === file)?.rejected;

  describe('Origin', () => {
    it.each([
      ['origin asing', 'http://evil.example'],
      ['port salah', 'http://127.0.0.1:9999'],
      ['host mirip', 'http://127.0.0.1.evil.example:4322'],
      ['skema https', `https://127.0.0.1:${PORT}`],
      ['origin null', 'null'],
      ['tanpa origin', null],
    ])('TC-AUD49-REV-3 /approve ditolak 403 dan manifest tidak berubah: %s', async (_n, origin) => {
      const handler = setup();
      const res = await post(handler, '/approve', approveBody(), origin);
      expect(res.status).toBe(403);
      expect(existsSync(manifestPath)).toBe(false);
    });

    it.each([
      ['origin asing', 'http://evil.example'],
      ['tanpa origin', null],
    ])('TC-AUD49-REV-3 /reject ditolak 403 dan laporan tidak berubah: %s', async (_n, origin) => {
      const handler = setup();
      const res = await post(handler, '/reject', { ...approveBody(), note: 'sumbang' }, origin);
      expect(res.status).toBe(403);
      expect(rejectedOf(jp.file)).toBeNull();
    });

    it.each([ORIGIN, `http://localhost:${PORT}`])(
      'TC-AUD49-REV-3 kontrol positif: /approve dengan origin %s berhasil',
      async (origin) => {
        const handler = setup();
        const res = await post(handler, '/approve', approveBody(), origin);
        expect(res.status).toBe(200);
        const manifest = AudioManifestSchema.parse(JSON.parse(readFileSync(manifestPath, 'utf8')));
        expect(manifest.clips.map((c) => c.id)).toEqual(['intro:JP']);
        expect(readdirSync(join(dir, 'data'))).toEqual(['audio-manifest.json']);
      },
    );

    it('TC-AUD49-REV-3 kontrol positif: /reject dengan origin sah mencatat penolakan', async () => {
      const handler = setup();
      const res = await post(handler, '/reject', { ...approveBody(), note: 'sumbang' });
      expect(res.status).toBe(200);
      expect(rejectedOf(jp.file)).toEqual({ note: 'sumbang', at: NOW.toISOString() });
    });
  });

  describe('validasi permintaan', () => {
    it.each([['../x'], ['intro:jp'], ['intro:JPN'], [''], ['fact:JP/../..']])(
      'TC-AUD49-REV-2 id tidak lolos regex ClipId -> 400: %s',
      async (id) => {
        const handler = setup();
        const res = await post(handler, '/approve', { ...approveBody(), id });
        expect(res.status).toBe(400);
        expect(existsSync(manifestPath)).toBe(false);
      },
    );

    it('TC-AUD49-REV-2 body bukan JSON -> 400', async () => {
      const handler = setup();
      const res = await handler(
        new Request(`${ORIGIN}/approve`, {
          method: 'POST',
          headers: { origin: ORIGIN, 'content-type': 'application/json' },
          body: '{bukan json',
        }),
      );
      expect(res.status).toBe(400);
    });

    it('TC-AUD49-REV-2 whisper null -> 400 dengan pesan audio:check', async () => {
      const item = makeItem('intro:JP', 'Ini Jepang', 1, null);
      const handler = setup([item]);
      const res = await post(handler, '/approve', approveBody(item));
      expect(res.status).toBe(400);
      expect(await res.text()).toMatch(/audio:check/);
      expect(existsSync(manifestPath)).toBe(false);
    });

    it('TC-AUD49-REV-2 teks inventaris sudah berubah -> 400 dan manifest tidak tertulis', async () => {
      const handler = setup(
        [jp],
        [entryFor({ id: 'intro:JP', locale: 'id', text: 'Ini negara Jepang' })],
      );
      const res = await post(handler, '/approve', approveBody());
      expect(res.status).toBe(400);
      expect(await res.text()).toMatch(/teks sudah berubah/);
      expect(existsSync(manifestPath)).toBe(false);
    });

    it('TC-AUD49-REV-2 id tidak ada di inventaris -> 400', async () => {
      const handler = setup([jp], []);
      const res = await post(handler, '/approve', approveBody());
      expect(res.status).toBe(400);
      expect(existsSync(manifestPath)).toBe(false);
    });

    it('TC-AUD49-REV-6 /reject tanpa catatan -> 400 dan laporan tidak berubah', async () => {
      const handler = setup();
      const res = await post(handler, '/reject', { ...approveBody(), note: '  ' });
      expect(res.status).toBe(400);
      expect(rejectedOf(jp.file)).toBeNull();
    });
  });

  describe('GET /raw', () => {
    const wav = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4]);

    it('TC-AUD49-REV-4 nama sah -> 200 audio/wav dengan byte berkas', async () => {
      const handler = setup();
      const name = jp.file.slice('id/'.length);
      writeFileSync(join(dir, 'raw', 'id', name), wav);
      const res = await get(handler, `/raw/${jp.file}`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('audio/wav');
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(wav);
    });

    it.each([
      ['traversal ter-encode di nama', '/raw/id/..%2f..%2fsecret.wav'],
      ['traversal %2e%2e di nama', '/raw/id/%2e%2e%2fsecret.wav'],
      ['locale tak dikenal', '/raw/fr/a.wav'],
      ['tanpa locale', '/raw/a.wav'],
      ['bukan wav', '/raw/id/a.mp3'],
      ['ekstensi ganda', '/raw/id/a.wav.exe'],
      ['nama kosong', '/raw/id/.wav'],
      ['nama 81 karakter', `/raw/id/${'a'.repeat(81)}.wav`],
      ['ada spasi', '/raw/id/a%20b.wav'],
      ['ada titik dua', '/raw/id/intro:JP.wav'],
      ['ada backslash', '/raw/id/..%5Csecret.wav'],
      ['bersarang', '/raw/id/sub/a.wav'],
    ])('TC-AUD49-REV-4 ditolak 400: %s', async (_n, path) => {
      const handler = setup();
      writeFileSync(join(dir, 'secret.wav'), 'RAHASIA');
      writeFileSync(join(dir, 'raw', 'secret.wav'), 'RAHASIA');
      const res = await get(handler, path);
      expect(res.status).toBe(400);
      expect(await res.text()).not.toContain('RAHASIA');
    });

    it.each([
      ['%2e%2e sebagai nama', '/raw/id/%2e%2e'],
      ['%2e%2e sebagai locale', '/raw/%2e%2e/secret.wav'],
      ['.. literal', '/raw/id/../secret.wav'],
      ['%2e%2e dua tingkat', '/raw/id/%2e%2e/%2e%2e/secret.wav'],
    ])(
      'TC-AUD49-REV-4 segmen titik dinormalkan URL, tidak pernah disajikan (400 atau 404): %s',
      async (_n, path) => {
        const handler = setup();
        writeFileSync(join(dir, 'secret.wav'), 'RAHASIA');
        writeFileSync(join(dir, 'raw', 'secret.wav'), 'RAHASIA');
        const res = await get(handler, path);
        expect([400, 404]).toContain(res.status);
        expect(await res.text()).not.toContain('RAHASIA');
      },
    );

    it('TC-AUD49-REV-4 nama 80 karakter sebelum .wav masih sah (batas)', async () => {
      const handler = setup();
      const name = `${'a'.repeat(80)}.wav`;
      writeFileSync(join(dir, 'raw', 'id', name), wav);
      const res = await get(handler, `/raw/id/${name}`);
      expect(res.status).toBe(200);
    });
  });

  describe('GET /', () => {
    it('TC-AUD49-REV-9 200 HTML berbahasa Indonesia memuat teks, transkrip, pemutar; tanpa emoji', async () => {
      const handler = setup([jp, makeItem('intro:BR', 'Ini Brasil', 1, 'beda', 0.6)]);
      const res = await get(handler, '/?loc=id');
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toMatch(/^text\/html/);
      const html = await res.text();
      expect(html).toContain('lang="id"');
      expect(html).toContain('Ini Jepang');
      expect(html).toContain('transkrip intro:JP');
      expect(html).toContain('Ini Brasil');
      expect(html).toContain('<audio');
      expect(html).toContain(`/raw/${jp.file}`);
      expect(EMOJI.test(html)).toBe(false);
    });

    it('TC-AUD49-REV-9 teks dan transkrip di-escape', async () => {
      const item = makeItem('intro:JP', 'Ini <b>Jepang</b> & "kawan"', 1);
      const handler = setup([item]);
      const html = await (await get(handler, '/?loc=id')).text();
      expect(html).not.toContain('<b>Jepang</b>');
      expect(html).toContain('&lt;b&gt;Jepang&lt;/b&gt;');
    });

    it('TC-AUD49-REV-9 tanpa laporan: tetap 200 dan tanpa emoji', async () => {
      const handler = setup([]);
      const res = await get(handler, '/');
      expect(res.status).toBe(200);
      expect(EMOJI.test(await res.text())).toBe(false);
    });
  });

  describe('Halaman tinjau: kosong, label, status, galat', () => {
    const tagsOf = (html: string, name: string): string[] =>
      html.match(new RegExp(`<${name}\\b[^>]*>`, 'g')) ?? [];
    const labelOf = (tag: string): string | null => /aria-label="([^"]*)"/.exec(tag)?.[1] ?? null;
    const approveButton = (html: string, file: string): string | undefined =>
      tagsOf(html, 'button').find(
        (t) => t.includes('data-act="approve"') && t.includes(`data-file="${file}"`),
      );

    it('TC-AUD49-REV-10 take kosong: tombol Setuju nonaktif dan POST /approve 400 tanpa mengubah manifest', async () => {
      const kosong = makeItem('intro:JP', 'Ini Jepang', 1, 'kosong', 0);
      const sehat = makeItem('intro:BR', 'Ini Brasil', 1, 'ok', 0.97);
      const handler = setup([kosong, sehat]);
      const html = await (await get(handler, '/?loc=id')).text();
      const btnKosong = approveButton(html, kosong.file);
      const btnSehat = approveButton(html, sehat.file);
      expect(btnKosong).toBeDefined();
      expect(btnKosong).toMatch(/\bdisabled\b/);
      expect(btnSehat).toBeDefined();
      expect(btnSehat).not.toMatch(/\bdisabled\b/);

      const res = await post(handler, '/approve', approveBody(kosong));
      expect(res.status).toBe(400);
      expect(await res.text()).toMatch(/kosong/);
      expect(existsSync(manifestPath)).toBe(false);

      const ok = await post(handler, '/approve', approveBody(sehat));
      expect(ok.status).toBe(200);
    });

    it('TC-AUD49-REV-11 tombol, catatan, dan pemutar punya aria-label berisi id klip dan nomor take', async () => {
      const t1 = makeItem('praise:1', 'Hebat sekali!', 1);
      const t2 = makeItem('praise:1', 'Hebat sekali!', 2);
      const html = await (await get(setup([t1, t2]), '/?loc=id')).text();
      const interactive = [
        ...tagsOf(html, 'button'),
        ...tagsOf(html, 'input'),
        ...tagsOf(html, 'audio'),
      ];
      expect(interactive).toHaveLength(2 * 4);
      for (const tag of interactive) {
        const label = labelOf(tag);
        expect(label, tag).not.toBeNull();
        expect(label).toContain('praise:1');
        expect(label).toMatch(/take [12]\b/);
      }
      expect(html).toContain('aria-label="Setujui praise:1 take 2"');
      expect(html).toContain('aria-label="Setujui praise:1 take 1"');
      const audioLabels = tagsOf(html, 'audio').map(labelOf);
      expect(audioLabels.some((l) => l?.includes('take 1'))).toBe(true);
      expect(audioLabels.some((l) => l?.includes('take 2'))).toBe(true);
      const inputLabels = tagsOf(html, 'input').map(labelOf);
      expect(new Set(inputLabels).size).toBe(2);
    });

    it('TC-AUD49-REV-12 elemen status ada dan gayanya sticky atau fixed', async () => {
      const html = await (await get(setup(), '/?loc=id')).text();
      expect(html).toMatch(/id="status"|role="status"|aria-live=/);
      expect(html).toMatch(
        /(?:#status|\[role=["']?status["']?\]|\[aria-live[^\]]*\])[^{}]*\{[^}]*position:\s*(?:sticky|fixed)/,
      );
    });

    it('TC-AUD49-REV-13 GET / dengan laporan rusak: respons 500 berteks, bukan throw', async () => {
      const handler = setup([]);
      writeFileSync(join(dir, 'report-id.json'), '{ rusak');
      const res = await get(handler, '/?loc=id');
      expect(res.status).toBe(500);
      expect(res.headers.get('content-type')).toMatch(/^text\/plain/);
      expect((await res.text()).length).toBeGreaterThan(0);
    });

    it('TC-AUD49-REV-13 kontrol positif: laporan sehat tetap 200', async () => {
      const res = await get(setup(), '/?loc=id');
      expect(res.status).toBe(200);
    });
  });
});
