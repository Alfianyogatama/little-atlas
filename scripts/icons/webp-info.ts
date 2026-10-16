export interface WebpInfo {
  width: number;
  height: number;
  hasAlpha: boolean;
}

const ascii = (b: Uint8Array, at: number, len: number): string | null => {
  if (at + len > b.length) return null;
  let s = '';
  for (let i = 0; i < len; i++) s += String.fromCharCode(b[at + i] ?? 0);
  return s;
};
const byteAt = (b: Uint8Array, i: number): number => b[i] ?? 0;
const u16 = (b: Uint8Array, i: number): number => byteAt(b, i) | (byteAt(b, i + 1) << 8);
const u24 = (b: Uint8Array, i: number): number => u16(b, i) | (byteAt(b, i + 2) << 16);
const u32 = (b: Uint8Array, i: number): number => (u24(b, i) | (byteAt(b, i + 3) << 24)) >>> 0;

/** Membaca ukuran dan alpha dari header WebP. Mengembalikan null bila bukan WebP atau terpotong. */
export function readWebpInfo(bytes: Uint8Array): WebpInfo | null {
  if (ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP') return null;
  let pos = 12;
  let vp8x: { width: number; height: number; flag: boolean } | null = null;
  while (pos + 8 <= bytes.length) {
    const fourcc = ascii(bytes, pos, 4);
    const size = u32(bytes, pos + 4);
    const data = pos + 8;
    if (data + size > bytes.length) return null;
    if (fourcc === 'VP8X') {
      if (size < 10) return null;
      vp8x = {
        flag: (byteAt(bytes, data) & 0x10) !== 0,
        width: u24(bytes, data + 4) + 1,
        height: u24(bytes, data + 7) + 1,
      };
    } else if (fourcc === 'ALPH' && vp8x) {
      vp8x.flag = true;
    } else if (fourcc === 'VP8L') {
      if (size < 5 || byteAt(bytes, data) !== 0x2f) return null;
      const bits = u32(bytes, data + 1);
      return {
        width: (bits & 0x3fff) + 1,
        height: ((bits >>> 14) & 0x3fff) + 1,
        hasAlpha: ((bits >>> 28) & 1) === 1,
      };
    } else if (fourcc === 'VP8 ') {
      if (size < 10) return null;
      if (byteAt(bytes, data + 3) !== 0x9d || byteAt(bytes, data + 4) !== 0x01) return null;
      if (byteAt(bytes, data + 5) !== 0x2a) return null;
      return {
        width: vp8x?.width ?? u16(bytes, data + 6) & 0x3fff,
        height: vp8x?.height ?? u16(bytes, data + 8) & 0x3fff,
        hasAlpha: vp8x?.flag ?? false,
      };
    }
    pos = data + size + (size % 2);
  }
  return vp8x ? { width: vp8x.width, height: vp8x.height, hasAlpha: vp8x.flag } : null;
}
