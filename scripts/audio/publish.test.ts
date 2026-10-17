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
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AudioSpriteMapSchema, type AudioSpriteMap } from '../../src/content/schema';
import { publishSprites } from './publish';

// Kontrak tambahan yang ditetapkan tes ini (T10, issue #49; PLAN-49.md L2 `publish.ts`, L3):
// - `scripts/audio/publish.ts` mengekspor `publishSprites({ dir, files, map })` (sinkron atau async).
//   `dir` = folder locale (mis. public/audio/id); `files` = MP3 baru `{ name, bytes }`; `map` = peta baru.
// - Urutan: (1) `AudioSpriteMapSchema.parse(map)` lebih dulu; gagal -> melempar dan TIDAK ada yang ditulis
//   atau dihapus (peta lama, MP3 lama, daftar isi folder utuh). (2) tulis MP3 baru (temp + rename; nama berbasis
//   hash sehingga tidak menimpa berkas lain). (3) tulis `sprites.json` atomik: JSON 2 spasi + newline.
//   (4) baru kemudian hapus `*.mp3` di `dir` yang tidak dirujuk peta. Berkas bukan .mp3 tidak disentuh.
//   Bila langkah (3) gagal, MP3 lama belum dihapus.

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

function tmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'publish-'));
  roots.push(dir);
  return dir;
}

const OLD_SRC = 'core-1-aaaaaaaa.mp3';
const NEW_SRC = 'core-1-bbbbbbbb.mp3';
const OTHER_NEW_SRC = 'fact-1-cccccccc.mp3';
const OLD_BYTES = new Uint8Array([0xff, 0xfb, 1, 1, 1]);
const NEW_BYTES = new Uint8Array([0xff, 0xfb, 2, 2, 2, 2]);
const OTHER_BYTES = new Uint8Array([0xff, 0xfb, 3, 3, 3, 3, 3]);

function mapFor(
  sprites: Record<string, { src: string; bytes: number }>,
  locale: 'id' | 'en' = 'id',
): AudioSpriteMap {
  const out: AudioSpriteMap = { version: 1, locale, sprites: {}, clips: {} };
  for (const [key, s] of Object.entries(sprites)) {
    out.sprites[key] = { src: s.src, bytes: s.bytes, durationMs: 1000 };
    out.clips[key === 'core-1' ? 'introHome' : 'fact:ID'] = {
      sprite: key,
      startMs: 80,
      durationMs: 500,
    };
  }
  return out;
}

const OLD_MAP = mapFor({ 'core-1': { src: OLD_SRC, bytes: OLD_BYTES.length } });
const NEW_MAP = mapFor({
  'core-1': { src: NEW_SRC, bytes: NEW_BYTES.length },
  'fact-1': { src: OTHER_NEW_SRC, bytes: OTHER_BYTES.length },
});
const NEW_FILES = [
  { name: NEW_SRC, bytes: NEW_BYTES },
  { name: OTHER_NEW_SRC, bytes: OTHER_BYTES },
];

function seed(): string {
  const dir = join(tmpDir(), 'id');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, OLD_SRC), OLD_BYTES);
  writeFileSync(join(dir, 'sprites.json'), `${JSON.stringify(OLD_MAP, null, 2)}\n`);
  writeFileSync(join(dir, 'CATATAN.txt'), 'jangan disentuh');
  writeFileSync(join(dir, '.gitkeep'), '');
  return dir;
}

const listing = (dir: string): string[] => readdirSync(dir).sort();

describe('publishSprites (T10, issue #49)', () => {
  it('TC-AUD49-PUB-1: MP3 baru dan peta baru tertulis, MP3 lama dihapus, berkas non-mp3 utuh', async () => {
    const dir = seed();
    await publishSprites({ dir, files: NEW_FILES, map: NEW_MAP });

    expect(existsSync(join(dir, OLD_SRC))).toBe(false);
    expect(Buffer.from(readFileSync(join(dir, NEW_SRC))).equals(Buffer.from(NEW_BYTES))).toBe(true);
    expect(
      Buffer.from(readFileSync(join(dir, OTHER_NEW_SRC))).equals(Buffer.from(OTHER_BYTES)),
    ).toBe(true);

    const text = readFileSync(join(dir, 'sprites.json'), 'utf8');
    expect(text).toBe(`${JSON.stringify(NEW_MAP, null, 2)}\n`);
    expect(AudioSpriteMapSchema.safeParse(JSON.parse(text)).success).toBe(true);

    expect(readFileSync(join(dir, 'CATATAN.txt'), 'utf8')).toBe('jangan disentuh');
    expect(existsSync(join(dir, '.gitkeep'))).toBe(true);
    // Tanpa sisa berkas sementara.
    expect(listing(dir)).toEqual(
      ['.gitkeep', 'CATATAN.txt', OTHER_NEW_SRC, NEW_SRC, 'sprites.json'].sort(),
    );
  });

  it('TC-AUD49-PUB-1: MP3 yang masih dirujuk peta tidak dihapus', async () => {
    const dir = seed();
    // Peta baru tetap merujuk MP3 lama dan menambah satu sprite baru.
    const map = mapFor({
      'core-1': { src: OLD_SRC, bytes: OLD_BYTES.length },
      'fact-1': { src: OTHER_NEW_SRC, bytes: OTHER_BYTES.length },
    });
    await publishSprites({ dir, files: [{ name: OTHER_NEW_SRC, bytes: OTHER_BYTES }], map });
    expect(Buffer.from(readFileSync(join(dir, OLD_SRC))).equals(Buffer.from(OLD_BYTES))).toBe(true);
    expect(existsSync(join(dir, OTHER_NEW_SRC))).toBe(true);
  });

  it('TC-AUD49-PUB-1: MP3 lama baru dihapus setelah peta baru tertulis (kegagalan menulis peta tidak menghapus apa pun)', async () => {
    const dir = seed();
    // Bikin penulisan sprites.json gagal: jalur itu menjadi folder tak kosong.
    rmSync(join(dir, 'sprites.json'));
    mkdirSync(join(dir, 'sprites.json'));
    writeFileSync(join(dir, 'sprites.json', 'penghalang'), 'x');

    await expect(
      Promise.resolve().then(() => publishSprites({ dir, files: NEW_FILES, map: NEW_MAP })),
    ).rejects.toThrow();

    expect(existsSync(join(dir, OLD_SRC))).toBe(true);
    expect(Buffer.from(readFileSync(join(dir, OLD_SRC))).equals(Buffer.from(OLD_BYTES))).toBe(true);
    expect(readFileSync(join(dir, 'CATATAN.txt'), 'utf8')).toBe('jangan disentuh');
  });

  const invalidMaps: [string, (m: AudioSpriteMap) => AudioSpriteMap][] = [
    [
      'src bukan <grup>-<hash8>.mp3',
      (m) => {
        const c = structuredClone(m);
        const s = c.sprites['core-1'];
        if (s) s.src = 'core-1.mp3';
        return c;
      },
    ],
    [
      'klip melewati durasi sprite',
      (m) => {
        const c = structuredClone(m);
        const clip = c.clips['introHome'];
        if (clip) clip.durationMs = 5000;
        return c;
      },
    ],
    [
      'klip merujuk sprite yang tidak ada',
      (m) => {
        const c = structuredClone(m);
        const clip = c.clips['introHome'];
        if (clip) clip.sprite = 'tidak-ada';
        return c;
      },
    ],
  ];

  it.each(invalidMaps)(
    'TC-AUD49-PUB-2: peta tidak valid (%s) melempar dan tidak mengubah apa pun',
    async (_name, corrupt) => {
      const dir = seed();
      const before = listing(dir);
      const oldMapText = readFileSync(join(dir, 'sprites.json'), 'utf8');
      const oldMp3 = readFileSync(join(dir, OLD_SRC));

      const bad = corrupt(NEW_MAP);
      expect(AudioSpriteMapSchema.safeParse(bad).success).toBe(false);
      await expect(
        Promise.resolve().then(() => publishSprites({ dir, files: NEW_FILES, map: bad })),
      ).rejects.toThrow();

      expect(listing(dir)).toEqual(before);
      expect(readFileSync(join(dir, 'sprites.json'), 'utf8')).toBe(oldMapText);
      expect(Buffer.from(readFileSync(join(dir, OLD_SRC))).equals(Buffer.from(oldMp3))).toBe(true);
      expect(existsSync(join(dir, NEW_SRC))).toBe(false);
      expect(existsSync(join(dir, OTHER_NEW_SRC))).toBe(false);
    },
  );
});
