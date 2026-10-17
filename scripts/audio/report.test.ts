import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeFileAtomic } from './atomic';
import {
  loadReport,
  PendingReportSchema,
  rawFileName,
  upsertItem,
  type PendingItem,
} from './report';

// Kontrak tambahan yang ditetapkan tes ini:
// - PendingReportSchema = { version: 1, locale: 'id'|'en', items: PendingItem[] }.
//   PendingItem = { id, locale, text, textHash (sha256 heksa 64), take: bilangan bulat >= 1,
//   file: '<loc>/<safeId>-<hash8>-<take>.wav', model, voice, styleHash, generatedAt: ISO,
//   durationMs: bilangan bulat > 0,
//   whisper: null | { model, transcript, language, languageProbability, score, flag },
//   rejected: null | { note, at } }.
// - rawFileName(id, textHash, take) = `<safeId>-<hash8>-<take>.wav` (tanpa awalan locale); safeId = id dengan
//   ':' diganti '_'; hash8 = 8 karakter heksa pertama textHash. Item.file = `${locale}/${rawFileName(...)}`.
// - loadReport(path, locale): berkas tidak ada -> { version: 1, locale, items: [] }; JSON rusak, tidak sesuai
//   skema, atau locale berkas berbeda dari yang diminta -> melempar.
// - upsertItem(path, report, item) sinkron: mengganti item dengan `file` sama (atau menambah), memvalidasi
//   hasilnya dengan skema (item tidak valid melempar dan berkas tidak ditulis), menulis atomik (mkdir -p,
//   temp di folder yang sama lalu rename, tanpa sisa temp), mengembalikan laporan BARU tanpa mengubah masukan.
// - writeFileAtomic(path, data: string | Uint8Array) sinkron: mkdir -p, temp di folder yang sama + rename.

const HASH = 'abcdef0123456789'.repeat(4);
const item = (over: Partial<PendingItem> = {}): PendingItem => ({
  id: 'fact:JP',
  locale: 'id',
  text: 'Jepang punya gunung Fuji.',
  textHash: HASH,
  take: 1,
  file: 'id/fact_JP-abcdef01-1.wav',
  model: 'gemini-tts-test',
  voice: 'Aoede',
  styleHash: '0'.repeat(64),
  generatedAt: '2026-10-17T10:00:00.000Z',
  durationMs: 1500,
  whisper: null,
  rejected: null,
  ...over,
});

let dir: string;
let path: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'audio-report-'));
  path = join(dir, 'nested', 'report-id.json');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('rawFileName', () => {
  it('TC-AUD49-REP-3: titik dua jadi garis bawah dan hash dipotong 8 heksa', () => {
    expect(rawFileName('fact:JP', HASH, 1)).toBe('fact_JP-abcdef01-1.wav');
    expect(rawFileName('praiseFlag:BR', HASH, 12)).toBe('praiseFlag_BR-abcdef01-12.wav');
    expect(rawFileName('introHome', HASH, 2)).toBe('introHome-abcdef01-2.wav');
  });
});

describe('loadReport', () => {
  it('TC-AUD49-REP-1: berkas tidak ada memberi laporan kosong untuk locale itu', () => {
    expect(loadReport(path, 'id')).toEqual({ version: 1, locale: 'id', items: [] });
    expect(loadReport(path, 'en')).toEqual({ version: 1, locale: 'en', items: [] });
    expect(existsSync(path)).toBe(false);
  });

  it('TC-AUD49-REP-1: berkas rusak, tidak sesuai skema, atau locale beda melempar', () => {
    writeFileAtomic(path, '{ rusak');
    expect(() => loadReport(path, 'id')).toThrow();
    writeFileAtomic(path, JSON.stringify({ version: 2, locale: 'id', items: [] }));
    expect(() => loadReport(path, 'id')).toThrow();
    writeFileAtomic(path, JSON.stringify({ version: 1, locale: 'id', items: [{ id: 'x' }] }));
    expect(() => loadReport(path, 'id')).toThrow();
    writeFileAtomic(path, JSON.stringify({ version: 1, locale: 'en', items: [] }));
    expect(() => loadReport(path, 'id')).toThrow();
  });

  it('TC-AUD49-REP-1: laporan yang valid terbaca utuh, termasuk hasil whisper dan penolakan', () => {
    const full = item({
      whisper: {
        model: 'medium',
        transcript: 'jepang punya gunung fuji',
        language: 'id',
        languageProbability: 0.98,
        score: 0.97,
        flag: 'ok',
      },
      rejected: { note: 'terpotong', at: '2026-10-17T11:00:00.000Z' },
    });
    writeFileAtomic(path, JSON.stringify({ version: 1, locale: 'id', items: [full] }));
    expect(loadReport(path, 'id').items).toEqual([full]);
  });
});

describe('PendingReportSchema', () => {
  const parse = (i: unknown) =>
    PendingReportSchema.safeParse({ version: 1, locale: 'id', items: [i] });

  it('TC-AUD49-REP-1: menolak take 0, durasi 0, nama berkas salah, dan flag di luar enum', () => {
    expect(parse(item()).success).toBe(true);
    expect(parse(item({ take: 0 })).success).toBe(false);
    expect(parse(item({ durationMs: 0 })).success).toBe(false);
    expect(parse(item({ file: 'id/fact:JP-1.wav' })).success).toBe(false);
    expect(parse(item({ file: '../x/fact_JP-abcdef01-1.wav' })).success).toBe(false);
    expect(parse(item({ generatedAt: 'kemarin' })).success).toBe(false);
    const bad = item({
      whisper: {
        model: 'm',
        transcript: 't',
        language: 'id',
        languageProbability: 1,
        score: 1,
        flag: 'aneh' as 'ok',
      },
    });
    expect(parse(bad).success).toBe(false);
  });
});

describe('upsertItem', () => {
  it('TC-AUD49-REP-2: menulis laporan, membuat folder induk, tanpa sisa berkas sementara', () => {
    const empty = loadReport(path, 'id');
    const next = upsertItem(path, empty, item());
    expect(next).toEqual({ version: 1, locale: 'id', items: [item()] });
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(next);
    expect(readdirSync(join(dir, 'nested'))).toEqual(['report-id.json']);
  });

  it('TC-AUD49-REP-2: tidak mengubah laporan masukan', () => {
    const empty = loadReport(path, 'id');
    upsertItem(path, empty, item());
    expect(empty.items).toEqual([]);
  });

  it('TC-AUD49-REP-2: item dengan file sama diganti, file berbeda ditambah, urutan terjaga', () => {
    const first = upsertItem(path, loadReport(path, 'id'), item());
    const second = upsertItem(path, first, item({ take: 2, file: 'id/fact_JP-abcdef01-2.wav' }));
    expect(second.items.map((i) => i.take)).toEqual([1, 2]);
    const rejected = item({ rejected: { note: 'sumbang', at: '2026-10-17T12:00:00.000Z' } });
    const third = upsertItem(path, second, rejected);
    expect(third.items).toHaveLength(2);
    expect(third.items[0]?.rejected).toEqual({ note: 'sumbang', at: '2026-10-17T12:00:00.000Z' });
    expect(third.items[1]?.take).toBe(2);
    expect(loadReport(path, 'id')).toEqual(third);
    expect(readdirSync(join(dir, 'nested'))).toEqual(['report-id.json']);
  });

  it('TC-AUD49-REP-2: item tidak valid melempar dan berkas lama tetap utuh', () => {
    const first = upsertItem(path, loadReport(path, 'id'), item());
    const before = readFileSync(path, 'utf8');
    expect(() =>
      upsertItem(path, first, item({ take: 0, file: 'id/fact_JP-abcdef01-0.wav' })),
    ).toThrow();
    expect(readFileSync(path, 'utf8')).toBe(before);
    expect(readdirSync(join(dir, 'nested'))).toEqual(['report-id.json']);
  });
});

describe('upsertItem: penggabungan dengan berkas di disk', () => {
  const REJECTED = { note: 'sumbang', at: '2026-10-17T12:00:00.000Z' };
  const WHISPER = {
    model: 'medium',
    transcript: 'jepang punya gunung fuji',
    language: 'id',
    languageProbability: 0.98,
    score: 0.97,
    flag: 'ok' as const,
  };
  const X = (over: Partial<PendingItem> = {}) => item(over);
  const Y = (over: Partial<PendingItem> = {}) =>
    item({ id: 'fact:BR', file: 'id/fact_BR-abcdef01-1.wav', ...over });
  const Z = (over: Partial<PendingItem> = {}) =>
    item({ id: 'fact:AR', file: 'id/fact_AR-abcdef01-1.wav', ...over });

  it('TC-AUD49-REP-4: penolakan proses lain pada X tidak tertimpa saat A meng-upsert Y', () => {
    upsertItem(path, loadReport(path, 'id'), X());
    const memoryA = loadReport(path, 'id'); // proses A memuat laporan: X belum ditolak
    // proses B menolak X langsung di disk
    upsertItem(path, loadReport(path, 'id'), X({ rejected: REJECTED }));

    const merged = upsertItem(path, memoryA, Y());

    const onDisk = loadReport(path, 'id');
    expect(onDisk.items.find((i) => i.file === X().file)?.rejected).toEqual(REJECTED);
    expect(onDisk.items.map((i) => i.file).sort()).toEqual([X().file, Y().file].sort());
    expect(merged).toEqual(onDisk);
  });

  it('TC-AUD49-REP-5: X dari A dengan rejected null: rejected disk dipertahankan, whisper baru tersimpan', () => {
    upsertItem(path, loadReport(path, 'id'), X());
    const memoryA = loadReport(path, 'id');
    upsertItem(path, loadReport(path, 'id'), X({ rejected: REJECTED }));

    const merged = upsertItem(path, memoryA, X({ whisper: WHISPER }));

    const saved = loadReport(path, 'id').items.find((i) => i.file === X().file);
    expect(saved?.rejected).toEqual(REJECTED);
    expect(saved?.whisper).toEqual(WHISPER);
    expect(merged.items.find((i) => i.file === X().file)).toEqual(saved);
  });

  it('TC-AUD49-REP-5: whisper disk dipertahankan bila item masuk whisper null; nilai non-null masuk menang', () => {
    upsertItem(path, loadReport(path, 'id'), X({ whisper: WHISPER }));
    const memoryA = loadReport(path, 'id');
    // A memegang salinan lama tanpa whisper dan menolak X sendiri
    const stale = { ...memoryA, items: [X()] };
    upsertItem(path, stale, X({ rejected: REJECTED }));
    const saved = loadReport(path, 'id').items[0];
    expect(saved?.whisper).toEqual(WHISPER);
    expect(saved?.rejected).toEqual(REJECTED);

    // nilai non-null masuk menggantikan nilai disk
    const newer = { ...WHISPER, transcript: 'ulang', score: 0.5, flag: 'periksa' as const };
    upsertItem(path, loadReport(path, 'id'), X({ whisper: newer, rejected: REJECTED }));
    expect(loadReport(path, 'id').items[0]?.whisper).toEqual(newer);
  });

  it('TC-AUD49-REP-6: item yang ditambah proses lain tidak hilang saat A menulis', () => {
    upsertItem(path, loadReport(path, 'id'), X());
    const memoryA = loadReport(path, 'id'); // hanya X
    upsertItem(path, loadReport(path, 'id'), Z()); // B menambah Z

    const merged = upsertItem(path, memoryA, Y());

    const files = loadReport(path, 'id').items.map((i) => i.file);
    expect(files).toEqual([X().file, Z().file, Y().file]);
    expect(merged.items.map((i) => i.file)).toEqual(files);
  });

  it('TC-AUD49-REP-6: kontrol positif tanpa proses lain, item dengan file sama tetap digantikan', () => {
    upsertItem(path, loadReport(path, 'id'), X());
    const next = upsertItem(path, loadReport(path, 'id'), X({ durationMs: 2500 }));
    expect(next.items).toHaveLength(1);
    expect(next.items[0]?.durationMs).toBe(2500);
  });
});

describe('writeFileAtomic', () => {
  it('TC-AUD49-REP-2: membuat folder, menimpa isi lama, menerima string dan byte, tanpa sisa temp', () => {
    const target = join(dir, 'a', 'b', 'file.bin');
    writeFileAtomic(target, 'halo');
    expect(readFileSync(target, 'utf8')).toBe('halo');
    writeFileAtomic(target, Uint8Array.from([1, 2, 3]));
    expect(Array.from(readFileSync(target))).toEqual([1, 2, 3]);
    expect(readdirSync(join(dir, 'a', 'b'))).toEqual(['file.bin']);
  });
});
