import type { ReactNode } from 'react';
import './toy.css';

export interface ToyButtonProps {
  label: string;
  icon: ReactNode;
  onPress: () => void;
  showLabel?: boolean;
  disabled?: boolean;
  className?: string;
}

export function ToyButton({
  label,
  icon,
  onPress,
  showLabel = false,
  disabled = false,
  className,
}: ToyButtonProps) {
  const classes = ['hd-toy', showLabel ? null : 'is-icon', className].filter(Boolean).join(' ');
  return (
    <button
      type="button"
      className={classes}
      aria-label={showLabel ? undefined : label}
      aria-disabled={disabled || undefined}
      onClick={() => {
        if (!disabled) onPress();
      }}
    >
      <span aria-hidden="true">{icon}</span>
      {showLabel ? <span>{label}</span> : null}
    </button>
  );
}
