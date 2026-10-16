import { useEffect, useState, type CSSProperties } from 'react';
import './confetti.css';

export interface ConfettiProps {
  size: 'small' | 'big';
}

const PIECES: Record<ConfettiProps['size'], number> = { small: 14, big: 40 };
const COLORS = ['--land-pink', '--land-orange', '--land-green', '--land-lilac', '--sun', '--coral'];
// Keping jatuh sekali: delay terlama + durasi terpanjang di pieceStyle.
const LIFETIME_MS = 3200;

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}

/** Posisi, warna, dan waktu tiap keping ditentukan dari indeks, jadi render tidak memakai angka acak. */
function pieceStyle(index: number): CSSProperties {
  return {
    left: `${(index * 37 + 11) % 100}%`,
    animationDelay: `${((index * 5) % 9) * 0.07}s`,
    animationDuration: `${2 + ((index * 3) % 5) * 0.2}s`,
    '--piece-color': `var(${COLORS[index % COLORS.length] ?? '--sun'})`,
    '--piece-drift': `${((index * 7) % 13) - 6}vw`,
    '--piece-spin': `${(index % 2 === 0 ? 1 : -1) * (360 + (index % 4) * 120)}deg`,
  } as CSSProperties;
}

export function Confetti({ size }: ConfettiProps) {
  const [reduced] = useState(prefersReducedMotion);
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (reduced) return;
    const timer = setTimeout(() => {
      setDone(true);
    }, LIFETIME_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [reduced]);

  if (reduced || done) return null;
  return (
    <div className="hd-confetti" data-confetti aria-hidden="true">
      {Array.from({ length: PIECES[size] }, (_, index) => (
        <span
          key={index}
          className="hd-confetti__piece"
          data-confetti-piece
          style={pieceStyle(index)}
        />
      ))}
    </div>
  );
}
