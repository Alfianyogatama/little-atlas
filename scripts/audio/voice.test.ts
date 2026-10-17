import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assertVoiceConfigured, loadVoice, styleHash } from './voice';

// Kontrak tambahan yang ditetapkan tes ini:
// - voice.json = { version: 1, voice: string, promptMode: 'transcript' | 'system', style: { id: string, en: string } };
//   sampai pemilik memilih suara, `voice` bernilai "ISI-SETELAH-SAMPEL". promptMode wajib (nilai repo 'transcript').
// - loadVoice(path) membaca dan memvalidasi dengan Zod (versi harus 1, semua string tidak kosong);
//   berkas rusak atau tidak sesuai skema melempar.
// - assertVoiceConfigured(v) melempar bila v.voice berawalan "ISI-SETELAH-"; selain itu tidak.
// - styleHash(v, locale) = sha256 heksa huruf kecil dari `voice + '\n' + promptMode + '\n' + style[locale]`.
//   Parameter v cukup memuat { voice, promptMode, style }.

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'audio-voice-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const STYLE = {
  id: 'Speak Indonesian slowly, cheerfully, and clearly, like reading a picture book to a toddler.',
  en: 'Speak English slowly, cheerfully, and clearly, like reading a picture book to a toddler.',
};
const PM = 'transcript';
const write = (name: string, value: unknown): string => {
  const path = join(dir, name);
  writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value));
  return path;
};

describe('loadVoice dan assertVoiceConfigured', () => {
  it('TC-AUD49-VOICE-1: voice placeholder terbaca tetapi assertVoiceConfigured melempar', () => {
    const raw = { version: 1, voice: 'ISI-SETELAH-SAMPEL', promptMode: 'transcript', style: STYLE };
    const v = loadVoice(write('v.json', raw));
    expect(v).toEqual(raw);
    expect(() => assertVoiceConfigured(v)).toThrow('ISI-SETELAH-');
  });

  it('TC-AUD49-VOICE-1: suara terpilih lolos assertVoiceConfigured', () => {
    const v = loadVoice(
      write('v.json', { version: 1, voice: 'Aoede', promptMode: 'system', style: STYLE }),
    );
    expect(v.voice).toBe('Aoede');
    expect(v.promptMode).toBe('system');
    expect(() => assertVoiceConfigured(v)).not.toThrow();
  });

  it('TC-AUD49-VOICE-1: berkas rusak atau tidak sesuai skema melempar', () => {
    expect(() => loadVoice(write('a.json', '{ bukan json'))).toThrow();
    expect(() =>
      loadVoice(write('b.json', { version: 2, voice: 'Aoede', promptMode: PM, style: STYLE })),
    ).toThrow();
    expect(() =>
      loadVoice(
        write('c.json', { version: 1, voice: 'Aoede', promptMode: PM, style: { id: 'x' } }),
      ),
    ).toThrow();
    expect(() =>
      loadVoice(write('d.json', { version: 1, voice: '', promptMode: PM, style: STYLE })),
    ).toThrow();
    expect(() => loadVoice(join(dir, 'tidak-ada.json'))).toThrow();
  });

  it('TC-AUD49-VOICE-1: voice.json di repo lolos skema dan memuat gaya id dan en', () => {
    const v = loadVoice(fileURLToPath(new URL('./voice.json', import.meta.url)));
    expect(v.version).toBe(1);
    expect(v.voice.length).toBeGreaterThan(0);
    expect(v.style.id.length).toBeGreaterThan(0);
    expect(v.style.en.length).toBeGreaterThan(0);
  });

  it('TC-AUD49-VOICE-3: skema menolak promptMode selain transcript/system atau yang absen', () => {
    const ok = { version: 1, voice: 'Aoede', style: STYLE };
    expect(loadVoice(write('t.json', { ...ok, promptMode: 'transcript' })).promptMode).toBe(
      'transcript',
    );
    expect(loadVoice(write('s.json', { ...ok, promptMode: 'system' })).promptMode).toBe('system');
    expect(() => loadVoice(write('absen.json', ok))).toThrow();
    expect(() => loadVoice(write('lain.json', { ...ok, promptMode: 'inline' }))).toThrow();
    expect(() => loadVoice(write('besar.json', { ...ok, promptMode: 'Transcript' }))).toThrow();
    expect(() => loadVoice(write('kosong.json', { ...ok, promptMode: '' }))).toThrow();
    expect(() => loadVoice(write('null.json', { ...ok, promptMode: null }))).toThrow();
  });

  it('TC-AUD49-VOICE-3: voice.json di repo memakai promptMode transcript dan gaya Inggris yang ditetapkan', () => {
    const v = loadVoice(fileURLToPath(new URL('./voice.json', import.meta.url)));
    expect(v.promptMode).toBe('transcript');
    expect(v.style).toEqual(STYLE);
  });
});

describe('styleHash', () => {
  const sha = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');
  const base = { voice: 'Aoede', promptMode: 'transcript', style: STYLE } as const;

  it('TC-AUD49-VOICE-2: sha256 heksa dari voice + newline + promptMode + newline + gaya locale', () => {
    expect(styleHash(base, 'id')).toBe(sha(`Aoede\ntranscript\n${STYLE.id}`));
    expect(styleHash(base, 'en')).toBe(sha(`Aoede\ntranscript\n${STYLE.en}`));
    expect(styleHash({ ...base, promptMode: 'system' }, 'id')).toBe(
      sha(`Aoede\nsystem\n${STYLE.id}`),
    );
    expect(styleHash(base, 'id')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('TC-AUD49-VOICE-2: berubah bila gaya atau suara berubah, dan stabil bila tidak', () => {
    const h = styleHash(base, 'id');
    expect(styleHash({ ...base }, 'id')).toBe(h);
    expect(styleHash({ ...base, style: { ...STYLE, id: 'lebih cepat' } }, 'id')).not.toBe(h);
    expect(styleHash({ ...base, voice: 'Kore' }, 'id')).not.toBe(h);
    expect(styleHash(base, 'en')).not.toBe(h);
  });

  it('TC-AUD49-VOICE-3: styleHash berubah bila promptMode berubah, locale en juga', () => {
    for (const locale of ['id', 'en'] as const) {
      expect(styleHash({ ...base, promptMode: 'system' }, locale)).not.toBe(
        styleHash({ ...base, promptMode: 'transcript' }, locale),
      );
    }
  });

  it('TC-AUD49-VOICE-2: gaya locale lain tidak memengaruhi hash locale ini', () => {
    const h = styleHash(base, 'id');
    expect(styleHash({ ...base, style: { ...STYLE, en: 'something else' } }, 'id')).toBe(h);
  });
});
