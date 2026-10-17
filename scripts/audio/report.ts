import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import type { AppLocale } from '../../src/domain/locale';
import { writeFileAtomic } from './atomic';

const Hex64 = z.string().regex(/^[0-9a-f]{64}$/, 'harus 64 karakter heksadesimal huruf kecil');

export const WhisperResultSchema = z.object({
  model: z.string().min(1),
  transcript: z.string(),
  language: z.string().min(1),
  languageProbability: z.number().min(0).max(1),
  score: z.number().min(0).max(1),
  flag: z.enum(['kosong', 'bahasa', 'beda', 'periksa', 'ok']),
});

export const PendingItemSchema = z.object({
  id: z.string().min(1),
  locale: z.enum(['id', 'en']),
  text: z.string().min(1),
  textHash: Hex64,
  take: z.number().int().min(1),
  file: z.string().regex(/^(?:id|en)\/[A-Za-z0-9_]+-[0-9a-f]{8}-\d+\.wav$/),
  model: z.string().min(1),
  voice: z.string().min(1),
  styleHash: Hex64,
  generatedAt: z.iso.datetime(),
  durationMs: z.number().int().positive(),
  whisper: WhisperResultSchema.nullable(),
  rejected: z.object({ note: z.string(), at: z.iso.datetime() }).nullable(),
});
export type PendingItem = z.infer<typeof PendingItemSchema>;

export const PendingReportSchema = z.object({
  version: z.literal(1),
  locale: z.enum(['id', 'en']),
  items: z.array(PendingItemSchema),
});
export type PendingReport = z.infer<typeof PendingReportSchema>;

/** Nama berkas mentah tanpa awalan locale: `<safeId>-<hash8>-<take>.wav`. */
export function rawFileName(id: string, textHash: string, take: number): string {
  return `${id.replaceAll(':', '_')}-${textHash.slice(0, 8)}-${take}.wav`;
}

/** Berkas tidak ada memberi laporan kosong; rusak, tidak sesuai skema, atau locale beda melempar. */
export function loadReport(path: string, locale: AppLocale): PendingReport {
  if (!existsSync(path)) return { version: 1, locale, items: [] };
  const report = PendingReportSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
  if (report.locale !== locale) {
    throw new Error(`${path} berlocale ${report.locale}, bukan ${locale}.`);
  }
  return report;
}

/**
 * Membaca ulang berkas dari disk lalu menggabungkan per `file`, supaya proses paralel (tinjauan, whisper,
 * generate) tidak saling menimpa. Item masuk menggantikan item disk; `rejected` atau `whisper` masuk
 * `null` tidak menghapus nilai disk. Menulis atomik dan mengembalikan laporan gabungan.
 */
export function upsertItem(path: string, report: PendingReport, item: PendingItem): PendingReport {
  const disk = loadReport(path, report.locale);
  const existing = disk.items.find((i) => i.file === item.file);
  const merged: PendingItem = existing
    ? {
        ...item,
        rejected: item.rejected ?? existing.rejected,
        whisper: item.whisper ?? existing.whisper,
      }
    : item;
  const items = existing
    ? disk.items.map((i) => (i.file === item.file ? merged : i))
    : [...disk.items, merged];
  const next = PendingReportSchema.parse({ ...disk, items });
  writeFileAtomic(path, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}
