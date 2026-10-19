// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initialProgress, type Progress, type ProgressRepository } from '@/domain/progress';
import { setAppLocale } from '@/services/i18n/locale';
import { App } from './App';

// Layar kuis memuat globe WebGL; di jsdom diganti stub yang hanya meneruskan prop bintang dan
// pemanggilan onStarsChange (kontrak App #10). Layar Jelajah tetap asli.
vi.mock('@/features/flag-quiz/FlagQuizScreen', () => ({
  FlagQuizScreen: (props: { stars: number; onStarsChange: (stars: number) => void }) => (
    <div>
      <output aria-label="stub-bintang">{props.stars}</output>
      <button type="button" onClick={() => props.onStarsChange(props.stars + 1)}>
        stub-tambah
      </button>
    </div>
  ),
}));

function fakeRepository(overrides: Partial<ProgressRepository> = {}): ProgressRepository {
  return {
    load: vi.fn(() => Promise.resolve(initialProgress())),
    saveStars: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

function renderApp(
  progress: Progress = initialProgress(),
  repository: ProgressRepository = fakeRepository(),
) {
  return render(<App repository={repository} initialProgress={progress} />);
}

afterEach(() => {
  cleanup();
  act(() => setAppLocale('id'));
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

describe('App', () => {
  it('dirender tanpa error dan punya landmark main', () => {
    expect(() => renderApp()).not.toThrow();
    expect(screen.getByRole('main')).toBeTruthy();
  });

  it('semua teks antarmuka berasal dari message key sesuai locale (#7, #6)', () => {
    const { container } = renderApp();
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
    renderApp();
    const before = screen.getByRole('main');
    act(() => setAppLocale('en'));
    expect(document.documentElement.lang).toBe('en');
    expect(screen.getByRole('main')).toBe(before);
    expect(before.isConnected).toBe(true);
  });

  describe('penyimpanan bintang (#10, F-11.1)', () => {
    function openQuiz() {
      fireEvent.click(screen.getByRole('button', { name: 'Tebak Bendera' }));
    }

    it('bintang awal diambil dari initialProgress.stars', () => {
      renderApp({ ...initialProgress(), stars: 6 });
      expect(screen.getByRole('status', { name: 'Bintang: 6' })).toBeTruthy();
      openQuiz();
      expect(screen.getByLabelText('stub-bintang').textContent).toBe('6');
    });

    it('bintang berubah: saveStars("default", n) dipanggil dan UI ikut berubah', () => {
      const repository = fakeRepository();
      renderApp({ ...initialProgress(), stars: 2 }, repository);
      openQuiz();
      fireEvent.click(screen.getByRole('button', { name: 'stub-tambah' }));
      expect(repository.saveStars).toHaveBeenCalledTimes(1);
      expect(repository.saveStars).toHaveBeenCalledWith('default', 3);
      expect(screen.getByLabelText('stub-bintang').textContent).toBe('3');
      fireEvent.click(screen.getByRole('button', { name: 'stub-tambah' }));
      expect(repository.saveStars).toHaveBeenLastCalledWith('default', 4);
    });

    it('tanpa perubahan bintang saveStars tidak dipanggil (kontrol positif untuk tes di atas)', () => {
      const repository = fakeRepository();
      renderApp({ ...initialProgress(), stars: 2 }, repository);
      openQuiz();
      expect(repository.saveStars).not.toHaveBeenCalled();
    });

    it('saveStars yang reject: console.warn, UI tetap menampilkan bintang baru, tanpa crash', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const repository = fakeRepository({
        saveStars: vi.fn(() => Promise.reject(new Error('disk penuh'))),
      });
      renderApp(initialProgress(), repository);
      openQuiz();
      fireEvent.click(screen.getByRole('button', { name: 'stub-tambah' }));
      await vi.waitFor(() => expect(warn).toHaveBeenCalled());
      expect(screen.getByLabelText('stub-bintang').textContent).toBe('1');
      // Tanpa crash: stub masih ada dan bisa diklik lagi, bintang naik, saveStars dipanggil dua kali.
      fireEvent.click(screen.getByRole('button', { name: 'stub-tambah' }));
      expect(screen.getByLabelText('stub-bintang').textContent).toBe('2');
      expect(repository.saveStars).toHaveBeenCalledTimes(2);
    });

    it('tidak ada listener beforeunload yang dipasang (fitur peringatan dihapus)', () => {
      const add = vi.spyOn(window, 'addEventListener');
      renderApp({ ...initialProgress(), stars: 3 });
      expect(add.mock.calls.filter(([type]) => type === 'beforeunload')).toHaveLength(0);
    });
  });
});
