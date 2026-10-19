import type { AudioSpriteMap } from '../../src/content/schema';
import { GAP_MS, LEAD_MS, MAX_GROUP_MS, POST_MS, PRE_MS } from './config';

/** Sampel per milidetik pada 24 kHz. */
const PER_MS = 24;

export interface SpriteClipInput {
  id: string;
  category: 'core' | 'celebrate' | 'fact' | 'intro' | 'quiz';
  continent?: string;
  quizLevel?: 1 | 2;
  /** Jumlah sampel PCM 24 kHz setelah trim dan normalisasi. */
  samples: number;
}

export interface PlannedGroup {
  key: string;
  clips: SpriteClipInput[];
}

export interface ClipOffset {
  id: string;
  startSample: number;
  samples: number;
}

export interface GroupLayout {
  offsets: ClipOffset[];
  totalSamples: number;
  clips: Record<string, { startMs: number; durationMs: number }>;
  durationMs: number;
}

export interface BuiltGroup {
  key: string;
  src: string;
  bytes: number;
  layout: GroupLayout;
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const codeOf = (id: string): string => id.slice(id.indexOf(':') + 1);
const numberOf = (id: string): number => Number(codeOf(id));

/** ask:XX tepat sebelum praiseFlag:XX; urut kode negara. */
const quizOrder = (a: SpriteClipInput, b: SpriteClipInput): number =>
  compare(codeOf(a.id), codeOf(b.id)) || compare(a.id, b.id);

/** Greedy: klip masuk selama LEAD + sum(klip) + GAP * n <= MAX_GROUP_MS (inklusif, dalam sampel). */
function pack(prefix: string, clips: SpriteClipInput[]): PlannedGroup[] {
  const limit = MAX_GROUP_MS * PER_MS;
  const groups: PlannedGroup[] = [];
  let current: SpriteClipInput[] = [];
  let used = LEAD_MS * PER_MS;
  const flush = (): void => {
    if (current.length > 0) groups.push({ key: `${prefix}-${groups.length + 1}`, clips: current });
    current = [];
    used = LEAD_MS * PER_MS;
  };
  for (const clip of clips) {
    const cost = clip.samples + GAP_MS * PER_MS;
    if (current.length > 0 && used + cost > limit) flush();
    current.push(clip);
    used += cost;
  }
  flush();
  return groups;
}

/** Murni dan deterministik: urutan masukan tidak berpengaruh. */
export function planGroups(clips: readonly SpriteClipInput[]): PlannedGroup[] {
  const of = (category: SpriteClipInput['category']): SpriteClipInput[] =>
    clips.filter((c) => c.category === category);

  const plan: PlannedGroup[] = [];
  plan.push(
    ...pack(
      'core',
      of('core').sort((a, b) => compare(a.id, b.id)),
    ),
  );
  plan.push(
    ...pack(
      'celebrate',
      of('celebrate').sort((a, b) => numberOf(a.id) - numberOf(b.id)),
    ),
  );
  plan.push(
    ...pack(
      'fact',
      of('fact').sort((a, b) => compare(a.id, b.id)),
    ),
  );

  const intros = of('intro');
  const continents = [...new Set(intros.map((c) => c.continent))].sort((a, b) =>
    compare(a ?? '', b ?? ''),
  );
  for (const continent of continents) {
    if (!continent) throw new Error('klip intro tanpa benua');
    const group = intros.filter((c) => c.continent === continent);
    plan.push(
      ...pack(
        `intro-${continent}`,
        group.sort((a, b) => compare(a.id, b.id)),
      ),
    );
  }

  const quizzes = of('quiz');
  for (const level of [1, 2] as const) {
    plan.push(
      ...pack(`quiz-${level}`, quizzes.filter((c) => c.quizLevel === level).sort(quizOrder)),
    );
  }
  return plan;
}

/** Lead, klip, jeda, ..., klip, ekor (dalam sampel); jendela klip dalam ms bulat. */
export function layoutGroup(clips: readonly SpriteClipInput[]): GroupLayout {
  const gap = GAP_MS * PER_MS;
  let cursor = LEAD_MS * PER_MS;
  const offsets: ClipOffset[] = [];
  const windows: GroupLayout['clips'] = {};
  for (const clip of clips) {
    offsets.push({ id: clip.id, startSample: cursor, samples: clip.samples });
    windows[clip.id] = {
      startMs: Math.floor(cursor / PER_MS) - PRE_MS,
      durationMs: Math.ceil(clip.samples / PER_MS) + PRE_MS + POST_MS,
    };
    cursor += clip.samples + gap;
  }
  return {
    offsets,
    totalSamples: cursor,
    clips: windows,
    durationMs: Math.floor(cursor / PER_MS),
  };
}

export function buildMap(
  locale: AudioSpriteMap['locale'],
  groups: readonly BuiltGroup[],
): AudioSpriteMap {
  const sprites: AudioSpriteMap['sprites'] = {};
  const clips: AudioSpriteMap['clips'] = {};
  for (const group of groups) {
    sprites[group.key] = {
      src: group.src,
      bytes: group.bytes,
      durationMs: group.layout.durationMs,
    };
    for (const [id, window] of Object.entries(group.layout.clips)) {
      clips[id] = { sprite: group.key, ...window };
    }
  }
  return { version: 1, locale, sprites, clips };
}
