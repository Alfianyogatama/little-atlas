/// <reference lib="dom" />
import { expect, type Page } from '@playwright/test';

/** Baca baris progress lewat API IndexedDB mentah (tanpa Dexie). */
export async function readProgressRow(page: Page, key: string): Promise<unknown> {
  return page.evaluate(
    (profileKey) =>
      new Promise<unknown>((resolve, reject) => {
        const open = indexedDB.open('little-atlas');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const get = db.transaction('progress').objectStore('progress').get(profileKey);
          get.onerror = () => reject(get.error);
          get.onsuccess = () => {
            db.close();
            resolve(get.result);
          };
        };
      }),
    key,
  );
}

/** Tulis baris progress mentah (dipakai menanam data rusak). */
export async function writeProgressRow(page: Page, row: Record<string, unknown>): Promise<void> {
  await page.evaluate(
    (value) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('little-atlas');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('progress', 'readwrite');
          tx.objectStore('progress').put(value);
          tx.onerror = () => reject(tx.error);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
        };
      }),
    row,
  );
}

/**
 * Tunggu sampai baris progress 'default' berisi bintang itu di IndexedDB. Tulis IndexedDB asinkron
 * (ADR-002 revisi 19 Okt): bintang yang didapat sesaat sebelum tab ditutup atau dimuat ulang bisa
 * hilang, jadi tes menunggu commit sebelum reload.
 */
export async function waitForSavedStars(page: Page, stars: number): Promise<void> {
  await expect
    .poll(() => readProgressRow(page, 'default'), { message: `bintang ${stars} tersimpan` })
    .toMatchObject({ profileId: 'default', stars });
}
