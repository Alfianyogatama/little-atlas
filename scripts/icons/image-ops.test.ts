import { describe, expect, it } from 'vitest';
import {
  BACKGROUND_TOLERANCE,
  checkBackgroundRemoved,
  downscale,
  estimateBackground,
  localChecks,
  removeKeyBackground,
  trimPad,
  type RgbaImage,
} from './image-ops';

type Rgb = [number, number, number];
const KEY: Rgb = [255, 0, 255];
const INK: Rgb = [30, 30, 30];
const WHITE: Rgb = [255, 255, 255];

function make(w: number, h: number, fill: Rgb, a = 255): RgbaImage {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set([...fill, a], i * 4);
  return { data, width: w, height: h };
}
function put(img: RgbaImage, x: number, y: number, c: Rgb, a = 255): void {
  img.data.set([...c, a], (y * img.width + x) * 4);
}
function px(img: RgbaImage, x: number, y: number): [number, number, number, number] {
  const i = (y * img.width + x) * 4;
  const d = img.data;
  return [d[i] ?? -1, d[i + 1] ?? -1, d[i + 2] ?? -1, d[i + 3] ?? -1];
}
function rect(img: RgbaImage, x0: number, y0: number, x1: number, y1: number, c: Rgb): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) put(img, x, y, c);
}
/** Kotak putih 8x8 (x,y 6..13) bergaris ink 1 piksel, di atas latar kunci 20x20. */
function boxOnKey(): RgbaImage {
  const img = make(20, 20, KEY);
  rect(img, 6, 6, 13, 13, INK);
  rect(img, 7, 7, 12, 12, WHITE);
  return img;
}

describe('removeKeyBackground', () => {
  it('latar yang terhubung ke tepi menjadi transparan, isi objek tetap buram', () => {
    const out = removeKeyBackground(boxOnKey(), KEY, 40);
    for (const [x, y] of [
      [0, 0],
      [19, 0],
      [0, 19],
      [19, 19],
      [10, 2],
    ] as const) {
      expect(px(out, x, y)[3]).toBe(0);
    }
    expect(px(out, 10, 10)).toEqual([...WHITE, 255]);
    expect(px(out, 6, 6)[3]).toBe(255);
  });
  // Remap (issue #25): kontrak lama "pulau warna kunci di dalam garis luar tidak terhapus" diganti.
  // Bidang tertutup bewarna latar (jendela, lubang, celah) kini harus ikut transparan.
  it('pulau warna kunci yang tertutup garis luar ikut menjadi transparan, isi lain tetap', () => {
    const img = boxOnKey();
    rect(img, 9, 9, 10, 10, KEY);
    const out = removeKeyBackground(img, KEY, 40);
    expect(px(out, 9, 9)[3]).toBe(0);
    expect(px(out, 10, 10)[3]).toBe(0);
    expect(px(out, 8, 8)).toEqual([...WHITE, 255]);
    expect(px(out, 6, 6)[3]).toBe(255);
    expect(px(out, 0, 0)[3]).toBe(0);
  });
  it('tepi anti-alias di-despill sehingga tidak lagi kemerahan-magenta', () => {
    const img = boxOnKey();
    // cincin piksel campuran 50% ink + 50% magenta di luar garis luar
    const mix: Rgb = [143, 15, 143];
    for (let x = 5; x <= 14; x++) {
      put(img, x, 5, mix);
      put(img, x, 14, mix);
    }
    for (let y = 5; y <= 14; y++) {
      put(img, 5, y, mix);
      put(img, 14, y, mix);
    }
    const out = removeKeyBackground(img, KEY, 40);
    const [r, g, b, a] = px(out, 10, 5);
    if (a > 0) {
      expect(r - g).toBeLessThan(64);
      expect(b - g).toBeLessThan(64);
    }
    // bagian dalam objek tidak berubah
    expect(px(out, 10, 10)).toEqual([...WHITE, 255]);
  });
  it('tidak mengubah gambar masukan', () => {
    const img = boxOnKey();
    const before = Uint8ClampedArray.from(img.data);
    removeKeyBackground(img, KEY, 40);
    expect(img.data).toEqual(before);
  });
});

describe('trimPad', () => {
  function sprite(): RgbaImage {
    const img = make(100, 100, [0, 0, 0], 0);
    rect(img, 20, 30, 39, 69, INK); // 20 lebar x 40 tinggi
    return img;
  }
  it('menghasilkan persegi berisi bbox ditambah padding', () => {
    const out = trimPad(sprite());
    expect(out.width).toBe(out.height);
    expect(out.width).toBeGreaterThanOrEqual(46);
    expect(out.width).toBeLessThanOrEqual(48);
  });
  it('objek tetap utuh dan berada di tengah', () => {
    const out = trimPad(sprite());
    let n = 0;
    let minX = out.width;
    let maxX = -1;
    for (let y = 0; y < out.height; y++)
      for (let x = 0; x < out.width; x++)
        if (px(out, x, y)[3] > 0) {
          n++;
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
        }
    expect(n).toBe(20 * 40);
    expect(Math.abs((minX + maxX) / 2 - (out.width - 1) / 2)).toBeLessThanOrEqual(1);
  });
  it('padRatio 0 menghasilkan persegi sisi terpanjang', () => {
    const out = trimPad(sprite(), 0);
    expect(out.width).toBe(40);
    expect(out.height).toBe(40);
  });
  it('gambar kosong melempar error yang jelas', () => {
    expect(() => trimPad(make(10, 10, [0, 0, 0], 0))).toThrow(/kosong/i);
  });
});

describe('downscale', () => {
  it('hasilnya size x size dan warna rata mempertahankan warnanya', () => {
    const out = downscale(make(64, 64, [10, 200, 30]), 16);
    expect(out.width).toBe(16);
    expect(out.height).toBe(16);
    expect(out.data.length).toBe(16 * 16 * 4);
    expect(px(out, 8, 8)).toEqual([10, 200, 30, 255]);
  });
  it('piksel transparan berwarna magenta tidak mencemari tepi', () => {
    const img = make(64, 64, KEY, 0); // RGB kotor, alpha 0
    rect(img, 18, 18, 45, 45, WHITE);
    const out = downscale(img, 16);
    let seenPartial = false;
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const [r, g, b, a] = px(out, x, y);
        if (a > 0) {
          expect(Math.min(r, g, b)).toBeGreaterThanOrEqual(240);
          if (a < 255) seenPartial = true;
        }
      }
    expect(seenPartial).toBe(true);
    expect(px(out, 0, 0)[3]).toBe(0);
  });
});

describe('localChecks', () => {
  function sample(): RgbaImage {
    const img = make(10, 10, KEY, 0);
    rect(img, 2, 2, 7, 7, WHITE);
    for (let i = 2; i <= 7; i++) {
      put(img, i, 2, INK);
      put(img, i, 7, INK);
      put(img, 2, i, INK);
      put(img, 7, i, INK);
    }
    return img;
  }
  it('melaporkan ukuran, alpha, sudut transparan, cakupan, jumlah warna, dan porsi ink', () => {
    const r = localChecks(sample(), { ink: INK });
    expect(r.size).toBe(10);
    expect(r.hasAlpha).toBe(true);
    expect(r.cornersTransparent).toBe(true);
    expect(r.coverage).toBeCloseTo(0.36, 5);
    expect(r.colorCount).toBe(2);
    expect(r.inkRatio).toBeCloseTo(20 / 36, 5);
  });
  it('sudut buram dan tanpa alpha terdeteksi', () => {
    const r = localChecks(make(10, 10, WHITE), { ink: INK });
    expect(r.hasAlpha).toBe(false);
    expect(r.cornersTransparent).toBe(false);
    expect(r.coverage).toBe(1);
    expect(r.colorCount).toBe(1);
    expect(r.inkRatio).toBe(0);
  });
});

// Sampel nyata: Gemini mengembalikan JPEG berlatar ~#E84AE0 dengan noise, bukan #FF00FF.
const REAL_BG: Rgb = [0xe8, 0x4a, 0xe0];

function noisyBackdrop(w: number, h: number, amp: number): RgbaImage {
  const img = make(w, h, REAL_BG);
  let seed = 12345;
  const rnd = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return Math.round(((seed % 1000) / 999) * 2 * amp - amp);
  };
  for (let i = 0; i < w * h; i++) {
    for (let c = 0; c < 3; c++) {
      img.data[i * 4 + c] = (img.data[i * 4 + c] ?? 0) + rnd();
    }
  }
  return img;
}
/** Latar bernoise + cincin ink (16..47) berisi putih dan "pulau" berwarna latar (24..29) dikelilingi ink. */
function iconOnNoisyBackdrop(): RgbaImage {
  const img = noisyBackdrop(64, 64, 12);
  rect(img, 16, 16, 47, 47, INK);
  rect(img, 18, 18, 45, 45, WHITE);
  rect(img, 22, 22, 31, 31, INK);
  rect(img, 23, 23, 30, 30, REAL_BG);
  return img;
}

describe('estimateBackground', () => {
  it('median piksel tepi (border 2 px) mendekati warna latar nyata meski ada noise dan objek', () => {
    const [r, g, b] = estimateBackground(iconOnNoisyBackdrop());
    expect(Math.hypot(r - REAL_BG[0], g - REAL_BG[1], b - REAL_BG[2])).toBeLessThanOrEqual(8);
  });
  it('tidak terpengaruh piksel objek yang tidak menyentuh tepi', () => {
    const img = make(20, 20, KEY);
    rect(img, 2, 2, 17, 17, WHITE);
    expect(estimateBackground(img)).toEqual([255, 0, 255]);
  });
});

describe('removeKeyBackground dengan kunci hasil estimateBackground', () => {
  // Remap (issue #25): pulau berwarna latar yang tertutup kini transparan, bukan buram.
  it('menghapus semua piksel tepi dan pulau berwarna latar yang tertutup; objek dan area putih tetap buram', () => {
    expect(BACKGROUND_TOLERANCE).toBeGreaterThanOrEqual(24);
    const src = iconOnNoisyBackdrop();
    const out = removeKeyBackground(src, estimateBackground(src), BACKGROUND_TOLERANCE);
    const w = out.width;
    for (let i = 0; i < w; i++) {
      for (const [x, y] of [
        [i, 0],
        [i, w - 1],
        [0, i],
        [w - 1, i],
      ] as const) {
        expect(px(out, x, y)[3]).toBe(0);
      }
    }
    for (const [x, y] of [
      [16, 16],
      [20, 40],
      [40, 20],
      [47, 47],
      [22, 22],
      [31, 31],
    ] as const) {
      expect(px(out, x, y)[3]).toBe(255);
    }
    for (const [x, y] of [
      [26, 26],
      [23, 23],
      [30, 30],
      [23, 30],
      [30, 23],
    ] as const) {
      expect(px(out, x, y)[3], `pulau (${x},${y})`).toBe(0);
    }
    expect(px(out, 8, 8)[3]).toBe(0);
  });
});

describe('checkBackgroundRemoved', () => {
  it('true bila porsi piksel tepi ber-alpha 0 >= 0.95', () => {
    const src = iconOnNoisyBackdrop();
    const out = removeKeyBackground(src, estimateBackground(src), BACKGROUND_TOLERANCE);
    expect(checkBackgroundRemoved(out)).toBe(true);
  });
  it('false bila latar tidak terhapus (kunci salah, tepi tetap buram)', () => {
    const src = iconOnNoisyBackdrop();
    const out = removeKeyBackground(src, KEY, 60);
    expect(checkBackgroundRemoved(out)).toBe(false);
  });
  it('localChecks meneruskan backgroundRemoved sebagai boolean', () => {
    expect(localChecks(make(10, 10, WHITE), { ink: INK, backgroundRemoved: false })).toMatchObject({
      backgroundRemoved: false,
    });
    expect(localChecks(make(10, 10, WHITE), { ink: INK, backgroundRemoved: true })).toMatchObject({
      backgroundRemoved: true,
    });
  });
});

// ---------------------------------------------------------------------------
// Issue #25: bidang latar tertutup (bukan terhubung ke tepi) harus ikut dihapus.
// Latar nyata dari Gemini kira-kira #E84AE0 dengan noise JPEG, bukan #FF00FF.
// ---------------------------------------------------------------------------
describe('pasca-proses latar nyata: bidang tertutup', () => {
  const BG: Rgb = [0xe8, 0x4a, 0xe0];
  const RING_INK: Rgb = [0x1d, 0x3a, 0x6e];
  const ORANGE: Rgb = [0xff, 0xb8, 0x6b];
  const PURPLE: Rgb = [0xb4, 0x9b, 0xf2];
  const PINK: Rgb = [0xff, 0x8f, 0xab];
  const colorDist = (a: Rgb, b: Rgb): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

  function noisy(seed: number): () => number {
    let s = seed;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return (s % 21) - 10; // -10..10
    };
  }

  /** 96x64: cincin ink di kiri (lubang bewarna latar), kotak ber-garis ink di kanan dengan tiga isi berwarna. */
  function scene(): RgbaImage {
    const w = 96;
    const h = 64;
    const rnd = noisy(7);
    const img = make(w, h, BG);
    const cx = 28;
    const cy = 32;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const r = Math.hypot(x - cx, y - cy);
        let c: Rgb = BG;
        if (r <= 24 && r > 12) c = RING_INK;
        if (x >= 60 && x <= 90 && y >= 12 && y <= 52) c = RING_INK;
        if (x >= 63 && x <= 87 && y >= 15 && y <= 49) {
          c = x < 71 ? ORANGE : x < 79 ? PURPLE : PINK;
        }
        const n = (): number => rnd();
        put(img, x, y, [c[0] + n(), c[1] + n(), c[2] + n()] as Rgb);
      }
    }
    return img;
  }
  const run = (): RgbaImage => {
    const img = scene();
    return removeKeyBackground(img, estimateBackground(img), BACKGROUND_TOLERANCE);
  };

  it('titik uji kontrol berjarak dari latar di atas toleransi', () => {
    for (const c of [ORANGE, PURPLE, PINK, RING_INK]) {
      expect(colorDist(c, BG) - 17.4).toBeGreaterThan(BACKGROUND_TOLERANCE); // 17.4 = noise maksimum
    }
  });

  it('bidang tertutup bewarna latar di tengah cincin menjadi alpha 0', () => {
    const out = run();
    for (const [x, y] of [
      [28, 32],
      [24, 30],
      [32, 34],
      [28, 24],
      [28, 40],
      [22, 32],
    ] as const) {
      expect(px(out, x, y)[3], `titik (${x},${y})`).toBe(0);
    }
  });

  it('latar luar tetap transparan dan cincin tetap buram dengan warna ink', () => {
    const out = run();
    expect(px(out, 0, 0)[3]).toBe(0);
    expect(px(out, 50, 5)[3]).toBe(0);
    for (const [x, y] of [
      [28, 14], // r=18
      [28, 50],
      [12, 32],
      [44, 32],
    ] as const) {
      const [r, g, b, a] = px(out, x, y);
      expect(a, `alpha (${x},${y})`).toBe(255);
      expect(colorDist([r, g, b], RING_INK)).toBeLessThanOrEqual(20);
    }
  });

  it('kontrol: isi oranye, ungu, dan pink di dalam garis luar tidak ikut terhapus', () => {
    const out = run();
    const probes: [number, number, Rgb][] = [
      [66, 30, ORANGE],
      [75, 30, PURPLE],
      [84, 30, PINK],
      [66, 20, ORANGE],
      [84, 44, PINK],
    ];
    for (const [x, y, c] of probes) {
      const [r, g, b, a] = px(out, x, y);
      expect(a, `alpha (${x},${y})`).toBe(255);
      expect(colorDist([r, g, b], c)).toBeLessThanOrEqual(20);
    }
  });
});
