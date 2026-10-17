import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildTtsPayload, extractPcm, pcmToWav, readWav } from './tts';

// Kontrak tambahan yang ditetapkan tes ini (modul murni, tanpa jaringan dan tanpa berkas):
// - buildTtsPayload({ text, locale, voice, style, promptMode, seed? }) menghasilkan body generateContent Gemini.
//   promptMode 'transcript': contents[0].parts[0].text = "### DIRECTOR'S NOTES\n" + style +
//   "\n\n### TRANSCRIPT\n" + text, tanpa systemInstruction. promptMode 'system': systemInstruction =
//   { parts: [{ text: style }] } dan contents[0].parts[0].text = text persis (gaya tidak masuk contents).
//   generationConfig: { responseModalities: ['AUDIO'],
//     speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } } di kedua mode.
//   `style` adalah string gaya untuk locale itu (pemanggil yang memilih). `generationConfig.seed = seed`
//   hanya bila seed diberikan; tanpa seed kuncinya tidak ada sama sekali. `locale` tidak masuk body.
// - extractPcm(res) mengambil inlineData berawalan mime audio/L16 (atau audio/pcm) dari
//   candidates[0].content.parts, decode base64, dan membaca `rate=` dari mime (default 24000).
//   Respons tanpa audio melempar Error yang menyebut alasannya (blockReason, finishReason, atau teks).
// - pcmToWav(pcm, rate) = header RIFF 44 byte + PCM 16-bit mono little-endian.
//   readWav(bytes) = { pcm, rate, channels, bitsPerSample }; menolak berkas bukan RIFF/WAVE dan bukan PCM 16-bit.

const STYLE_ID =
  'Speak Indonesian slowly, cheerfully, and clearly, like reading a picture book to a toddler.';
const bytesOf = (...n: number[]): Uint8Array => Uint8Array.from(n);
const b64 = (b: Uint8Array): string => Buffer.from(b).toString('base64');
const audioResponse = (mimeType: string, data: Uint8Array): unknown => ({
  candidates: [{ content: { parts: [{ inlineData: { mimeType, data: b64(data) } }] } }],
});
const ascii = (b: Uint8Array, from: number, to: number): string =>
  String.fromCharCode(...b.slice(from, to));
const view = (b: Uint8Array): DataView => new DataView(b.buffer, b.byteOffset, b.byteLength);

describe('buildTtsPayload', () => {
  const TEXT = 'Ini Indonesia, rumah kita!';
  const generationConfig = {
    responseModalities: ['AUDIO'],
    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } } },
  };
  const base = { text: TEXT, locale: 'id', voice: 'Aoede', style: STYLE_ID } as const;

  // REMAP TC-AUD49-TTS-1: format lama `${style}: ${text}` membuat model membacakan instruksi gaya
  // (transkrip Whisper sampel asli memuat kalimat gaya). Kontrak baru: catatan sutradara terpisah.
  it('TC-AUD49-TTS-1: payload persis mode transcript untuk id dengan suara Aoede; seed hanya bila diberikan', () => {
    const expected = {
      contents: [
        {
          role: 'user',
          parts: [{ text: `### DIRECTOR'S NOTES\n${STYLE_ID}\n\n### TRANSCRIPT\n${TEXT}` }],
        },
      ],
      generationConfig,
    };

    const without = buildTtsPayload({ ...base, promptMode: 'transcript' });
    expect(without).toEqual(expected);
    expect(Object.keys(without)).not.toContain('systemInstruction');
    expect(Object.keys((without as typeof expected).generationConfig)).not.toContain('seed');

    const withSeed = buildTtsPayload({ ...base, promptMode: 'transcript', seed: 2 });
    expect(withSeed).toEqual({
      ...expected,
      generationConfig: { ...expected.generationConfig, seed: 2 },
    });
  });

  it('TC-AUD49-TTS-1: payload persis mode system; seed hanya bila diberikan', () => {
    const expected = {
      systemInstruction: { parts: [{ text: STYLE_ID }] },
      contents: [{ role: 'user', parts: [{ text: TEXT }] }],
      generationConfig,
    };

    const without = buildTtsPayload({ ...base, promptMode: 'system' });
    expect(without).toEqual(expected);
    expect(Object.keys((without as typeof expected).generationConfig)).not.toContain('seed');

    expect(buildTtsPayload({ ...base, promptMode: 'system', seed: 5 })).toEqual({
      ...expected,
      generationConfig: { ...generationConfig, seed: 5 },
    });
  });

  it('TC-AUD49-TTS-10: mode system tidak memuat gaya di contents; mode transcript tidak punya systemInstruction', () => {
    const sys = buildTtsPayload({ ...base, promptMode: 'system' }) as {
      contents: { parts: { text: string }[] }[];
    };
    const sysContents = JSON.stringify(sys.contents);
    expect(sysContents).not.toContain(STYLE_ID);
    expect(sysContents).not.toContain('Speak Indonesian');
    expect(sys.contents[0]?.parts[0]?.text).toBe(TEXT);

    const tr = buildTtsPayload({ ...base, promptMode: 'transcript' });
    expect('systemInstruction' in tr).toBe(false);
    expect(JSON.stringify(tr)).not.toContain('systemInstruction');
  });

  it('TC-AUD49-TTS-10: teks klip tidak pernah diawali gaya di kedua mode; gaya en dipakai apa adanya', () => {
    const styleEn =
      'Speak English slowly, cheerfully, and clearly, like reading a picture book to a toddler.';
    for (const promptMode of ['transcript', 'system'] as const) {
      const p = buildTtsPayload({
        text: 'This is Japan.',
        locale: 'en',
        voice: 'Leda',
        style: styleEn,
        promptMode,
      }) as { contents: { parts: { text: string }[] }[] };
      const sent = p.contents[0]?.parts[0]?.text ?? '';
      expect(sent.startsWith(styleEn)).toBe(false);
      expect(sent.endsWith('This is Japan.')).toBe(true);
      expect(sent).not.toContain(`${styleEn}: `);
    }
  });
});

describe('extractPcm', () => {
  const PCM = bytesOf(0, 0, 1, 0, 255, 127, 0, 128, 10, 20);

  it('TC-AUD49-TTS-2: mengambil byte PCM dan rate dari mime audio/L16', () => {
    const out = extractPcm(audioResponse('audio/L16;codec=pcm;rate=24000', PCM));
    expect(Array.from(out.pcm)).toEqual(Array.from(PCM));
    expect(out.rate).toBe(24000);
  });

  it('TC-AUD49-TTS-2: mime tanpa rate memakai 24000; rate=16000 dibaca apa adanya', () => {
    expect(extractPcm(audioResponse('audio/L16', PCM)).rate).toBe(24000);
    expect(extractPcm(audioResponse('audio/L16;codec=pcm', PCM)).rate).toBe(24000);
    const slow = extractPcm(audioResponse('audio/L16;codec=pcm;rate=16000', PCM));
    expect(slow.rate).toBe(16000);
    expect(Array.from(slow.pcm)).toEqual(Array.from(PCM));
  });

  it('TC-AUD49-TTS-2: audio/pcm juga diterima, dan bagian teks sebelum audio dilewati', () => {
    const res = {
      candidates: [
        {
          content: {
            parts: [
              { text: 'catatan' },
              { inlineData: { mimeType: 'audio/pcm;rate=16000', data: b64(PCM) } },
            ],
          },
        },
      ],
    };
    const out = extractPcm(res);
    expect(Array.from(out.pcm)).toEqual(Array.from(PCM));
    expect(out.rate).toBe(16000);
  });

  it('TC-AUD49-TTS-3: respons diblokir menyebut alasannya', () => {
    expect(() => extractPcm({ promptFeedback: { blockReason: 'PROHIBITED_CONTENT' } })).toThrow(
      /PROHIBITED_CONTENT/,
    );
  });

  it('TC-AUD49-TTS-3: finishReason SAFETY tanpa konten menyebut alasannya', () => {
    expect(() => extractPcm({ candidates: [{ finishReason: 'SAFETY' }] })).toThrow(/SAFETY/);
  });

  it('TC-AUD49-TTS-3: parts teks saja melempar dengan kutipan teksnya', () => {
    const res = {
      candidates: [{ content: { parts: [{ text: 'Maaf, saya tidak bisa mengucapkan itu.' }] } }],
    };
    expect(() => extractPcm(res)).toThrow(/tidak bisa mengucapkan itu/);
  });

  it('TC-AUD49-TTS-3: inlineData bukan audio dan respons kosong tetap melempar Error', () => {
    expect(() => extractPcm(audioResponse('image/png', PCM))).toThrow(Error);
    expect(() => extractPcm({})).toThrow(Error);
    expect(() => extractPcm({ candidates: [] })).toThrow(Error);
  });
});

describe('pcmToWav dan readWav', () => {
  const PCM = Uint8Array.from({ length: 480 }, (_, i) => (i * 7) % 256);

  it('TC-AUD49-TTS-4: header RIFF 44 byte dengan ukuran data benar', () => {
    const wav = pcmToWav(PCM, 24000);
    const v = view(wav);
    expect(wav.length).toBe(44 + PCM.length);
    expect(ascii(wav, 0, 4)).toBe('RIFF');
    expect(v.getUint32(4, true)).toBe(36 + PCM.length);
    expect(ascii(wav, 8, 12)).toBe('WAVE');
    expect(ascii(wav, 12, 16)).toBe('fmt ');
    expect(v.getUint32(16, true)).toBe(16);
    expect(v.getUint16(20, true)).toBe(1);
    expect(v.getUint16(22, true)).toBe(1);
    expect(v.getUint32(24, true)).toBe(24000);
    expect(v.getUint32(28, true)).toBe(48000);
    expect(v.getUint16(32, true)).toBe(2);
    expect(v.getUint16(34, true)).toBe(16);
    expect(ascii(wav, 36, 40)).toBe('data');
    expect(v.getUint32(40, true)).toBe(PCM.length);
    expect(Array.from(wav.slice(44))).toEqual(Array.from(PCM));
  });

  it('TC-AUD49-TTS-4: pcmToWav lalu readWav mengembalikan pcm, rate, mono, 16 bit', () => {
    for (const rate of [24000, 16000]) {
      const out = readWav(pcmToWav(PCM, rate));
      expect(Array.from(out.pcm)).toEqual(Array.from(PCM));
      expect(out.rate).toBe(rate);
      expect(out.channels).toBe(1);
      expect(out.bitsPerSample).toBe(16);
    }
  });

  it('TC-AUD49-TTS-5: readWav menolak berkas yang bukan WAV', () => {
    const text = new TextEncoder().encode('ini bukan berkas audio sama sekali, hanya teks biasa.');
    expect(() => readWav(text)).toThrow(Error);
    expect(() => readWav(new Uint8Array(0))).toThrow(Error);
    expect(() => readWav(bytesOf(0x52, 0x49, 0x46, 0x46))).toThrow(Error);
    const notWave = pcmToWav(PCM, 24000).slice();
    notWave.set(new TextEncoder().encode('AVI '), 8);
    expect(() => readWav(notWave)).toThrow(Error);
  });

  it('TC-AUD49-TTS-5: readWav menolak yang bukan PCM 16-bit (float, 8-bit)', () => {
    const float = pcmToWav(PCM, 24000).slice();
    view(float).setUint16(20, 3, true);
    expect(() => readWav(float)).toThrow(Error);

    const eightBit = pcmToWav(PCM, 24000).slice();
    view(eightBit).setUint16(34, 8, true);
    expect(() => readWav(eightBit)).toThrow(Error);
  });
});

describe('extractPcm: respons audio/wav', () => {
  // Model gemini-3.8-flash-lite-tts mengembalikan WAV lengkap (RIFF), bukan PCM mentah.
  const PCM = Uint8Array.from({ length: 480 }, (_, i) => (i * 11) % 256);

  it('TC-AUD49-TTS-7: audio/wav -> pcm dan rate dari header WAV, bukan header ikut terbawa', () => {
    const out = extractPcm(audioResponse('audio/wav', pcmToWav(PCM, 24000)));
    expect(Array.from(out.pcm)).toEqual(Array.from(PCM));
    expect(out.rate).toBe(24000);

    const slow = extractPcm(audioResponse('audio/wav', pcmToWav(PCM, 16000)));
    expect(Array.from(slow.pcm)).toEqual(Array.from(PCM));
    expect(slow.rate).toBe(16000);
  });

  it('TC-AUD49-TTS-7: audio/x-wav, audio/wave, huruf besar, dan berparameter diterima', () => {
    for (const mime of ['audio/x-wav', 'audio/wave', 'AUDIO/WAV', 'audio/wav; charset=binary']) {
      const out = extractPcm(audioResponse(mime, pcmToWav(PCM, 16000)));
      expect(Array.from(out.pcm), mime).toEqual(Array.from(PCM));
      expect(out.rate, mime).toBe(16000);
    }
  });

  it('TC-AUD49-TTS-8: audio/wav stereo melempar dengan info channels', () => {
    const stereo = pcmToWav(PCM, 24000).slice();
    view(stereo).setUint16(22, 2, true);
    expect(() => extractPcm(audioResponse('audio/wav', stereo))).toThrow(/channels|stereo|mono/i);
    expect(() => extractPcm(audioResponse('audio/wav', stereo))).toThrow(/2/);
  });

  it('TC-AUD49-TTS-8: audio/wav 8-bit melempar dengan info bits', () => {
    const eightBit = pcmToWav(PCM, 24000).slice();
    view(eightBit).setUint16(34, 8, true);
    expect(() => extractPcm(audioResponse('audio/wav', eightBit))).toThrow(/bit/i);
  });

  it('TC-AUD49-TTS-8: audio/wav yang isinya bukan WAV melempar Error', () => {
    expect(() => extractPcm(audioResponse('audio/wav', bytesOf(1, 2, 3, 4)))).toThrow(/WAV/);
  });

  it('TC-AUD49-TTS-9: fixture berbentuk respons asli (candidates/content/parts/inlineData) berhasil', () => {
    const raw: unknown = JSON.parse(
      readFileSync(new URL('./fixtures/tts-wav-response.json', import.meta.url), 'utf8'),
    );
    const shape = raw as {
      candidates: {
        finishReason: string;
        content: { parts: { inlineData: { mimeType: string } }[] };
      }[];
      usageMetadata: unknown;
      modelVersion: string;
    };
    expect(shape.candidates[0]?.finishReason).toBe('STOP');
    expect(shape.candidates[0]?.content.parts[0]?.inlineData.mimeType).toBe('audio/wav');
    expect(shape.usageMetadata).toBeDefined();
    expect(shape.modelVersion).toBe('gemini-3.8-flash-lite-tts');

    const out = extractPcm(raw);
    expect(out.rate).toBe(24000);
    expect(out.pcm).toHaveLength(240 * 2);
  });
});
