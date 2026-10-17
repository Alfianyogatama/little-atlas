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
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, createClient } from '../ai/client';
import { runGenerate } from './generate';
import { exitCodeFor, parseArgs } from './generate-cli';
import { textHash, type InventoryCategory, type InventoryEntry } from './inventory';
import { loadReport, rawFileName, type PendingItem } from './report';
import { buildTtsPayload, pcmToWav, readWav } from './tts';
import { styleHash } from './voice';

// Kontrak tambahan yang ditetapkan tes ini (semua lewat DI, tanpa jaringan, tanpa ffmpeg):
// - runGenerate(opts): Promise<{ done, skipped, total, stopped: null | 'rpd' | 'free_tier' }> dengan
//   opts = { locale, entries, takes, dryRun, rawDir, reportPath, approved(id, textHash), client, models
//   { assertConfigured(role), model, seed }, voice { voice, style { id, en } }, now, sleep, delayMs, log }.
//   total = jumlah entri masukan; skipped = entri yang dilewati; done = klip yang berhasil dibuat.
// - Target take per entri: `takes` untuk kategori core dan celebrate, 1 untuk kategori lain. Entri dilewati bila
//   approved(id, textHash) true, atau jumlah item laporan dengan id + textHash sama dan rejected === null
//   sudah >= target. Take baru = take maksimum untuk id + textHash (termasuk yang ditolak) + 1.
// - Permintaan: client.request('tts', buildTtsPayload({ text, locale, voice, style: style[locale], seed? }),
//   { cacheTag: 'take-<n>' }); seed = n hanya bila models.seed true, selain itu kuncinya tidak ada.
// - Respons -> extractPcm -> pcmToWav -> rawDir/<locale>/<rawFileName(id, textHash, n)> -> upsertItem
//   SEGERA (sebelum permintaan berikutnya). Item: file = '<locale>/<rawFileName>', model = models.model,
//   voice, styleHash = styleHash(voice, locale), generatedAt = now().toISOString(), durationMs dari jumlah
//   sampel, whisper null, rejected null.
// - sleep(delayMs) hanya di antara permintaan sungguhan (bukan sebelum yang pertama, bukan untuk entri yang dilewati).
// - ApiError 429 dengan classifyQuota 'rpd' atau 'free_tier' menghentikan run (stopped terisi, progres tetap);
//   error lain per entri (rpm, status lain, respons tanpa audio) dicatat lewat log dengan id entri lalu lanjut.
// - dryRun: tanpa assertConfigured, tanpa client, tanpa berkas; log satu baris per klip yang akan dibuat,
//   memuat id, teks, nama berkas, dan suara; assertVoiceConfigured tidak dipanggil.
// - Bukan dry-run: models.assertConfigured('tts') dan assertVoiceConfigured (melempar bila voice berawalan
//   "ISI-SETELAH-") dipanggil SEBELUM permintaan pertama.
// - generate-cli: parseArgs(argv) -> { locale, batch?, ids?, takes (default 1), limit?, dryRun };
//   argumen salah melempar Error berpesan Indonesia. exitCodeFor(result) = 2 bila stopped terisi, selain itu 0.
//   Mengimpor generate-cli tidak boleh menjalankan main().

const NOW = new Date('2026-10-17T10:00:00.000Z');
const STYLE = { id: 'pelan, ceria, dan jelas untuk anak balita', en: 'slow, cheerful, and clear' };
const VOICE = { voice: 'Aoede', style: STYLE };
const PCM_BYTES = 24000; // 12000 sampel pada 24 kHz = 500 ms

const googleError = (quotaId: string): string =>
  JSON.stringify({
    error: {
      code: 429,
      message: 'You exceeded your current quota.',
      status: 'RESOURCE_EXHAUSTED',
      details: [
        {
          '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
          violations: [{ quotaId }],
        },
      ],
    },
  });
const PER_DAY = googleError('GenerateRequestsPerDayPerProjectPerModel');
const PER_MINUTE = googleError('GenerateRequestsPerMinutePerProjectPerModel');
const FREE_TIER = googleError('GenerateRequestsPerDayPerProjectPerModel-FreeTier');

const audioResponse = (fill: number): unknown => ({
  candidates: [
    {
      content: {
        parts: [
          {
            inlineData: {
              mimeType: 'audio/L16;codec=pcm;rate=24000',
              data: Buffer.alloc(PCM_BYTES, fill).toString('base64'),
            },
          },
        ],
      },
    },
  ],
});

const entry = (
  id: string,
  category: InventoryCategory,
  text: string,
  locale: 'id' | 'en' = 'id',
): InventoryEntry => ({
  id,
  locale,
  text,
  textHash: textHash(text),
  category,
  batch: 1,
});
const CORE = entry('introHome', 'core', 'Ini Indonesia, rumah kita!');
const CELEBRATE = entry('celebrate:5', 'celebrate', 'Hebat, lima bendera!');
const FACT = entry('fact:JP', 'fact', 'Jepang punya gunung Fuji.');
const INTRO = entry('intro:FR', 'intro', 'Ini Prancis.');
const QUIZ = entry('praiseFlag:BR', 'quiz', 'Benar, ini bendera Brasil!');

let dir: string;
let rawDir: string;
let reportPath: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'audio-gen-'));
  rawDir = join(dir, 'raw');
  reportPath = join(dir, 'report-id.json');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

interface Over {
  locale?: 'id' | 'en';
  entries?: InventoryEntry[];
  takes?: number;
  dryRun?: boolean;
  seed?: boolean;
  voice?: { voice: string; style: { id: string; en: string } };
  approved?: (id: string, hash: string) => boolean;
  respond?: (n: number) => unknown;
  configError?: Error;
}
interface Call {
  role: string;
  payload: unknown;
  cacheTag: string | undefined;
}

function setup(o: Over = {}) {
  const calls: Call[] = [];
  const order: string[] = [];
  const request = vi.fn(
    (role: string, payload: unknown, opt?: { cacheTag?: string }): Promise<unknown> => {
      calls.push({ role, payload, cacheTag: opt?.cacheTag });
      order.push('request');
      const n = calls.length;
      try {
        return Promise.resolve(o.respond ? o.respond(n) : audioResponse(n));
      } catch (e) {
        return Promise.reject(e instanceof Error ? e : new Error(String(e)));
      }
    },
  );
  const assertConfigured = vi.fn<(role: string) => void>(() => {
    order.push('assertConfigured');
    if (o.configError) throw o.configError;
  });
  const sleep = vi.fn<(ms: number) => Promise<void>>(() => Promise.resolve());
  const log = vi.fn<(line: string) => void>(() => undefined);
  const approved = vi.fn(o.approved ?? ((): boolean => false));
  const run = (over: Partial<Parameters<typeof runGenerate>[0]> = {}) =>
    runGenerate({
      locale: o.locale ?? 'id',
      entries: o.entries ?? [CORE],
      takes: o.takes ?? 1,
      dryRun: o.dryRun ?? false,
      rawDir,
      reportPath,
      approved,
      client: { request },
      models: { assertConfigured, model: 'gemini-tts-test', seed: o.seed ?? false },
      voice: o.voice ?? VOICE,
      now: () => NOW,
      sleep,
      delayMs: 3000,
      log,
      ...over,
    });
  return { run, request, calls, order, assertConfigured, sleep, log, approved };
}

const report = (locale: 'id' | 'en' = 'id') => loadReport(reportPath, locale);
const rawFiles = (locale = 'id'): string[] =>
  existsSync(join(rawDir, locale)) ? readdirSync(join(rawDir, locale)).sort() : [];
const logged = (log: { mock: { calls: unknown[][] } }): string[] =>
  log.mock.calls.map((c) => String(c[0]));

/** Menulis laporan awal langsung sebagai JSON, supaya tes tidak bergantung pada upsertItem. */
function seedReport(items: PendingItem[], locale: 'id' | 'en' = 'id'): void {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify({ version: 1, locale, items }));
}
function pendingItem(e: InventoryEntry, take: number, rejected = false): PendingItem {
  return {
    id: e.id,
    locale: e.locale,
    text: e.text,
    textHash: e.textHash,
    take,
    file: `${e.locale}/${rawFileName(e.id, e.textHash, take)}`,
    model: 'gemini-tts-test',
    voice: 'Aoede',
    styleHash: styleHash(VOICE, e.locale),
    generatedAt: '2026-10-16T10:00:00.000Z',
    durationMs: 500,
    whisper: null,
    rejected: rejected ? { note: 'terpotong', at: '2026-10-16T12:00:00.000Z' } : null,
  };
}

describe('runGenerate: entri baru', () => {
  it('TC-AUD49-GEN-1: satu request, WAV tertulis, item laporan take 1, cacheTag take-1', async () => {
    const t = setup({ entries: [FACT] });
    const result = await t.run();

    expect(result).toEqual({ done: 1, skipped: 0, total: 1, stopped: null });
    expect(t.request).toHaveBeenCalledTimes(1);
    expect(t.calls[0]?.role).toBe('tts');
    expect(t.calls[0]?.cacheTag).toBe('take-1');
    expect(t.calls[0]?.payload).toEqual(
      buildTtsPayload({ text: FACT.text, locale: 'id', voice: 'Aoede', style: STYLE.id }),
    );

    const file = `id/${rawFileName(FACT.id, FACT.textHash, 1)}`;
    expect(file).toMatch(/^id\/fact_JP-[0-9a-f]{8}-1\.wav$/);
    expect(rawFiles()).toEqual([`${rawFileName(FACT.id, FACT.textHash, 1)}`]);
    const wav = readWav(readFileSync(join(rawDir, file)));
    expect(wav.rate).toBe(24000);
    expect(wav.pcm).toHaveLength(PCM_BYTES);
    expect(wav.pcm[0]).toBe(1);

    expect(report().items).toEqual([
      {
        id: 'fact:JP',
        locale: 'id',
        text: FACT.text,
        textHash: FACT.textHash,
        take: 1,
        file,
        model: 'gemini-tts-test',
        voice: 'Aoede',
        styleHash: styleHash(VOICE, 'id'),
        generatedAt: NOW.toISOString(),
        durationMs: 500,
        whisper: null,
        rejected: null,
      },
    ]);
  });

  it('TC-AUD49-GEN-1: locale en memakai gaya en dan folder en', async () => {
    const intro = entry('intro:JP', 'intro', 'This is Japan.', 'en');
    reportPath = join(dir, 'report-en.json');
    const t = setup({ locale: 'en', entries: [intro] });
    await t.run();
    expect(t.calls[0]?.payload).toEqual(
      buildTtsPayload({ text: 'This is Japan.', locale: 'en', voice: 'Aoede', style: STYLE.en }),
    );
    expect(rawFiles('en')).toEqual([rawFileName('intro:JP', intro.textHash, 1)]);
    expect(report('en').items[0]?.file).toBe(`en/${rawFileName('intro:JP', intro.textHash, 1)}`);
    expect(report('en').items[0]?.styleHash).toBe(styleHash(VOICE, 'en'));
  });

  it('TC-AUD49-GEN-1: laporan dan WAV klip pertama sudah ada sebelum request klip kedua', async () => {
    const snapshots: { items: number; files: number }[] = [];
    const t = setup({
      entries: [FACT, INTRO],
      respond: (n) => {
        snapshots.push({
          items: existsSync(reportPath) ? report().items.length : 0,
          files: rawFiles().length,
        });
        return audioResponse(n);
      },
    });
    await t.run();
    expect(snapshots).toEqual([
      { items: 0, files: 0 },
      { items: 1, files: 1 },
    ]);
  });

  it('TC-AUD49-GEN-1: sleep(delayMs) hanya di antara permintaan sungguhan', async () => {
    const one = setup({ entries: [FACT] });
    await one.run();
    expect(one.sleep).not.toHaveBeenCalled();

    const dir2 = mkdtempSync(join(tmpdir(), 'audio-gen-'));
    try {
      const three = setup({ entries: [FACT, INTRO, QUIZ] });
      await three.run({ rawDir: join(dir2, 'raw'), reportPath: join(dir2, 'r.json') });
      expect(three.request).toHaveBeenCalledTimes(3);
      expect(three.sleep.mock.calls).toEqual([[3000], [3000]]);
    } finally {
      rmSync(dir2, { recursive: true, force: true });
    }
  });
});

describe('runGenerate: respons audio/wav', () => {
  it('TC-AUD49-GEN-10: respons audio/wav menghasilkan satu WAV tulen, bukan WAV bersarang', async () => {
    const pcm = Uint8Array.from({ length: PCM_BYTES }, (_, i) => (i * 5 + 1) % 256);
    const wavResponse = {
      candidates: [
        {
          content: {
            parts: [
              {
                inlineData: {
                  mimeType: 'audio/wav',
                  data: Buffer.from(pcmToWav(pcm, 24000)).toString('base64'),
                },
              },
            ],
          },
          finishReason: 'STOP',
        },
      ],
    };
    const t = setup({ entries: [FACT], respond: () => wavResponse });
    const result = await t.run();
    expect(result).toEqual({ done: 1, skipped: 0, total: 1, stopped: null });

    const bytes = readFileSync(join(rawDir, 'id', rawFileName(FACT.id, FACT.textHash, 1)));
    expect(bytes.length).toBe(44 + PCM_BYTES);
    const wav = readWav(bytes);
    expect(wav.rate).toBe(24000);
    expect(wav.channels).toBe(1);
    expect(wav.bitsPerSample).toBe(16);
    expect(Array.from(wav.pcm)).toEqual(Array.from(pcm));
    expect(report().items[0]?.durationMs).toBe(500);
  });
});

describe('runGenerate: resume dan persetujuan', () => {
  it('TC-AUD49-GEN-2: run kedua tanpa perubahan tidak membuat request sama sekali', async () => {
    const t = setup({ entries: [CORE, FACT] });
    const first = await t.run();
    expect(first.done).toBe(2);
    expect(t.request).toHaveBeenCalledTimes(2);

    const second = await t.run();
    expect(t.request).toHaveBeenCalledTimes(2);
    expect(second).toEqual({ done: 0, skipped: 2, total: 2, stopped: null });
    expect(report().items).toHaveLength(2);
    expect(rawFiles()).toHaveLength(2);
  });

  it('TC-AUD49-GEN-2: teks berubah (textHash baru) dibuat ulang sebagai take 1 untuk hash baru', async () => {
    const t = setup({ entries: [FACT] });
    await t.run();
    const changed = entry('fact:JP', 'fact', 'Jepang punya gunung Fuji yang tinggi.');
    await t.run({ entries: [changed] });
    expect(t.request).toHaveBeenCalledTimes(2);
    expect(t.calls[1]?.cacheTag).toBe('take-1');
    expect(report().items.map((i) => [i.textHash, i.take])).toEqual([
      [FACT.textHash, 1],
      [changed.textHash, 1],
    ]);
  });

  it('TC-AUD49-GEN-3: entri yang sudah disetujui dilewati, sisanya tetap dibuat', async () => {
    const t = setup({
      entries: [FACT, INTRO, QUIZ],
      approved: (id, hash) => id === 'intro:FR' && hash === INTRO.textHash,
    });
    const result = await t.run();
    expect(result).toEqual({ done: 2, skipped: 1, total: 3, stopped: null });
    expect(t.approved).toHaveBeenCalledWith('intro:FR', INTRO.textHash);
    expect(t.calls.map((c) => JSON.stringify(c.payload).includes('Prancis'))).toEqual([
      false,
      false,
    ]);
    expect(report().items.map((i) => i.id)).toEqual(['fact:JP', 'praiseFlag:BR']);
    expect(t.sleep).toHaveBeenCalledTimes(1);
  });

  it('TC-AUD49-GEN-3: approved dengan hash lama tidak berlaku untuk teks baru', async () => {
    const t = setup({
      entries: [FACT],
      approved: (_id, hash) => hash === textHash('teks lama'),
    });
    await t.run();
    expect(t.request).toHaveBeenCalledTimes(1);
  });
});

describe('runGenerate: penolakan dan take', () => {
  it('TC-AUD49-GEN-4: take 1 ditolak -> run berikutnya membuat take 2 dan tidak dihitung untuk target', async () => {
    seedReport([pendingItem(FACT, 1, true)]);
    const t = setup({ entries: [FACT] });
    const result = await t.run();

    expect(result.done).toBe(1);
    expect(t.request).toHaveBeenCalledTimes(1);
    expect(t.calls[0]?.cacheTag).toBe('take-2');
    expect(rawFiles()).toEqual([rawFileName(FACT.id, FACT.textHash, 2)]);
    expect(rawFileName(FACT.id, FACT.textHash, 2)).toMatch(/-2\.wav$/);
    expect(report().items.map((i) => [i.take, i.rejected === null])).toEqual([
      [1, false],
      [2, true],
    ]);

    // Take 2 sekarang memenuhi target: run berikutnya tidak meminta apa-apa.
    await t.run();
    expect(t.request).toHaveBeenCalledTimes(1);
  });

  it('TC-AUD49-GEN-4: nomor take naik melewati take yang ditolak walau bukan yang terakhir', async () => {
    seedReport([pendingItem(FACT, 1, true), pendingItem(FACT, 2, true)]);
    const t = setup({ entries: [FACT] });
    await t.run();
    expect(t.calls[0]?.cacheTag).toBe('take-3');
    expect(report().items.map((i) => i.take)).toEqual([1, 2, 3]);
  });

  it('TC-AUD49-GEN-4: take ditolak milik hash teks lama tidak memengaruhi nomor take hash baru', async () => {
    const old = entry('fact:JP', 'fact', 'Teks lama.');
    seedReport([pendingItem(old, 1, true), pendingItem(old, 2, true)]);
    const t = setup({ entries: [FACT] });
    await t.run();
    expect(t.calls[0]?.cacheTag).toBe('take-1');
  });

  it('TC-AUD49-GEN-4: dengan takes 2, satu take core ditolak -> hanya membuat take pengganti (take 3)', async () => {
    seedReport([pendingItem(CORE, 1), pendingItem(CORE, 2, true)]);
    const t = setup({ entries: [CORE], takes: 2 });
    await t.run();
    expect(t.request).toHaveBeenCalledTimes(1);
    expect(t.calls[0]?.cacheTag).toBe('take-3');
    expect(report().items.map((i) => i.take)).toEqual([1, 2, 3]);
  });

  it('TC-AUD49-GEN-5: takes 2 -> core dan celebrate dapat 2 take, fact, intro, dan quiz 1', async () => {
    const t = setup({ entries: [CORE, CELEBRATE, FACT, INTRO, QUIZ], takes: 2 });
    const result = await t.run();
    expect(result.done).toBe(7);
    expect(t.request).toHaveBeenCalledTimes(7);

    const perId = new Map<string, number[]>();
    for (const i of report().items) perId.set(i.id, [...(perId.get(i.id) ?? []), i.take]);
    expect(Object.fromEntries(perId)).toEqual({
      introHome: [1, 2],
      'celebrate:5': [1, 2],
      'fact:JP': [1],
      'intro:FR': [1],
      'praiseFlag:BR': [1],
    });
    expect(t.calls.map((c) => c.cacheTag)).toEqual([
      'take-1',
      'take-2',
      'take-1',
      'take-2',
      'take-1',
      'take-1',
      'take-1',
    ]);
    expect(rawFiles()).toHaveLength(7);

    await t.run();
    expect(t.request).toHaveBeenCalledTimes(7);
  });

  it('TC-AUD49-GEN-5: takes 1 (default CLI) hanya satu take untuk core', async () => {
    const t = setup({ entries: [CORE], takes: 1 });
    await t.run();
    expect(t.request).toHaveBeenCalledTimes(1);
  });
});

describe('runGenerate: kuota dan error', () => {
  it('TC-AUD49-GEN-6: kuota harian pada request kedua -> berhenti, progres tetap, tanpa request ketiga', async () => {
    const t = setup({
      entries: [FACT, INTRO, QUIZ, CORE],
      respond: (n) => {
        if (n === 2) throw new ApiError('Panggilan ke tts gagal dengan status 429', 429, PER_DAY);
        return audioResponse(n);
      },
    });
    const result = await t.run();
    expect(result).toEqual({ done: 1, skipped: 0, total: 4, stopped: 'rpd' });
    expect(t.request).toHaveBeenCalledTimes(2);
    expect(report().items.map((i) => i.id)).toEqual(['fact:JP']);
    expect(rawFiles()).toEqual([rawFileName(FACT.id, FACT.textHash, 1)]);
  });

  it('TC-AUD49-GEN-9: 429 harian berbody panjang lewat client asli -> berhenti dengan stopped rpd', async () => {
    const longBody = JSON.stringify(
      {
        error: {
          code: 429,
          message:
            'You exceeded your current quota, please check your plan and billing details. ' +
            'For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits. ' +
            'To monitor your current usage, head to: https://ai.dev/rate-limit.',
          status: 'RESOURCE_EXHAUSTED',
          details: [
            {
              '@type': 'type.googleapis.com/google.rpc.Help',
              links: [{ description: 'Learn more', url: 'https://ai.google.dev/gemini-api/docs' }],
            },
            {
              '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
              violations: [
                {
                  quotaMetric: 'generativelanguage.googleapis.com/generate_content_requests',
                  quotaId: 'GenerateRequestsPerDayPerProjectPerModel',
                  quotaDimensions: { location: 'global', model: 'gemini-tts-test' },
                  quotaValue: '100',
                },
              ],
            },
          ],
        },
      },
      null,
      2,
    );
    expect(longBody.length).toBeGreaterThan(900);
    const cacheDir = join(dir, 'ai-cache');
    const savedKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = 'sk-test-gen-9';
    try {
      let fetches = 0;
      const real = createClient({
        fetch: (() => {
          fetches += 1;
          return Promise.resolve(new Response(longBody, { status: 429 }));
        }) as unknown as typeof fetch,
        sleep: () => Promise.resolve(),
        cacheDir,
        now: () => NOW,
      });
      const t = setup({ entries: [FACT, INTRO, QUIZ] });
      const result = await t.run({ client: real });
      expect(fetches).toBeGreaterThan(0);
      expect(result).toEqual({ done: 0, skipped: 0, total: 3, stopped: 'rpd' });
      expect(report().items).toEqual([]);
    } finally {
      if (savedKey === undefined) Reflect.deleteProperty(process.env, 'GEMINI_API_KEY');
      else process.env.GEMINI_API_KEY = savedKey;
    }
  });

  it('TC-AUD49-GEN-6: kuota free tier juga menghentikan run', async () => {
    const t = setup({
      entries: [FACT, INTRO, QUIZ],
      respond: (n) => {
        if (n === 1) throw new ApiError('gagal', 429, FREE_TIER);
        return audioResponse(n);
      },
    });
    const result = await t.run();
    expect(result.stopped).toBe('free_tier');
    expect(t.request).toHaveBeenCalledTimes(1);
    expect(existsSync(reportPath)).toBe(false);
  });

  it('TC-AUD49-GEN-6: setelah berhenti, run berikutnya melanjutkan tanpa mengulang yang sudah jadi', async () => {
    let exhausted = true;
    const t = setup({
      entries: [FACT, INTRO],
      respond: (n) => {
        if (n === 2 && exhausted) throw new ApiError('gagal', 429, PER_DAY);
        return audioResponse(n);
      },
    });
    expect((await t.run()).stopped).toBe('rpd');
    exhausted = false;
    const second = await t.run();
    expect(second).toEqual({ done: 1, skipped: 1, total: 2, stopped: null });
    expect(report().items.map((i) => i.id)).toEqual(['fact:JP', 'intro:FR']);
  });

  it('TC-AUD49-GEN-6: kuota per menit (rpm) dicatat lalu lanjut ke entri berikutnya', async () => {
    const t = setup({
      entries: [FACT, INTRO, QUIZ],
      respond: (n) => {
        if (n === 2) throw new ApiError('gagal', 429, PER_MINUTE);
        return audioResponse(n);
      },
    });
    const result = await t.run();
    expect(result).toEqual({ done: 2, skipped: 0, total: 3, stopped: null });
    expect(t.request).toHaveBeenCalledTimes(3);
    expect(report().items.map((i) => i.id)).toEqual(['fact:JP', 'praiseFlag:BR']);
    expect(logged(t.log).some((l) => l.includes('intro:FR'))).toBe(true);
  });

  it('TC-AUD49-GEN-6: status lain dan respons tanpa audio dicatat dengan id lalu lanjut', async () => {
    const t = setup({
      entries: [FACT, INTRO, QUIZ],
      respond: (n) => {
        if (n === 1) throw new ApiError('gagal', 500, 'oops');
        if (n === 2) return { candidates: [{ finishReason: 'SAFETY' }] };
        return audioResponse(n);
      },
    });
    const result = await t.run();
    expect(result).toEqual({ done: 1, skipped: 0, total: 3, stopped: null });
    expect(report().items.map((i) => i.id)).toEqual(['praiseFlag:BR']);
    const lines = logged(t.log);
    expect(lines.some((l) => l.includes('fact:JP'))).toBe(true);
    expect(lines.some((l) => l.includes('intro:FR'))).toBe(true);
  });
});

describe('runGenerate: dry-run dan konfigurasi', () => {
  it('TC-AUD49-GEN-7: dry-run tanpa request, tanpa berkas, tanpa assertConfigured, log lengkap', async () => {
    const t = setup({
      entries: [FACT, INTRO],
      dryRun: true,
      voice: { voice: 'ISI-SETELAH-SAMPEL', style: STYLE },
      approved: (id) => id === 'intro:FR',
    });
    const result = await t.run();
    expect(result.stopped).toBeNull();
    expect(t.request).not.toHaveBeenCalled();
    expect(t.assertConfigured).not.toHaveBeenCalled();
    expect(t.sleep).not.toHaveBeenCalled();
    expect(existsSync(rawDir)).toBe(false);
    expect(existsSync(reportPath)).toBe(false);
    expect(readdirSync(dir)).toEqual([]);

    const lines = logged(t.log);
    const line = lines.find((l) => l.includes('fact:JP'));
    expect(line).toBeDefined();
    expect(line).toContain(FACT.text);
    expect(line).toContain(rawFileName(FACT.id, FACT.textHash, 1));
    expect(line).toContain('ISI-SETELAH-SAMPEL');
    expect(lines.some((l) => l.includes('intro:FR'))).toBe(false);
  });

  it('TC-AUD49-GEN-7: dry-run menampilkan nomor take berikutnya setelah take ditolak', async () => {
    seedReport([pendingItem(FACT, 1, true)]);
    const t = setup({ entries: [FACT], dryRun: true });
    await t.run();
    expect(logged(t.log).some((l) => l.includes(rawFileName(FACT.id, FACT.textHash, 2)))).toBe(
      true,
    );
  });

  it('TC-AUD49-GEN-7: voice placeholder pada run sungguhan melempar sebelum request pertama', async () => {
    const t = setup({ entries: [FACT], voice: { voice: 'ISI-SETELAH-SAMPEL', style: STYLE } });
    await expect(t.run()).rejects.toThrow('ISI-SETELAH-');
    expect(t.request).not.toHaveBeenCalled();
    expect(existsSync(rawDir)).toBe(false);
  });

  it('TC-AUD49-GEN-7: model tts belum dikonfigurasi melempar sebelum request; assertConfigured("tts") lebih dulu', async () => {
    const bad = setup({ entries: [FACT], configError: new Error('ISI-SETELAH-T0 belum diisi') });
    await expect(bad.run()).rejects.toThrow('ISI-SETELAH-T0');
    expect(bad.request).not.toHaveBeenCalled();

    const ok = setup({ entries: [FACT] });
    await ok.run();
    expect(ok.assertConfigured).toHaveBeenCalledWith('tts');
    expect(ok.order[0]).toBe('assertConfigured');
    expect(ok.order.indexOf('assertConfigured')).toBeLessThan(ok.order.indexOf('request'));
  });
});

describe('runGenerate: seed', () => {
  const seedOf = (payload: unknown): unknown =>
    (payload as { generationConfig: Record<string, unknown> }).generationConfig.seed;

  it('TC-AUD49-GEN-8: models.seed false -> payload tanpa kunci seed', async () => {
    const t = setup({ entries: [FACT], seed: false });
    await t.run();
    const cfg = (t.calls[0]?.payload as { generationConfig: object }).generationConfig;
    expect(Object.keys(cfg)).not.toContain('seed');
  });

  it('TC-AUD49-GEN-8: models.seed true -> seed sama dengan nomor take', async () => {
    seedReport([pendingItem(FACT, 1, true)]);
    const t = setup({ entries: [FACT, CORE], seed: true, takes: 2 });
    await t.run();
    expect(t.calls.map((c) => [c.cacheTag, seedOf(c.payload)])).toEqual([
      ['take-2', 2],
      ['take-1', 1],
      ['take-2', 2],
    ]);
  });
});

describe('generate-cli: parseArgs dan exitCodeFor', () => {
  it('TC-AUD49-CLI-1: argumen valid, dengan default takes 1 dan dryRun false', () => {
    expect(parseArgs(['--locale', 'id', '--batch', '1'])).toEqual({
      locale: 'id',
      batch: 1,
      takes: 1,
      dryRun: false,
    });
    expect(parseArgs(['--locale', 'en'])).toEqual({ locale: 'en', takes: 1, dryRun: false });
  });

  it('TC-AUD49-CLI-1: semua opsi sekaligus', () => {
    expect(
      parseArgs([
        '--locale',
        'id',
        '--batch',
        '3',
        '--ids',
        'fact:JP,celebrate:25',
        '--takes',
        '2',
        '--limit',
        '5',
        '--dry-run',
      ]),
    ).toEqual({
      locale: 'id',
      batch: 3,
      ids: ['fact:JP', 'celebrate:25'],
      takes: 2,
      limit: 5,
      dryRun: true,
    });
  });

  it('TC-AUD49-CLI-1: argumen salah melempar pesan Indonesia yang menyebut argumennya', () => {
    expect(() => parseArgs([])).toThrow(/--locale/);
    expect(() => parseArgs(['--locale', 'fr'])).toThrow(/--locale/);
    expect(() => parseArgs(['--locale'])).toThrow(/--locale/);
    expect(() => parseArgs(['--locale', 'id', '--batch', '4'])).toThrow(/--batch/);
    expect(() => parseArgs(['--locale', 'id', '--batch', '0'])).toThrow(/--batch/);
    expect(() => parseArgs(['--locale', 'id', '--batch', 'x'])).toThrow(/--batch/);
    expect(() => parseArgs(['--locale', 'id', '--takes', '0'])).toThrow(/--takes/);
    expect(() => parseArgs(['--locale', 'id', '--takes', '1.5'])).toThrow(/--takes/);
    expect(() => parseArgs(['--locale', 'id', '--limit', '-1'])).toThrow(/--limit/);
    expect(() => parseArgs(['--locale', 'id', '--limit', 'abc'])).toThrow(/--limit/);
    expect(() => parseArgs(['--locale', 'id', '--ids'])).toThrow(/--ids/);
    expect(() => parseArgs(['--locale', 'id', '--foo'])).toThrow('Argumen tidak dikenal: --foo');
  });

  it('TC-AUD49-CLI-1: exitCodeFor = 2 bila run berhenti karena kuota, selain itu 0', () => {
    expect(exitCodeFor({ done: 3, skipped: 0, total: 10, stopped: 'rpd' })).toBe(2);
    expect(exitCodeFor({ done: 0, skipped: 0, total: 10, stopped: 'free_tier' })).toBe(2);
    expect(exitCodeFor({ done: 10, skipped: 0, total: 10, stopped: null })).toBe(0);
  });
});
