import { describe, expect, it } from 'vitest';
import { JUMP_DURATION, jumpProfile } from './index';

describe('jump: jumpProfile', () => {
  it('durasi total 0,7 detik', () => {
    expect(JUMP_DURATION).toBe(0.7);
  });

  it('lift dan wobble nol sebelum ketukan dan setelah durasi', () => {
    for (const t of [-1, 0, JUMP_DURATION, 1, 10]) {
      const p = jumpProfile(t);
      expect(p.lift).toBe(0);
      expect(p.wobble).toBeCloseTo(0, 9);
    }
  });

  it('nilai selalu berhingga dan lift tidak negatif', () => {
    for (let t = -0.2; t <= 1; t += 0.01) {
      const p = jumpProfile(t);
      expect(Number.isFinite(p.lift)).toBe(true);
      expect(Number.isFinite(p.wobble)).toBe(true);
      expect(p.lift).toBeGreaterThanOrEqual(0);
    }
  });

  it('puncak lift di sekitar sepertiga awal dan tidak lebih dari 0,12', () => {
    let peakT = 0;
    let peak = 0;
    for (let t = 0; t <= JUMP_DURATION; t += 0.005) {
      const { lift } = jumpProfile(t);
      if (lift > peak) {
        peak = lift;
        peakT = t;
      }
    }
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThanOrEqual(0.12);
    expect(peakT).toBeGreaterThan(0.1);
    expect(peakT).toBeLessThan(0.35);
  });

  it('ada pantulan kecil: lift naik lagi setelah turun pertama', () => {
    let seenDown = false;
    let bounced = false;
    let prev = 0;
    let peak = 0;
    for (let t = 0.001; t < JUMP_DURATION; t += 0.002) {
      const { lift } = jumpProfile(t);
      peak = Math.max(peak, lift);
      if (lift < prev - 1e-9) seenDown = true;
      if (seenDown && lift > prev + 1e-9) bounced = true;
      prev = lift;
    }
    expect(bounced).toBe(true);
    expect(peak).toBeGreaterThan(0);
  });
});
