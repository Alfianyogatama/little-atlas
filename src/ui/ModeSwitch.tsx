import { FlagIcon } from '@phosphor-icons/react/dist/csr/Flag';
import { GlobeHemisphereWestIcon } from '@phosphor-icons/react/dist/csr/GlobeHemisphereWest';
import { useLocale } from '@/app/i18n/useLocale';
import { m } from '@/paraglide/messages.js';
import { ToyButton } from './ToyButton';
import './mode-switch.css';

export type AppMode = 'explore' | 'quiz';

export interface ModeSwitchProps {
  mode: AppMode;
  onChange: (mode: AppMode) => void;
}

export function ModeSwitch({ mode, onChange }: ModeSwitchProps) {
  useLocale();
  return (
    <div className="hd-mode">
      <ToyButton
        label={m.mode_explore()}
        icon={<GlobeHemisphereWestIcon weight="fill" />}
        showLabel
        pressed={mode === 'explore'}
        onPress={() => {
          if (mode !== 'explore') onChange('explore');
        }}
      />
      <ToyButton
        label={m.mode_quiz()}
        icon={<FlagIcon weight="fill" />}
        showLabel
        pressed={mode === 'quiz'}
        onPress={() => {
          if (mode !== 'quiz') onChange('quiz');
        }}
      />
    </div>
  );
}
