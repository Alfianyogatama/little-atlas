import { describe, expect, it } from 'vitest';
import enMessages from '../../messages/en.json' with { type: 'json' };
import idMessages from '../../messages/id.json' with { type: 'json' };

// Copy yang disetujui pemilik (.tmp/plan-6/PLAN.md, bagian "Copy"). Jangan diubah tanpa persetujuan.
const COPY: Record<string, { id: string; en: string }> = {
  mode_explore: { id: 'Jelajah', en: 'Explore' },
  mode_quiz: { id: 'Tebak Bendera', en: 'Guess the Flag' },
  quiz_ask_text: { id: 'Mana bendera {name}?', en: 'Which flag is {name}?' },
  quiz_ask_speech: {
    id: 'Ini {name}. Mana benderanya?',
    en: 'This is {name}. Which one is its flag?',
  },
  quiz_listen_again: { id: 'Dengar lagi', en: 'Listen again' },
  quiz_choice_label: { id: 'Bendera {name}', en: 'Flag of {name}' },
  quiz_praise_1: { id: 'Hebat!', en: 'Great job!' },
  quiz_praise_2: { id: 'Pintar!', en: 'Clever!' },
  quiz_praise_3: { id: 'Betul!', en: "That's right!" },
  quiz_praise_4: { id: 'Keren!', en: 'Awesome!' },
  quiz_praise_flag: { id: 'Itu bendera {name}.', en: 'That is the flag of {name}.' },
  quiz_try_again: { id: 'Coba lagi ya!', en: "Let's try again!" },
  quiz_stars_label: { id: 'Bintang: {count}', en: 'Stars: {count}' },
  quiz_celebrate_text: { id: 'Hore! {count} bintang!', en: 'Hooray! {count} stars!' },
  quiz_celebrate_speech: {
    id: 'Hore! Kamu dapat {count} bintang! Hebat sekali!',
    en: 'Hooray! You got {count} stars! Amazing!',
  },
  quiz_celebrate_many_speech: {
    id: 'Hore! Bintangmu banyak sekali! Hebat!',
    en: 'Hooray! You have so many stars! Amazing!',
  },
  quiz_region_label: { id: 'Soal Tebak Bendera', en: 'Flag quiz' },
};

const id = idMessages as Record<string, unknown>;
const en = enMessages as Record<string, unknown>;

describe('copy Tebak Bendera (#6): teks persis seperti yang disetujui pemilik', () => {
  it('tabel copy mencakup 17 key', () => {
    expect(Object.keys(COPY)).toHaveLength(17);
  });

  it.each(Object.entries(COPY))('%s: id dan en sesuai tabel', (key, text) => {
    expect(id[key], `id:${key}`).toBe(text.id);
    expect(en[key], `en:${key}`).toBe(text.en);
  });

  it('semua key mode_* dan quiz_* di katalog termasuk tabel (tanpa key liar)', () => {
    const present = (catalog: Record<string, unknown>) =>
      Object.keys(catalog)
        .filter((key) => key.startsWith('mode_') || key.startsWith('quiz_'))
        .sort();
    const expected = Object.keys(COPY).sort();
    expect(present(id)).toEqual(expected);
    expect(present(en)).toEqual(expected);
  });

  it('tidak ada kata "salah" atau "gagal" untuk anak (AGENTS.md)', () => {
    for (const key of Object.keys(COPY)) {
      expect(String(id[key]).toLowerCase(), `id:${key}`).not.toMatch(/\b(salah|gagal)\b/);
      expect(String(en[key]).toLowerCase(), `en:${key}`).not.toMatch(/\b(wrong|fail|failed)\b/);
    }
  });
});
