import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AudioManifestSchema, type AudioManifest } from '../../src/content/schema';
import { textHash } from './inventory';
import { loadReport, rawFileName, upsertItem, type PendingItem } from './report';
import { approveClip, rejectClip, ReviewError } from './review';

// Kontrak tambahan yang ditetapkan tes ini (issue #49, halaman tinjau audio):
// - approveClip({ manifestPath, reportPath, locale, id, file, currentHash, now }): AudioManifest, sinkron.
//   `reportPath` = laporan pending locale itu; `now: () => Date`; `currentHash` = textHash inventaris terkini.
//   Item laporan dengan `file` itu harus ada, id-nya cocok, `rejected === null`, `whisper !== null`, dan
//   `textHash === currentHash`; kalau tidak melempar ReviewError (pesan Indonesia; whisper null menyebut
//   "audio:check", hash beda menyebut "teks sudah berubah"). Manifest tidak berubah bila gagal.
// - Berhasil: entri (locale, id) lama diganti (satu entri per pasangan); attempt = lama + 1 atau 1;
//   reviewedAt = now().toISOString(); raw = item.file; model/voice/styleHash/take/generatedAt/durationMs/text/
//   textHash disalin dari item; whisper = { model, transcript, score, flag } dari item; manifest diurut
//   (locale, id), lolos AudioManifestSchema, ditulis atomik (tanpa sisa berkas temp); manifest yang belum
//   ada dimulai dari { version: 1, clips: [] }.
// - rejectClip({ manifestPath, reportPath, locale, id, file, note, now }): catatan (setelah trim) wajib
//   tidak kosong, kalau tidak ReviewError; mengisi item.rejected = { note, at: now().toISOString() };
//   bila `file` itu yang sedang disetujui untuk (locale, id), entri manifest dihapus; take lain tidak
//   menyentuh manifest. File tak dikenal -> ReviewError.

const HASH = 'abcdef0123456789'.repeat(4);
const NOW = new Date('2026-10-17T02:00:00.000Z');
const now = () => NOW;
const OLD_TEXT = 'Ini Jepang!';

let dir: string;
let manifestPath: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'audio-review-'));
  manifestPath = join(dir, 'data', 'audio-manifest.json');
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const reportPath = (locale: 'id' | 'en' = 'id') => join(dir, `report-${locale}.json`);

function makeItem(
  id: string,
  text: string,
  take: number,
  over: Partial<PendingItem> = {},
  locale: 'id' | 'en' = 'id',
): PendingItem {
  const hash = textHash(text);
  return {
    id,
    locale,
    text,
    textHash: hash,
    take,
    file: `${locale}/${rawFileName(id, hash, take)}`,
    model: 'gemini-tts-model',
    voice: 'Aoede',
    styleHash: HASH,
    generatedAt: '2026-10-17T01:00:00.000Z',
    durationMs: 1800,
    whisper: {
      model: 'medium',
      transcript: text.toLowerCase().replace(/[!?.,]/g, ''),
      language: locale,
      languageProbability: 0.99,
      score: 0.97,
      flag: 'ok',
    },
    rejected: null,
    ...over,
  };
}

function seed(items: PendingItem[], locale: 'id' | 'en' = 'id'): void {
  const path = reportPath(locale);
  let report = loadReport(path, locale);
  for (const item of items) report = upsertItem(path, report, item);
}

function readManifest(): AudioManifest {
  return AudioManifestSchema.parse(JSON.parse(readFileSync(manifestPath, 'utf8')));
}

function approve(item: PendingItem, over: Partial<Parameters<typeof approveClip>[0]> = {}) {
  return approveClip({
    manifestPath,
    reportPath: reportPath(item.locale),
    locale: item.locale,
    id: item.id,
    file: item.file,
    currentHash: item.textHash,
    now,
    ...over,
  });
}

describe('approveClip', () => {
  it('TC-AUD49-REV-1 persetujuan pertama: attempt 1, kolom disalin dari item laporan', () => {
    const item = makeItem('intro:JP', OLD_TEXT, 1);
    seed([item]);
    const result = approve(item);
    expect(result).toEqual(readManifest());
    expect(result.version).toBe(1);
    expect(result.clips).toEqual([
      {
        id: 'intro:JP',
        locale: 'id',
        text: OLD_TEXT,
        textHash: item.textHash,
        attempt: 1,
        raw: item.file,
        model: 'gemini-tts-model',
        voice: 'Aoede',
        styleHash: HASH,
        take: 1,
        generatedAt: '2026-10-17T01:00:00.000Z',
        durationMs: 1800,
        whisper: { model: 'medium', transcript: 'ini jepang', score: 0.97, flag: 'ok' },
        reviewedAt: '2026-10-17T02:00:00.000Z',
      },
    ]);
  });

  it('TC-AUD49-REV-1 menyetujui take lain untuk id sama: attempt 2, entri tunggal, raw berganti', () => {
    const take1 = makeItem('intro:JP', OLD_TEXT, 1);
    const take2 = makeItem('intro:JP', OLD_TEXT, 2, { durationMs: 2100 });
    seed([take1, take2]);
    approve(take1);
    const after = approve(take2);
    expect(after.clips).toHaveLength(1);
    expect(after.clips[0]).toMatchObject({
      attempt: 2,
      take: 2,
      raw: take2.file,
      durationMs: 2100,
    });
    expect(readManifest().clips).toHaveLength(1);
  });

  it('TC-AUD49-REV-1 id lain tidak ikut berubah saat satu id disetujui ulang', () => {
    const a = makeItem('intro:JP', OLD_TEXT, 1);
    const b = makeItem('intro:BR', 'Ini Brasil!', 1);
    const a2 = makeItem('intro:JP', OLD_TEXT, 2);
    seed([a, b, a2]);
    approve(a);
    approve(b);
    const after = approve(a2);
    const clipB = after.clips.find((c) => c.id === 'intro:BR');
    expect(clipB).toMatchObject({ attempt: 1, raw: b.file });
    expect(after.clips.find((c) => c.id === 'intro:JP')).toMatchObject({ attempt: 2 });
  });
});

describe('approveClip: penolakan', () => {
  it('TC-AUD49-REV-2 whisper null: ReviewError menyebut audio:check, manifest tidak tertulis', () => {
    const item = makeItem('intro:JP', OLD_TEXT, 1, { whisper: null });
    seed([item]);
    expect(() => approve(item)).toThrow(ReviewError);
    expect(() => approve(item)).toThrow(/audio:check/);
    expect(existsSync(manifestPath)).toBe(false);
  });

  it('TC-AUD49-REV-2 hash basi: ReviewError menyebut teks sudah berubah', () => {
    const item = makeItem('intro:JP', OLD_TEXT, 1);
    seed([item]);
    const currentHash = textHash('Ini negara Jepang!');
    expect(() => approve(item, { currentHash })).toThrow(ReviewError);
    expect(() => approve(item, { currentHash })).toThrow(/teks sudah berubah/);
    expect(existsSync(manifestPath)).toBe(false);
  });

  it('TC-AUD49-REV-2 item yang sudah ditolak: ReviewError', () => {
    const item = makeItem('intro:JP', OLD_TEXT, 1, {
      rejected: { note: 'suara sumbang', at: '2026-10-17T01:30:00.000Z' },
    });
    seed([item]);
    expect(() => approve(item)).toThrow(ReviewError);
    expect(existsSync(manifestPath)).toBe(false);
  });

  it('TC-AUD49-REV-10 flag kosong: ReviewError menyebut "kosong", manifest tidak tertulis', () => {
    const item = makeItem('intro:JP', OLD_TEXT, 1, {
      whisper: {
        model: 'medium',
        transcript: '',
        language: 'id',
        languageProbability: 0.2,
        score: 0,
        flag: 'kosong',
      },
    });
    seed([item]);
    expect(() => approve(item)).toThrow(ReviewError);
    expect(() => approve(item)).toThrow(/kosong/);
    expect(existsSync(manifestPath)).toBe(false);
  });

  it('TC-AUD49-REV-10 kontrol positif: flag periksa tetap bisa disetujui pemilik', () => {
    const item = makeItem('intro:JP', OLD_TEXT, 1, {
      whisper: {
        model: 'medium',
        transcript: 'ini jepang',
        language: 'id',
        languageProbability: 0.9,
        score: 0.8,
        flag: 'periksa',
      },
    });
    seed([item]);
    expect(approve(item).clips.map((c) => c.id)).toEqual(['intro:JP']);
  });

  it('TC-AUD49-REV-2 file tidak ada di laporan: ReviewError', () => {
    const item = makeItem('intro:JP', OLD_TEXT, 1);
    seed([item]);
    const ghost = makeItem('intro:JP', OLD_TEXT, 7);
    expect(() => approve(item, { file: ghost.file })).toThrow(ReviewError);
    expect(existsSync(manifestPath)).toBe(false);
  });

  it('TC-AUD49-REV-2 file milik id lain: ReviewError', () => {
    const jp = makeItem('intro:JP', OLD_TEXT, 1);
    const br = makeItem('intro:BR', 'Ini Brasil!', 1);
    seed([jp, br]);
    expect(() => approve(jp, { id: 'intro:BR' })).toThrow(ReviewError);
    expect(existsSync(manifestPath)).toBe(false);
  });

  it('TC-AUD49-REV-2 kegagalan tidak mengubah manifest yang sudah ada', () => {
    const good = makeItem('intro:JP', OLD_TEXT, 1);
    const bad = makeItem('intro:BR', 'Ini Brasil!', 1, { whisper: null });
    seed([good, bad]);
    approve(good);
    const before = readFileSync(manifestPath, 'utf8');
    expect(() => approve(bad)).toThrow(ReviewError);
    expect(readFileSync(manifestPath, 'utf8')).toBe(before);
  });

  it('TC-AUD49-REV-2 kontrol positif: item sehat dengan hash terkini disetujui', () => {
    const item = makeItem('intro:JP', OLD_TEXT, 1);
    seed([item]);
    expect(() => approve(item)).not.toThrow();
    expect(existsSync(manifestPath)).toBe(true);
  });
});

describe('approveClip: berkas manifest', () => {
  it('TC-AUD49-REV-5 ditulis atomik, lolos skema, tanpa berkas temp tersisa', () => {
    const item = makeItem('intro:JP', OLD_TEXT, 1);
    seed([item]);
    approve(item);
    expect(readdirSync(dirname(manifestPath))).toEqual(['audio-manifest.json']);
    expect(
      AudioManifestSchema.safeParse(JSON.parse(readFileSync(manifestPath, 'utf8'))).success,
    ).toBe(true);
  });

  it('TC-AUD49-REV-5 diurut (locale, id) apa pun urutan persetujuan', () => {
    const idJp = makeItem('intro:JP', OLD_TEXT, 1);
    const idCel = makeItem('celebrate:25', 'Hore, dua puluh lima!', 1);
    const enJp = makeItem('intro:JP', 'This is Japan!', 1, {}, 'en');
    seed([idJp, idCel]);
    seed([enJp], 'en');
    approve(idJp);
    approve(enJp);
    approve(idCel);
    expect(readManifest().clips.map((c) => `${c.locale}/${c.id}`)).toEqual([
      'en/intro:JP',
      'id/celebrate:25',
      'id/intro:JP',
    ]);
  });
});

describe('rejectClip', () => {
  const reject = (item: PendingItem, note: string, over: Record<string, unknown> = {}) =>
    rejectClip({
      manifestPath,
      reportPath: reportPath(item.locale),
      locale: item.locale,
      id: item.id,
      file: item.file,
      note,
      now,
      ...over,
    });

  it('TC-AUD49-REV-6 catatan kosong atau spasi saja: ReviewError dan laporan tidak berubah', () => {
    const item = makeItem('intro:JP', OLD_TEXT, 1);
    seed([item]);
    const before = readFileSync(reportPath(), 'utf8');
    expect(() => reject(item, '')).toThrow(ReviewError);
    expect(() => reject(item, '   ')).toThrow(ReviewError);
    expect(readFileSync(reportPath(), 'utf8')).toBe(before);
  });

  it('TC-AUD49-REV-6 mencatat penolakan di laporan dengan waktu', () => {
    const item = makeItem('intro:JP', OLD_TEXT, 1);
    const other = makeItem('intro:JP', OLD_TEXT, 2);
    seed([item, other]);
    reject(item, 'suara terpotong');
    const items = loadReport(reportPath(), 'id').items;
    expect(items.find((i) => i.file === item.file)?.rejected).toEqual({
      note: 'suara terpotong',
      at: '2026-10-17T02:00:00.000Z',
    });
    expect(items.find((i) => i.file === other.file)?.rejected).toBeNull();
  });

  it('TC-AUD49-REV-6 menolak take yang sedang disetujui menghapus entri manifest', () => {
    const jp = makeItem('intro:JP', OLD_TEXT, 1);
    const br = makeItem('intro:BR', 'Ini Brasil!', 1);
    seed([jp, br]);
    approve(jp);
    approve(br);
    reject(jp, 'ada desis');
    expect(readManifest().clips.map((c) => c.id)).toEqual(['intro:BR']);
  });

  it('TC-AUD49-REV-6 menolak take lain tidak menyentuh entri manifest', () => {
    const take1 = makeItem('intro:JP', OLD_TEXT, 1);
    const take2 = makeItem('intro:JP', OLD_TEXT, 2);
    seed([take1, take2]);
    approve(take1);
    const before = readFileSync(manifestPath, 'utf8');
    reject(take2, 'terlalu cepat');
    expect(readFileSync(manifestPath, 'utf8')).toBe(before);
  });

  it('TC-AUD49-REV-6 file tidak dikenal: ReviewError', () => {
    const item = makeItem('intro:JP', OLD_TEXT, 1);
    seed([item]);
    const ghost = makeItem('intro:JP', OLD_TEXT, 9);
    expect(() => reject(item, 'x', { file: ghost.file })).toThrow(ReviewError);
  });

  it('TC-AUD49-REV-6 item yang ditolak tidak bisa disetujui lagi', () => {
    const item = makeItem('intro:JP', OLD_TEXT, 1);
    seed([item]);
    reject(item, 'sumbang');
    expect(() => approve(item)).toThrow(ReviewError);
  });
});
