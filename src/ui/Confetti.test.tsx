// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Confetti } from './Confetti';

function stubMotion(reduce: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: reduce && query.includes('prefers-reduced-motion'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onchange: null,
    })),
  );
}

function pieces(container: HTMLElement): number {
  return container.querySelectorAll('[data-confetti-piece]').length;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Confetti', () => {
  it('CF01: reduced motion: tidak merender keping apa pun', () => {
    stubMotion(true);
    const { container } = render(<Confetti size="big" />);
    expect(pieces(container)).toBe(0);
    expect(container.querySelector('[data-confetti]')).toBeNull();
  });

  it('CF02: reduced motion juga berlaku untuk ukuran small', () => {
    stubMotion(true);
    const { container } = render(<Confetti size="small" />);
    expect(pieces(container)).toBe(0);
  });

  it('CF03: tanpa reduced motion: merender keping', () => {
    stubMotion(false);
    const { container } = render(<Confetti size="small" />);
    expect(pieces(container)).toBeGreaterThan(0);
  });

  it('CF04: big memunculkan lebih banyak keping daripada small', () => {
    stubMotion(false);
    const small = render(<Confetti size="small" />);
    const smallCount = pieces(small.container);
    small.unmount();
    const big = render(<Confetti size="big" />);
    expect(pieces(big.container)).toBeGreaterThan(smallCount);
  });

  it('CF05: aria-hidden pada pembungkus dan tidak ada teks', () => {
    stubMotion(false);
    const { container } = render(<Confetti size="big" />);
    const root = container.querySelector('[data-confetti]');
    expect(root).not.toBeNull();
    expect(root?.getAttribute('aria-hidden')).toBe('true');
    expect(root?.textContent?.trim()).toBe('');
  });

  it('CF06: semua keping berada di dalam pembungkus aria-hidden', () => {
    stubMotion(false);
    const { container } = render(<Confetti size="small" />);
    const all = container.querySelectorAll('[data-confetti-piece]');
    expect(all.length).toBeGreaterThan(0);
    for (const piece of all) {
      expect(piece.closest('[aria-hidden="true"]')).not.toBeNull();
    }
  });
});
