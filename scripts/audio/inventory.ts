import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ContinentFactsSchema,
  CountryCatalogSchema,
  FavoritesSchema,
  type ContinentFacts,
  type CountryCatalog,
  type Favorites,
} from '../../src/content/schema';
import { HOME_CODE } from '../../src/domain/explore';
import type { AppLocale } from '../../src/domain/locale';
import { buildFlagPool, CELEBRATE_EVERY, type PoolEntry } from '../../src/domain/quiz';
import {
  exploreClip,
  MAX_CELEBRATE_CLIP,
  quizClips,
  type ClipDeps,
} from '../../src/services/audio/segments';

/** Daftar klip yang harus ada di audio produksi, turunan murni dari data konten dan segments.ts. */

export type InventoryCategory = 'core' | 'celebrate' | 'fact' | 'intro' | 'quiz';

export interface InventoryEntry {
  id: string;
  locale: AppLocale;
  text: string;
  textHash: string;
  category: InventoryCategory;
  batch: 1 | 2 | 3;
  /** Hanya untuk kategori intro. */
  continent?: CountryCatalog[number]['continent'];
  /** Hanya untuk kategori quiz. */
  quizLevel?: 1 | 2;
}

export interface InventorySource {
  catalog: CountryCatalog;
  favorites: Favorites;
  continentFacts: ContinentFacts;
}

type SafeResult<T> = { success: true; data: T } | { success: false; error: { message: string } };

function readValidated<T>(path: string, schema: { safeParse(v: unknown): SafeResult<T> }): T {
  const parsed = schema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
  if (!parsed.success) {
    throw new Error(`${path} tidak lolos skema: ${parsed.error.message}`);
  }
  return parsed.data;
}

/** Membaca dan memvalidasi sumber konten dari `root`; melempar bila skema gagal. */
export function loadInventorySource(root: string): InventorySource {
  return {
    catalog: readValidated(
      join(root, 'src/content/generated/countries.json'),
      CountryCatalogSchema,
    ),
    favorites: readValidated(join(root, 'src/content/data/favorites.json'), FavoritesSchema),
    continentFacts: readValidated(
      join(root, 'src/content/data/continent-facts.json'),
      ContinentFactsSchema,
    ),
  };
}

/** sha256 hex huruf kecil dari utf8 teks yang dinormalisasi NFC. */
export function textHash(text: string): string {
  return createHash('sha256').update(text.normalize('NFC'), 'utf8').digest('hex');
}

function depsFor(src: InventorySource, locale: AppLocale): ClipDeps {
  const facts = new Map<string, { id: string; en: string }>();
  for (const f of src.favorites) facts.set(f.code, f.fact);
  for (const [code, v] of Object.entries(src.continentFacts)) facts.set(code, v.fact);
  return {
    locale,
    nameOf: (code) => src.catalog.find((c) => c.alpha2 === code)?.name[locale] ?? code,
    factText: (code, l) => facts.get(code)?.[l] ?? null,
  };
}

export function buildInventory(src: InventorySource, locale: AppLocale): InventoryEntry[] {
  const deps = depsFor(src, locale);
  const out = new Map<string, InventoryEntry>();

  const add = (
    clip: { id: string; text: string } | null | undefined,
    meta: Omit<InventoryEntry, 'id' | 'locale' | 'text' | 'textHash'>,
  ): void => {
    if (!clip) return;
    const prev = out.get(clip.id);
    if (prev) {
      if (prev.text !== clip.text) {
        throw new Error(
          `id klip "${clip.id}" punya dua teks berbeda: "${prev.text}" dan "${clip.text}"`,
        );
      }
      return;
    }
    out.set(clip.id, {
      id: clip.id,
      locale,
      text: clip.text,
      textHash: textHash(clip.text),
      ...meta,
    });
  };

  // Locale en seluruhnya batch 3; locale id dibagi per kategori di bawah.
  const batchOf = (idBatch: 1 | 2): 1 | 2 | 3 => (locale === 'en' ? 3 : idBatch);

  add(exploreClip({ kind: 'introHome' }, deps), { category: 'core', batch: batchOf(1) });
  add(exploreClip({ kind: 'ocean' }, deps), { category: 'core', batch: batchOf(1) });
  for (const variant of [0, 1, 2, 3]) {
    const [praise] = quizClips({ kind: 'praise', variant, code: HOME_CODE }, deps);
    add(praise, { category: 'core', batch: batchOf(1) });
  }
  add(quizClips({ kind: 'tryAgain' }, deps)[0], { category: 'core', batch: batchOf(1) });
  add(quizClips({ kind: 'celebrate', stars: MAX_CELEBRATE_CLIP + 1 }, deps)[0], {
    category: 'core',
    batch: batchOf(1),
  });

  for (let stars = CELEBRATE_EVERY; stars <= MAX_CELEBRATE_CLIP; stars += CELEBRATE_EVERY) {
    add(quizClips({ kind: 'celebrate', stars }, deps)[0], {
      category: 'celebrate',
      batch: batchOf(1),
    });
  }

  const factCodes = [...src.favorites.map((f) => f.code), ...Object.keys(src.continentFacts)];
  for (const code of factCodes) {
    add(exploreClip({ kind: 'fact', code }, deps), { category: 'fact', batch: batchOf(1) });
  }

  const factSet = new Set(factCodes);
  for (const c of src.catalog) {
    if (c.alpha2 === HOME_CODE) continue;
    add(exploreClip({ kind: 'intro', code: c.alpha2 }, deps), {
      category: 'intro',
      continent: c.continent,
      batch: batchOf(factSet.has(c.alpha2) ? 1 : 2),
    });
  }

  const entries: PoolEntry[] = src.catalog.map((c) => ({
    code: c.alpha2,
    kind: c.kind,
    hasFlag: c.hasFlag,
    favoriteLevel: c.favorite?.level ?? null,
  }));
  const level1 = buildFlagPool(entries, 1);
  const level1Set = new Set(level1);
  const level2 = buildFlagPool(entries, 2).filter((code) => !level1Set.has(code));
  const quizPools: [1 | 2, string[]][] = [
    [1, level1],
    [2, level2],
  ];
  for (const [quizLevel, pool] of quizPools) {
    for (const code of pool) {
      const meta = { category: 'quiz', quizLevel, batch: batchOf(quizLevel) } as const;
      add(quizClips({ kind: 'ask', code }, deps)[0], meta);
      add(quizClips({ kind: 'praise', variant: 0, code }, deps)[1], meta);
    }
  }

  return [...out.values()];
}
