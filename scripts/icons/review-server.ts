import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Report } from './generate';
import { styleHash, type StyleSpec } from './prompt';
import { approve, reject } from './review';

const HERE = import.meta.dirname;
const ROOT = resolve(HERE, '..', '..');
const WORK_DIR = join(ROOT, '.tmp/icons/out');
const REPORT_PATH = join(WORK_DIR, 'report.json');
const PUBLIC_DIR = join(ROOT, 'public/content');
const ICONS_DIR = join(PUBLIC_DIR, 'icons');
const MANIFEST_PATH = join(PUBLIC_DIR, 'icons-manifest.json');
const REJECT_PATH = join(ROOT, '.tmp/icons/rejects.json');
const STYLE_PATH = join(HERE, 'style.json');
const MODELS_PATH = join(ROOT, 'scripts/ai/models.json');
const MAX_BYTES = 30000;
const IMG_NAME = /^[A-Za-z0-9-]{1,32}\.webp$/;
const CODE = /^[A-Z]{2}$/;

type Json = Record<string, unknown>;

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}
function isRecord(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function esc(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function loadLabels(): Map<string, { id: string; en: string }> {
  const labels = new Map<string, { id: string; en: string }>();
  const add = (code: string, label: unknown) => {
    if (isRecord(label) && typeof label.id === 'string' && typeof label.en === 'string') {
      labels.set(code, { id: label.id, en: label.en });
    }
  };
  try {
    const favorites = readJson(join(ROOT, 'src/content/data/favorites.json'));
    if (Array.isArray(favorites)) {
      for (const f of favorites) {
        if (isRecord(f) && typeof f.code === 'string' && isRecord(f.icon))
          add(f.code, f.icon.label);
      }
    }
    const facts = readJson(join(ROOT, 'src/content/data/continent-facts.json'));
    if (isRecord(facts)) {
      for (const [code, v] of Object.entries(facts))
        if (isRecord(v) && isRecord(v.icon)) add(code, v.icon.label);
    }
  } catch {
    // label hanya pelengkap tampilan
  }
  return labels;
}

function loadReport(): Report | null {
  if (!existsSync(REPORT_PATH)) return null;
  const data = readJson(REPORT_PATH);
  return isRecord(data) && Array.isArray(data.items) ? (data as unknown as Report) : null;
}

interface ViewItem {
  code: string;
  variant: number;
  checks: Json;
  verdict: Json | null;
  error: string | null;
  attempt: string;
  problems: string[];
}

export function toView(raw: unknown): ViewItem | null {
  if (!isRecord(raw) || typeof raw.code !== 'string' || typeof raw.variant !== 'number')
    return null;
  const checks = isRecord(raw.checks) ? raw.checks : {};
  const verdict = isRecord(raw.verdict) ? raw.verdict : null;
  const error = typeof raw.error === 'string' ? raw.error : null;
  const problems: string[] = [];
  if (error) problems.push('error');
  if (verdict && verdict.matchesLabel === false) problems.push('verdict tidak cocok');
  if (verdict && verdict.hasText === true) problems.push('ada teks');
  if (verdict && verdict.hasFlag === true) problems.push('ada bendera');
  if (verdict && verdict.scary === true) problems.push('menakutkan');
  if (checks.size !== undefined && checks.size !== 256) problems.push('ukuran bukan 256');
  if (checks.hasAlpha === false) problems.push('tanpa alpha');
  if (checks.cornersTransparent === false) problems.push('sudut tidak transparan');
  if (typeof raw.bytes === 'number' && raw.bytes > MAX_BYTES) problems.push('berkas terlalu besar');
  return {
    code: raw.code,
    variant: raw.variant,
    checks,
    verdict,
    error,
    attempt: typeof raw.attempt === 'number' ? String(raw.attempt) : '-',
    problems,
  };
}

function renderCard(it: ViewItem, labels: Map<string, { id: string; en: string }>): string {
  const label = labels.get(it.code);
  const file = `${it.code}-${it.variant}.webp`;
  const checks = Object.entries(it.checks)
    .map(([k, v]) => `${esc(k)}: ${esc(String(v))}`)
    .join(', ');
  const verdict = it.verdict ? esc(JSON.stringify(it.verdict)) : 'belum diperiksa';
  return `<div class="variant${it.problems.length ? ' bad' : ''}">
  <div class="imgs"><img class="light" src="/img/${esc(file)}" width="128" height="128" alt="${esc(it.code)} varian ${it.variant}"><img class="dark" src="/img/${esc(file)}" width="128" height="128" alt=""></div>
  <p>Varian ${it.variant}${label ? ` - id: ${esc(label.id)} / en: ${esc(label.en)}` : ''}</p>
  <p>Cek lokal: ${checks || 'tidak ada'}</p>
  <p>Verdict: ${verdict}</p>
  <p>Percobaan: ${esc(it.attempt)}${it.error ? ` | Error: ${esc(it.error)}` : ''}${it.problems.length ? ` | Masalah: ${esc(it.problems.join(', '))}` : ''}</p>
  <button type="button" data-act="approve" data-code="${esc(it.code)}" data-variant="${it.variant}">Setujui</button>
  <form data-code="${esc(it.code)}" data-variant="${it.variant}"><input name="note" placeholder="Catatan penolakan" required><button type="submit">Tolak</button></form>
</div>`;
}

function renderPage(): string {
  const report = loadReport();
  const labels = loadLabels();
  const items = (report?.items ?? []).map(toView).filter((v): v is ViewItem => v !== null);
  const byCode = new Map<string, ViewItem[]>();
  for (const it of items) byCode.set(it.code, [...(byCode.get(it.code) ?? []), it]);
  const groups = [...byCode.entries()]
    .map(([code, list]) => ({ code, list: list.sort((a, b) => a.variant - b.variant) }))
    .sort((a, b) => {
      const pa = a.list.some((i) => i.problems.length) ? 0 : 1;
      const pb = b.list.some((i) => i.problems.length) ? 0 : 1;
      return pa - pb || a.code.localeCompare(b.code);
    });
  const body = report
    ? groups
        .map(
          (g) =>
            `<section><h2>${esc(g.code)}</h2><div class="row">${g.list.map((i) => renderCard(i, labels)).join('')}</div></section>`,
        )
        .join('\n')
    : '<p>Belum ada laporan di .tmp/icons/out/report.json. Jalankan generator dulu.</p>';
  return `<!doctype html>
<html lang="id"><head><meta charset="utf-8"><title>Tinjau ikon</title>
<style>
body{font-family:system-ui,sans-serif;margin:16px}
.row{display:flex;flex-wrap:wrap;gap:12px}
.variant{border:1px solid #999;padding:8px;max-width:340px}
.variant.bad{border:2px solid #b00}
.imgs{display:flex}
.imgs img{padding:8px}
.light{background:#fff}.dark{background:#222}
p{margin:4px 0;font-size:13px;overflow-wrap:anywhere}
</style></head><body>
<h1>Tinjau ikon</h1>
<p>Sumber: <select id="source"><option value="gemini-api">gemini-api</option><option value="manual">manual</option></select></p>
<p id="status" role="status"></p>
${body}
<script>
async function send(path, payload) {
  const s = document.getElementById('status');
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  const text = await res.text();
  s.textContent = res.ok ? 'Berhasil: ' + payload.code + ' varian ' + payload.variant : 'Gagal (' + res.status + '): ' + text;
}
document.querySelectorAll('button[data-act="approve"]').forEach((b) => {
  b.addEventListener('click', () => send('/approve', { code: b.dataset.code, variant: Number(b.dataset.variant), source: document.getElementById('source').value }));
});
document.querySelectorAll('form').forEach((f) => {
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    send('/reject', { code: f.dataset.code, variant: Number(f.dataset.variant), note: f.elements.note.value });
  });
});
</script></body></html>`;
}

function text(body: string, status: number, type = 'text/plain; charset=utf-8'): Response {
  return new Response(body, { status, headers: { 'content-type': type } });
}

function serveImage(name: string): Response {
  if (!IMG_NAME.test(name)) return text('nama berkas tidak valid', 400);
  for (const dir of [WORK_DIR, ICONS_DIR]) {
    const path = join(dir, name);
    if (existsSync(path)) {
      return new Response(new Uint8Array(readFileSync(path)), {
        headers: { 'content-type': 'image/webp' },
      });
    }
  }
  return text('tidak ditemukan', 404);
}

function handleApprove(code: string, variant: number, source: 'gemini-api' | 'manual'): Response {
  const report = loadReport();
  if (!report) return text('laporan tidak ada', 400);
  const style = readJson(STYLE_PATH) as StyleSpec;
  const models = readJson(MODELS_PATH) as { image: { model: string }; vision: { model: string } };
  approve({
    code,
    variant,
    workDir: WORK_DIR,
    publicDir: PUBLIC_DIR,
    manifestPath: MANIFEST_PATH,
    style,
    styleHash: styleHash(style),
    report,
    now: () => new Date(),
    source,
    model: source === 'manual' ? null : models.image.model,
    checkerModel: models.vision.model,
  });
  return text('ok', 200);
}

export function createHandler(port: number): (req: Request) => Promise<Response> {
  const allowed = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
  return async (req) => {
    const url = new URL(req.url);
    if (req.method === 'GET') {
      if (url.pathname === '/') return text(renderPage(), 200, 'text/html; charset=utf-8');
      if (url.pathname.startsWith('/img/')) {
        let name: string;
        try {
          name = decodeURIComponent(url.pathname.slice('/img/'.length));
        } catch {
          return text('nama berkas tidak valid', 400);
        }
        return serveImage(name);
      }
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
        typeof body.code !== 'string' ||
        !CODE.test(body.code) ||
        typeof body.variant !== 'number' ||
        !Number.isInteger(body.variant)
      ) {
        return text('code atau variant tidak valid', 400);
      }
      try {
        if (url.pathname === '/reject') {
          const note = typeof body.note === 'string' ? body.note.trim() : '';
          if (!note) return text('catatan wajib', 400);
          reject({ code: body.code, variant: body.variant, note, rejectPath: REJECT_PATH });
          return text('ok', 200);
        }
        return handleApprove(
          body.code,
          body.variant,
          body.source === 'manual' ? 'manual' : 'gemini-api',
        );
      } catch (err) {
        return text(err instanceof Error ? err.message : 'gagal', 500);
      }
    }
    return text('tidak ditemukan', 404);
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = process.argv[2];
  const port = arg ? Number(arg) : 4321;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error('port tidak valid');
    process.exit(1);
  }
  const handler = createHandler(port);
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
      void handler(req).then(async (res) => {
        outgoing.writeHead(res.status, Object.fromEntries(res.headers));
        outgoing.end(Buffer.from(await res.arrayBuffer()));
      });
    });
  }).listen(port, '127.0.0.1', () => {
    console.log(`Halaman tinjau ikon: http://127.0.0.1:${port}`);
  });
}
