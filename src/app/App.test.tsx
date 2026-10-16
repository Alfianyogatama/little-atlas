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

  it('belum menampilkan teks antarmuka sampai Paraglide (#7)', () => {
    const { container } = render(<App />);
    expect(container.textContent?.trim()).toBe('');
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
