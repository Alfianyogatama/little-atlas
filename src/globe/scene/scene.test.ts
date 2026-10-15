import {
  BufferGeometry,
  Color,
  InstancedMesh,
  LineSegments,
  Mesh,
  ShaderMaterial,
  Texture,
  Vector3,
  Box3,
  type Object3D,
} from 'three';
import { describe, expect, it, vi } from 'vitest';
import { JUMP_DURATION, jumpProfile, lonLatToVec3, type MapFeature } from '@/domain/geo';
import type { GlobePalette } from '@/globe/palette';
import type { GlobeData } from '@/services/content';
import { countDrawCalls, createGlobeScene } from './index';

const PALETTE: GlobePalette = {
  ocean: '#2fa9da',
  oceanLight: '#5fc8ea',
  land: ['#ff8fab', '#ffb86b', '#8bd86b', '#b49bf2', '#e9b98a'],
  select: '#fff95e',
  coral: '#ff4d6d',
  neutral: '#c9ced6',
  ice: '#f2faff',
  border: '#ffffff',
};

function square(lon: number, lat: number, size: number): number[] {
  return [lon, lat, lon + size, lat, lon + size, lat + size, lon, lat + size, lon, lat];
}

const FEATURES: MapFeature[] = [
  { code: 'ID', kind: 'country', polygons: [[square(100, -5, 10)]] },
  { code: 'JP', kind: 'country', polygons: [[square(130, 30, 10)]] },
  { code: 'SG', kind: 'country', polygons: [[square(110, 0, 5)]] },
  { code: null, kind: 'neutral', polygons: [[square(10, 10, 8)]] },
  { code: 'AQ', kind: 'continent', polygons: [[square(0, -85, 20)]] },
];

const entry = (alpha2: string, anchor: [number, number], marker: boolean) => ({
  alpha2,
  alpha3: `${alpha2}X`,
  numeric: '000',
  kind: alpha2 === 'AQ' ? ('continent' as const) : ('country' as const),
  continent: alpha2 === 'AQ' ? ('antarctica' as const) : ('asia' as const),
  name: { id: alpha2, en: alpha2 },
  hasFlag: alpha2 !== 'AQ',
  anchor,
  marker,
});

const DATA = {
  map: { version: 1, features: FEATURES },
  grid: { cellDeg: 10, cells: {} },
  catalog: [
    entry('ID', [105, 0], false),
    entry('JP', [135, 35], false),
    entry('SG', [112.5, 2.5], true),
    entry('AQ', [10, -85], false),
  ],
} as unknown as GlobeData;

function build() {
  return createGlobeScene(DATA, PALETTE);
}

function child(scene: ReturnType<typeof build>, name: string): Object3D {
  const found = scene.group.getObjectByName(name);
  if (!found) throw new Error(`objek ${name} tidak ada`);
  return found;
}

function uniforms(obj: Object3D): Record<string, { value: unknown }> {
  const material = (obj as Mesh).material;
  if (!(material instanceof ShaderMaterial)) throw new Error('bukan ShaderMaterial');
  return material.uniforms;
}

const hexOf = (c: unknown) => (c as Color).getHexString();
const bare = (hex: string) => hex.replace('#', '');

describe('createGlobeScene: struktur', () => {
  it('group berisi tepat 5 objek bernama ocean, land, borders, markers, flag dengan tipe yang benar', () => {
    const scene = build();
    expect(scene.group.children.map((c) => c.name).sort()).toEqual(
      ['borders', 'flag', 'land', 'markers', 'ocean'].sort(),
    );
    expect(child(scene, 'ocean')).toBeInstanceOf(Mesh);
    expect(child(scene, 'land')).toBeInstanceOf(Mesh);
    expect(child(scene, 'borders')).toBeInstanceOf(LineSegments);
    expect(child(scene, 'markers')).toBeInstanceOf(InstancedMesh);
    expect(child(scene, 'flag')).toBeInstanceOf(Mesh);
    for (const name of ['ocean', 'land', 'borders', 'markers', 'flag']) {
      expect((child(scene, name) as Mesh).material).toBeInstanceOf(ShaderMaterial);
    }
  });

  it('land punya atribut countryIndex dan colorIndex; borders punya countryIndex', () => {
    const scene = build();
    const land = (child(scene, 'land') as Mesh).geometry;
    expect(land.getAttribute('countryIndex')).toBeDefined();
    expect(land.getAttribute('colorIndex')).toBeDefined();
    expect(land.getAttribute('position').count).toBeGreaterThan(0);
    expect(
      (child(scene, 'borders') as LineSegments).geometry.getAttribute('countryIndex'),
    ).toBeDefined();
  });

  it('markers: count sama dengan jumlah katalog marker:true dan atribut instance countryIndex', () => {
    const scene = build();
    const markers = child(scene, 'markers') as InstancedMesh;
    expect(markers.count).toBe(1);
    const attr = markers.geometry.getAttribute('countryIndex');
    expect(attr).toBeDefined();
    expect(attr.count).toBe(1);
    expect(attr.array[0]).toBe(2);
  });

  it('flag: atribut isPole dan tersembunyi saat awal', () => {
    const scene = build();
    const flag = child(scene, 'flag') as Mesh;
    expect(flag.geometry.getAttribute('isPole')).toBeDefined();
    expect(flag.visible).toBe(false);
  });

  it('countryIndexOf mengembalikan indeks fitur di map.features', () => {
    const scene = build();
    expect(scene.countryIndexOf('ID')).toBe(0);
    expect(scene.countryIndexOf('JP')).toBe(1);
    expect(scene.countryIndexOf('SG')).toBe(2);
    expect(scene.countryIndexOf('AQ')).toBe(4);
  });
});

describe('createGlobeScene: draw call', () => {
  it('diam dengan bendera tersembunyi = 4, saat bendera tampil = 5', () => {
    const scene = build();
    expect(countDrawCalls(scene.group)).toBe(4);
    scene.setSelected('JP');
    scene.setFlag(new Texture());
    expect(countDrawCalls(scene.group)).toBe(5);
    expect(countDrawCalls(scene.group)).toBeLessThanOrEqual(5);
    scene.setFlag(null);
    expect(countDrawCalls(scene.group)).toBe(4);
  });

  it('countDrawCalls menghormati visible pada parent dan menghitung rekursif', () => {
    const scene = build();
    scene.group.visible = false;
    // group sendiri tersembunyi: tidak ada yang digambar
    expect(countDrawCalls(scene.group)).toBe(0);
  });
});

describe('createGlobeScene: uniform dari palet yang diinjeksi', () => {
  it('land memakai palet, select, neutral, ice dari input', () => {
    const u = uniforms(child(build(), 'land'));
    const palette = u.uPalette?.value as Color[];
    expect(palette).toHaveLength(5);
    expect(palette.map(hexOf)).toEqual(PALETTE.land.map(bare));
    expect(hexOf(u.uSelect?.value)).toBe(bare(PALETTE.select));
    expect(hexOf(u.uNeutral?.value)).toBe(bare(PALETTE.neutral));
    expect(hexOf(u.uIce?.value)).toBe(bare(PALETTE.ice));
    expect(u.uSelectedIndex?.value).toBe(-1);
    expect(u.uLift?.value).toBe(0);
    expect(u.uWobble?.value).toBe(0);
  });

  it('borders dan ocean memakai warna dari input', () => {
    const scene = build();
    const b = uniforms(child(scene, 'borders'));
    expect(hexOf(b.uBorder?.value)).toBe(bare(PALETTE.border));
    expect(hexOf(b.uCoral?.value)).toBe(bare(PALETTE.coral));
    expect(b.uSelectedIndex?.value).toBe(-1);
    expect(b.uLift?.value).toBe(0);
    const o = uniforms(child(scene, 'ocean'));
    expect(hexOf(o.uOcean?.value)).toBe(bare(PALETTE.ocean));
    expect(hexOf(o.uOceanLight?.value)).toBe(bare(PALETTE.oceanLight));
  });

  it('flag punya uniform uTime dan uMap', () => {
    const u = uniforms(child(build(), 'flag'));
    expect(u.uTime).toBeDefined();
    expect(u.uMap).toBeDefined();
  });
});

describe('createGlobeScene: kontrol', () => {
  it('setSelected mengisi uSelectedIndex land dan borders; null dan kode tak dikenal = -1', () => {
    const scene = build();
    const land = uniforms(child(scene, 'land'));
    const borders = uniforms(child(scene, 'borders'));
    scene.setSelected('JP');
    expect(land.uSelectedIndex?.value).toBe(1);
    expect(borders.uSelectedIndex?.value).toBe(1);
    scene.setSelected(null);
    expect(land.uSelectedIndex?.value).toBe(-1);
    expect(borders.uSelectedIndex?.value).toBe(-1);
    scene.setSelected('ID');
    expect(land.uSelectedIndex?.value).toBe(0);
    expect(() => scene.setSelected('ZZ')).not.toThrow();
    expect(land.uSelectedIndex?.value).toBe(-1);
    expect(borders.uSelectedIndex?.value).toBe(-1);
  });

  it('setJump mengikuti jumpProfile dan null mengembalikan 0', () => {
    const scene = build();
    const land = uniforms(child(scene, 'land'));
    const borders = uniforms(child(scene, 'borders'));
    const t = 0.2;
    const expected = jumpProfile(t);
    expect(expected.lift).toBeGreaterThan(0);
    scene.setJump(t);
    expect(land.uLift?.value).toBeCloseTo(expected.lift, 9);
    expect(land.uWobble?.value).toBeCloseTo(expected.wobble, 9);
    expect(borders.uLift?.value).toBeCloseTo(expected.lift, 9);
    scene.setJump(JUMP_DURATION + 1);
    expect(land.uLift?.value).toBe(0);
    scene.setJump(t);
    scene.setJump(null);
    expect(land.uLift?.value).toBe(0);
    expect(land.uWobble?.value).toBe(0);
    expect(borders.uLift?.value).toBe(0);
  });

  it('setTime mengisi uTime bendera', () => {
    const scene = build();
    scene.setTime(1.5);
    expect(uniforms(child(scene, 'flag')).uTime?.value).toBe(1.5);
  });

  it('setFlag menampilkan bendera di anchor negara terpilih dan menyembunyikannya bila null', () => {
    const scene = build();
    const flag = child(scene, 'flag') as Mesh;
    const texture = new Texture();
    scene.setSelected('JP');
    scene.setFlag(texture);
    expect(flag.visible).toBe(true);
    expect(uniforms(flag).uMap?.value).toBe(texture);
    scene.group.updateMatrixWorld(true);
    const center = new Box3().setFromObject(flag).getCenter(new Vector3());
    const [x, y, z] = lonLatToVec3(135, 35, 1.025);
    expect(center.distanceTo(new Vector3(x, y, z))).toBeLessThan(0.1);
    scene.setFlag(null);
    expect(flag.visible).toBe(false);
  });
});

describe('createGlobeScene: shader dan dispose', () => {
  it('setiap material punya vertex dan fragment shader non-kosong', () => {
    const scene = build();
    for (const name of ['ocean', 'land', 'borders', 'markers', 'flag']) {
      const m = (child(scene, name) as Mesh).material as ShaderMaterial;
      expect(m.vertexShader.trim().length, `${name} vertex`).toBeGreaterThan(0);
      expect(m.fragmentShader.trim().length, `${name} fragment`).toBeGreaterThan(0);
    }
  });

  it('shader land memakai uSelectedIndex, uLift, dan uPalette', () => {
    const m = (child(build(), 'land') as Mesh).material as ShaderMaterial;
    expect(m.vertexShader).toContain('uSelectedIndex');
    expect(m.vertexShader).toContain('uLift');
    expect(m.fragmentShader).toContain('uPalette');
  });

  it('dispose memanggil dispose semua geometry dan material, aman dipanggil dua kali', () => {
    const scene = build();
    const geometrySpies: ReturnType<typeof vi.fn>[] = [];
    const materialSpies: ReturnType<typeof vi.fn>[] = [];
    for (const name of ['ocean', 'land', 'borders', 'markers', 'flag']) {
      const mesh = child(scene, name) as Mesh;
      const g = vi.spyOn(mesh.geometry as BufferGeometry, 'dispose');
      const m = vi.spyOn(mesh.material as ShaderMaterial, 'dispose');
      geometrySpies.push(g);
      materialSpies.push(m);
    }
    scene.dispose();
    for (const spy of [...geometrySpies, ...materialSpies]) expect(spy).toHaveBeenCalled();
    expect(() => scene.dispose()).not.toThrow();
  });
});

describe('createGlobeScene: penanda tanpa geometri (Tuvalu)', () => {
  const withTuvalu = {
    ...DATA,
    catalog: [...DATA.catalog, entry('TV', [179.2, -8.5], true)],
  } as unknown as GlobeData;

  function markerIndices(scene: ReturnType<typeof build>): number[] {
    const attr = (child(scene, 'markers') as InstancedMesh).geometry.getAttribute('countryIndex');
    return Array.from({ length: attr.count }, (_, i) => attr.getX(i));
  }

  it('tanpa pilihan, uSelectedIndex di markers, land, dan borders tidak sama dengan countryIndex penanda mana pun', () => {
    const scene = createGlobeScene(withTuvalu, PALETTE);
    scene.setSelected(null);
    const indices = markerIndices(scene);
    expect(indices.length).toBe(2);
    for (const name of ['markers', 'land', 'borders']) {
      const selected = uniforms(child(scene, name)).uSelectedIndex?.value as number;
      expect(indices).not.toContain(selected);
      expect(selected).toBe(scene.noSelectionIndex);
    }
  });

  it('noSelectionIndex tidak sama dengan indeks negara mana pun, termasuk yang tidak dikenal', () => {
    const scene = createGlobeScene(withTuvalu, PALETTE);
    for (const code of ['ID', 'JP', 'SG', 'TV', 'ZZ']) {
      expect(scene.countryIndexOf(code)).not.toBe(scene.noSelectionIndex);
    }
  });

  it('penanda TV punya countryIndex unik yang tidak dipakai fitur peta mana pun', () => {
    const scene = createGlobeScene(withTuvalu, PALETTE);
    const tv = scene.countryIndexOf('TV');
    expect(tv).toBeGreaterThanOrEqual(FEATURES.length);
    expect(tv).not.toBe(scene.countryIndexOf('SG'));
    expect(markerIndices(scene)).toContain(tv);
  });

  it('setSelected("TV") menyorot penanda TV dan setSelected("SG") tidak', () => {
    const scene = createGlobeScene(withTuvalu, PALETTE);
    scene.setSelected('TV');
    expect(uniforms(child(scene, 'markers')).uSelectedIndex?.value).toBe(
      scene.countryIndexOf('TV'),
    );
    scene.setSelected('SG');
    expect(uniforms(child(scene, 'markers')).uSelectedIndex?.value).not.toBe(
      scene.countryIndexOf('TV'),
    );
  });
});
