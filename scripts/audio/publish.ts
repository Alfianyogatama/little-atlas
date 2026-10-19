import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { AudioSpriteMapSchema, type AudioSpriteMap } from '../../src/content/schema';
import { writeFileAtomic } from './atomic';

export interface PublishInput {
  /** Folder locale, mis. public/audio/id. */
  dir: string;
  files: readonly { name: string; bytes: Uint8Array }[];
  map: AudioSpriteMap;
}

/** Peta divalidasi dulu; MP3 lama baru dihapus setelah peta baru tertulis. */
export function publishSprites({ dir, files, map }: PublishInput): void {
  const parsed = AudioSpriteMapSchema.parse(map);
  mkdirSync(dir, { recursive: true });
  for (const file of files) writeFileAtomic(join(dir, file.name), file.bytes);
  writeFileAtomic(join(dir, 'sprites.json'), `${JSON.stringify(parsed, null, 2)}\n`);
  const referenced = new Set(Object.values(parsed.sprites).map((s) => s.src));
  for (const name of readdirSync(dir)) {
    if (name.endsWith('.mp3') && !referenced.has(name)) rmSync(join(dir, name), { force: true });
  }
}
