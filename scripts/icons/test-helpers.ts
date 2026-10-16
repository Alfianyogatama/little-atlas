// Pembantu tes: membuat byte WebP minimal (hanya header yang valid, bukan citra yang bisa didekode).

function u32(n: number): number[] {
  return [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
}
function u24(n: number): number[] {
  return [n & 255, (n >> 8) & 255, (n >> 16) & 255];
}
const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));

function riff(chunks: number[]): Uint8Array {
  const body = [...ascii('WEBP'), ...chunks];
  return Uint8Array.from([...ascii('RIFF'), ...u32(body.length), ...body]);
}
function chunk(fourcc: string, data: number[]): number[] {
  const pad = data.length % 2 === 1 ? [0] : [];
  return [...ascii(fourcc), ...u32(data.length), ...data, ...pad];
}

export function webpVp8x(width: number, height: number, alpha: boolean): Uint8Array {
  const flags = alpha ? 0x10 : 0;
  return riff(chunk('VP8X', [flags, 0, 0, 0, ...u24(width - 1), ...u24(height - 1)]));
}

export function webpVp8l(width: number, height: number, alpha: boolean): Uint8Array {
  const bits = (width - 1) | ((height - 1) << 14) | ((alpha ? 1 : 0) << 28);
  return riff(chunk('VP8L', [0x2f, ...u32(bits >>> 0), 0, 0, 0, 0]));
}

export function webpVp8(width: number, height: number): Uint8Array {
  return riff(
    chunk('VP8 ', [
      0x10,
      0x00,
      0x00,
      0x9d,
      0x01,
      0x2a,
      width & 255,
      (width >> 8) & 63,
      height & 255,
      (height >> 8) & 63,
      0,
      0,
      0,
      0,
    ]),
  );
}
