import { useMemo, useState } from 'react';
import { readDebugParams } from '@/domain/debug';
import { ExploreScreen } from '@/features/explore/ExploreScreen';
import { FlagQuizScreen } from '@/features/flag-quiz/FlagQuizScreen';
import type { AppMode } from '@/ui/ModeSwitch';
import { useWarnOnUnload } from './useWarnOnUnload';

export function App() {
  const [mode, setMode] = useState<AppMode>('explore');
  // Bintang hanya di memori sesi sampai penyimpanan (#10); parameter debug menentukan nilai awal.
  const { quizStars } = useMemo(
    () => readDebugParams(new URLSearchParams(window.location.search), __DEBUG_ENABLED__),
    [],
  );
  const [stars, setStars] = useState(quizStars ?? 0);
  const [previousTarget, setPreviousTarget] = useState<string | null>(null);
  useWarnOnUnload(stars > 0);

  return mode === 'quiz' ? (
    <FlagQuizScreen
      stars={stars}
      previousTarget={previousTarget}
      onStarsChange={setStars}
      onTargetChange={setPreviousTarget}
      onModeChange={setMode}
    />
  ) : (
    <ExploreScreen stars={stars} onModeChange={setMode} />
  );
}
