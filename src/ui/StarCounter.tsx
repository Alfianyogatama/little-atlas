import { StarIcon } from '@phosphor-icons/react/dist/csr/Star';
import { useState } from 'react';
import { useLocale } from '@/app/i18n/useLocale';
import { m } from '@/paraglide/messages.js';
import './star-counter.css';

export interface StarCounterProps {
  count: number;
}

// Bintang dipilih karena itu hadiah yang dihitung di kuis (mockup hd-stars), bukan hiasan.
export function StarCounter({ count }: StarCounterProps) {
  useLocale();
  const label = m.quiz_stars_label({ count });
  // Membesar sekali hanya saat count naik: bumpKey me-remount pil sehingga animasinya mulai ulang.
  const [seen, setSeen] = useState(count);
  const [bumpKey, setBumpKey] = useState(0);
  if (count !== seen) {
    setSeen(count);
    if (count > seen) setBumpKey((key) => key + 1);
  }
  return (
    <div className="hd-stars" role="status" aria-label={label}>
      <span key={bumpKey} className="hd-stars__pill" data-bump={bumpKey > 0 ? '' : undefined}>
        <span className="hd-stars__icon" aria-hidden="true">
          <StarIcon weight="fill" />
        </span>
        <span className="hd-stars__count" aria-hidden="true">
          {count}
        </span>
        <span className="hd-stars__sr">{label}</span>
      </span>
    </div>
  );
}
