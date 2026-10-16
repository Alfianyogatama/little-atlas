// @vitest-environment jsdom
/// <reference lib="dom" />
/**
 * TC-AUD-BR-6 (issue #8), bagian referensi kuat untuk src/services/audio/browser.ts: utterance native yang
 * sedang diucapkan harus tetap dirujuk modul (Chromium bisa meng-GC utterance tanpa akar JS sehingga onend
 * tak pernah terpanggil) sampai onend/onerror, lalu dilepas. Memakai GC paksa lewat modul node (v8, vm),
 * jadi berada di tests/unit (tsconfig.node.json), bukan di src. Tes onerror -> antrean ada di
 * src/services/audio/browser.test.ts.
 */
import v8 from 'node:v8';
import vm from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

async function freshBrowserModule() {
  vi.resetModules();
  return import('../../src/services/audio/browser');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TC-AUD-BR-6: utterance native', () => {
  describe('referensi kuat', () => {
    /** gc() eksplisit lewat flag V8; WeakRef baru bisa dibebaskan setelah giliran (macrotask) berikutnya. */
    async function collect() {
      v8.setFlagsFromString('--expose-gc');
      const gc = vm.runInNewContext('gc') as () => void;
      for (let i = 0; i < 3; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        gc();
      }
    }

    /** Hanya WeakRef yang disimpan tes: tes sendiri tidak menahan utterance. */
    async function speakHoldingOnlyWeakRef() {
      let ref: WeakRef<NativeUtterance> | null = null;
      setup((u) => {
        ref = new WeakRef(u);
      });
      const { createBrowserAudio } = await freshBrowserModule();
      createBrowserAudio().speak([segment('intro:JP')]);
      await vi.waitFor(() => {
        expect(ref).not.toBeNull();
      });
      if (!ref) throw new Error('utterance tidak diucapkan');
      return ref as WeakRef<NativeUtterance>;
    }

    it('utterance yang sedang diucapkan tetap hidup walau di-GC, lalu onend masih terpanggil', async () => {
      const ref = await speakHoldingOnlyWeakRef();
      await collect();
      const alive = ref.deref();
      expect(alive, 'utterance dibuang GC saat masih bicara').toBeDefined();
      expect(typeof alive?.onend).toBe('function');
    });

    it.each(['onend', 'onerror'] as const)(
      'sesudah %s referensi dilepas (tidak bocor selamanya)',
      async (event) => {
        const ref = await speakHoldingOnlyWeakRef();
        ref.deref()?.[event]?.();
        await vi.waitFor(async () => {
          await collect();
          expect(ref.deref()).toBeUndefined();
        });
      },
    );
  });
});
