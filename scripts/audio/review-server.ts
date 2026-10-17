import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AudioManifestSchema, ClipId, type AudioManifest } from '../../src/content/schema';
import type { AppLocale } from '../../src/domain/locale';
import { MANIFEST_PATH, RAW_DIR } from './config';
import { buildInventory, loadInventorySource, type InventoryEntry } from './inventory';
import { loadReport, type PendingReport } from './report';
import { approveClip, rejectClip, ReviewError } from './review';
import { flagRank, type ScoreFlag } from './score';

const RAW_NAME = /^[A-Za-z0-9_-]{1,80}\.wav$/;
const RAW_PATH = /^(id|en)\/([A-Za-z0-9_-]{1,80}\.wav)$/;
/** Kartu tanpa take yang bisa dinilai (belum diperiksa atau semua ditolak) diurut paling akhir. */
const RANK_LAST = 99;

export interface ViewTake {
  file: string;
  take: number;
  flag: ScoreFlag | null;
  score: number | null;
  transcript: string | null;
  durationMs: number;
  generatedAt: string;
  approved: boolean;
  stale: boolean;
  rejected: string | null;
}

export interface ViewCard {
  id: string;
  text: string;
  takes: ViewTake[];
}

export interface ViewInput {
  report: PendingReport;
  manifest: AudioManifest;
  inventory: InventoryEntry[];
}

function cardRank(card: ViewCard): { rank: number; score: number } {
  const active = card.takes.filter((t) => t.rejected === null && t.flag !== null);
  if (active.length === 0) return { rank: RANK_LAST, score: 0 };
  let rank = RANK_LAST;
  let score = 1;
  for (const t of active) {
    if (t.flag !== null) rank = Math.min(rank, flagRank(t.flag));
    if (t.score !== null) score = Math.min(score, t.score);
  }
  return { rank, score };
}

/** Mengelompokkan take per id lalu mengurutkan: flag terburuk, skor terendah, id. */
export function toView({ report, manifest, inventory }: ViewInput): ViewCard[] {
  const hashes = new Map(inventory.map((e) => [e.id, e.textHash]));
  const approvedRaw = new Map(
    manifest.clips.filter((c) => c.locale === report.locale).map((c) => [c.id, c.raw]),
  );
  const byId = new Map<string, ViewCard>();
  for (const item of report.items) {
    const card = byId.get(item.id) ?? { id: item.id, text: item.text, takes: [] };
    card.takes.push({
      file: item.file,
      take: item.take,
      flag: item.whisper?.flag ?? null,
      score: item.whisper?.score ?? null,
      transcript: item.whisper?.transcript ?? null,
      durationMs: item.durationMs,
      generatedAt: item.generatedAt,
      approved: approvedRaw.get(item.id) === item.file,
      stale: hashes.get(item.id) !== item.textHash,
      rejected: item.rejected?.note ?? null,
    });
    byId.set(item.id, card);
  }
  const cards = [...byId.values()];
  for (const card of cards) card.takes.sort((a, b) => a.take - b.take);
  const keyed = cards.map((card) => ({ card, ...cardRank(card) }));
  keyed.sort(
    (a, b) =>
      a.rank - b.rank ||
      a.score - b.score ||
      (a.card.id < b.card.id ? -1 : a.card.id > b.card.id ? 1 : 0),
  );
  return keyed.map((k) => k.card);
}

function esc(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const FLAG_LABEL: Record<ScoreFlag, string> = {
  kosong: 'Kosong',
  bahasa: 'Bahasa beda',
  beda: 'Beda dari teks',
  periksa: 'Periksa',
  ok: 'Sesuai',
};

function renderTake(card: ViewCard, t: ViewTake, locale: AppLocale): string {
  const flag = t.flag === null ? 'Belum diperiksa' : FLAG_LABEL[t.flag];
  const flagClass = t.flag === null ? 'none' : t.flag;
  const badges = [
    `<span class="badge flag-${flagClass}">${esc(flag)}${t.score === null ? '' : ` ${t.score.toFixed(2)}`}</span>`,
    t.approved ? '<span class="badge approved">Disetujui</span>' : '',
    t.stale ? '<span class="badge stale">Basi: teks sudah berubah</span>' : '',
    t.rejected !== null ? '<span class="badge rejected">Ditolak</span>' : '',
  ].join('');
  const canApprove =
    t.rejected === null && t.flag !== null && t.flag !== 'kosong' && !t.stale && !t.approved;
  const who = `${card.id} take ${t.take}`;
  const attrs = `data-locale="${locale}" data-id="${esc(card.id)}" data-file="${esc(t.file)}"`;
  return `<div class="take">
  <h3>Take ${t.take}</h3>
  <p class="badges">${badges}</p>
  <p class="transcript"><span class="label">Transkrip</span> ${t.transcript === null ? 'belum ada' : esc(t.transcript)}</p>
  <p class="meta">${t.durationMs} ms, dibuat ${esc(t.generatedAt)}</p>
  ${t.rejected !== null ? `<p class="meta">Catatan: ${esc(t.rejected)}</p>` : ''}
  <audio controls preload="none" aria-label="Putar ${esc(who)}" src="/raw/${esc(t.file)}"></audio>
  <div class="actions">
    <button type="button" class="approve" data-act="approve" aria-label="Setujui ${esc(who)}" ${attrs}${canApprove ? '' : ' disabled'}>Setuju</button>
    <form class="reject" ${attrs}>
      <label>Catatan penolakan <input name="note" required autocomplete="off" aria-label="Catatan penolakan ${esc(who)}"></label>
      <button type="submit" aria-label="Tolak ${esc(who)}"${t.rejected === null ? '' : ' disabled'}>Tolak</button>
    </form>
  </div>
</div>`;
}

function renderPage(cards: ViewCard[], locale: AppLocale): string {
  const other: AppLocale = locale === 'id' ? 'en' : 'id';
  const body =
    cards.length === 0
      ? `<p>Belum ada laporan untuk locale ${locale}. Jalankan audio:generate dan audio:check dulu.</p>`
      : cards
          .map(
            (c) => `<article class="card" id="card-${esc(c.id)}">
  <h2>${esc(c.id)}</h2>
  <p class="text">${esc(c.text)}</p>
  <div class="takes">${c.takes.map((t) => renderTake(c, t, locale)).join('\n')}</div>
</article>`,
          )
          .join('\n');
  return `<!doctype html>
<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Tinjau audio (${locale})</title>
<style>
body{font-family:system-ui,sans-serif;font-size:16px;line-height:1.5;color:#1b1b1b;background:#f6f5f2;margin:0;padding:16px 24px}
h1{font-size:24px;margin:0 0 8px}
h2{font-size:20px;margin:0}
h3{font-size:16px;margin:0 0 4px}
nav{margin-bottom:16px}
a{color:#0b4f9c}
.card{background:#fff;border:1px solid #8a8a8a;border-radius:8px;padding:16px;margin-bottom:16px}
.text{font-size:18px;margin:4px 0 12px}
.takes{display:flex;flex-wrap:wrap;gap:16px}
.take{flex:1 1 300px;border:1px solid #c4c4c4;border-radius:6px;padding:12px}
p{margin:4px 0;overflow-wrap:anywhere}
.meta{font-size:14px;color:#454545}
.label{font-weight:600}
.badges{display:flex;flex-wrap:wrap;gap:6px}
.badge{display:inline-block;font-size:14px;font-weight:600;padding:2px 8px;border-radius:4px;border:1px solid #1b1b1b;background:#fff}
.flag-kosong,.flag-bahasa,.flag-beda{background:#ffe1de;border-color:#8f1d12;color:#5c0f08}
.flag-periksa{background:#fff0c2;border-color:#7a5a00;color:#4a3600}
.flag-ok{background:#dff3e0;border-color:#1f6b2a;color:#124019}
.approved{background:#1f6b2a;border-color:#1f6b2a;color:#fff}
.stale{background:#e8e8e8;border-color:#454545;color:#1b1b1b}
.rejected{background:#454545;border-color:#454545;color:#fff}
audio{width:100%;margin:8px 0}
.actions{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end}
.reject{display:flex;gap:8px;align-items:flex-end;flex:1 1 200px}
.reject label{display:flex;flex-direction:column;font-size:14px;flex:1}
input{font:inherit;padding:6px;border:1px solid #6b6b6b;border-radius:4px}
button{font:inherit;font-weight:600;padding:8px 16px;border:2px solid #1b1b1b;border-radius:6px;background:#fff;color:#1b1b1b;cursor:pointer}
button.approve:not(:disabled){background:#1f6b2a;border-color:#1f6b2a;color:#fff}
button:disabled{opacity:.5;cursor:not-allowed}
button:focus-visible,input:focus-visible,a:focus-visible{outline:3px solid #0b4f9c;outline-offset:2px}
#status{position:sticky;top:0;z-index:1;font-weight:600;background:#f6f5f2;padding:8px 0;margin:0 0 8px;border-bottom:1px solid #c4c4c4}
</style></head><body>
<h1>Tinjau audio (${locale})</h1>
<nav>Locale: <a href="/?loc=${other}">${other}</a></nav>
<p id="status" role="status"></p>
${body}
<script>
async function send(path, payload) {
  const s = document.getElementById('status');
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  const text = await res.text();
  if (res.ok) {
    s.textContent = 'Tersimpan. Memuat ulang...';
    location.hash = 'card-' + payload.id;
    setTimeout(() => location.reload(), 600);
    return;
  }
  s.textContent = 'Gagal (' + res.status + '): ' + text;
}
document.querySelectorAll('button[data-act="approve"]').forEach((b) => {
  b.addEventListener('click', () => send('/approve', { locale: b.dataset.locale, id: b.dataset.id, file: b.dataset.file }));
});
document.querySelectorAll('form.reject').forEach((f) => {
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    send('/reject', { locale: f.dataset.locale, id: f.dataset.id, file: f.dataset.file, note: f.elements.note.value });
  });
});
</script></body></html>`;
}

function text(body: string, status: number, type = 'text/plain; charset=utf-8'): Response {
  return new Response(body, { status, headers: { 'content-type': type } });
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isLocale(v: unknown): v is AppLocale {
  return v === 'id' || v === 'en';
}

export interface ReviewDeps {
  rawDir: string;
  manifestPath: string;
  reportPath: (locale: AppLocale) => string;
  inventory: (locale: AppLocale) => InventoryEntry[];
  now: () => Date;
}

function loadManifest(path: string): AudioManifest {
  if (!existsSync(path)) return { version: 1, clips: [] };
  return AudioManifestSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

function serveRaw(rawDir: string, pathname: string): Response {
  let rest: string;
  try {
    rest = decodeURIComponent(pathname.slice('/raw/'.length));
  } catch {
    return text('nama berkas tidak valid', 400);
  }
  const m = RAW_PATH.exec(rest);
  const loc = m?.[1];
  const name = m?.[2];
  if (!loc || !name || !RAW_NAME.test(name)) return text('nama berkas tidak valid', 400);
  const path = join(rawDir, loc, name);
  if (!existsSync(path)) return text('tidak ditemukan', 404);
  return new Response(new Uint8Array(readFileSync(path)), {
    headers: { 'content-type': 'audio/wav' },
  });
}

export function createHandler(port: number, deps: ReviewDeps): (req: Request) => Promise<Response> {
  const allowed = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
  const route = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    if (req.method === 'GET') {
      if (url.pathname === '/') {
        const requested = url.searchParams.get('loc');
        const locale: AppLocale = isLocale(requested) ? requested : 'id';
        const cards = toView({
          report: loadReport(deps.reportPath(locale), locale),
          manifest: loadManifest(deps.manifestPath),
          inventory: deps.inventory(locale),
        });
        return text(renderPage(cards, locale), 200, 'text/html; charset=utf-8');
      }
      if (url.pathname.startsWith('/raw/')) return serveRaw(deps.rawDir, url.pathname);
      return text('tidak ditemukan', 404);
    }
    if (req.method === 'POST' && (url.pathname === '/approve' || url.pathname === '/reject')) {
      const origin = req.headers.get('origin');
      if (!origin || !allowed.has(origin)) return text('origin ditolak', 403);
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return text('JSON tidak valid', 400);
      }
      if (
        !isRecord(body) ||
        !isLocale(body.locale) ||
        typeof body.id !== 'string' ||
        !ClipId.safeParse(body.id).success ||
        typeof body.file !== 'string'
      ) {
        return text('locale, id, atau file tidak valid', 400);
      }
      const { locale, id, file } = body;
      try {
        const common = {
          manifestPath: deps.manifestPath,
          reportPath: deps.reportPath(locale),
          locale,
          id,
          file,
          now: deps.now,
        };
        if (url.pathname === '/reject') {
          rejectClip({ ...common, note: typeof body.note === 'string' ? body.note : '' });
          return text('ok', 200);
        }
        const entry = deps.inventory(locale).find((e) => e.id === id);
        if (!entry) return text(`id ${id} tidak ada di inventaris`, 400);
        approveClip({ ...common, currentHash: entry.textHash });
        return text('ok', 200);
      } catch (err) {
        if (err instanceof ReviewError) return text(err.message, 400);
        return text(err instanceof Error ? err.message : 'gagal', 500);
      }
    }
    return text('tidak ditemukan', 404);
  };
  return async (req) => {
    try {
      return await route(req);
    } catch (err) {
      return text(
        `Terjadi kesalahan: ${err instanceof Error ? err.message : 'tidak diketahui'}`,
        500,
      );
    }
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = process.argv[2];
  const port = arg ? Number(arg) : 4322;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error('port tidak valid');
    process.exit(1);
  }
  const root = resolve(import.meta.dirname, '..', '..');
  const handler = createHandler(port, {
    rawDir: join(root, RAW_DIR),
    manifestPath: join(root, MANIFEST_PATH),
    reportPath: (locale) => join(root, '.tmp/audio', `report-${locale}.json`),
    inventory: (locale) => buildInventory(loadInventorySource(root), locale),
    now: () => new Date(),
  });
  createServer((incoming, outgoing) => {
    const chunks: Buffer[] = [];
    incoming.on('data', (c: Buffer) => chunks.push(c));
    incoming.on('end', () => {
      const headers = new Headers();
      for (const [k, v] of Object.entries(incoming.headers)) {
        if (typeof v === 'string') headers.set(k, v);
      }
      const method = incoming.method ?? 'GET';
      const hasBody = method !== 'GET' && method !== 'HEAD';
      const req = new Request(`http://127.0.0.1:${port}${incoming.url ?? '/'}`, {
        method,
        headers,
        body: hasBody ? Buffer.concat(chunks) : undefined,
      });
      void handler(req)
        .then(async (res) => {
          outgoing.writeHead(res.status, Object.fromEntries(res.headers));
          outgoing.end(Buffer.from(await res.arrayBuffer()));
        })
        .catch(() => {
          if (!outgoing.headersSent) {
            outgoing.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
          }
          outgoing.end('Terjadi kesalahan di server tinjau.');
        });
    });
  }).listen(port, '127.0.0.1', () => {
    console.log(`Halaman tinjau audio: http://127.0.0.1:${port}`);
  });
}
