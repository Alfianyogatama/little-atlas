// @vitest-environment jsdom
/**
 * Kontrak A5 (issue #8, TC-AUD-BR, temuan #47 butir 2): src/services/audio/browser.ts.
 *
 * - createBrowserAudio() mengembalikan singleton modul (instans yang sama setiap kali).
 * - Listener `voiceschanged` pada speechSynthesis dipasang sekali walau createBrowserAudio dipanggil berulang.
 * - Howler (K8) hanya lewat import() dinamis: mengimpor modul browser tidak boleh mengevaluasi `howler`.
 *   Dicek dengan vi.doMock('howler', factory) yang menandai evaluasi; import statis akan menandainya
 *   saat './browser' dimuat. Ini cek perilaku (bukan baca source), jadi tidak rapuh terhadap penulisan ulang.
 * - navigator.audioSession.type = 'playback' bila ada; tanpa itu tidak melempar.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const howlerEvaluated = vi.hoisted(() => ({ value: false }));

/** doMock (bukan vi.mock): pabrik didaftarkan ulang tiap tes, jadi evaluasi modul tidak ter-cache antar tes. */
function mockHowler() {
  howlerEvaluated.value = false;
  vi.doMock('howler', () => {
    howlerEvaluated.value = true;
    class Howl {
      readonly kind = 'howl';
    }
    return { Howl, Howler: { autoUnlock: true }, default: { Howl } };
  });
}

class FakeUtterance {
  text: string;
  constructor(text: string) {
    this.text = text;
  }
}

function stubSpeechSynthesis() {
  const addEventListener = vi.fn();
  const synth = {
    getVoices: () => [],
    speak: vi.fn(),
    cancel: vi.fn(),
    addEventListener,
  };
  vi.stubGlobal('speechSynthesis', synth);
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
  return { addEventListener };
}

async function freshBrowserModule() {
  vi.resetModules();
  mockHowler();
  return import('./browser');
}

afterEach(() => {
  vi.doUnmock('howler');
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window.navigator, 'audioSession');
});

describe('TC-AUD-BR-1: singleton', () => {
  it('dua panggilan mengembalikan instans yang sama', async () => {
    stubSpeechSynthesis();
    const { createBrowserAudio } = await freshBrowserModule();
    const first = createBrowserAudio();
    expect(createBrowserAudio()).toBe(first);
    expect(typeof first.speak).toBe('function');
    expect(typeof first.stop).toBe('function');
  });

  it('tanpa speechSynthesis tetap singleton dan speak/stop tidak melempar', async () => {
    const { createBrowserAudio } = await freshBrowserModule();
    const audio = createBrowserAudio();
    expect(createBrowserAudio()).toBe(audio);
    expect(() => {
      audio.speak([]);
      audio.stop();
    }).not.toThrow();
  });
});

describe('TC-AUD-BR-2: voiceschanged dipasang sekali (#47 butir 2)', () => {
  it('createBrowserAudio dipanggil berulang: tepat satu listener voiceschanged', async () => {
    const { addEventListener } = stubSpeechSynthesis();
    const { createBrowserAudio } = await freshBrowserModule();
    createBrowserAudio();
    createBrowserAudio();
    createBrowserAudio();
    const voicesChanged = addEventListener.mock.calls.filter(([type]) => type === 'voiceschanged');
    expect(voicesChanged).toHaveLength(1);
  });

  it('kontrol: modul baru (instans baru) memasang listener-nya sendiri', async () => {
    const { addEventListener } = stubSpeechSynthesis();
    const first = await freshBrowserModule();
    first.createBrowserAudio();
    const second = await freshBrowserModule();
    second.createBrowserAudio();
    const voicesChanged = addEventListener.mock.calls.filter(([type]) => type === 'voiceschanged');
    expect(voicesChanged).toHaveLength(2);
  });
});

describe('TC-AUD-BR-3: Howler dimuat dinamis, bukan statis', () => {
  it('mengimpor browser.ts dan membuat audio tidak mengevaluasi modul howler', async () => {
    stubSpeechSynthesis();
    const { createBrowserAudio } = await freshBrowserModule();
    createBrowserAudio();
    createBrowserAudio().stop();
    expect(howlerEvaluated.value).toBe(false);
  });

  it('kontrol: tiruan howler memang bisa dimuat lewat import() dinamis (penanda bekerja)', async () => {
    vi.resetModules();
    mockHowler();
    expect(howlerEvaluated.value).toBe(false);
    const specifier = 'howler'; // lewat variabel: tidak ikut analisis impor Vite, jadi tak bergantung pada paket terpasang
    await import(/* @vite-ignore */ specifier);
    expect(howlerEvaluated.value).toBe(true);
  });
});

describe('TC-AUD-BR-4: audioSession', () => {
  it("navigator.audioSession.type diatur 'playback' bila ada", async () => {
    stubSpeechSynthesis();
    const session = { type: 'auto' };
    Object.defineProperty(window.navigator, 'audioSession', { value: session, configurable: true });
    const { createBrowserAudio } = await freshBrowserModule();
    createBrowserAudio();
    expect(session.type).toBe('playback');
  });

  it('tanpa audioSession tidak melempar', async () => {
    stubSpeechSynthesis();
    expect('audioSession' in window.navigator).toBe(false); // kontrol: memang tidak ada
    const { createBrowserAudio } = await freshBrowserModule();
    expect(() => createBrowserAudio()).not.toThrow();
  });
});

/**
 * Peta sprite yang belum ada (TC-AUD-BR-5). `vercel.json` me-rewrite semua path ke /index.html, jadi
 * `/audio/id/sprites.json` yang belum diterbitkan dijawab `200 text/html`. Itu harus dianggap "peta belum ada"
 * (sama dengan 404): has false, di-cache, tanpa fetch ulang. Galat jaringan tidak di-cache.
 *
 * Diuji lewat createBrowserAudio() dengan `fetch` global di-stub (fetchJson tidak perlu diekspor) dan
 * speechSynthesis tiruan dengan satu suara lokal `id`, supaya jatuh ke suara lokal bisa diamati.
 */
describe('TC-AUD-BR-5: respons peta sprite yang bukan peta', () => {
  const segment = (id: string) => ({ id, text: `teks ${id}`, locale: 'id' as const });

  /** Respons tiruan: `json()` menolak bila body bukan JSON, seperti Response asli. */
  function fakeResponse(status: number, contentType: string, body: string) {
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: {
        get: (name: string) => (name.toLowerCase() === 'content-type' ? contentType : null),
      },
      json: () => new Promise<unknown>((resolve) => resolve(JSON.parse(body) as unknown)),
      text: () => Promise.resolve(body),
    };
  }

  function setup(respond: () => Promise<unknown>) {
    const spoken: string[] = [];
    const synth = {
      getVoices: () => [{ lang: 'id-ID', localService: true, name: 'suara-id' }],
      speak: (u: { text: string; onend: (() => void) | null }) => {
        spoken.push(u.text);
        setTimeout(() => u.onend?.(), 0);
      },
      cancel: vi.fn(),
      addEventListener: vi.fn(),
    };
    vi.stubGlobal('speechSynthesis', synth);
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
    const fetchStub = vi.fn<(url: string) => Promise<unknown>>(() => respond());
    vi.stubGlobal('fetch', fetchStub);
    const spriteFetches = () =>
      fetchStub.mock.calls.filter(([url]) => String(url).endsWith('/audio/id/sprites.json')).length;
    return { spoken, spriteFetches };
  }

  /** Dua `speak` beruntun; menunggu tiap segmen jatuh ke suara lokal. */
  async function speakTwice(spoken: string[]) {
    const { createBrowserAudio } = await freshBrowserModule();
    const audio = createBrowserAudio();
    audio.speak([segment('intro:JP')]);
    await vi.waitFor(() => {
      expect(spoken).toEqual(['teks intro:JP']);
    });
    audio.speak([segment('fact:JP')]);
    await vi.waitFor(() => {
      expect(spoken).toEqual(['teks intro:JP', 'teks fact:JP']);
    });
  }

  it('(a) 200 text/html berisi HTML: dianggap tanpa peta, di-cache, fetch sekali untuk dua speak, jatuh ke suara lokal', async () => {
    const { spoken, spriteFetches } = setup(() =>
      Promise.resolve(
        fakeResponse(200, 'text/html; charset=utf-8', '<!doctype html><html></html>'),
      ),
    );
    await speakTwice(spoken);
    expect(spriteFetches()).toBe(1);
  });

  it('(b) 200 application/json tetapi body tidak bisa di-parse: sama, null dan di-cache', async () => {
    const { spoken, spriteFetches } = setup(() =>
      Promise.resolve(fakeResponse(200, 'application/json', '{ bukan json')),
    );
    await speakTwice(spoken);
    expect(spriteFetches()).toBe(1);
  });

  it('(c) fetch melempar TypeError (jaringan): tidak di-cache, speak berikutnya fetch lagi; suara lokal tetap jalan', async () => {
    const { spoken, spriteFetches } = setup(() => Promise.reject(new TypeError('Failed to fetch')));
    await speakTwice(spoken);
    expect(spriteFetches()).toBe(2);
  });

  it('kontrol: 404 dan JSON valid tanpa klip itu juga di-cache (satu fetch), jatuh ke suara lokal', async () => {
    const notFound = setup(() => Promise.resolve(fakeResponse(404, 'text/html', 'tidak ada')));
    await speakTwice(notFound.spoken);
    expect(notFound.spriteFetches()).toBe(1);

    vi.unstubAllGlobals();
    const emptyMap = setup(() =>
      Promise.resolve(
        fakeResponse(
          200,
          'application/json',
          JSON.stringify({ version: 1, locale: 'id', sprites: {}, clips: {} }),
        ),
      ),
    );
    await speakTwice(emptyMap.spoken);
    expect(emptyMap.spriteFetches()).toBe(1);
  });
});

/**
 * Jembatan ke SpeechSynthesisUtterance native (TC-AUD-BR-6). `real.onerror` harus memajukan antrean.
 * Tes referensi kuat (GC paksa, butuh modul node) ada di tests/unit/audio-browser-gc.test.ts.
 */
describe('TC-AUD-BR-6: utterance native', () => {
  interface NativeUtterance {
    text: string;
    onend: (() => void) | null;
    onerror: (() => void) | null;
  }

  const segment = (id: string) => ({ id, text: `teks ${id}`, locale: 'id' as const });

  /** 404 untuk peta sprite supaya semua segmen jatuh ke suara lokal. */
  const notFound = () =>
    Promise.resolve({
      ok: false,
      status: 404,
      headers: { get: () => null },
      json: () => Promise.reject(new SyntaxError('bukan json')),
    });

  /** speechSynthesis tiruan; `onSpeak` menerima utterance native yang diberikan modul. */
  function setup(onSpeak: (utterance: NativeUtterance) => void) {
    class Utterance {
      text: string;
      lang = '';
      rate = 1;
      pitch = 1;
      voice: unknown = null;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(text: string) {
        this.text = text;
      }
    }
    vi.stubGlobal('speechSynthesis', {
      getVoices: () => [{ lang: 'id-ID', localService: true, name: 'suara-id' }],
      speak: onSpeak,
      cancel: vi.fn(),
      addEventListener: vi.fn(),
    });
    vi.stubGlobal('SpeechSynthesisUtterance', Utterance);
    vi.stubGlobal('fetch', vi.fn(notFound));
  }

  it('error dari utterance native memajukan antrean ke segmen berikutnya', async () => {
    const spoken: NativeUtterance[] = [];
    setup((u) => spoken.push(u));
    const { createBrowserAudio } = await freshBrowserModule();
    createBrowserAudio().speak([segment('intro:JP'), segment('fact:JP')]);
    await vi.waitFor(() => {
      expect(spoken.map((u) => u.text)).toEqual(['teks intro:JP']);
    });

    spoken[0]?.onerror?.();
    await vi.waitFor(() => {
      expect(spoken.map((u) => u.text)).toEqual(['teks intro:JP', 'teks fact:JP']);
    });
    // Kontrol: onend memajukan antrean dengan cara yang sama dan tidak memicu segmen ketiga.
    spoken[1]?.onend?.();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(spoken).toHaveLength(2);
  });
});
