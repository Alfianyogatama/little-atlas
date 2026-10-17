import type { LogEntry } from './client';

const ROLES = ['image', 'vision', 'tts'] as const;

function sum(entries: LogEntry[], pick: (e: LogEntry) => number): number {
  return entries.reduce((n, e) => n + pick(e), 0);
}

function int(n: number): string {
  return n.toLocaleString('en-US');
}

function usd(n: number): string {
  return `$${n.toFixed(4)}`;
}

export function formatUsageSummary(log: LogEntry[]): string {
  const lines = [
    'Ringkasan pemakaian AI',
    `  Panggilan: ${int(log.length)}`,
    `  Cache hit: ${int(log.filter((e) => e.cached).length)}`,
    `  Token masuk: ${int(sum(log, (e) => e.tokensIn))}`,
    `  Token keluar: ${int(sum(log, (e) => e.tokensOut))}`,
    `  Gambar: ${int(sum(log, (e) => e.images))}`,
    `  Perkiraan biaya: ${usd(sum(log, (e) => e.estCostUsd))}`,
  ];
  for (const role of ROLES) {
    const rows = log.filter((e) => e.role === role);
    lines.push(`  ${role}: ${int(rows.length)} panggilan, ${usd(sum(rows, (e) => e.estCostUsd))}`);
  }
  return lines.join('\n');
}
