import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');

function readJson(rel: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(root, rel), 'utf8')) as Record<string, unknown>;
}

function entries(rel: string): [string, unknown][] {
  return Object.entries(readJson(rel)).filter(([key]) => key !== '$schema');
}

const files = ['messages/id.json', 'messages/en.json'] as const;

describe('katalog pesan (F-06.3)', () => {
  it('set kunci id dan en identik', () => {
    const id = entries(files[0])
      .map(([k]) => k)
      .sort();
    const en = entries(files[1])
      .map(([k]) => k)
      .sort();
    expect(en).toEqual(id);
  });

  it.each(files)('%s: semua nilai string tidak kosong', (file) => {
    for (const [key, value] of entries(file)) {
      expect(typeof value, `${file}:${key}`).toBe('string');
      expect((value as string).trim(), `${file}:${key}`).not.toBe('');
    }
  });

  it.each(files)('%s: semua kunci snake_case', (file) => {
    for (const [key] of entries(file)) {
      expect(key).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });
});

describe('project.inlang/settings.json', () => {
  it('memuat baseLocale id dan locales id, en', () => {
    const settings = readJson('project.inlang/settings.json');
    expect(settings.baseLocale).toBe('id');
    expect(settings.locales).toEqual(['id', 'en']);
  });

  it('modul plugin lokal, tidak dimulai dengan http', () => {
    const settings = readJson('project.inlang/settings.json');
    const modules = settings.modules;
    expect(Array.isArray(modules)).toBe(true);
    expect((modules as unknown[]).length).toBeGreaterThan(0);
    for (const mod of modules as unknown[]) {
      expect(typeof mod).toBe('string');
      expect((mod as string).toLowerCase().startsWith('http')).toBe(false);
    }
  });
});
