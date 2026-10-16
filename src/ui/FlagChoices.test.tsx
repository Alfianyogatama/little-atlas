// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setAppLocale } from '@/services/i18n/locale';
import { FlagChoices, type FlagChoicesProps } from './FlagChoices';

afterEach(() => {
  cleanup();
  act(() => setAppLocale('id'));
});

function props(over: Partial<FlagChoicesProps> = {}): FlagChoicesProps {
  return {
    choices: [
      { code: 'JP', name: 'Jepang', src: '/flags/jp.svg' },
      { code: 'BR', name: 'Brasil', src: '/flags/br.svg' },
    ],
    dimmed: [],
    correct: null,
    onPick: vi.fn(),
    ...over,
  };
}

describe('FlagChoices', () => {
  it('FC01: id: satu tombol per pilihan, bernama "Bendera {nama}"', () => {
    render(<FlagChoices {...props()} />);
    expect(screen.getAllByRole('button')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Bendera Jepang' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Bendera Brasil' })).toBeTruthy();
  });

  it('FC02: en: nama tombol "Flag of {name}"', () => {
    act(() => setAppLocale('en'));
    render(
      <FlagChoices
        {...props({
          choices: [
            { code: 'JP', name: 'Japan', src: '/flags/jp.svg' },
            { code: 'BR', name: 'Brazil', src: '/flags/br.svg' },
          ],
        })}
      />,
    );
    expect(screen.getByRole('button', { name: 'Flag of Japan' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Flag of Brazil' })).toBeTruthy();
  });

  it('FC03: merender sebanyak N pilihan (3 pilihan -> 3 tombol)', () => {
    render(
      <FlagChoices
        {...props({
          choices: [
            { code: 'JP', name: 'Jepang', src: '/flags/jp.svg' },
            { code: 'BR', name: 'Brasil', src: '/flags/br.svg' },
            { code: 'FR', name: 'Prancis', src: '/flags/fr.svg' },
          ],
        })}
      />,
    );
    expect(screen.getAllByRole('button')).toHaveLength(3);
  });

  it('FC04: img di dalam tombol berisi alt kosong (dekoratif) dan src dari pilihan', () => {
    const { container } = render(<FlagChoices {...props()} />);
    const imgs = Array.from(container.querySelectorAll('img'));
    expect(imgs).toHaveLength(2);
    for (const img of imgs) {
      expect(img.getAttribute('alt')).toBe('');
      expect(img.closest('button')).not.toBeNull();
    }
    const jp = screen.getByRole('button', { name: 'Bendera Jepang' }).querySelector('img');
    expect(jp?.getAttribute('src')).toBe('/flags/jp.svg');
  });

  it('FC05: ketuk pilihan aktif memanggil onPick sekali dengan kodenya', () => {
    const onPick = vi.fn();
    render(<FlagChoices {...props({ onPick })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Bendera Brasil' }));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith('BR');
  });

  it('FC06: pilihan pudar: aria-disabled="true" dan klik tidak memanggil onPick', () => {
    const onPick = vi.fn();
    render(<FlagChoices {...props({ dimmed: ['JP'], onPick })} />);
    const dimmed = screen.getByRole('button', { name: 'Bendera Jepang' });
    expect(dimmed.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(dimmed);
    expect(onPick).not.toHaveBeenCalled();
  });

  it('FC07: kontrol positif: pilihan lain tetap aktif dan masih bisa diketuk', () => {
    const onPick = vi.fn();
    render(<FlagChoices {...props({ dimmed: ['JP'], onPick })} />);
    const other = screen.getByRole('button', { name: 'Bendera Brasil' });
    expect(other.getAttribute('aria-disabled')).not.toBe('true');
    fireEvent.click(other);
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith('BR');
  });

  it('FC08: status data-state: idle, dimmed, correct', () => {
    render(<FlagChoices {...props({ dimmed: ['JP'], correct: 'BR' })} />);
    expect(screen.getByRole('button', { name: 'Bendera Jepang' }).dataset.state).toBe('dimmed');
    expect(screen.getByRole('button', { name: 'Bendera Brasil' }).dataset.state).toBe('correct');
  });

  it('FC09: tanpa dimmed/correct semua pilihan berstatus idle', () => {
    render(<FlagChoices {...props()} />);
    for (const button of screen.getAllByRole('button')) {
      expect(button.dataset.state).toBe('idle');
    }
  });

  it('FC10: pilihan benar tidak ditandai pudar dan tidak ada tanda untuk "salah"', () => {
    const { container } = render(<FlagChoices {...props({ correct: 'JP' })} />);
    const correct = screen.getByRole('button', { name: 'Bendera Jepang' });
    expect(correct.dataset.state).toBe('correct');
    expect(correct.getAttribute('aria-disabled')).not.toBe('true');
    expect(screen.getByRole('button', { name: 'Bendera Brasil' }).dataset.state).toBe('idle');
    expect(container.querySelector('[data-state="wrong"]')).toBeNull();
  });
});
