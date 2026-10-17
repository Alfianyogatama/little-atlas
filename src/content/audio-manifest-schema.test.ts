import { describe, expect, it } from 'vitest';
import { AudioManifestSchema } from './schema';

// Kontrak tambahan yang ditetapkan tes ini (issue #49, perluasan AudioManifestSchema):
// - Entri klip = { id: ClipId, locale: 'id'|'en', text, textHash (sha256 heksa 64 huruf kecil),
//   attempt: bilangan bulat >= 1, raw: '<loc>/<nama>.wav' (nama: A-Z a-z 0-9 _ -), model, voice,
//   styleHash (heksa 64), take: bilangan bulat >= 1, generatedAt: ISO, durationMs: bilangan bulat > 0,
//   whisper: { model, transcript, score 0..1, flag: 'kosong'|'bahasa'|'beda'|'periksa'|'ok' },
//   reviewedAt: ISO }.
// - Pasangan (locale, id) harus unik di seluruh manifest; locale di `raw` harus sama dengan locale entri.
// - Satu entri buruk menggagalkan seluruh manifest.

const HASH = 'a'.repeat(64);

const entry = (over: Record<string, unknown> = {}) => ({
  id: 'intro:JP',
  locale: 'id',
  text: 'Ini Jepang!',
  textHash: HASH,
  attempt: 1,
  raw: 'id/intro_JP-aaaaaaaa-1.wav',
  model: 'gemini-tts-model',
  voice: 'Aoede',
  styleHash: 'b'.repeat(64),
  take: 1,
  generatedAt: '2026-10-17T01:00:00.000Z',
  durationMs: 1800,
  whisper: { model: 'medium', transcript: 'ini jepang', score: 0.97, flag: 'ok' },
  reviewedAt: '2026-10-17T02:00:00.000Z',
  ...over,
});
const manifest = (clips: unknown[]) => ({ version: 1, clips });
const accepts = (v: unknown) => AudioManifestSchema.safeParse(v).success;

describe('AudioManifestSchema (perluasan #49)', () => {
  it('TC-AUD49-MAN-1 manifest valid: kosong, dan id sama di locale berbeda', () => {
    expect(accepts(manifest([]))).toBe(true);
    expect(
      accepts(
        manifest([
          entry(),
          entry({ locale: 'en', raw: 'en/intro_JP-aaaaaaaa-2.wav', text: 'This is Japan!' }),
          entry({ id: 'celebrate:25', raw: 'id/celebrate_25-aaaaaaaa-1.wav' }),
        ]),
      ),
    ).toBe(true);
  });

  it('TC-AUD49-MAN-1 semua nilai flag enum diterima', () => {
    for (const flag of ['kosong', 'bahasa', 'beda', 'periksa', 'ok']) {
      const whisper = { model: 'medium', transcript: 'x', score: 0.5, flag };
      expect(accepts(manifest([entry({ whisper })])), flag).toBe(true);
    }
  });

  it('TC-AUD49-MAN-2 pasangan (locale, id) ganda ditolak', () => {
    expect(accepts(manifest([entry(), entry({ attempt: 2, take: 2 })]))).toBe(false);
    expect(
      accepts(
        manifest([entry(), entry({ raw: 'id/intro_JP-aaaaaaaa-2.wav', take: 2, attempt: 2 })]),
      ),
    ).toBe(false);
  });

  it('TC-AUD49-MAN-2 kontrol positif: id sama beda locale, atau locale sama beda id, diterima', () => {
    const en = entry({ locale: 'en', raw: 'en/intro_JP-aaaaaaaa-1.wav' });
    expect(accepts(manifest([entry(), en]))).toBe(true);
    const other = entry({ id: 'intro:BR', raw: 'id/intro_BR-aaaaaaaa-1.wav' });
    expect(accepts(manifest([entry(), other]))).toBe(true);
  });

  it.each([
    ['locale id tapi raw en/', { locale: 'id', raw: 'en/intro_JP-aaaaaaaa-1.wav' }],
    ['locale en tapi raw id/', { locale: 'en', raw: 'id/intro_JP-aaaaaaaa-1.wav' }],
    ['raw tanpa awalan locale', { raw: 'intro_JP-aaaaaaaa-1.wav' }],
    ['raw bentuk lama .tmp/audio/raw/', { raw: '.tmp/audio/raw/id/intro_JP-aaaaaaaa-1.wav' }],
    ['raw locale tak dikenal', { raw: 'fr/intro_JP-aaaaaaaa-1.wav' }],
    ['raw naik direktori', { raw: 'id/../intro_JP-aaaaaaaa-1.wav' }],
    ['raw bersarang', { raw: 'id/sub/intro_JP-aaaaaaaa-1.wav' }],
    ['raw bukan wav', { raw: 'id/intro_JP-aaaaaaaa-1.mp3' }],
    ['raw ada spasi', { raw: 'id/intro JP.wav' }],
    ['raw ada titik dua', { raw: 'id/intro:JP.wav' }],
  ])('TC-AUD49-MAN-3 raw ditolak: %s', (_n, patch) => {
    expect(accepts(manifest([entry(patch)]))).toBe(false);
  });

  it('TC-AUD49-MAN-3 kontrol positif: raw dengan garis bawah dan tanda hubung diterima', () => {
    expect(accepts(manifest([entry({ raw: 'id/intro_JP-aaaaaaaa-12.wav' })]))).toBe(true);
  });

  it.each([
    ['flag di luar enum', { whisper: { model: 'm', transcript: 'x', score: 0.9, flag: 'bagus' } }],
    ['flag huruf besar', { whisper: { model: 'm', transcript: 'x', score: 0.9, flag: 'OK' } }],
    ['flag kosong', { whisper: { model: 'm', transcript: 'x', score: 0.9, flag: '' } }],
    ['whisper tanpa model', { whisper: { transcript: 'x', score: 0.9, flag: 'ok' } }],
    ['whisper.model kosong', { whisper: { model: '', transcript: 'x', score: 0.9, flag: 'ok' } }],
    ['skor di atas 1', { whisper: { model: 'm', transcript: 'x', score: 1.1, flag: 'ok' } }],
    ['model hilang', { model: undefined }],
    ['voice hilang', { voice: undefined }],
    ['styleHash hilang', { styleHash: undefined }],
    ['styleHash bukan heksa 64', { styleHash: 'xyz' }],
    ['take hilang', { take: undefined }],
    ['take 0', { take: 0 }],
    ['take pecahan', { take: 1.5 }],
    ['generatedAt hilang', { generatedAt: undefined }],
    ['generatedAt bukan ISO', { generatedAt: 'kemarin' }],
    ['durasi 0', { durationMs: 0 }],
    ['attempt 0', { attempt: 0 }],
  ])('TC-AUD49-MAN-4 entri ditolak: %s', (_n, patch) => {
    expect(accepts(manifest([entry(patch)]))).toBe(false);
  });

  it('TC-AUD49-MAN-4 satu entri buruk menggagalkan seluruh manifest', () => {
    const buruk = entry({
      id: 'intro:BR',
      raw: 'id/intro_BR-aaaaaaaa-1.wav',
      whisper: { model: 'm', transcript: 'x', score: 0.9, flag: 'bagus' },
    });
    expect(accepts(manifest([entry(), buruk]))).toBe(false);
  });
});
