import { useCallback, useMemo, useState } from 'react';
import { readDebugParams } from '@/domain/debug';
import { DEFAULT_PROFILE_ID, type Progress, type ProgressRepository } from '@/domain/progress';
import { ExploreScreen } from '@/features/explore/ExploreScreen';
import { FlagQuizScreen } from '@/features/flag-quiz/FlagQuizScreen';
import type { AppMode } from '@/ui/ModeSwitch';

interface AppProps {
  repository: ProgressRepository;
  initialProgress: Progress;
}

export function App({ repository, initialProgress }: AppProps) {
  const [mode, setMode] = useState<AppMode>('explore');
  // Bintang awal dari penyimpanan; parameter debug menimpanya tanpa ikut tersimpan sampai bintang berubah.
  const { quizStars } = useMemo(
    () => readDebugParams(new URLSearchParams(window.location.search), __DEBUG_ENABLED__),
    [],
  );
  const [stars, setStars] = useState(quizStars ?? initialProgress.stars);
  const [previousTarget, setPreviousTarget] = useState<string | null>(null);

  // Tulis tanpa ditunggu: UI tidak menunggu penyimpanan, kegagalan hanya dicatat.
  const handleStarsChange = useCallback(
    (next: number) => {
      setStars(next);
      repository.saveStars(DEFAULT_PROFILE_ID, next).catch((error: unknown) => {
        console.warn('Bintang tidak tersimpan.', error);
      });
    },
    [repository],
  );

  return mode === 'quiz' ? (
    <FlagQuizScreen
      stars={stars}
      previousTarget={previousTarget}
      onStarsChange={handleStarsChange}
      onTargetChange={setPreviousTarget}
      onModeChange={setMode}
    />
  ) : (
    <ExploreScreen stars={stars} onModeChange={setMode} />
  );
}
