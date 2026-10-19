import { join } from 'node:path';
import { ApiError } from '../ai/client';
import type { ModelRole } from '../ai/models';
import type { AppLocale } from '../../src/domain/locale';
import { writeFileAtomic } from './atomic';
import type { InventoryEntry } from './inventory';
import { classifyQuota, quotaDetail } from './quota';
import { loadReport, rawFileName, upsertItem, type PendingItem } from './report';
import { buildTtsPayload, extractPcm, pcmToWav } from './tts';
import { assertVoiceConfigured, styleHash, type Voice } from './voice';

export interface GenerateOptions {
  locale: AppLocale;
  entries: InventoryEntry[];
  /** Jumlah take untuk kategori core dan celebrate; kategori lain selalu 1. */
  takes: number;
  dryRun: boolean;
  rawDir: string;
  reportPath: string;
  approved: (id: string, textHash: string) => boolean;
  client: {
    request: (
      role: ModelRole,
      payload: Record<string, unknown>,
      opts?: { cacheTag?: string },
    ) => Promise<unknown>;
  };
  models: {
    assertConfigured: (role: ModelRole) => void;
    model: string;
    seed: boolean;
  };
  voice: Pick<Voice, 'voice' | 'promptMode' | 'style'>;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  delayMs: number;
  log: (line: string) => void;
}

export interface GenerateResult {
  done: number;
  skipped: number;
  total: number;
  stopped: null | 'rpd' | 'free_tier';
  /** Ringkasan satu baris error kuota saat berhenti; null bila tidak berhenti. */
  stopDetail: string | null;
}

const MULTI_TAKE = new Set<InventoryEntry['category']>(['core', 'celebrate']);

/** Membuat klip mentah per entri inventaris; laporan dan WAV ditulis segera setelah tiap respons. */
export async function runGenerate(opts: GenerateOptions): Promise<GenerateResult> {
  const { locale, entries, dryRun } = opts;
  const total = entries.length;
  if (!dryRun) {
    opts.models.assertConfigured('tts');
    assertVoiceConfigured(opts.voice);
  }

  let report = loadReport(opts.reportPath, locale);
  const hash = styleHash(opts.voice, locale);
  let done = 0;
  let skipped = 0;
  let planned = 0;
  let requests = 0;

  for (const entry of entries) {
    if (opts.approved(entry.id, entry.textHash)) {
      skipped += 1;
      continue;
    }
    const target = MULTI_TAKE.has(entry.category) ? opts.takes : 1;
    const same = (): PendingItem[] =>
      report.items.filter((i) => i.id === entry.id && i.textHash === entry.textHash);
    const missing = target - same().filter((i) => i.rejected === null).length;
    if (missing <= 0) {
      skipped += 1;
      continue;
    }

    for (let k = 0; k < missing; k += 1) {
      // Laporan baru bertambah setelah tiap klip sungguhan; dry-run tidak menulis, jadi k yang menaikkan nomor.
      const take = Math.max(0, ...same().map((i) => i.take)) + (dryRun ? k : 0) + 1;
      const name = rawFileName(entry.id, entry.textHash, take);
      if (dryRun) {
        planned += 1;
        opts.log(`dry-run ${entry.id} -> ${locale}/${name} (${opts.voice.voice}): ${entry.text}`);
        continue;
      }

      if (requests > 0) await opts.sleep(opts.delayMs);
      requests += 1;
      let pcm: Uint8Array;
      let rate: number;
      try {
        const response = await opts.client.request(
          'tts',
          buildTtsPayload({
            text: entry.text,
            locale,
            voice: opts.voice.voice,
            style: opts.voice.style[locale],
            promptMode: opts.voice.promptMode,
            ...(opts.models.seed ? { seed: take } : {}),
          }),
          { cacheTag: `take-${take}` },
        );
        ({ pcm, rate } = extractPcm(response));
        if (pcm.length < 2) throw new Error('Penyedia mengembalikan audio kosong.');
      } catch (err) {
        if (err instanceof ApiError) {
          const kind = classifyQuota(err.status, err.body);
          if (kind === 'rpd' || kind === 'free_tier') {
            return { done, skipped, total, stopped: kind, stopDetail: quotaDetail(err.body) };
          }
        }
        opts.log(`Gagal ${entry.id}: ${err instanceof Error ? err.message : String(err)}`);
        break;
      }

      writeFileAtomic(join(opts.rawDir, locale, name), pcmToWav(pcm, rate));
      report = upsertItem(opts.reportPath, report, {
        id: entry.id,
        locale,
        text: entry.text,
        textHash: entry.textHash,
        take,
        file: `${locale}/${name}`,
        model: opts.models.model,
        voice: opts.voice.voice,
        styleHash: hash,
        generatedAt: opts.now().toISOString(),
        durationMs: Math.max(1, Math.round((pcm.length / 2 / rate) * 1000)),
        whisper: null,
        rejected: null,
      });
      done += 1;
      opts.log(`${entry.id} take ${take} selesai (${locale}/${name})`);
    }
  }

  if (dryRun) opts.log(`Dry-run: ${planned} klip akan dibuat, ${skipped} entri dilewati.`);
  return { done, skipped, total, stopped: null, stopDetail: null };
}
