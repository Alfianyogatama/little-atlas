import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assertVoiceConfigured, loadVoice, styleHash } from './voice';

// Kontrak tambahan yang ditetapkan tes ini:
// - voice.json = { version: 1, voice: string, style: { id: string, en: string } }; sampai pemilik memilih
//   suara, `voice` bernilai "ISI-SETELAH-SAMPEL".
// - loadVoice(path) membaca dan memvalidasi dengan Zod (versi harus 1, semua string tidak kosong);
//   berkas rusak atau tidak sesuai skema melempar.
// - assertVoiceConfigured(v) melempar bila v.voice berawalan "ISI-SETELAH-"; selain itu tidak.
// - styleHash(v, locale) = sha256 heksa huruf kecil dari `voice + '\n' + style[locale]`. Parameter v
//   cukup memuat { voice, style }.

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'audio-voice-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const STYLE = {
  id: 'pelan, ceria, dan jelas untuk anak balita',
  en: 'slow, cheerful, and clear for toddlers',
};
const write = (name: string, value: unknown): string => {
  const path = join(dir, name);
  writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value));
  return path;
};

describe('loadVoice dan assertVoiceConfigured', () => {
  it('TC-AUD49-VOICE-1: voice placeholder terbaca tetapi assertVoiceConfigured melempar', () => {
    const v = loadVoice(write('v.json', { version: 1, voice: 'ISI-SETELAH-SAMPEL', style: STYLE }));
    expect(v).toEqual({ version: 1, voice: 'ISI-SETELAH-SAMPEL', style: STYLE });
    expect(() => assertVoiceConfigured(v)).toThrow('ISI-SETELAH-');
  });

  it('TC-AUD49-VOICE-1: suara terpilih lolos assertVoiceConfigured', () => {
    const v = loadVoice(write('v.json', { version: 1, voice: 'Aoede', style: STYLE }));
    expect(v.voice).toBe('Aoede');
    expect(() => assertVoiceConfigured(v)).not.toThrow();
  });

  it('TC-AUD49-VOICE-1: berkas rusak atau tidak sesuai skema melempar', () => {
    expect(() => loadVoice(write('a.json', '{ bukan json'))).toThrow();
    expect(() =>
      loadVoice(write('b.json', { version: 2, voice: 'Aoede', style: STYLE })),
    ).toThrow();
    expect(() =>
      loadVoice(write('c.json', { version: 1, voice: 'Aoede', style: { id: 'x' } })),
    ).toThrow();
    expect(() => loadVoice(write('d.json', { version: 1, voice: '', style: STYLE }))).toThrow();
    expect(() => loadVoice(join(dir, 'tidak-ada.json'))).toThrow();
  });

  it('TC-AUD49-VOICE-1: voice.json di repo lolos skema dan memuat gaya id dan en', () => {
    const v = loadVoice(fileURLToPath(new URL('./voice.json', import.meta.url)));
    expect(v.version).toBe(1);
    expect(v.voice.length).toBeGreaterThan(0);
    expect(v.style.id.length).toBeGreaterThan(0);
    expect(v.style.en.length).toBeGreaterThan(0);
  });
});

describe('styleHash', () => {
  const sha = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');
  const base = { voice: 'Aoede', style: STYLE };

  it('TC-AUD49-VOICE-2: sha256 heksa dari voice + newline + gaya locale', () => {
    expect(styleHash(base, 'id')).toBe(sha(`Aoede\n${STYLE.id}`));
    expect(styleHash(base, 'en')).toBe(sha(`Aoede\n${STYLE.en}`));
    expect(styleHash(base, 'id')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('TC-AUD49-VOICE-2: berubah bila gaya atau suara berubah, dan stabil bila tidak', () => {
    const h = styleHash(base, 'id');
    expect(styleHash({ ...base }, 'id')).toBe(h);
    expect(styleHash({ ...base, style: { ...STYLE, id: 'lebih cepat' } }, 'id')).not.toBe(h);
    expect(styleHash({ ...base, voice: 'Kore' }, 'id')).not.toBe(h);
    expect(styleHash(base, 'en')).not.toBe(h);
  });

  it('TC-AUD49-VOICE-2: gaya locale lain tidak memengaruhi hash locale ini', () => {
    const h = styleHash(base, 'id');
    expect(styleHash({ ...base, style: { ...STYLE, en: 'something else' } }, 'id')).toBe(h);
  });
});
