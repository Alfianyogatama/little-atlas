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

describe('warna dari token: tidak ada literal hex di globe dan komponen ui', () => {
  const hexSnippets = [
    "export const c = '#ff8fab';",
    'export const c = "#FFF";',
    'export const c = `#2FA9DA`;',
    "export const c = '#2fa9daff';",
    "export const style = { color: '#abc' };",
  ];

  it.each(['src/globe/x.ts', 'src/globe/scene/x.tsx', 'src/ui/button.tsx'])(
    '%s menolak literal hex',
    async (file) => {
      for (const code of hexSnippets) {
        const rules = await lintRules(`${code}\n`, file);
        expect(rules, `${file}: ${code}`).toContain('no-restricted-syntax');
      }
    },
  );

  it('file tes dikecualikan', async () => {
    const rules = await lintRules("export const c = '#ff8fab';\n", 'src/globe/palette.test.ts');
    expect(rules).not.toContain('no-restricted-syntax');
  });

  it('kontrol positif: string non-warna dan variabel CSS lolos', async () => {
    const rules = await lintRules(
      "export const a = 'var(--ocean)';\nexport const b = 'item #12 dari 20';\nexport const c = '#nav';\n",
      'src/globe/x.ts',
    );
    expect(rules).not.toContain('no-restricted-syntax');
  });
});

describe('services boleh memakai fetch lewat injeksi (aturan features tidak berlaku)', () => {
  it('src/services/content tidak kena no-restricted-globals untuk fetch', async () => {
    const rules = await lintRules(
      "export const f = (fetchFn: typeof fetch) => fetchFn('/a');\nexport const g = fetch('/b');\n",
      'src/services/content/x.ts',
    );
    expect(rules).not.toContain('no-restricted-globals');
  });

  it('kontrol: fitur tetap dilarang memakai fetch', async () => {
    const rules = await lintRules("export const g = fetch('/b');\n", 'src/features/explore/x.ts');
    expect(rules).toContain('no-restricted-globals');
  });
});
