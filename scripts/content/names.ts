import { TtsNameSchema, type NameOverrides } from '../../src/content/schema';

export type ResolvedNames = Record<string, { id: string; en: string }>;

interface ResolveNamesInput {
  cldrId: Record<string, string>;
  cldrEn: Record<string, string>;
  overrides: NameOverrides;
  codes: readonly string[];
}

function pick(
  lang: 'id' | 'en',
  code: string,
  cldr: Record<string, string>,
  overrides: Record<string, string>,
): string {
  const raw = overrides[code] ?? cldr[code];
  if (raw === undefined) throw new Error(`${code}: tidak ada nama ${lang} (CLDR maupun override)`);
  const parsed = TtsNameSchema.safeParse(raw);
  if (!parsed.success) {
    const reason = parsed.error.issues.map((i) => i.message).join('; ');
    throw new Error(`${code}: nama ${lang} "${raw}" tidak valid: ${reason}`);
  }
  return parsed.data;
}

/** Nama dasar CLDR (tanpa kunci -alt-*), ditimpa override, divalidasi aturan TTS. Urut sesuai codes. */
export function resolveNames({
  cldrId,
  cldrEn,
  overrides,
  codes,
}: ResolveNamesInput): ResolvedNames {
  const out: ResolvedNames = {};
  for (const code of codes) {
    out[code] = {
      id: pick('id', code, cldrId, overrides.id),
      en: pick('en', code, cldrEn, overrides.en),
    };
  }
  return out;
}
