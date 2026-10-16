import { createHash } from 'node:crypto';

export interface StyleSpec {
  version: number;
  prompt: string;
  avoid: string[];
  background: string;
}

export interface PromptInput {
  style: StyleSpec;
  code: string;
  labelEn: string;
  countryEn: string;
  hint?: string;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function styleHash(style: StyleSpec): string {
  const { version, prompt, avoid, background } = style;
  return createHash('sha256')
    .update(canonical({ version, prompt, avoid, background }))
    .digest('hex');
}

export function buildPrompt({ style, labelEn, countryEn, hint }: PromptInput): string {
  const lines = [
    style.prompt,
    `Background: ${style.background}.`,
    `Avoid: ${style.avoid.join(', ')}.`,
    `Subject: ${labelEn}, from ${countryEn}`,
  ];
  if (hint) lines.push(`Depict it as: ${hint}.`);
  return lines.join('\n');
}
