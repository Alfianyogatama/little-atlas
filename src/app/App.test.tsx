// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { setAppLocale } from '@/services/i18n/locale';
import { App } from './App';

afterEach(() => {
  cleanup();
  act(() => setAppLocale('id'));
});

describe('App', () => {
  it('dirender tanpa error dan punya landmark main', () => {
    expect(() => render(<App />)).not.toThrow();
    expect(screen.getByRole('main')).toBeTruthy();
  });

  it('semua teks antarmuka berasal dari message key sesuai locale (#7, #6)', () => {
    const { container } = render(<App />);
    expect(screen.getByRole('button', { name: 'Jelajah' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tebak Bendera' })).toBeTruthy();
    expect(screen.getByRole('status', { name: 'Bintang: 0' })).toBeTruthy();

    // Teks hanya label mode, label bintang (sr-only), dan angka bintang; sisanya harus kosong.
    const leftover = (container.textContent ?? '')
      .replace('Jelajah', '')
      .replace('Tebak Bendera', '')
      .replace('Bintang: 0', '')
      .replace('0', '')
      .trim();
    expect(leftover).toBe('');

    const main = screen.getByRole('main');
    act(() => setAppLocale('en'));
    expect(screen.getByRole('main')).toBe(main);
    expect(screen.getByRole('button', { name: 'Explore' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Guess the Flag' })).toBeTruthy();
    expect(screen.getByRole('status', { name: 'Stars: 0' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Jelajah' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Tebak Bendera' })).toBeNull();
    const leftoverEn = (container.textContent ?? '')
      .replace('Explore', '')
      .replace('Guess the Flag', '')
      .replace('Stars: 0', '')
      .replace('0', '')
      .trim();
    expect(leftoverEn).toBe('');
  });

  it('ganti bahasa memperbarui <html lang> tanpa me-remount subtree aplikasi', () => {
    render(<App />);
    const before = screen.getByRole('main');
    act(() => setAppLocale('en'));
    expect(document.documentElement.lang).toBe('en');
    expect(screen.getByRole('main')).toBe(before);
    expect(before.isConnected).toBe(true);
  });
});
