import { existsSync, readFileSync } from 'node:fs';
import { AudioManifestSchema, type AudioManifest } from '../../src/content/schema';
import type { AppLocale } from '../../src/domain/locale';
import { writeFileAtomic } from './atomic';
import { loadReport, upsertItem, type PendingItem } from './report';

/** Kesalahan yang bisa dibaca pemilik di halaman tinjau (pesan Indonesia). */
export class ReviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReviewError';
  }
}

export interface ApproveOptions {
  manifestPath: string;
  /** Laporan pending untuk `locale`. */
  reportPath: string;
  locale: AppLocale;
  id: string;
  file: string;
  /** textHash inventaris terkini untuk `id`. */
  currentHash: string;
  now: () => Date;
}

export interface RejectOptions {
  manifestPath: string;
  reportPath: string;
  locale: AppLocale;
  id: string;
  file: string;
  note: string;
  now: () => Date;
}

function readManifest(path: string): AudioManifest {
  if (!existsSync(path)) return { version: 1, clips: [] };
  return AudioManifestSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

function writeManifest(path: string, manifest: AudioManifest): AudioManifest {
  const clips = [...manifest.clips].sort((a, b) =>
    a.locale === b.locale ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.locale < b.locale ? -1 : 1,
  );
  const next = AudioManifestSchema.parse({ ...manifest, clips });
  writeFileAtomic(path, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

function findItem(
  reportPath: string,
  locale: AppLocale,
  id: string,
  file: string,
): { report: ReturnType<typeof loadReport>; item: PendingItem } {
  const report = loadReport(reportPath, locale);
  const item = report.items.find((i) => i.file === file);
  if (!item || item.id !== id || item.locale !== locale) {
    throw new ReviewError(`Berkas ${file} tidak ada di laporan untuk ${id}.`);
  }
  return { report, item };
}

/** Menyetujui satu take: menggantikan entri (locale, id) di manifest. Gagal tanpa mengubah manifest. */
export function approveClip(opts: ApproveOptions): AudioManifest {
  const { item } = findItem(opts.reportPath, opts.locale, opts.id, opts.file);
  if (item.rejected !== null) {
    throw new ReviewError(`Take ${item.file} sudah ditolak.`);
  }
  if (item.whisper === null) {
    throw new ReviewError(`Take ${item.file} belum diperiksa Whisper: jalankan audio:check dulu.`);
  }
  if (item.whisper.flag === 'kosong') {
    throw new ReviewError(`Take ${item.file} kosong (tanpa suara terbaca): tidak bisa disetujui.`);
  }
  if (item.textHash !== opts.currentHash) {
    throw new ReviewError(
      `Berkas ${item.file} basi: teks sudah berubah sejak dibuat, buat ulang klipnya.`,
    );
  }
  const manifest = readManifest(opts.manifestPath);
  const previous = manifest.clips.find((c) => c.locale === opts.locale && c.id === opts.id);
  const { model, transcript, score, flag } = item.whisper;
  const clip = {
    id: item.id,
    locale: item.locale,
    text: item.text,
    textHash: item.textHash,
    attempt: (previous?.attempt ?? 0) + 1,
    raw: item.file,
    model: item.model,
    voice: item.voice,
    styleHash: item.styleHash,
    take: item.take,
    generatedAt: item.generatedAt,
    whisper: { model, transcript, score, flag },
    durationMs: item.durationMs,
    reviewedAt: opts.now().toISOString(),
  };
  const rest = manifest.clips.filter((c) => !(c.locale === opts.locale && c.id === opts.id));
  return writeManifest(opts.manifestPath, { ...manifest, clips: [...rest, clip] });
}

/** Menolak satu take dengan catatan. Bila take itu sedang disetujui, entri manifest dihapus. */
export function rejectClip(opts: RejectOptions): void {
  const note = opts.note.trim();
  if (!note) throw new ReviewError('Catatan penolakan wajib diisi.');
  const { report, item } = findItem(opts.reportPath, opts.locale, opts.id, opts.file);
  const manifest = readManifest(opts.manifestPath);
  const approved = manifest.clips.find(
    (c) => c.locale === opts.locale && c.id === opts.id && c.raw === opts.file,
  );
  if (approved) {
    writeManifest(opts.manifestPath, {
      ...manifest,
      clips: manifest.clips.filter((c) => c !== approved),
    });
  }
  upsertItem(opts.reportPath, report, {
    ...item,
    rejected: { note, at: opts.now().toISOString() },
  });
}
