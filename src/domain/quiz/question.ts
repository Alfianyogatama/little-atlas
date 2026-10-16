import { shuffle, type Rng } from './rng';

export interface PoolEntry {
  code: string;
  kind: 'country' | 'continent';
  hasFlag: boolean;
  favoriteLevel: 1 | 2 | null;
}

export interface QuizConfig {
  readonly maxFavoriteLevel: 1 | 2;
  readonly choiceCount: number;
}

export interface Question {
  readonly target: string;
  readonly choices: readonly string[];
}

/** Kesalahan konfigurasi untuk developer, bukan teks untuk anak. */
export class QuizConfigError extends Error {
  readonly kind: 'pool-too-small' | 'choice-count-invalid';

  constructor(kind: 'pool-too-small' | 'choice-count-invalid', message: string) {
    super(message);
    this.name = 'QuizConfigError';
    this.kind = kind;
  }
}

/** Kode negara berbendera dengan level Favorit <= maxLevel; unik dan urut kode. */
export function buildFlagPool(entries: readonly PoolEntry[], maxLevel: 1 | 2): string[] {
  const codes = new Set<string>();
  for (const e of entries) {
    if (
      e.kind === 'country' &&
      e.hasFlag &&
      e.favoriteLevel !== null &&
      e.favoriteLevel <= maxLevel
    ) {
      codes.add(e.code);
    }
  }
  return [...codes].sort();
}

export function createQuestion(
  pool: readonly string[],
  choiceCount: number,
  previousTarget: string | null,
  rng: Rng,
): Question {
  if (!Number.isInteger(choiceCount) || choiceCount < 2) {
    throw new QuizConfigError(
      'choice-count-invalid',
      `choiceCount harus bilangan bulat >= 2, diterima ${choiceCount}`,
    );
  }
  const unique = [...new Set(pool)];
  if (unique.length < choiceCount) {
    throw new QuizConfigError(
      'pool-too-small',
      `kolam bendera berisi ${unique.length} kode unik, butuh minimal ${choiceCount}`,
    );
  }
  const candidates = unique.filter((c) => c !== previousTarget);
  const target = candidates[Math.min(candidates.length - 1, Math.floor(rng() * candidates.length))];
  if (target === undefined) {
    throw new QuizConfigError('pool-too-small', 'tidak ada kandidat target di kolam bendera');
  }
  const decoys = shuffle(
    unique.filter((c) => c !== target),
    rng,
  ).slice(0, choiceCount - 1);
  return { target, choices: shuffle([target, ...decoys], rng) };
}
