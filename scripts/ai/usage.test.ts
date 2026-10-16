import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { LogEntry } from './client';
import { formatUsageSummary } from './usage';

const base: LogEntry = {
  at: '2026-10-16T00:00:00.000Z',
  role: 'image',
  model: 'm',
  cached: false,
  tokensIn: 0,
  tokensOut: 0,
  images: 0,
  estCostUsd: 0,
};

const log: LogEntry[] = [
  { ...base, role: 'image', tokensIn: 100, tokensOut: 1290, images: 1, estCostUsd: 0.039 },
  { ...base, role: 'image', cached: true, tokensIn: 100, tokensOut: 1290, images: 1 },
  { ...base, role: 'vision', tokensIn: 2000, tokensOut: 300, estCostUsd: 0.0032 },
  { ...base, role: 'vision', tokensIn: 500, tokensOut: 50 },
];

describe('formatUsageSummary', () => {
  it('mencantumkan total panggilan, cache hit, token, gambar, dan biaya', () => {
    const out = formatUsageSummary(log);
    expect(out).toMatch(/panggilan\D*4\b/i);
    expect(out).toMatch(/cache\D*1\b/i);
    expect(out).toMatch(/2[.,]?700/); // token masuk 100+100+2000+500
    expect(out).toMatch(/2[.,]?930/); // token keluar 1290+1290+300+50
    expect(out).toMatch(/gambar\D*2\b/i);
    expect(out).toMatch(/\$?0[.,]0422/); // 0.039 + 0.0032
  });

  it('memberi rincian per role image dan vision', () => {
    const lines = formatUsageSummary(log).split('\n');
    const image = lines.find((l) => /image/i.test(l));
    const vision = lines.find((l) => /vision/i.test(l));
    expect(image).toMatch(/\b2\b/);
    expect(image).toMatch(/0[.,]0390/);
    expect(vision).toMatch(/\b2\b/);
    expect(vision).toMatch(/0[.,]0032/);
  });

  it('tetap tercetak dengan angka nol saat log kosong', () => {
    const out = formatUsageSummary([]);
    expect(out.length).toBeGreaterThan(0);
    expect(out).toMatch(/panggilan\D*0\b/i);
    expect(out).toMatch(/cache\D*0\b/i);
    expect(out).toMatch(/gambar\D*0\b/i);
    expect(out).toMatch(/0[.,]0000/);
  });
});

describe('generate-cli mencetak ringkasan', () => {
  // generate-cli.ts menjalankan main() saat diimpor dan tidak mengekspor apa pun,
  // jadi mengimpornya akan menyentuh jaringan. Dites lewat sumbernya.
  const src = readFileSync('scripts/icons/generate-cli.ts', 'utf8');
  it('mengimpor formatUsageSummary dari ../ai/usage', () => {
    expect(src).toMatch(/import\s*\{[^}]*formatUsageSummary[^}]*\}\s*from\s*'\.\.\/ai\/usage'/);
  });
  it('mencetak formatUsageSummary(client.log) lewat console.log', () => {
    expect(src).toMatch(/console\.log\(\s*formatUsageSummary\(\s*client\.log\s*\)\s*\)/);
  });
});
