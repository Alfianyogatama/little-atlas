export const JUMP_DURATION = 0.7;

const FIRST_END = 0.45;

/** Profil lompatan bola: lift (satuan radius) dan wobble (radian), t dalam detik sejak ketukan. */
export function jumpProfile(t: number): { lift: number; wobble: number } {
  if (!(t > 0) || t >= JUMP_DURATION) return { lift: 0, wobble: 0 };
  const lift =
    t < FIRST_END
      ? 0.1 * Math.sin((Math.PI * t) / FIRST_END)
      : 0.03 * Math.sin((Math.PI * (t - FIRST_END)) / (JUMP_DURATION - FIRST_END));
  const decay = 1 - t / JUMP_DURATION;
  const wobble = 0.08 * decay * decay * Math.sin((2 * Math.PI * 3 * t) / JUMP_DURATION);
  return { lift: Math.max(0, lift), wobble };
}
