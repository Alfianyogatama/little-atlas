import { useLocale } from '@/app/i18n/useLocale';
import { m } from '@/paraglide/messages.js';
import './flag-choices.css';

export interface FlagChoice {
  code: string;
  name: string;
  src: string;
}

export interface FlagChoicesProps {
  choices: readonly FlagChoice[];
  /** Kode pilihan yang sudah dicoba; pudar dan tidak bisa diketuk lagi. */
  dimmed: readonly string[];
  /** Kode jawaban benar setelah anak menjawab, atau null selama masih bertanya. */
  correct: string | null;
  onPick: (code: string) => void;
}

export function FlagChoices({ choices, dimmed, correct, onPick }: FlagChoicesProps) {
  useLocale();
  return (
    <div className="hd-choices">
      {choices.map((choice) => {
        const isDimmed = dimmed.includes(choice.code);
        const state = isDimmed ? 'dimmed' : choice.code === correct ? 'correct' : 'idle';
        return (
          <button
            key={choice.code}
            type="button"
            className="hd-choice"
            data-state={state}
            aria-label={m.quiz_choice_label({ name: choice.name })}
            aria-disabled={isDimmed || undefined}
            onClick={() => {
              if (!isDimmed) onPick(choice.code);
            }}
          >
            <img className="hd-choice__flag" src={choice.src} alt="" draggable={false} />
          </button>
        );
      })}
    </div>
  );
}
