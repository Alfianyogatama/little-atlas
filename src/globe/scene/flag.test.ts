import { Mesh, Texture, Vector3, type BufferGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import { lonLatToVec3 } from '@/domain/geo';
import type { GlobePalette } from '@/globe/palette';
import type { GlobeData } from '@/services/content';
import { buildFlagGeometry, createGlobeScene } from './scene';

const PALETTE: GlobePalette = {
  ocean: 'blue',
  oceanLight: 'cyan',
  land: ['red', 'orange', 'green', 'purple', 'tan'],
  select: 'yellow',
  coral: 'pink',
  neutral: 'gray',
  ice: 'white',
  border: 'white',
};

const DATA = {
  map: {
    version: 1,
    features: [
      { code: 'ID', kind: 'country', polygons: [[[100, -5, 110, -5, 110, 5, 100, 5, 100, -5]]] },
    ],
  },
  grid: { cellDeg: 10, cells: {} },
  catalog: [
    {
      alpha2: 'ID',
      alpha3: 'IDN',
      numeric: '360',
      kind: 'country',
      continent: 'asia',
      name: { id: 'ID', en: 'ID' },
      hasFlag: true,
      anchor: [105, 0],
      marker: false,
    },
  ],
} as unknown as GlobeData;

function clothVertices(geometry: BufferGeometry) {
  const position = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv');
  const isPole = geometry.getAttribute('isPole');
  const out: { x: number; y: number; u: number; v: number }[] = [];
  for (let i = 0; i < position.count; i += 1) {
    if (isPole.getX(i) === 0) {
      out.push({ x: position.getX(i), y: position.getY(i), u: uv.getX(i), v: uv.getY(i) });
    }
  }
  return out;
}

describe('bendera: orientasi tekstur', () => {
  // Konvensi: ImageBitmap tanpa flipY menaruh baris atas gambar di v=0,
  // jadi kiri-atas kain (sisi tiang, puncak) harus (u=0, v=0) dan kanan-bawah (u=1, v=1).
  it('sudut kiri-atas kain memetakan ke (0, 0) dan kanan-bawah ke (1, 1)', () => {
    const vertices = clothVertices(buildFlagGeometry());
    const maxY = Math.max(...vertices.map((p) => p.y));
    const minY = Math.min(...vertices.map((p) => p.y));
    const minX = Math.min(...vertices.map((p) => p.x));
    const maxX = Math.max(...vertices.map((p) => p.x));
    const topLeft = vertices.find((p) => p.x === minX && p.y === maxY);
    const bottomRight = vertices.find((p) => p.x === maxX && p.y === minY);
    expect(topLeft).toMatchObject({ u: 0, v: 0 });
    expect(bottomRight).toMatchObject({ u: 1, v: 1 });
  });

  it('u tumbuh ke kanan sehingga tidak terbalik cermin', () => {
    const vertices = clothVertices(buildFlagGeometry());
    for (const p of vertices) {
      const minX = Math.min(...vertices.map((q) => q.x));
      const maxX = Math.max(...vertices.map((q) => q.x));
      expect(p.u).toBeCloseTo((p.x - minX) / (maxX - minX), 5);
    }
  });
});

describe('bendera: menghadap kamera', () => {
  it('normal kain berdot positif dengan arah ke kamera di beberapa sisi', () => {
    const scene = createGlobeScene(DATA, PALETTE);
    scene.setSelected('ID');
    scene.setFlag(new Texture());
    const flag = scene.group.getObjectByName('flag');
    if (!(flag instanceof Mesh)) throw new Error('bendera tidak ada');
    const cameras: [number, number, number][] = [
      [3, 0.5, 0.2],
      [0.3, 3, 1],
      [-1, 2, 3],
      [1.2, -0.4, 2.5],
    ];
    for (const camera of cameras) {
      scene.faceCamera(camera);
      flag.updateMatrixWorld(true);
      const normal = new Vector3(0, 0, 1).applyQuaternion(flag.quaternion);
      const toCamera = new Vector3(...camera).sub(flag.position).normalize();
      expect(normal.dot(toCamera)).toBeGreaterThan(0);
    }
  });

  it('tidak melakukan apa pun saat bendera tersembunyi', () => {
    const scene = createGlobeScene(DATA, PALETTE);
    const flag = scene.group.getObjectByName('flag');
    const before = flag?.quaternion.clone();
    scene.faceCamera([3, 0, 0]);
    expect(flag?.quaternion.equals(before ?? flag.quaternion)).toBe(true);
  });
});

describe('bendera: billboard penuh ke kamera', () => {
  it('kamera tepat di atas anchor: normal kain berdot >= 0.7 dengan arah kamera dan alas tiang tetap di anchor', () => {
    const scene = createGlobeScene(DATA, PALETTE);
    scene.setSelected('ID');
    scene.setFlag(new Texture());
    const flag = scene.group.getObjectByName('flag');
    if (!(flag instanceof Mesh)) throw new Error('bendera tidak ada');
    const [x, y, z] = lonLatToVec3(105, 0, 3);
    const camera: [number, number, number] = [x, y, z];
    scene.faceCamera(camera);
    flag.updateMatrixWorld(true);
    const normal = new Vector3(0, 0, 1).transformDirection(flag.matrixWorld);
    const toCamera = new Vector3(...camera).sub(flag.position).normalize();
    expect(normal.dot(toCamera)).toBeGreaterThanOrEqual(0.7);
    const [ax, ay, az] = lonLatToVec3(105, 0, 1);
    const base = new Vector3(0, 0, 0).applyMatrix4(flag.matrixWorld);
    expect(base.distanceTo(new Vector3(ax, ay, az))).toBeLessThan(0.05);
  });
});

describe('bendera: kain tidak menembus permukaan globe', () => {
  // Daratan tertinggi di radius 1.025 (lihat FLAG_RADIUS); kain wajib di atasnya + margin.
  const MIN_RADIUS = 1.025 + 0.005;
  // Geser kibaran maksimum menurut shader: z 0.010 + 0.003, y 0.003 (arah terburuk dipakai).
  const WAVE_Z = 0.013;
  const WAVE_Y = 0.003;

  function cameraPositions(): [number, number, number][] {
    const [nx, ny, nz] = lonLatToVec3(105, 0, 1);
    const normal = new Vector3(nx, ny, nz);
    const ref = Math.abs(normal.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
    const t1 = new Vector3().crossVectors(normal, ref).normalize();
    const t2 = new Vector3().crossVectors(normal, t1).normalize();
    const out: [number, number, number][] = [];
    for (const distance of [3.4, 4.4]) {
      out.push(normal.clone().multiplyScalar(distance).toArray());
      for (const tilt of [20, 40, 60]) {
        const rad = (tilt * Math.PI) / 180;
        for (let k = 0; k < 8; k += 1) {
          const az = (k * Math.PI) / 4;
          const dir = t1
            .clone()
            .multiplyScalar(Math.cos(az))
            .addScaledVector(t2, Math.sin(az))
            .multiplyScalar(Math.sin(rad))
            .addScaledVector(normal, Math.cos(rad));
          out.push(dir.multiplyScalar(distance).toArray());
        }
      }
    }
    return out;
  }

  it('semua vertex kain (dengan kibaran terburuk) berada di radius >= 1.030 untuk kamera miring', () => {
    const scene = createGlobeScene(DATA, PALETTE);
    scene.setSelected('ID');
    scene.setFlag(new Texture());
    const flag = scene.group.getObjectByName('flag');
    if (!(flag instanceof Mesh)) throw new Error('bendera tidak ada');
    const position = flag.geometry.getAttribute('position');
    const isPole = flag.geometry.getAttribute('isPole');
    let minRadius = Infinity;
    let worst = '';
    for (const camera of cameraPositions()) {
      scene.faceCamera(camera);
      flag.updateMatrixWorld(true);
      for (let i = 0; i < position.count; i += 1) {
        if (isPole.getX(i) !== 0) continue;
        const world = new Vector3(
          position.getX(i),
          position.getY(i) - WAVE_Y,
          position.getZ(i) - WAVE_Z,
        ).applyMatrix4(flag.matrixWorld);
        if (world.length() < minRadius) {
          minRadius = world.length();
          worst = camera.map((c) => c.toFixed(2)).join(',');
        }
      }
    }
    expect(minRadius, `radius minimum terukur, kamera ${worst}`).toBeGreaterThanOrEqual(MIN_RADIUS);
  });
});
