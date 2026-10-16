import { describe, expect, it } from 'vitest';
import { readWebpInfo } from './webp-info';
import { webpVp8, webpVp8l, webpVp8x } from './test-helpers';

describe('readWebpInfo', () => {
  it('membaca VP8X dengan flag alpha', () => {
    expect(readWebpInfo(webpVp8x(256, 256, true))).toEqual({
      width: 256,
      height: 256,
      hasAlpha: true,
    });
  });
  it('VP8X tanpa flag alpha dilaporkan hasAlpha false dan ukuran tak persegi dibaca benar', () => {
    expect(readWebpInfo(webpVp8x(300, 120, false))).toEqual({
      width: 300,
      height: 120,
      hasAlpha: false,
    });
  });
  it('membaca VP8L 256x256 beserta bit alpha', () => {
    expect(readWebpInfo(webpVp8l(256, 256, true))).toEqual({
      width: 256,
      height: 256,
      hasAlpha: true,
    });
    expect(readWebpInfo(webpVp8l(256, 256, false))?.hasAlpha).toBe(false);
  });
  it('membaca VP8 (lossy tanpa alpha)', () => {
    expect(readWebpInfo(webpVp8(640, 480))).toEqual({ width: 640, height: 480, hasAlpha: false });
  });
  it('PNG mengembalikan null', () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
    expect(readWebpInfo(png)).toBeNull();
  });
  it('HTML dan buffer kosong atau terpotong mengembalikan null', () => {
    expect(readWebpInfo(new TextEncoder().encode('<!doctype html><html></html>'))).toBeNull();
    expect(readWebpInfo(new Uint8Array(0))).toBeNull();
    expect(readWebpInfo(webpVp8x(256, 256, true).subarray(0, 14))).toBeNull();
  });
  it('RIFF yang bukan WEBP mengembalikan null', () => {
    const wav = Uint8Array.from(webpVp8x(256, 256, true));
    wav.set(new TextEncoder().encode('WAVE'), 8);
    expect(readWebpInfo(wav)).toBeNull();
  });
});
