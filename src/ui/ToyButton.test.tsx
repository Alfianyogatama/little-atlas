// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToyButton } from './ToyButton';

afterEach(cleanup);

const icon = <svg data-testid="glyph" />;

describe('ToyButton', () => {
  it('(a) default: bulat, nama dari aria-label, tanpa teks terlihat', () => {
    render(<ToyButton label="Perbesar" icon={icon} onPress={vi.fn()} />);
    const btn = screen.getByRole('button', { name: 'Perbesar' });
    expect(btn.getAttribute('aria-label')).toBe('Perbesar');
    expect(btn.classList.contains('hd-toy')).toBe(true);
    expect(btn.classList.contains('is-icon')).toBe(true);
    expect(btn.textContent?.trim()).toBe('');
  });

  it('(b) showLabel: nama dari isi, label terlihat, tanpa aria-label dan is-icon', () => {
    render(<ToyButton label="Dengar lagi" icon={icon} showLabel onPress={vi.fn()} />);
    const btn = screen.getByRole('button', { name: 'Dengar lagi' });
    expect(btn.hasAttribute('aria-label')).toBe(false);
    expect(btn.classList.contains('hd-toy')).toBe(true);
    expect(btn.classList.contains('is-icon')).toBe(false);
    expect(btn.textContent).toContain('Dengar lagi');
  });

  it('(c) klik memanggil onPress sekali', () => {
    const onPress = vi.fn();
    render(<ToyButton label="Tutup" icon={icon} onPress={onPress} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tutup' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('(d) disabled: aria-disabled="true" dan klik tidak memanggil onPress', () => {
    const onPress = vi.fn();
    render(<ToyButton label="Tutup" icon={icon} disabled onPress={onPress} />);
    const btn = screen.getByRole('button', { name: 'Tutup' });
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(btn);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('(e) ikon disembunyikan dari pembaca layar', () => {
    render(<ToyButton label="Tutup" icon={icon} onPress={vi.fn()} />);
    const glyph = screen.getByTestId('glyph');
    expect(glyph.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it('className tambahan diteruskan tanpa menghilangkan hd-toy', () => {
    render(<ToyButton label="Tutup" icon={icon} className="extra" onPress={vi.fn()} />);
    const btn = screen.getByRole('button', { name: 'Tutup' });
    expect(btn.classList.contains('extra')).toBe(true);
    expect(btn.classList.contains('hd-toy')).toBe(true);
  });
});
