// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from './App';

afterEach(cleanup);

describe('App', () => {
  it('dirender tanpa error dan punya landmark main', () => {
    expect(() => render(<App />)).not.toThrow();
    expect(screen.getByRole('main')).toBeTruthy();
  });

  it('belum menampilkan teks antarmuka sampai Paraglide (#7)', () => {
    const { container } = render(<App />);
    expect(container.textContent?.trim()).toBe('');
  });
});
