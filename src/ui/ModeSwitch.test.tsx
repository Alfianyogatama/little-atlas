// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setAppLocale } from '@/services/i18n/locale';
import { ModeSwitch } from './ModeSwitch';

afterEach(() => {
  cleanup();
  act(() => setAppLocale('id'));
});

describe('ModeSwitch', () => {
  it('M01: id: dua tombol "Jelajah" dan "Tebak Bendera" dengan teks terlihat', () => {
    render(<ModeSwitch mode="explore" onChange={vi.fn()} />);
    expect(screen.getAllByRole('button')).toHaveLength(2);
    const explore = screen.getByRole('button', { name: 'Jelajah' });
    const quiz = screen.getByRole('button', { name: 'Tebak Bendera' });
    // Nama datang dari teks terlihat, bukan dari aria-label.
    expect(explore.hasAttribute('aria-label')).toBe(false);
    expect(quiz.hasAttribute('aria-label')).toBe(false);
    expect(explore.textContent).toContain('Jelajah');
    expect(quiz.textContent).toContain('Tebak Bendera');
  });

  it('M02: en: teks terlihat "Explore" dan "Guess the Flag"', () => {
    act(() => setAppLocale('en'));
    render(<ModeSwitch mode="quiz" onChange={vi.fn()} />);
    const explore = screen.getByRole('button', { name: 'Explore' });
    const quiz = screen.getByRole('button', { name: 'Guess the Flag' });
    expect(explore.textContent).toContain('Explore');
    expect(quiz.textContent).toContain('Guess the Flag');
    expect(screen.queryByRole('button', { name: 'Jelajah' })).toBeNull();
  });

  it('M03: ganti bahasa memperbarui teks tanpa me-remount tombol', () => {
    render(<ModeSwitch mode="explore" onChange={vi.fn()} />);
    const before = screen.getByRole('button', { name: 'Jelajah' });
    act(() => setAppLocale('en'));
    expect(screen.getByRole('button', { name: 'Explore' })).toBe(before);
  });

  it('M04: mode explore aktif: aria-pressed true pada Jelajah, false pada Tebak Bendera', () => {
    render(<ModeSwitch mode="explore" onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Jelajah' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByRole('button', { name: 'Tebak Bendera' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
  });

  it('M05: mode quiz aktif: penanda berpindah', () => {
    render(<ModeSwitch mode="quiz" onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Jelajah' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
    expect(screen.getByRole('button', { name: 'Tebak Bendera' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('M06: mengetuk mode lain memanggil onChange sekali dengan id mode itu', () => {
    const onChange = vi.fn();
    const { rerender } = render(<ModeSwitch mode="explore" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tebak Bendera' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('quiz');

    onChange.mockClear();
    rerender(<ModeSwitch mode="quiz" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Jelajah' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('explore');
  });

  it('M07: mengetuk mode yang sedang aktif tidak memanggil apa pun', () => {
    const onChange = vi.fn();
    const { rerender } = render(<ModeSwitch mode="explore" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Jelajah' }));
    rerender(<ModeSwitch mode="quiz" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tebak Bendera' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('M08: ikon disembunyikan dari pembaca layar dan teks tanpa emoji', () => {
    const { container } = render(<ModeSwitch mode="explore" onChange={vi.fn()} />);
    for (const button of screen.getAllByRole('button')) {
      const svg = button.querySelector('svg');
      expect(svg, 'tiap tombol punya ikon').not.toBeNull();
      expect(svg?.closest('[aria-hidden="true"]')).not.toBeNull();
    }
    expect(/\p{Extended_Pictographic}/u.test(container.textContent ?? '')).toBe(false);
  });
});
