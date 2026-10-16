// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { setAppLocale } from '@/services/i18n/locale';
import { StarCounter } from './StarCounter';

afterEach(() => {
  cleanup();
  act(() => setAppLocale('id'));
});

describe('StarCounter', () => {
  it('S01: id: role status bernama "Bintang: 3" dan angka terlihat', () => {
    render(<StarCounter count={3} />);
    const status = screen.getByRole('status', { name: 'Bintang: 3' });
    expect(status.textContent).toContain('3');
  });

  it('S02: en: nama "Stars: 3"', () => {
    act(() => setAppLocale('en'));
    render(<StarCounter count={3} />);
    const status = screen.getByRole('status', { name: 'Stars: 3' });
    expect(status.textContent).toContain('3');
  });

  it('S03: nol tetap tampil sebagai angka 0', () => {
    render(<StarCounter count={0} />);
    const status = screen.getByRole('status', { name: 'Bintang: 0' });
    expect(status.textContent).toContain('0');
  });

  it('S04: angka dan nama ikut berubah saat count bertambah, elemen sama', () => {
    const { rerender } = render(<StarCounter count={4} />);
    const before = screen.getByRole('status', { name: 'Bintang: 4' });
    rerender(<StarCounter count={5} />);
    const after = screen.getByRole('status', { name: 'Bintang: 5' });
    expect(after).toBe(before);
    expect(after.textContent).toContain('5');
  });

  it('S05: ikon bintang disembunyikan dari pembaca layar; hanya satu status', () => {
    const { container } = render(<StarCounter count={2} />);
    expect(screen.getAllByRole('status')).toHaveLength(1);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.closest('[aria-hidden="true"]')).not.toBeNull();
  });
});
