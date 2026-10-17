import { describe, expect, it } from 'vitest';
import { parseArgs } from './samples-cli';

// Kontrak tambahan yang ditetapkan tes ini:
// - parseArgs(argv) -> { voices?, limit?, mode? }; kunci yang tidak diberikan tidak ada di hasil.
//   --voices Aoede,Leda (daftar dipisah koma, hanya Aoede/Leda/Kore), --limit N (bilangan bulat >= 1),
//   --mode transcript|system|plain (menimpa promptMode di voice.json). Argumen salah melempar Error.
// - Mengimpor samples-cli tidak boleh menjalankan main() (guard process.argv[1]).

describe('samples-cli parseArgs', () => {
  it('TC-AUD49-CLI-2: tanpa argumen menghasilkan objek kosong', () => {
    expect(parseArgs([])).toEqual({});
    expect(Object.keys(parseArgs([]))).toEqual([]);
  });

  it('TC-AUD49-CLI-2: --voices, --limit, --mode valid, dalam urutan apa pun', () => {
    expect(parseArgs(['--voices', 'Aoede,Leda'])).toEqual({ voices: ['Aoede', 'Leda'] });
    expect(parseArgs(['--voices', 'Kore'])).toEqual({ voices: ['Kore'] });
    expect(parseArgs(['--limit', '2'])).toEqual({ limit: 2 });
    expect(parseArgs(['--mode', 'transcript'])).toEqual({ mode: 'transcript' });
    expect(parseArgs(['--mode', 'system'])).toEqual({ mode: 'system' });
    expect(parseArgs(['--mode', 'system', '--limit', '2', '--voices', 'Aoede,Leda'])).toEqual({
      voices: ['Aoede', 'Leda'],
      limit: 2,
      mode: 'system',
    });
  });

  it('TC-AUD49-CLI-2: argumen salah melempar', () => {
    const bad: string[][] = [
      ['--voices'],
      ['--voices', '--limit', '2'],
      ['--voices', 'Zephyr'],
      ['--voices', 'Aoede,Zephyr'],
      ['--limit'],
      ['--limit', '0'],
      ['--limit', '-1'],
      ['--limit', '1.5'],
      ['--limit', 'dua'],
      ['--mode'],
      ['--mode', 'inline'],
      ['--mode', 'System'],
      ['--tidak-dikenal'],
      ['Aoede'],
    ];
    for (const argv of bad) expect(() => parseArgs(argv), argv.join(' ')).toThrow();
  });
});

describe('samples-cli parseArgs: mode plain', () => {
  it('TC-AUD49-CLI-3: --mode plain valid, --mode foo tetap melempar', () => {
    expect(parseArgs(['--mode', 'plain'])).toEqual({ mode: 'plain' });
    expect(parseArgs(['--mode', 'plain', '--voices', 'Leda'])).toEqual({
      mode: 'plain',
      voices: ['Leda'],
    });
    expect(() => parseArgs(['--mode', 'foo'])).toThrow();
    expect(() => parseArgs(['--mode', 'Plain'])).toThrow();
  });
});
