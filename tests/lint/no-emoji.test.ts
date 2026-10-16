import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const EMOJI = /\p{Extended_Pictographic}|\u{FE0F}|[\u{1F1E6}-\u{1F1FF}]/u;

function walk(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const isFixture = (rel: string): boolean => /(^|\/)(fixtures?|__fixtures__)\//.test(rel);
const isTest = (rel: string): boolean => /\.test\.(ts|tsx)$/.test(rel);

function targets(): string[] {
  const files = [
    ...walk(join(ROOT, 'src')).filter((f) => /\.(ts|tsx)$/.test(f)),
    ...walk(join(ROOT, 'messages')).filter((f) => f.endsWith('.json')),
    ...walk(join(ROOT, 'src/content')).filter((f) => f.endsWith('.json')),
  ];
  return [...new Set(files)]
    .map((f) => relative(ROOT, f))
    .filter((rel) => !isTest(rel) && !isFixture(rel))
    .sort();
}

describe('larangan emoji', () => {
  it('src, messages, dan data konten tidak memuat emoji', () => {
    const offenders: string[] = [];
    for (const rel of targets()) {
      const lines = readFileSync(join(ROOT, rel), 'utf8').split('\n');
      lines.forEach((line, i) => {
        const m = EMOJI.exec(line);
        if (m)
          offenders.push(`${rel}:${i + 1} memuat ${m[0]} (U+${m[0].codePointAt(0)?.toString(16)})`);
      });
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});
