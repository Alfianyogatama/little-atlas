// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CountryCard, type CountryCardProps } from './CountryCard';

afterEach(cleanup);

const labels = { card: 'Kartu negara', close: 'Tutup', listenAgain: 'Dengar lagi' };

function props(over: Partial<CountryCardProps> = {}): CountryCardProps {
  return {
    name: 'Indonesia',
    flag: { src: '/flags/id.svg', alt: 'Bendera Indonesia' },
    fact: 'Negara kepulauan terbesar di dunia.',
    labels,
    onClose: vi.fn(),
    onReplay: vi.fn(),
    ...over,
  };
}

describe('CountryCard', () => {
  it('C01: region, bendera, h2 nama, dan fakta tampil', () => {
    render(<CountryCard {...props()} />);
    expect(screen.getByRole('region', { name: 'Kartu negara' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Bendera Indonesia' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Indonesia' })).toBeTruthy();
    expect(screen.getByText('Negara kepulauan terbesar di dunia.')).toBeTruthy();
  });

  it('C02: fact null dan tanpa icon: hanya satu img (bendera), tanpa slot ikon kosong', () => {
    const { container } = render(<CountryCard {...props({ fact: null })} />);
    expect(screen.queryByText('Negara kepulauan terbesar di dunia.')).toBeNull();
    expect(screen.getAllByRole('img')).toHaveLength(1);
    expect(container.querySelectorAll('img')).toHaveLength(1);
    const empties = Array.from(container.querySelectorAll('*')).filter(
      (el) =>
        el.children.length === 0 &&
        !el.textContent?.trim() &&
        el.tagName !== 'IMG' &&
        el.tagName !== 'svg' &&
        !el.closest('button, svg'),
    );
    expect(empties).toHaveLength(0);
  });

  it('C02b: tanpa prop icon, hanya satu img walau fakta ada', () => {
    const { container } = render(<CountryCard {...props()} />);
    expect(container.querySelectorAll('img')).toHaveLength(1);
  });

  it('C03: flag null (AQ): tanpa img bendera, nama dan fakta tetap tampil', () => {
    const { container } = render(<CountryCard {...props({ name: 'Antarktika', flag: null })} />);
    expect(container.querySelectorAll('img')).toHaveLength(0);
    expect(screen.getByRole('heading', { level: 2, name: 'Antarktika' })).toBeTruthy();
    expect(screen.getByText('Negara kepulauan terbesar di dunia.')).toBeTruthy();
  });

  it('C04: tombol tutup dan dengar lagi memanggil handler masing-masing sekali', () => {
    const onClose = vi.fn();
    const onReplay = vi.fn();
    render(<CountryCard {...props({ onClose, onReplay })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tutup' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onReplay).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Dengar lagi' }));
    expect(onReplay).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('C05: textContent kartu tanpa emoji', () => {
    render(<CountryCard {...props({ icon: { src: '/icons/fact.svg', alt: 'Ikon fakta' } })} />);
    const text = screen.getByRole('region', { name: 'Kartu negara' }).textContent ?? '';
    expect(text.length).toBeGreaterThan(0);
    expect(/\p{Extended_Pictographic}/u.test(text)).toBe(false);
  });

  it('C06: prop icon merender img ikon ber-alt icon.alt', () => {
    render(<CountryCard {...props({ icon: { src: '/icons/fact.svg', alt: 'Ikon fakta' } })} />);
    const img = screen.getByRole('img', { name: 'Ikon fakta' });
    expect(img.getAttribute('src')).toBe('/icons/fact.svg');
    expect(screen.getAllByRole('img')).toHaveLength(2);
  });
});
