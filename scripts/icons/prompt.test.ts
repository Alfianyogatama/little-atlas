import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPrompt, styleHash } from './prompt';

const style = {
  version: 1,
  prompt: 'Flat sticker illustration, thick dark outline, bright flat colors.',
  avoid: ['text', 'letters', 'scary faces'],
  background: 'solid magenta #FF00FF',
};

describe('styleHash', () => {
  it('berupa 64 hex dan stabil untuk input sama', () => {
    expect(styleHash(style)).toMatch(/^[0-9a-f]{64}$/);
    expect(styleHash({ ...style })).toBe(styleHash(style));
  });
  it('urutan kunci tidak berpengaruh', () => {
    const reordered = {
      background: style.background,
      avoid: style.avoid,
      prompt: style.prompt,
      version: style.version,
    };
    expect(styleHash(reordered)).toBe(styleHash(style));
  });
  it('berubah bila prompt, avoid, background, atau version berubah', () => {
    const base = styleHash(style);
    expect(styleHash({ ...style, prompt: style.prompt + ' ' })).not.toBe(base);
    expect(styleHash({ ...style, avoid: ['text'] })).not.toBe(base);
    expect(styleHash({ ...style, background: 'white' })).not.toBe(base);
    expect(styleHash({ ...style, version: 2 })).not.toBe(base);
  });
  it('field di luar version, prompt, avoid, background tidak ikut di-hash', () => {
    const withExtra = { ...style, catatan: 'abaikan' };
    expect(styleHash(withExtra)).toBe(styleHash(style));
  });
});

describe('buildPrompt', () => {
  const input = { style, code: 'AU', labelEn: 'Kangaroo', countryEn: 'Australia' };
  it('memuat prompt gaya dan baris Subject', () => {
    const p = buildPrompt(input);
    expect(p).toContain(style.prompt);
    expect(p).toContain('Subject: Kangaroo, from Australia');
  });
  it('memuat hint bila ada, dan tidak bila tidak ada', () => {
    expect(buildPrompt({ ...input, hint: 'a cartoon kangaroo hopping' })).toContain(
      'a cartoon kangaroo hopping',
    );
    expect(buildPrompt(input)).not.toContain('undefined');
  });
  it('tidak membocorkan label Indonesia, fakta, atau data lain', () => {
    const rich = {
      ...input,
      labelId: 'Kanguru',
      countryId: 'Australia id',
      fact: { id: 'Di Australia ada kanguru.', en: 'Kangaroos live in Australia.' },
      emoji: 'KANGURU-EMOJI',
    };
    const p = buildPrompt(rich);
    expect(p).not.toContain('Kanguru');
    expect(p).not.toContain('Di Australia ada kanguru');
    expect(p).not.toContain('Kangaroos live in Australia');
    expect(p).not.toContain('KANGURU-EMOJI');
  });
});

describe('prompt untuk data nyata', () => {
  it('setiap kode di favorites.json dan AQ menghasilkan prompt non-kosong', () => {
    const read = (p: string): unknown =>
      JSON.parse(readFileSync(resolve(process.cwd(), p), 'utf8'));
    const stylePath = resolve(process.cwd(), 'scripts/icons/style.json');
    expect(existsSync(stylePath), 'scripts/icons/style.json belum ada').toBe(true);
    const realStyle = read('scripts/icons/style.json') as typeof style;
    const favorites = read('src/content/data/favorites.json') as {
      code: string;
      icon: { label: { en: string } };
    }[];
    const facts = read('src/content/data/continent-facts.json') as {
      AQ: { icon: { label: { en: string } } };
    };
    const countries = read('src/content/generated/countries.json') as {
      alpha2: string;
      name: { en: string };
    }[];
    const items = [
      ...favorites.map((f) => ({ code: f.code, labelEn: f.icon.label.en })),
      { code: 'AQ', labelEn: facts.AQ.icon.label.en },
    ];
    expect(items.length).toBeGreaterThanOrEqual(41);
    for (const it of items) {
      const country = countries.find((c) => c.alpha2 === it.code);
      expect(country, `negara ${it.code}`).toBeDefined();
      const p = buildPrompt({
        style: realStyle,
        code: it.code,
        labelEn: it.labelEn,
        countryEn: country?.name.en ?? '',
      });
      expect(p.trim().length, it.code).toBeGreaterThan(0);
      expect(p).toContain(it.labelEn);
    }
  });
});
