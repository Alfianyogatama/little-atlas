// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import enMessages from '../../../messages/en.json' with { type: 'json' };
import idMessages from '../../../messages/id.json' with { type: 'json' };
import { m } from '@/paraglide/messages.js';
import { setAppLocale } from '@/services/i18n/locale';
import { useLocale } from './useLocale';

function WithHook() {
  useLocale();
  return <button aria-label={m.globe_zoom_in()} />;
}

// Kontrol: tanpa useLocale(), komponen tidak render ulang saat bahasa berganti.
function WithoutHook() {
  return <button aria-label={m.globe_zoom_in()} />;
}

afterEach(() => {
  cleanup();
  act(() => setAppLocale('id'));
});

describe('useLocale', () => {
  it('label ikut berganti dan elemen tombol tidak di-remount', () => {
    render(<WithHook />);
    const before = screen.getByRole('button', { name: idMessages.globe_zoom_in });
    act(() => setAppLocale('en'));
    const after = screen.getByRole('button', { name: enMessages.globe_zoom_in });
    expect(after).toBe(before);
    expect(screen.queryByRole('button', { name: idMessages.globe_zoom_in })).toBeNull();
  });

  it('kontrol tanpa useLocale(): label basi setelah ganti bahasa', () => {
    render(<WithoutHook />);
    const before = screen.getByRole('button', { name: idMessages.globe_zoom_in });
    act(() => setAppLocale('en'));
    expect(screen.queryByRole('button', { name: enMessages.globe_zoom_in })).toBeNull();
    expect(before.getAttribute('aria-label')).toBe(idMessages.globe_zoom_in);
  });
});
