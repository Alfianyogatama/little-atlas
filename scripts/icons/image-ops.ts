export interface RgbaImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}
type Rgb = readonly [number, number, number];

const INK_TOLERANCE = 24;
/** Cukup lebar untuk noise JPEG di latar, jauh di bawah jarak ke garis luar gelap. */
export const BACKGROUND_TOLERANCE = 56;
const EDGE_BORDER = 2;
const REMOVED_EDGE_RATIO = 0.95;

function dist(d: Uint8ClampedArray, i: number, c: Rgb): number {
  const r = (d[i] ?? 0) - c[0];
  const g = (d[i + 1] ?? 0) - c[1];
  const b = (d[i + 2] ?? 0) - c[2];
  return Math.sqrt(r * r + g * g + b * b);
}

/** Median per kanal dari piksel tepi (border 2 px): warna latar nyata, kebal terhadap objek yang menyentuh tepi. */
export function estimateBackground(img: RgbaImage): [number, number, number] {
  const { width: w, height: h, data } = img;
  const ch: number[][] = [[], [], []];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x >= EDGE_BORDER && x < w - EDGE_BORDER && y >= EDGE_BORDER && y < h - EDGE_BORDER) {
        x = w - EDGE_BORDER - 1;
        continue;
      }
      for (let c = 0; c < 3; c++) ch[c]?.push(data[(y * w + x) * 4 + c] ?? 0);
    }
  }
  const med = (v: number[] | undefined): number => {
    const a = Uint8Array.from(v ?? []).sort();
    return a[Math.floor(a.length / 2)] ?? 0;
  };
  return [med(ch[0]), med(ch[1]), med(ch[2])];
}

/** Benar bila minimal 95% piksel tepi (border 2 px) sudah transparan. */
export function checkBackgroundRemoved(img: RgbaImage): boolean {
  const { width: w, height: h, data } = img;
  let edge = 0;
  let clear = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x >= EDGE_BORDER && x < w - EDGE_BORDER && y >= EDGE_BORDER && y < h - EDGE_BORDER) {
        x = w - EDGE_BORDER - 1;
        continue;
      }
      edge++;
      if ((data[(y * w + x) * 4 + 3] ?? 0) === 0) clear++;
    }
  }
  return edge > 0 && clear / edge >= REMOVED_EDGE_RATIO;
}

/**
 * Hapus semua piksel dalam toleransi warna kunci (termasuk bidang tertutup seperti lubang atau jendela),
 * lalu despill piksel buram di sebelahnya.
 */
export function removeKeyBackground(img: RgbaImage, key: Rgb, tolerance: number): RgbaImage {
  const { width: w, height: h } = img;
  const data = Uint8ClampedArray.from(img.data);
  const removed = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) {
    if (dist(data, p * 4, key) <= tolerance) removed[p] = 1;
  }

  const high = [0, 1, 2].filter((c) => (key[c] ?? 0) > 128);
  const low = [0, 1, 2].filter((c) => (key[c] ?? 0) <= 128);
  const canSpill = high.length > 0 && low.length > 0;
  const out = Uint8ClampedArray.from(data);
  for (let p = 0; p < w * h; p++) {
    const i = p * 4;
    if (removed[p] === 1) {
      out[i + 3] = 0;
      continue;
    }
    if (!canSpill) continue;
    const x = p % w;
    const y = (p - x) / w;
    let near = false;
    for (let dy = -1; dy <= 1 && !near; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        if (removed[ny * w + nx] === 1) {
          near = true;
          break;
        }
      }
    }
    if (!near) continue;
    const lo = Math.max(...low.map((c) => data[i + c] ?? 0));
    const hi = Math.min(...high.map((c) => data[i + c] ?? 0));
    const spill = Math.max(0, hi - lo);
    for (const c of high) out[i + c] = (data[i + c] ?? 0) - spill * ((key[c] ?? 0) / 255);
  }
  return { data: out, width: w, height: h };
}

/** Potong ke kotak pembatas piksel ber-alpha, jadikan persegi dengan padding di tengah. */
export function trimPad(img: RgbaImage, padRatio = 0.08): RgbaImage {
  const { width: w, height: h, data } = img;
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if ((data[(y * w + x) * 4 + 3] ?? 0) === 0) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) throw new Error('Gambar kosong: tidak ada piksel ber-alpha.');
  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  const side = Math.ceil(Math.max(bw, bh) * (1 + 2 * padRatio));
  const offX = Math.floor((side - bw) / 2);
  const offY = Math.floor((side - bh) / 2);
  const out = new Uint8ClampedArray(side * side * 4);
  for (let y = 0; y < bh; y++) {
    const src = ((minY + y) * w + minX) * 4;
    out.set(data.subarray(src, src + bw * 4), ((offY + y) * side + offX) * 4);
  }
  return { data: out, width: side, height: side };
}

/** Rata-rata area berbobot alpha (premultiplied), lalu un-premultiply. */
export function downscale(img: RgbaImage, size: number): RgbaImage {
  const { width: w, height: h, data } = img;
  const out = new Uint8ClampedArray(size * size * 4);
  const sx = w / size;
  const sy = h / size;
  for (let oy = 0; oy < size; oy++) {
    const y0 = oy * sy;
    const y1 = y0 + sy;
    for (let ox = 0; ox < size; ox++) {
      const x0 = ox * sx;
      const x1 = x0 + sx;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let wsum = 0;
      for (let y = Math.floor(y0); y < Math.min(h, Math.ceil(y1)); y++) {
        const wy = Math.min(y + 1, y1) - Math.max(y, y0);
        for (let x = Math.floor(x0); x < Math.min(w, Math.ceil(x1)); x++) {
          const wt = wy * (Math.min(x + 1, x1) - Math.max(x, x0));
          const i = (y * w + x) * 4;
          const pa = (data[i + 3] ?? 0) * wt;
          r += (data[i] ?? 0) * pa;
          g += (data[i + 1] ?? 0) * pa;
          b += (data[i + 2] ?? 0) * pa;
          a += pa;
          wsum += wt;
        }
      }
      const o = (oy * size + ox) * 4;
      if (a > 0) {
        out[o] = r / a;
        out[o + 1] = g / a;
        out[o + 2] = b / a;
        out[o + 3] = a / wsum;
      }
    }
  }
  return { data: out, width: size, height: size };
}

export interface LocalChecks {
  size: number;
  hasAlpha: boolean;
  cornersTransparent: boolean;
  coverage: number;
  colorCount: number;
  inkRatio: number;
  backgroundRemoved: boolean;
}

export function localChecks(
  img: RgbaImage,
  opts: { ink: Rgb; backgroundRemoved?: boolean },
): LocalChecks {
  const { width: w, height: h, data } = img;
  const alphaAt = (x: number, y: number): number => data[(y * w + x) * 4 + 3] ?? 0;
  let hasAlpha = false;
  let visible = 0;
  let ink = 0;
  const colors = new Set<number>();
  for (let p = 0; p < w * h; p++) {
    const i = p * 4;
    const a = data[i + 3] ?? 0;
    if (a < 255) hasAlpha = true;
    if (a === 0) continue;
    visible++;
    colors.add(((data[i] ?? 0) << 16) | ((data[i + 1] ?? 0) << 8) | (data[i + 2] ?? 0));
    if (dist(data, i, opts.ink) <= INK_TOLERANCE) ink++;
  }
  return {
    size: w,
    hasAlpha,
    cornersTransparent:
      alphaAt(0, 0) === 0 &&
      alphaAt(w - 1, 0) === 0 &&
      alphaAt(0, h - 1) === 0 &&
      alphaAt(w - 1, h - 1) === 0,
    coverage: visible / (w * h),
    colorCount: colors.size,
    inkRatio: visible === 0 ? 0 : ink / visible,
    backgroundRemoved: opts.backgroundRemoved ?? true,
  };
}
