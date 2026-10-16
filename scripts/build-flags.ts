/**
 * Mode debug (?debug=1, overlay) hanya boleh ada di dev, e2e, dan preview Vercel.
 * Build produksi membuangnya total dari bundel (#32, ADR-006); VERCEL_ENV=production
 * selalu menang atas mode apa pun.
 */
export function isDebugEnabled(opts: { mode: string; vercelEnv: string | undefined }): boolean {
  if (opts.vercelEnv === 'production') return false;
  return opts.mode === 'development' || opts.mode === 'e2e' || opts.vercelEnv === 'preview';
}
