import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadExploreContent } from '../../src/services/content/explore';

// Relokasi dari src/services/content/explore.test.ts: tsconfig.app tanpa tipe node.
interface Coded {
  code: string;
}

describe('berkas ikon Jelajah (T9, F-03.2)', () => {
  it('setiap Favorit dan AQ menunjuk berkas ikon yang ada di public/content/icons', () => {
    const favorites = JSON.parse(
      readFileSync(resolve('src/content/data/favorites.json'), 'utf8'),
    ) as Coded[];
    const codes = [...favorites.map((f) => f.code), 'AQ'];
    const c = loadExploreContent();
    for (const code of codes) {
      for (const locale of ['id', 'en'] as const) {
        const icon = c.iconFor(code, locale);
        expect(icon, code).not.toBeNull();
        expect(icon?.src).toBe(`/content/icons/${code.toLowerCase()}.webp`);
        expect(existsSync(resolve('public', (icon?.src ?? '').replace(/^\//, ''))), code).toBe(
          true,
        );
      }
    }
  });
});
