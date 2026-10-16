import { resolve } from 'node:path';
import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const eslint = new ESLint({ cwd: root });

// Biaya inisialisasi ESLint (parser + config) ditanggung hook, bukan tes pertama.
beforeAll(async () => {
  await eslint.lintText('export {};\n', { filePath: resolve(root, 'src/domain/warmup.ts') });
});

async function lintRules(code: string, relPath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: resolve(root, relPath) });
  return (result?.messages ?? []).map((m) => m.ruleId ?? `fatal:${m.message}`);
}

describe('batas modul: src/domain', () => {
  const imports = [
    'react',
    'three',
    '@react-three/fiber',
    'dexie',
    'howler',
    '@/services/audio',
    '../features/explore/x',
    '@/ui/button',
    '@/globe/x',
    '@/app/x',
    '@inlang/paraglide-js',
    '@/paraglide/messages',
    '../paraglide/runtime',
  ];
  it.each(imports)('domain tidak boleh mengimpor %s', async (spec) => {
    const rules = await lintRules(
      `import * as m from '${spec}';\nexport const v = m;\n`,
      'src/domain/x.ts',
    );
    expect(rules).toContain('no-restricted-imports');
  });

  it.each([
    ["export const a = fetch('/a');", 'fetch'],
    ["export const a = indexedDB.open('a');", 'indexedDB'],
    ['export const a = window.location;', 'window'],
    ['export const a = document.title;', 'document'],
    ['export const a = new AudioContext();', 'AudioContext'],
  ])('domain tidak boleh memakai global browser: %s', async (code) => {
    const rules = await lintRules(`${code}\n`, 'src/domain/x.ts');
    expect(rules).toContain('no-restricted-globals');
  });

  it.each(['@/services', '../services', '@/ui', '@/features', '@/globe', '@/app'])(
    'domain tidak boleh mengimpor barrel %s',
    async (spec) => {
      const rules = await lintRules(
        `import * as m from '${spec}';\nexport const v = m;\n`,
        'src/domain/x.ts',
      );
      expect(rules).toContain('no-restricted-imports');
    },
  );

  it('domain tidak boleh memakai import() dinamis', async () => {
    const rules = await lintRules("export const m = import('react');\n", 'src/domain/x.ts');
    expect(rules).toContain('no-restricted-syntax');
  });

  it('domain boleh mengimpor subfolder domain ./level/rules', async () => {
    const rules = await lintRules(
      `import { r } from './level/rules';\nexport const v = r;\n`,
      'src/domain/x.ts',
    );
    expect(rules).not.toContain('no-restricted-imports');
    expect(rules).not.toContain('no-restricted-syntax');
    expect(rules).not.toContain('no-restricted-globals');
  });

  it('domain boleh mengimpor ./rules', async () => {
    const rules = await lintRules(
      `import { r } from './rules';\nexport const v = r;\n`,
      'src/domain/x.ts',
    );
    expect(rules).not.toContain('no-restricted-imports');
    expect(rules).not.toContain('no-restricted-globals');
  });
});

describe('batas modul: src/features', () => {
  it.each(['dexie', 'howler'])('fitur tidak boleh mengimpor %s', async (spec) => {
    const rules = await lintRules(
      `import * as m from '${spec}';\nexport const v = m;\n`,
      'src/features/explore/x.ts',
    );
    expect(rules).toContain('no-restricted-imports');
  });

  it.each([
    "export const a = indexedDB.open('a');",
    'export const a = new AudioContext();',
    "export const a = fetch('/a');",
    "export const a = localStorage.getItem('a');",
    "export const a = sessionStorage.getItem('a');",
    "export const a = new Audio('/a.mp3');",
    "export const a = new WebSocket('ws://a');",
    'export const a = speechSynthesis.cancel();',
  ])('fitur tidak boleh memakai global: %s', async (code) => {
    const rules = await lintRules(`${code}\n`, 'src/features/explore/x.ts');
    expect(rules).toContain('no-restricted-globals');
  });

  it.each([
    "export const a = window.fetch('/a');",
    "export const a = window.localStorage.getItem('a');",
    "export const a = self.fetch('/a');",
    'export const a = globalThis.speechSynthesis.cancel();',
  ])('fitur tidak boleh memakai properti global: %s', async (code) => {
    const rules = await lintRules(`${code}\n`, 'src/features/explore/x.ts');
    expect(rules).toContain('no-restricted-properties');
  });

  it('fitur boleh import() dinamis dari services', async () => {
    const rules = await lintRules(
      "export const p = import('@/services/storage');\n",
      'src/features/explore/x.ts',
    );
    expect(rules).not.toContain('no-restricted-imports');
    expect(rules).not.toContain('no-restricted-syntax');
  });

  it('fitur boleh mengimpor domain dan services lewat alias', async () => {
    const rules = await lintRules(
      `import { q } from '@/domain/quiz';\nimport { a } from '@/services/audio';\nexport const v = [q, a];\n`,
      'src/features/explore/x.ts',
    );
    expect(rules).not.toContain('no-restricted-imports');
    expect(rules).not.toContain('no-restricted-globals');
    expect(rules).not.toContain('no-restricted-properties');
  });
});

describe('batas modul: data peta tidak boleh dibundel (ADR-006)', () => {
  it.each([
    ['src/app/x.ts', '../../public/content/map.json'],
    ['src/globe/x.ts', '../../public/content/grid.json'],
    ['src/features/explore/x.ts', '../../../public/content/map.json'],
    ['src/globe/x.ts', '@/../public/content/map.json'],
    ['src/app/x.ts', '@/../public/x'],
  ])('%s tidak boleh mengimpor %s', async (file, spec) => {
    const rules = await lintRules(`import m from '${spec}';\nexport const v = m;\n`, file);
    expect(rules).toContain('no-restricted-imports');
  });
});

describe('konvensi kode', () => {
  it('melarang any', async () => {
    const rules = await lintRules('export const a: any = 1;\n', 'src/app/x.ts');
    expect(rules).toContain('@typescript-eslint/no-explicit-any');
  });

  it('melarang @ts-ignore', async () => {
    const rules = await lintRules('// @ts-ignore\nexport const a: number = "x";\n', 'src/app/x.ts');
    expect(rules).toContain('@typescript-eslint/ban-ts-comment');
  });
});
