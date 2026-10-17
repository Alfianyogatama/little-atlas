import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadReport, rawFileName, upsertItem, type PendingItem } from './report';
import { rejectClip } from './review';
import {
  createPythonRunner,
  runCheck,
  TranscribeResponseSchema,
  type SpawnFn,
  type TranscribeRequest,
  type TranscribeResponse,
  type WhisperRunner,
} from './whisper';

// Kontrak tambahan yang ditetapkan tes ini (#49, ADR-010):
// - TranscribeRequest = { items: { key, path, language: 'id'|'en' }[] }.
//   TranscribeResponse (Zod: TranscribeResponseSchema) = { version: 1, model, items: ({ key, transcript,
//   language, languageProbability, durationSec } | { key, error })[] }.
// - WhisperRunner = (req) => Promise<TranscribeResponse>.
//   SpawnFn = (cmd, args, stdin) => Promise<{ code, stdout, stderr }>.
// - createPythonRunner({ python, script, model, modelDir, spawn, exists }): exists(python) false -> melempar
//   Error berisi perintah setup venv (`python3 -m venv .tmp/audio/venv` dan
//   `pip install -r scripts/audio/whisper/requirements.txt`) tanpa memanggil spawn. Selain itu spawn(python,
//   [script, '--model', model, '--model-dir', modelDir], stdinJson). Exit != 0 -> melempar dengan potongan stderr;
//   stdout bukan JSON valid atau gagal skema -> melempar; respons valid dikembalikan.
// - runCheck({ reportPath, locale, rawDir, runner, all?, log }): memilih item rejected === null dan
//   (whisper === null atau all). Tanpa item terpilih runner tidak dipanggil. Satu panggilan runner untuk semua
//   item terpilih (key = item.file, path = join(rawDir, item.file), language = locale). Tiap hasil dinilai dengan
//   scoreTranscript(item.text, transcript, locale, { language, languageProbability, durationSec }) lalu
//   di-upsert ke laporan sebagai whisper = { model: resp.model, transcript, language, languageProbability,
//   score, flag }. Hasil { error } -> log(...), whisper tetap null, errors bertambah. Key tak dikenal di respons
//   diabaikan dengan log. Mengembalikan { checked, errors, flags: Record<flag, number> } (checked = jumlah
//   item yang whisper-nya terisi pada pemanggilan ini).

const HEX = '0123456789abcdef';
/** Hash palsu 64 heksa yang berbeda per id (tes tidak memeriksa kecocokan dengan sha256 teks). */
const fakeHash = (id: string): string => {
  const sum = Array.from(id).reduce((n, ch) => n + ch.charCodeAt(0), 0);
  return (HEX[sum % 16] ?? 'a').repeat(8) + HEX[(sum * 7) % 16]?.repeat(56);
};

const mkItem = (id: string, text: string, over: Partial<PendingItem> = {}): PendingItem => {
  const textHash = fakeHash(id);
  const take = over.take ?? 1;
  return {
    id,
    locale: 'id',
    text,
    textHash,
    take,
    file: `id/${rawFileName(id, textHash, take)}`,
    model: 'gemini-tts-test',
    voice: 'Aoede',
    styleHash: '0'.repeat(64),
    generatedAt: '2026-10-17T10:00:00.000Z',
    durationMs: 1500,
    whisper: null,
    rejected: null,
    ...over,
  };
};

const TEXT_A = 'Jepang punya gunung Fuji.';
const TEXT_B = 'Kucing suka tidur siang.';
const TEXT_C = 'Burung terbang tinggi sekali.';
const TEXT_D = 'Ikan berenang di laut biru.';

const WHISPER_DONE = {
  model: 'medium',
  transcript: 'sudah ada',
  language: 'id',
  languageProbability: 0.99,
  score: 1,
  flag: 'ok' as const,
};

let dir: string;
let reportPath: string;
let rawDir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'whisper-test-'));
  reportPath = join(dir, 'pending-id.json');
  rawDir = join(dir, 'raw');
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function seed(items: PendingItem[]): void {
  let report = loadReport(reportPath, 'id');
  for (const it of items) report = upsertItem(reportPath, report, it);
}

const okResult = (key: string, transcript: string) => ({
  key,
  transcript,
  language: 'id',
  languageProbability: 0.98,
  durationSec: 1.5,
});

function fakeRunner(
  answer: (req: TranscribeRequest) => TranscribeResponse['items'],
  model = 'medium',
): { runner: WhisperRunner; calls: TranscribeRequest[] } {
  const calls: TranscribeRequest[] = [];
  const runner: WhisperRunner = async (req) => {
    calls.push(req);
    return { version: 1, model, items: answer(req) };
  };
  return { runner, calls };
}

describe('runCheck', () => {
  it('TC-AUD49-WSP-1: mengisi whisper dengan skor dan flag, hanya untuk item yang perlu', async () => {
    const a = mkItem('fact:JP', TEXT_A);
    const b = mkItem('fact:CAT', TEXT_B, { whisper: WHISPER_DONE });
    const c = mkItem('fact:BIRD', TEXT_C, {
      rejected: { note: 'suara pecah', at: '2026-10-17T11:00:00.000Z' },
    });
    seed([a, b, c]);

    const { runner, calls } = fakeRunner((req) => req.items.map((i) => okResult(i.key, TEXT_A)));
    const log = vi.fn();
    const result = await runCheck({ reportPath, locale: 'id', rawDir, runner, log });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      items: [{ key: a.file, path: join(rawDir, a.file), language: 'id' }],
    });
    expect(result.checked).toBe(1);
    expect(result.errors).toBe(0);
    expect(result.flags['ok']).toBe(1);

    const saved = loadReport(reportPath, 'id');
    const savedA = saved.items.find((i) => i.file === a.file);
    expect(savedA?.whisper).toEqual({
      model: 'medium',
      transcript: TEXT_A,
      language: 'id',
      languageProbability: 0.98,
      score: 1,
      flag: 'ok',
    });
    // item lain tidak berubah
    expect(saved.items.find((i) => i.file === b.file)).toEqual(b);
    expect(saved.items.find((i) => i.file === c.file)).toEqual(c);
    expect(saved.items).toHaveLength(3);
  });

  it('TC-AUD49-WSP-1: `all` mengirim ulang item yang sudah punya whisper, tetap melewati yang ditolak', async () => {
    const a = mkItem('fact:JP', TEXT_A);
    const b = mkItem('fact:CAT', TEXT_B, { whisper: WHISPER_DONE });
    const c = mkItem('fact:BIRD', TEXT_C, {
      rejected: { note: 'suara pecah', at: '2026-10-17T11:00:00.000Z' },
    });
    seed([a, b, c]);

    const { runner, calls } = fakeRunner((req) =>
      req.items.map((i) => okResult(i.key, i.key === a.file ? TEXT_A : TEXT_B)),
    );
    const result = await runCheck({
      reportPath,
      locale: 'id',
      rawDir,
      runner,
      all: true,
      log: vi.fn(),
    });

    expect(calls).toHaveLength(1);
    const sent = calls[0]?.items.map((i) => i.key).sort();
    expect(sent).toEqual([a.file, b.file].sort());
    expect(result.checked).toBe(2);

    const saved = loadReport(reportPath, 'id');
    const savedB = saved.items.find((i) => i.file === b.file);
    expect(savedB?.whisper?.transcript).toBe(TEXT_B);
    expect(savedB?.whisper?.flag).toBe('ok');
    expect(saved.items.find((i) => i.file === c.file)?.whisper).toBeNull();
  });

  it('TC-AUD49-WSP-1: tanpa item yang perlu dicek, runner tidak dipanggil dan laporan tidak berubah', async () => {
    const b = mkItem('fact:CAT', TEXT_B, { whisper: WHISPER_DONE });
    const c = mkItem('fact:BIRD', TEXT_C, {
      rejected: { note: 'suara pecah', at: '2026-10-17T11:00:00.000Z' },
    });
    seed([b, c]);
    const before = readFileSync(reportPath, 'utf8');

    const { runner, calls } = fakeRunner(() => []);
    const result = await runCheck({ reportPath, locale: 'id', rawDir, runner, log: vi.fn() });

    expect(calls).toHaveLength(0);
    expect(result.checked).toBe(0);
    expect(result.errors).toBe(0);
    expect(readFileSync(reportPath, 'utf8')).toBe(before);
  });

  it('TC-AUD49-WSP-1: laporan kosong atau tidak ada tidak memanggil runner', async () => {
    const { runner, calls } = fakeRunner(() => []);
    const result = await runCheck({ reportPath, locale: 'id', rawDir, runner, log: vi.fn() });
    expect(calls).toHaveLength(0);
    expect(result.checked).toBe(0);
  });

  it('TC-AUD49-WSP-2: hasil error membuat whisper tetap null dan menambah errors; key asing diabaikan', async () => {
    const a = mkItem('fact:JP', TEXT_A);
    const b = mkItem('fact:CAT', TEXT_B);
    seed([a, b]);

    const { runner } = fakeRunner((req) => [
      { key: req.items[0]?.key ?? '', error: 'berkas rusak' },
      okResult(req.items[1]?.key ?? '', TEXT_B),
      okResult('id/tidak_dikenal-00000000-1.wav', 'apa saja'),
    ]);
    const log = vi.fn();
    const result = await runCheck({ reportPath, locale: 'id', rawDir, runner, log });

    expect(result.errors).toBe(1);
    expect(result.checked).toBe(1);
    expect(log).toHaveBeenCalled();
    const logged = log.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toContain('berkas rusak');
    expect(logged).toContain('tidak_dikenal');

    const saved = loadReport(reportPath, 'id');
    expect(saved.items).toHaveLength(2);
    expect(saved.items.find((i) => i.file === a.file)?.whisper).toBeNull();
    expect(saved.items.find((i) => i.file === b.file)?.whisper?.flag).toBe('ok');
  });

  it('TC-AUD49-WSP-5: flags menghitung campuran hasil ok, beda, dan kosong', async () => {
    const a = mkItem('fact:JP', TEXT_A);
    const b = mkItem('fact:CAT', TEXT_B);
    const c = mkItem('fact:BIRD', TEXT_C);
    const d = mkItem('fact:FISH', TEXT_D);
    seed([a, b, c, d]);

    const answers: Record<string, string> = {
      [a.file]: TEXT_A,
      [b.file]: 'xyz qwv zzz',
      [c.file]: '',
      [d.file]: TEXT_D,
    };
    const { runner } = fakeRunner((req) =>
      req.items.map((i) => okResult(i.key, answers[i.key] ?? '')),
    );
    const result = await runCheck({ reportPath, locale: 'id', rawDir, runner, log: vi.fn() });

    expect(result.checked).toBe(4);
    expect(result.errors).toBe(0);
    expect(result.flags['ok']).toBe(2);
    expect(result.flags['beda']).toBe(1);
    expect(result.flags['kosong']).toBe(1);

    const saved = loadReport(reportPath, 'id');
    expect(saved.items.find((i) => i.file === b.file)?.whisper?.flag).toBe('beda');
    expect(saved.items.find((i) => i.file === c.file)?.whisper).toMatchObject({
      flag: 'kosong',
      score: 0,
    });
  });
});

describe('runCheck: berjalan bersamaan dengan tinjauan', () => {
  it('TC-AUD49-WSP-6: item yang ditolak saat runner berjalan tetap ditolak dan tetap memuat whisper', async () => {
    const a = mkItem('fact:JP', TEXT_A);
    const b = mkItem('fact:CAT', TEXT_B);
    seed([a, b]);

    const runner: WhisperRunner = async (req) => {
      // pemilik menolak take a lewat halaman tinjau selagi whisper berjalan
      rejectClip({
        manifestPath: join(dir, 'audio-manifest.json'),
        reportPath,
        locale: 'id',
        id: a.id,
        file: a.file,
        note: 'terpotong',
        now: () => new Date('2026-10-17T11:00:00.000Z'),
      });
      return { version: 1, model: 'medium', items: req.items.map((i) => okResult(i.key, TEXT_A)) };
    };
    const result = await runCheck({ reportPath, locale: 'id', rawDir, runner, log: vi.fn() });

    expect(result.checked).toBe(2);
    const saved = loadReport(reportPath, 'id');
    const savedA = saved.items.find((i) => i.file === a.file);
    expect(savedA?.rejected).toEqual({ note: 'terpotong', at: '2026-10-17T11:00:00.000Z' });
    expect(savedA?.whisper).toMatchObject({ model: 'medium', transcript: TEXT_A });
    const savedB = saved.items.find((i) => i.file === b.file);
    expect(savedB?.rejected).toBeNull();
    expect(savedB?.whisper).not.toBeNull();
  });
});

describe('createPythonRunner', () => {
  const REQ: TranscribeRequest = {
    items: [
      { key: 'id/fact_JP-abcdef01-1.wav', path: '/raw/id/fact_JP-abcdef01-1.wav', language: 'id' },
    ],
  };
  const opts = {
    python: '.tmp/audio/venv/bin/python',
    script: 'scripts/audio/whisper/transcribe.py',
    model: 'medium',
    modelDir: '.tmp/audio/whisper-model',
  };
  const VALID: TranscribeResponse = {
    version: 1,
    model: 'medium',
    items: [okResult('id/fact_JP-abcdef01-1.wav', TEXT_A)],
  };

  it('TC-AUD49-WSP-3: memanggil python dengan argumen dan stdin persis, lalu memparse respons valid', async () => {
    const spawn = vi.fn<SpawnFn>(async () => ({
      code: 0,
      stdout: JSON.stringify(VALID),
      stderr: 'log pemuatan model',
    }));
    const runner = createPythonRunner({ ...opts, spawn, exists: () => true });
    const resp = await runner(REQ);

    expect(spawn).toHaveBeenCalledTimes(1);
    const [cmd, args, stdin] = spawn.mock.calls[0] ?? [];
    expect(cmd).toBe(opts.python);
    expect(args).toEqual([opts.script, '--model', 'medium', '--model-dir', opts.modelDir]);
    expect(JSON.parse(stdin ?? 'null')).toEqual(REQ);
    expect(resp).toEqual(VALID);
    expect(TranscribeResponseSchema.safeParse(resp).success).toBe(true);
  });

  it('TC-AUD49-WSP-3: exit bukan 0 melempar dengan potongan stderr', async () => {
    const spawn = vi.fn<SpawnFn>(async () => ({
      code: 1,
      stdout: '',
      stderr: 'Traceback: ModuleNotFoundError: faster_whisper',
    }));
    const runner = createPythonRunner({ ...opts, spawn, exists: () => true });
    await expect(runner(REQ)).rejects.toThrow(/ModuleNotFoundError: faster_whisper/);
  });

  it('TC-AUD49-WSP-3: stdout bukan JSON melempar', async () => {
    const spawn = vi.fn<SpawnFn>(async () => ({ code: 0, stdout: 'bukan json {', stderr: '' }));
    const runner = createPythonRunner({ ...opts, spawn, exists: () => true });
    await expect(runner(REQ)).rejects.toThrow();
  });

  it('TC-AUD49-WSP-3: JSON yang melanggar skema melempar', async () => {
    const spawn = vi.fn<SpawnFn>(async () => ({
      code: 0,
      stdout: JSON.stringify({ version: 2, model: 'medium', items: [] }),
      stderr: '',
    }));
    const runner = createPythonRunner({ ...opts, spawn, exists: () => true });
    await expect(runner(REQ)).rejects.toThrow();

    const spawn2 = vi.fn<SpawnFn>(async () => ({
      code: 0,
      stdout: JSON.stringify({ version: 1, model: 'medium', items: [{ key: 'x', transcript: 5 }] }),
      stderr: '',
    }));
    const runner2 = createPythonRunner({ ...opts, spawn: spawn2, exists: () => true });
    await expect(runner2(REQ)).rejects.toThrow();
  });

  it('TC-AUD49-WSP-4: python tidak ada melempar dengan perintah setup venv dan tanpa spawn', async () => {
    const spawn = vi.fn<SpawnFn>(async () => ({ code: 0, stdout: '{}', stderr: '' }));
    const exists = vi.fn((p: string) => p !== opts.python);
    const runner = createPythonRunner({ ...opts, spawn, exists });

    let message = '';
    try {
      await runner(REQ);
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message).toContain('python3 -m venv .tmp/audio/venv');
    expect(message).toContain('pip install -r scripts/audio/whisper/requirements.txt');
    expect(exists).toHaveBeenCalledWith(opts.python);
    expect(spawn).not.toHaveBeenCalled();
  });
});
