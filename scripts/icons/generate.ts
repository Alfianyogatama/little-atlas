import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { parseVerdict, type VisionVerdict } from '../ai/client';
import type { ModelRole } from '../ai/models';
import {
  checkBackgroundRemoved,
  downscale,
  estimateBackground,
  localChecks,
  BACKGROUND_TOLERANCE,
  removeKeyBackground,
  trimPad,
  type LocalChecks,
  type RgbaImage,
} from './image-ops';
import { buildPrompt, type StyleSpec } from './prompt';

const INK_COLOR = [0x1d, 0x3a, 0x6e] as const;
const ICON_SIZE = 256;
// Latar abu muda opak untuk gambar yang dikirim ke pemeriksa (alat build, bukan token UI).
const VISION_BACKDROP = [235, 235, 235] as const;
const MAX_BYTES = 30000;
const RAW_EXTS = ['png', 'jpg'] as const;
type RawExt = (typeof RAW_EXTS)[number];
const MIME: Record<RawExt, string> = { png: 'image/png', jpg: 'image/jpeg' };
const EXT_BY_MIME: Record<string, RawExt> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
};

export interface GenerateCodec {
  decode: (bytes: Uint8Array, mime: string) => RgbaImage | Promise<RgbaImage>;
  encodeWebp: (
    img: RgbaImage,
    opts: { lossless: boolean; quality?: number },
  ) => Uint8Array | Promise<Uint8Array>;
  encodePng: (img: RgbaImage) => Uint8Array | Promise<Uint8Array>;
}

export interface GenerateOptions {
  codes: string[];
  variants: number;
  dryRun: boolean;
  rawDir: string;
  outDir: string;
  style: StyleSpec;
  hints: Record<string, string>;
  names: Record<string, { en: string }>;
  labels: Record<string, { en: string }>;
  client: { request: (role: ModelRole, payload: Record<string, unknown>) => Promise<unknown> };
  codec: GenerateCodec;
  models: { assertConfigured: (role: ModelRole) => void };
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  delayMs: number;
  log: (line: string) => void;
}

export interface ReportItem {
  code: string;
  variant: number;
  rawPath: string | null;
  outPath: string | null;
  bytes: number;
  encoding: 'lossless' | 'q90' | null;
  checks: LocalChecks;
  verdict: VisionVerdict | null;
  promptHash: string;
  generatedAt: string;
  error?: string;
}

export interface Report {
  items: ReportItem[];
}

const EMPTY_CHECKS: LocalChecks = {
  size: 0,
  hasAlpha: false,
  cornersTransparent: false,
  coverage: 0,
  colorCount: 0,
  inkRatio: 0,
  backgroundRemoved: false,
};

const ImageResponseSchema = z.object({
  promptFeedback: z.object({ blockReason: z.string().optional() }).passthrough().optional(),
  candidates: z
    .array(
      z.object({
        content: z
          .object({
            parts: z
              .array(
                z.object({
                  text: z.string().optional(),
                  inlineData: z.object({ mimeType: z.string(), data: z.string() }).optional(),
                }),
              )
              .optional(),
          })
          .optional(),
      }),
    )
    .optional(),
});

/**
 * Satu-satunya tempat yang membaca bentuk respons image (generateContent native Gemini):
 * part inlineData pertama.
 */
export function extractImage(response: unknown): { bytes: Uint8Array; mime: string } {
  const parsed = ImageResponseSchema.parse(response);
  const parts = (parsed.candidates ?? []).flatMap((c) => c.content?.parts ?? []);
  const found = parts.find((p) => p.inlineData !== undefined)?.inlineData;
  if (found) {
    return { bytes: Uint8Array.from(Buffer.from(found.data, 'base64')), mime: found.mimeType };
  }
  const block = parsed.promptFeedback?.blockReason;
  if (block) throw new Error(`Penyedia tidak mengembalikan gambar: diblokir (${block}).`);
  const text = parts
    .map((p) => p.text)
    .filter((t): t is string => t !== undefined && t !== '')
    .join(' ');
  throw new Error(`Penyedia tidak mengembalikan gambar${text ? `: ${text.slice(0, 300)}` : '.'}`);
}

const VisionResponseSchema = z.object({
  promptFeedback: z.object({ blockReason: z.string().optional() }).passthrough().optional(),
  candidates: z
    .array(
      z.object({
        content: z
          .object({ parts: z.array(z.object({ text: z.string().optional() })).optional() })
          .optional(),
      }),
    )
    .optional(),
});

/** Mengambil teks jawaban pemeriksa dari respons generateContent native Gemini. */
export function extractVisionText(response: unknown): string {
  const parsed = VisionResponseSchema.parse(response);
  const parts = parsed.candidates?.[0]?.content?.parts ?? [];
  const text = parts
    .map((p) => p.text)
    .filter((t): t is string => t !== undefined && t !== '')
    .join('');
  if (text !== '') return text;
  const block = parsed.promptFeedback?.blockReason;
  throw new Error(`Pemeriksa tidak mengembalikan teks${block ? `: diblokir (${block})` : '.'}`);
}

function compositeOnBackdrop(img: RgbaImage): RgbaImage {
  const data = new Uint8ClampedArray(img.data.length);
  for (let i = 0; i < img.data.length; i += 4) {
    const a = (img.data[i + 3] ?? 0) / 255;
    for (let c = 0; c < 3; c++) {
      data[i + c] = Math.round((img.data[i + c] ?? 0) * a + (VISION_BACKDROP[c] ?? 0) * (1 - a));
    }
    data[i + 3] = 255;
  }
  return { data, width: img.width, height: img.height };
}

function visionInstruction(label: string): string {
  return [
    `You are checking an icon for a children's game. The intended subject is: "${label}".`,
    'Reply with JSON only, using exactly these keys:',
    '{"seen": string (what you see, in a few words),',
    '"matchesLabel": boolean (the icon clearly shows the intended subject),',
    '"hasText": boolean (any letters, words, or numbers appear),',
    '"hasFlag": boolean (any national flag or flag-like banner appears),',
    '"thickOutline": boolean (shapes have a thick dark outline),',
    '"flatColors": boolean (flat fill colors, no gradients or shading),',
    '"sameStyleAsReference": boolean (looks like a simple friendly sticker-style icon),',
    '"scary": boolean (anything frightening for a young child),',
    '"notes": string (one short sentence)}',
  ].join('\n');
}

function findRaw(
  rawDir: string,
  code: string,
  variant: number,
): { path: string; ext: RawExt } | null {
  for (const ext of RAW_EXTS) {
    const path = join(rawDir, `${code}-${variant}.${ext}`);
    if (existsSync(path)) return { path, ext };
  }
  return null;
}

export interface ProcessedIcon {
  small: RgbaImage;
  webp: Uint8Array;
  encoding: 'lossless' | 'q90';
  checks: LocalChecks;
}

/**
 * Pasca-proses bersama (generate dan reprocess): hapus latar, trim, perkecil, encode WebP.
 * Melempar bila latar tidak terhapus; `checks` pada error tidak tersedia, lihat generate.
 */
export class BackgroundNotRemovedError extends Error {
  constructor() {
    super('Latar tidak terhapus: warna latar tidak seragam di tepi gambar.');
  }
}

export async function processRaw(
  decoded: RgbaImage,
  codec: Pick<GenerateCodec, 'encodeWebp'>,
): Promise<ProcessedIcon> {
  const keyed = removeKeyBackground(decoded, estimateBackground(decoded), BACKGROUND_TOLERANCE);
  const backgroundRemoved = checkBackgroundRemoved(keyed);
  if (!backgroundRemoved) throw new BackgroundNotRemovedError();
  const small = downscale(trimPad(keyed), ICON_SIZE);
  const checks = localChecks(small, { ink: INK_COLOR, backgroundRemoved });
  let webp = await codec.encodeWebp(small, { lossless: true });
  let encoding: 'lossless' | 'q90' = 'lossless';
  if (webp.length > MAX_BYTES) {
    webp = await codec.encodeWebp(small, { lossless: false, quality: 90 });
    encoding = 'q90';
  }
  return { small, webp, encoding, checks };
}

export async function runGenerate(opts: GenerateOptions): Promise<Report> {
  const { codes, variants, rawDir, outDir, style, client, codec, log } = opts;

  const promptFor = (code: string): string =>
    buildPrompt({
      style,
      code,
      labelEn: opts.labels[code]?.en ?? code,
      countryEn: opts.names[code]?.en ?? code,
      hint: opts.hints[code],
    });

  if (opts.dryRun) {
    for (const code of codes) {
      for (let v = 1; v <= variants; v++) log(`[${code}-${v}]\n${promptFor(code)}`);
    }
    return { items: [] };
  }

  opts.models.assertConfigured('image');
  let visionOn = true;
  try {
    opts.models.assertConfigured('vision');
  } catch {
    visionOn = false;
  }

  mkdirSync(rawDir, { recursive: true });
  mkdirSync(outDir, { recursive: true });

  const items: ReportItem[] = [];
  let requested = 0;
  for (const code of codes) {
    const prompt = promptFor(code);
    const promptHash = createHash('sha256').update(prompt).digest('hex');
    for (let variant = 1; variant <= variants; variant++) {
      const item: ReportItem = {
        code,
        variant,
        rawPath: null,
        outPath: null,
        bytes: 0,
        encoding: null,
        checks: EMPTY_CHECKS,
        verdict: null,
        promptHash,
        generatedAt: opts.now().toISOString(),
      };
      try {
        let raw = findRaw(rawDir, code, variant);
        if (!raw) {
          if (requested > 0) await opts.sleep(opts.delayMs);
          requested++;
          const text =
            variant > 1
              ? `${prompt}\n\nVariation ${variant} of ${variants}: a different pose or composition.`
              : prompt;
          const res = await client.request('image', {
            contents: [{ role: 'user', parts: [{ text }] }],
            generationConfig: {
              responseModalities: ['IMAGE'],
              imageConfig: { aspectRatio: '1:1' },
            },
          });
          const img = extractImage(res);
          const ext = EXT_BY_MIME[img.mime.toLowerCase()];
          if (!ext) throw new Error(`Format gambar tidak didukung: ${img.mime}`);
          const path = join(rawDir, `${code}-${variant}.${ext}`);
          writeFileSync(path, img.bytes);
          raw = { path, ext };
        }
        item.rawPath = raw.path;

        const decoded = await codec.decode(new Uint8Array(readFileSync(raw.path)), MIME[raw.ext]);
        let processed: ProcessedIcon;
        try {
          processed = await processRaw(decoded, codec);
        } catch (err) {
          if (err instanceof BackgroundNotRemovedError) {
            item.checks = { ...EMPTY_CHECKS, backgroundRemoved: false };
          }
          throw err;
        }
        item.checks = processed.checks;
        item.encoding = processed.encoding;
        const small = processed.small;
        const webp = processed.webp;
        const outPath = join(outDir, `${code}-${variant}.webp`);
        writeFileSync(outPath, webp);
        item.outPath = outPath;
        item.bytes = webp.length;

        if (visionOn) {
          const png = await codec.encodePng(compositeOnBackdrop(small));
          const verdictRes = await client.request('vision', {
            contents: [
              {
                role: 'user',
                parts: [
                  { text: visionInstruction(opts.labels[code]?.en ?? code) },
                  {
                    inlineData: {
                      mimeType: 'image/png',
                      data: Buffer.from(png).toString('base64'),
                    },
                  },
                ],
              },
            ],
            generationConfig: { responseMimeType: 'application/json' },
          });
          item.verdict = parseVerdict(extractVisionText(verdictRes));
        }
      } catch (err) {
        item.error = err instanceof Error ? err.message : String(err);
        log(`[${code}-${variant}] gagal: ${item.error}`);
      }
      items.push(item);
    }
  }

  const report: Report = { items };
  writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  return report;
}
