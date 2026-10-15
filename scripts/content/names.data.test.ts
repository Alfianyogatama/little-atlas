import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { NameOverridesSchema, UnMembersSchema } from '@/content/schema';
import { resolveNames } from './names';

const root = process.cwd();
const readJson = (p: string): unknown => JSON.parse(readFileSync(resolve(root, p), 'utf8'));
const territories = (lang: string): Record<string, string> => {
  const j = readJson(`node_modules/cldr-localenames-modern/main/${lang}/territories.json`) as {
    main: Record<string, { localeDisplayNames: { territories: Record<string, string> } }>;
  };
  return j.main[lang]?.localeDisplayNames.territories ?? {};
};

let cldrEn: Record<string, string>;
let names: ReturnType<typeof resolveNames>;
let codes: string[];

beforeAll(() => {
  const members = UnMembersSchema.parse(readJson('src/content/data/un-members.json'));
  codes = members.members.map((m) => m.alpha2);
  cldrEn = territories('en');
  names = resolveNames({
    cldrId: territories('id'),
    cldrEn,
    overrides: NameOverridesSchema.parse(readJson('src/content/data/name-overrides.json')),
    codes,
  });
});

describe('resolveNames dengan data nyata', () => {
  it('193 anggota PBB semua mendapat nama id dan en tanpa error', () => {
    expect(codes).toHaveLength(193);
    for (const c of codes) expect(names[c], c).toBeDefined();
  });

  it('nama spot-check sesuai keputusan pemilik', () => {
    expect(names['GB']?.id).toBe('Inggris');
    expect(names['CN']?.id).toBe('China');
    expect(names['CI']?.id).toBe('Pantai Gading');
    expect(names['SZ']?.id).toBe('Eswatini');
    expect(names['ST']?.id).toBe('São Tomé dan Príncipe');
    expect(names['CD']?.en).toBe('Democratic Republic of the Congo');
  });

  it('negara tanpa override memakai nilai CLDR apa adanya', () => {
    expect(names['TR']?.en).toBe(cldrEn['TR']);
  });
});
