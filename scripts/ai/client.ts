import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { MODELS, type ModelRole } from './models';

const MAX_RETRIES = 3;

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`${name} belum diisi. Salin .env.example ke .env lalu isi kuncinya.`);
  }
  return value;
}

export const VisionVerdictSchema = z.object({
  seen: z.string(),
  matchesLabel: z.boolean(),
  hasText: z.boolean(),
  hasFlag: z.boolean(),
  thickOutline: z.boolean(),
  flatColors: z.boolean(),
  sameStyleAsReference: z.boolean(),
  scary: z.boolean(),
  notes: z.string(),
});
export type VisionVerdict = z.infer<typeof VisionVerdictSchema>;

export function parseVerdict(text: string): VisionVerdict {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = (fenced?.[1] ?? text).trim();
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw new Error('Jawaban pemeriksa bukan JSON yang valid.');
  }
  return VisionVerdictSchema.parse(json);
}

/** Non-OK final dari penyedia; body utuh sudah disamarkan dari kunci API, hanya message yang dipotong. */
export class ApiError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

export interface LogEntry {
  at: string;
  role: ModelRole;
  model: string;
  cached: boolean;
  tokensIn: number;
  tokensOut: number;
  images: number;
  estCostUsd: number;
}

export interface ClientDeps {
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  cacheDir: string;
  now: () => Date;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

const NativeResponseSchema = z
  .object({
    candidates: z
      .array(
        z
          .object({
            content: z
              .object({
                parts: z.array(z.object({ inlineData: z.unknown().optional() }).passthrough()),
              })
              .partial()
              .optional(),
          })
          .passthrough(),
      )
      .optional(),
    usageMetadata: z
      .object({
        promptTokenCount: z.number().optional(),
        candidatesTokenCount: z.number().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

function countImages(parsed: z.infer<typeof NativeResponseSchema>): number {
  let n = 0;
  for (const c of parsed.candidates ?? [])
    for (const p of c.content?.parts ?? []) if (p.inlineData !== undefined) n++;
  return n;
}

export function createClient(deps: ClientDeps) {
  const log: LogEntry[] = [];

  function redact(text: string, key: string | undefined): string {
    return key ? text.split(key).join('[kunci disamarkan]') : text;
  }

  function estimateCost(role: ModelRole, tokensIn: number, tokensOut: number): number {
    if (role === 'image') return MODELS.image.priceUsd.perImage;
    const { perInputToken, perOutputToken } = MODELS[role].priceUsd;
    return tokensIn * perInputToken + tokensOut * perOutputToken;
  }

  function record(role: ModelRole, body: unknown, cached: boolean): void {
    const parsed = NativeResponseSchema.safeParse(body);
    const u = parsed.success ? parsed.data.usageMetadata : undefined;
    const tokensIn = u?.promptTokenCount ?? 0;
    const tokensOut = u?.candidatesTokenCount ?? 0;
    const images = role === 'image' && parsed.success ? countImages(parsed.data) : 0;
    log.push({
      at: deps.now().toISOString(),
      role,
      model: MODELS[role].model,
      cached,
      tokensIn,
      tokensOut,
      images,
      estCostUsd: cached ? 0 : estimateCost(role, tokensIn, tokensOut),
    });
  }

  // cacheTag hanya masuk hash cache (untuk ambil ulang), tidak pernah ikut terkirim.
  async function request(
    role: ModelRole,
    payload: Record<string, unknown>,
    opts?: { cacheTag?: string },
  ): Promise<unknown> {
    const cfg = MODELS[role];
    const tag = opts?.cacheTag === undefined ? '' : `\n${opts.cacheTag}`;
    const hash = createHash('sha256')
      .update(role + '\n' + cfg.model + '\n' + canonical(payload) + tag)
      .digest('hex');
    const cacheFile = join(deps.cacheDir, `${hash}.json`);
    if (existsSync(cacheFile)) {
      const cachedBody: unknown = JSON.parse(readFileSync(cacheFile, 'utf8'));
      record(role, cachedBody, true);
      return cachedBody;
    }

    const key = requireEnv(cfg.apiKeyEnv);
    const url = `${cfg.baseUrl.replace(/\/+$/, '')}/models/${cfg.model}:generateContent`;
    const init: RequestInit = {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(payload),
    };

    for (let attempt = 0; ; attempt++) {
      // Error asli bisa memuat kunci di message atau stack, jadi cause dibuat baru dan disamarkan.
      const res = await deps.fetch(url, init).catch((err: unknown): never => {
        const safe = redact(err instanceof Error ? err.message : String(err), key);
        throw new Error(`Panggilan ke ${role} gagal: ${safe}`, { cause: new Error(safe) });
      });
      if (res.ok) {
        const body: unknown = await res.json();
        mkdirSync(deps.cacheDir, { recursive: true });
        writeFileSync(cacheFile, JSON.stringify(body));
        record(role, body, false);
        return body;
      }
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt >= MAX_RETRIES) {
        const body = redact(await res.text().catch(() => ''), key);
        throw new ApiError(
          `Panggilan ke ${role} gagal dengan status ${res.status}: ${body.slice(0, 300)}`,
          res.status,
          body,
        );
      }
      const retryAfter = Number(res.headers.get('retry-after'));
      const waitMs =
        Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : cfg.delayMs * 2 ** attempt;
      await deps.sleep(waitMs);
    }
  }

  return { request, log };
}
