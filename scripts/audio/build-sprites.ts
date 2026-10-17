import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { AudioManifest, AudioSpriteMap } from '../../src/content/schema';
import type { AppLocale } from '../../src/domain/locale';
import { encodeArgs, measureArgs, normalizeArgs, parseLoudnorm, type FfmpegRunner } from './ffmpeg';
import type { InventoryEntry } from './inventory';
import { buildMap, layoutGroup, planGroups, type BuiltGroup, type SpriteClipInput } from './sprite';

export interface BuildSpritesInput {
  locale: AppLocale;
  manifest: AudioManifest;
  inventory: readonly InventoryEntry[];
  /** Folder berkas mentah; `raw` di manifest relatif terhadapnya. */
  rawDir: string;
  ffmpeg: FfmpegRunner;
  log: (line: string) => void;
}

export interface SpriteFile {
  name: string;
  bytes: Uint8Array;
}

export interface BuildSpritesResult {
  files: SpriteFile[];
  map: AudioSpriteMap | null;
  skipped: string[];
}

async function runStage(
  ffmpeg: FfmpegRunner,
  stage: string,
  id: string,
  args: string[],
  stdin?: Uint8Array,
): Promise<{ stdout: Uint8Array; stderr: string }> {
  const result = await ffmpeg(args, stdin);
  if (result.code !== 0) {
    throw new Error(`ffmpeg ${stage} gagal untuk ${id} (exit ${result.code}): ${result.stderr}`);
  }
  return result;
}

/** Ukur, normalisasi, rangkai, dan enkode klip yang disetujui menjadi sprite MP3 per grup. */
export async function buildSprites(input: BuildSpritesInput): Promise<BuildSpritesResult> {
  const { locale, manifest, inventory, rawDir, ffmpeg, log } = input;
  const byId = new Map(inventory.map((entry) => [entry.id, entry]));

  const skipped: string[] = [];
  const eligible: { entry: InventoryEntry; raw: string }[] = [];
  for (const clip of manifest.clips) {
    if (clip.locale !== locale) continue;
    const entry = byId.get(clip.id);
    if (!entry) {
      skipped.push(clip.id);
      log(`dilewati ${clip.id}: tidak ada di inventaris`);
    } else if (entry.textHash !== clip.textHash) {
      skipped.push(clip.id);
      log(`dilewati ${clip.id}: teks berubah sejak klip dibuat`);
    } else {
      eligible.push({ entry, raw: clip.raw });
    }
  }
  if (eligible.length === 0) return { files: [], map: null, skipped };

  const pcmById = new Map<string, Uint8Array>();
  const inputs: SpriteClipInput[] = [];
  for (const { entry, raw } of eligible) {
    const path = join(rawDir, raw);
    let pcm: Uint8Array;
    try {
      const measured = await runStage(ffmpeg, 'measure', entry.id, measureArgs(path));
      const { inputI } = parseLoudnorm(measured.stderr);
      const normalized = await runStage(ffmpeg, 'normalize', entry.id, normalizeArgs(path, inputI));
      pcm = normalized.stdout;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${entry.id} (${raw}): ${message}`, { cause: error });
    }
    const samples = Math.floor(pcm.length / 2);
    if (samples === 0) throw new Error(`klip ${entry.id} kosong setelah dipangkas`);
    pcmById.set(entry.id, pcm);
    inputs.push({
      id: entry.id,
      category: entry.category,
      ...(entry.continent !== undefined ? { continent: entry.continent } : {}),
      ...(entry.quizLevel !== undefined ? { quizLevel: entry.quizLevel } : {}),
      samples,
    });
  }

  const files: SpriteFile[] = [];
  const built: BuiltGroup[] = [];
  for (const group of planGroups(inputs)) {
    const layout = layoutGroup(group.clips);
    const pcm = new Uint8Array(layout.totalSamples * 2);
    for (const offset of layout.offsets) {
      const clipPcm = pcmById.get(offset.id);
      if (!clipPcm) throw new Error(`PCM klip ${offset.id} hilang`);
      pcm.set(clipPcm.subarray(0, offset.samples * 2), offset.startSample * 2);
    }
    const encoded = await runStage(ffmpeg, 'encode', group.key, encodeArgs(), pcm);
    const mp3 = encoded.stdout;
    const hash = createHash('sha256').update(mp3).digest('hex').slice(0, 8);
    const name = `${group.key}-${hash}.mp3`;
    files.push({ name, bytes: mp3 });
    built.push({ key: group.key, src: name, bytes: mp3.length, layout });
  }

  return { files, map: buildMap(locale, built), skipped };
}
