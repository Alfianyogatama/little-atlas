import { describe, expect, it } from 'vitest';
import { classifyPointer, pickMarker } from './index';

const base = { downAt: 1000, upAt: 1100, dx: 0, dy: 0, pointers: 1 };

describe('pointer: classifyPointer', () => {
  it('ketukan singkat dan diam dihitung tap', () => {
    expect(classifyPointer(base)).toBe('tap');
  });

  it('batas durasi: 299 ms tap, 300 ms drag', () => {
    expect(classifyPointer({ ...base, upAt: 1299 })).toBe('tap');
    expect(classifyPointer({ ...base, upAt: 1300 })).toBe('drag');
  });

  it('batas jarak: 10 px tap, 10,01 px drag', () => {
    expect(classifyPointer({ ...base, dx: 10 })).toBe('tap');
    expect(classifyPointer({ ...base, dx: 6, dy: 8 })).toBe('tap');
    expect(classifyPointer({ ...base, dx: 10.01 })).toBe('drag');
    expect(classifyPointer({ ...base, dy: -10.01 })).toBe('drag');
  });

  it('dua pointer selalu drag', () => {
    expect(classifyPointer({ ...base, pointers: 2 })).toBe('drag');
  });

  it('menghormati opsi kustom', () => {
    expect(classifyPointer({ ...base, upAt: 1200 }, { maxMs: 100, maxPx: 10 })).toBe('drag');
    expect(classifyPointer({ ...base, dx: 20 }, { maxMs: 300, maxPx: 25 })).toBe('tap');
  });
});

describe('pointer: pickMarker', () => {
  const m = (code: string, x: number, y: number, facing = true) => ({ code, x, y, facing });

  it('mengembalikan null bila tidak ada penanda dalam radius', () => {
    expect(pickMarker({ x: 0, y: 0 }, [m('SM', 100, 100)])).toBeNull();
    expect(pickMarker({ x: 0, y: 0 }, [])).toBeNull();
  });

  it('tepat 32 px masih kena, lebih dari itu tidak', () => {
    expect(pickMarker({ x: 0, y: 0 }, [m('SM', 32, 0)])).toBe('SM');
    expect(pickMarker({ x: 0, y: 0 }, [m('SM', 32.01, 0)])).toBeNull();
  });

  it('mengabaikan penanda di belakang bola', () => {
    expect(pickMarker({ x: 0, y: 0 }, [m('SM', 1, 1, false)])).toBeNull();
    expect(pickMarker({ x: 0, y: 0 }, [m('SM', 1, 1, false), m('VA', 20, 0)])).toBe('VA');
  });

  it('dua dalam radius memilih yang terdekat', () => {
    expect(pickMarker({ x: 0, y: 0 }, [m('AD', 20, 0), m('SM', 10, 0)])).toBe('SM');
  });

  it('seri jarak memilih kode urut alfabet, apa pun urutan input', () => {
    expect(pickMarker({ x: 0, y: 0 }, [m('VA', 10, 0), m('SM', -10, 0)])).toBe('SM');
    expect(pickMarker({ x: 0, y: 0 }, [m('SM', -10, 0), m('VA', 10, 0)])).toBe('SM');
  });

  it('radius dapat diatur', () => {
    expect(pickMarker({ x: 0, y: 0 }, [m('SM', 40, 0)], 50)).toBe('SM');
  });
});
