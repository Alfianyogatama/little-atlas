import type { Progress } from './progress';

export interface ProgressRepository {
  /** Tidak pernah reject karena data rusak; jatuh ke nilai awal. */
  load(profileId: string): Promise<Progress>;
  /** Field progress lain dipertahankan. */
  saveStars(profileId: string, stars: number): Promise<void>;
}
