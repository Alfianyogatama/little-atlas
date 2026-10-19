/** Profil tunggal sampai #11 menambah baris profiles. */
export const DEFAULT_PROFILE_ID = 'default';

/** Batas bintang hasil migrasi v0; v0 sendiri tanpa batas. Sama dengan batas parameter debug quizStars. */
export const MAX_V0_STARS = 999;

export interface FlagQuizAnswer {
  itemId: string;
  correct: boolean;
  sessionId: string;
  answeredAt: number;
}

export interface Progress {
  stars: number;
  flagQuizLevel: number;
  flagQuizWindow: FlagQuizAnswer[];
}

/** Objek baru tiap panggilan supaya pemanggil boleh memutasinya. */
export function initialProgress(): Progress {
  return { stars: 0, flagQuizLevel: 1, flagQuizWindow: [] };
}

/** Meniru v0: null = key tidak ada; NaN atau ≤0 menjadi 0; di atas batas menjadi 999. */
export function parseV0Stars(raw: string | null): number | null {
  if (raw === null) return null;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n) || n <= 0) return 0;
  return Math.min(n, MAX_V0_STARS);
}
