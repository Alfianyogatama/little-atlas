import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  LineSegments,
  Matrix4,
  Mesh,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  type Object3D,
  type Texture,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  JUMP_DURATION,
  assignLandColors,
  jumpProfile,
  lonLatToVec3,
  type Vec3,
} from '@/domain/geo';
import type { GlobePalette } from '@/globe/palette';
import { buildBorderGeometry, buildLandGeometry } from '@/globe/geometry';
import type { GlobeData } from '@/services/content';
import { bordersFragment, bordersVertex } from './shaders/borders';
import { flagFragment, flagVertex } from './shaders/flag';
import { landFragment, landVertex } from './shaders/land';
import { markersFragment, markersVertex } from './shaders/markers';
import { oceanFragment, oceanVertex } from './shaders/ocean';

const MARKER_RADIUS = 1.03;
const MARKER_SIZE = 0.014;
const FLAG_RADIUS = 1.025;
const POLE_HEIGHT = 0.13;
const POLE_WIDTH = 0.005;
const CLOTH_WIDTH = 0.09;
const CLOTH_HEIGHT = 0.0675;
const MAX_TILT = (50 * Math.PI) / 180;
const MAX_TILT_COS = Math.cos(MAX_TILT);
const MAX_TILT_SIN = Math.sin(MAX_TILT);

export interface GlobeScene {
  readonly group: Group;
  /** Indeks fitur di `map.features`, atau -2 bila kode tidak dikenal. */
  countryIndexOf: (code: string) => number;
  /** Nilai uSelectedIndex saat tidak ada pilihan; tidak pernah sama dengan indeks negara mana pun. */
  readonly noSelectionIndex: number;
  setSelected: (code: string | null) => void;
  /** Detik sejak ketukan; null atau di luar durasi lompatan mengembalikan ke 0. */
  setJump: (t: number | null) => void;
  setTime: (seconds: number) => void;
  setFlag: (texture: Texture | null) => void;
  /** Putar bendera penuh supaya kain menghadap kamera dengan tiang tetap berdiri dari permukaan (posisi dalam ruang lokal grup). */
  faceCamera: (cameraPosition: Vec3) => void;
  dispose: () => void;
}

/** Jumlah draw call: objek terlihat (semua leluhurnya juga terlihat) yang bisa digambar. */
export function countDrawCalls(root: Object3D): number {
  if (!root.visible) return 0;
  let count = root instanceof Mesh || root instanceof LineSegments ? 1 : 0;
  for (const child of root.children) count += countDrawCalls(child);
  return count;
}

function colorOf(hex: string): Color {
  return new Color(hex);
}

/**
 * Tekstur dari ImageBitmap tidak bisa flipY: baris pertama gambar ada di v=0.
 * Karena itu v kain dibalik: sudut kiri-atas (sisi tiang, puncak) memetakan ke (u=0, v=0).
 */
export function buildFlagGeometry(): BufferGeometry {
  const pole = new BoxGeometry(POLE_WIDTH, POLE_HEIGHT, POLE_WIDTH);
  pole.translate(0, POLE_HEIGHT / 2, 0);
  const cloth = new PlaneGeometry(CLOTH_WIDTH, CLOTH_HEIGHT, 24, 12);
  cloth.translate(CLOTH_WIDTH / 2, POLE_HEIGHT - CLOTH_HEIGHT / 2, 0);
  const clothUv = cloth.getAttribute('uv');
  for (let i = 0; i < clothUv.count; i += 1) clothUv.setY(i, 1 - clothUv.getY(i));
  for (const [geometry, value] of [
    [pole, 1],
    [cloth, 0],
  ] as const) {
    geometry.deleteAttribute('normal');
    geometry.setAttribute(
      'isPole',
      new BufferAttribute(new Float32Array(geometry.getAttribute('position').count).fill(value), 1),
    );
  }
  const merged = mergeGeometries([pole, cloth]);
  pole.dispose();
  cloth.dispose();
  if (!merged) throw new Error('Geometri bendera gagal digabung.');
  return merged;
}

export function createGlobeScene(data: GlobeData, palette: GlobePalette): GlobeScene {
  const { map, catalog } = data;
  const colors = assignLandColors(map);
  const indexByCode = new Map<string, number>();
  map.features.forEach((f, i) => {
    if (f.code) indexByCode.set(f.code, i);
  });
  // Negara tanpa fitur peta (mis. TV) diberi indeks unik di luar rentang fitur.
  let nextExtraIndex = map.features.length;
  for (const entry of catalog) {
    if (entry.marker && !indexByCode.has(entry.alpha2)) {
      indexByCode.set(entry.alpha2, nextExtraIndex);
      nextExtraIndex += 1;
    }
  }
  const noSelectionIndex = -1;
  const unknownIndex = -2;
  const countryIndexOf = (code: string): number => indexByCode.get(code) ?? unknownIndex;

  const paletteColors = palette.land.map(colorOf);
  const select = colorOf(palette.select);
  const neutral = colorOf(palette.neutral);
  const selectedIndex = { value: noSelectionIndex };
  const lift = { value: 0 };
  const wobble = { value: 0 };

  const group = new Group();

  const ocean = new Mesh(
    new SphereGeometry(1, 64, 48),
    new ShaderMaterial({
      vertexShader: oceanVertex,
      fragmentShader: oceanFragment,
      uniforms: {
        uOcean: { value: colorOf(palette.ocean) },
        uOceanLight: { value: colorOf(palette.oceanLight) },
      },
    }),
  );
  ocean.name = 'ocean';

  const landData = buildLandGeometry(map, colors);
  const landGeometry = new BufferGeometry();
  landGeometry.setAttribute('position', new BufferAttribute(landData.positions, 3));
  landGeometry.setAttribute('normal', new BufferAttribute(landData.normals, 3));
  landGeometry.setAttribute('countryIndex', new BufferAttribute(landData.countryIndex, 1));
  landGeometry.setAttribute('colorIndex', new BufferAttribute(landData.colorIndex, 1));
  const landUniforms = {
    uPalette: { value: paletteColors },
    uSelect: { value: select },
    uNeutral: { value: neutral },
    uIce: { value: colorOf(palette.ice) },
    uSelectedIndex: selectedIndex,
    uLift: lift,
    uWobble: wobble,
  };
  const land = new Mesh(
    landGeometry,
    new ShaderMaterial({
      vertexShader: landVertex,
      fragmentShader: landFragment,
      uniforms: landUniforms,
    }),
  );
  land.name = 'land';
  land.frustumCulled = false;

  const borderData = buildBorderGeometry(map);
  const borderGeometry = new BufferGeometry();
  borderGeometry.setAttribute('position', new BufferAttribute(borderData.positions, 3));
  borderGeometry.setAttribute('countryIndex', new BufferAttribute(borderData.countryIndex, 1));
  const borders = new LineSegments(
    borderGeometry,
    new ShaderMaterial({
      vertexShader: bordersVertex,
      fragmentShader: bordersFragment,
      uniforms: {
        uBorder: { value: colorOf(palette.border) },
        uCoral: { value: colorOf(palette.coral) },
        uSelectedIndex: selectedIndex,
        uLift: lift,
      },
    }),
  );
  borders.name = 'borders';
  borders.frustumCulled = false;

  const anchors = new Map<string, [number, number]>();
  for (const entry of catalog) anchors.set(entry.alpha2, [entry.anchor[0], entry.anchor[1]]);
  const markerEntries = catalog.filter((entry) => entry.marker);
  const markerGeometry = new SphereGeometry(MARKER_SIZE, 8, 6);
  const markerCountry = new Float32Array(markerEntries.length);
  const markerColor = new Float32Array(markerEntries.length);
  const markers = new InstancedMesh(
    markerGeometry,
    new ShaderMaterial({
      vertexShader: markersVertex,
      fragmentShader: markersFragment,
      uniforms: {
        uPalette: { value: paletteColors },
        uSelect: { value: select },
        uNeutral: { value: neutral },
        uSelectedIndex: selectedIndex,
        uLift: lift,
      },
    }),
    markerEntries.length,
  );
  const matrix = new Matrix4();
  markerEntries.forEach((entry, i) => {
    const index = countryIndexOf(entry.alpha2);
    markerCountry[i] = index;
    markerColor[i] = colors[index] ?? -1;
    const [x, y, z] = lonLatToVec3(entry.anchor[0], entry.anchor[1], MARKER_RADIUS);
    markers.setMatrixAt(i, matrix.makeTranslation(x, y, z));
  });
  markers.instanceMatrix.needsUpdate = true;
  markerGeometry.setAttribute('countryIndex', new InstancedBufferAttribute(markerCountry, 1));
  markerGeometry.setAttribute('colorIndex', new InstancedBufferAttribute(markerColor, 1));
  markers.name = 'markers';
  markers.frustumCulled = false;

  const flagUniforms = {
    uTime: { value: 0 },
    uMap: { value: null as Texture | null },
    uPole: { value: neutral },
  };
  const flag = new Mesh(
    buildFlagGeometry(),
    new ShaderMaterial({
      vertexShader: flagVertex,
      fragmentShader: flagFragment,
      uniforms: flagUniforms,
      side: DoubleSide,
    }),
  );
  flag.name = 'flag';
  flag.visible = false;
  flag.frustumCulled = false;

  group.add(ocean, land, borders, markers, flag);

  let selectedCode: string | null = null;
  let flagTexture: Texture | null = null;
  const up = new Vector3(0, 1, 0);
  const surfaceQuaternion = new Quaternion();
  const toCamera = new Vector3();
  const normalAxis = new Vector3();
  const upAxis = new Vector3();
  const rightAxis = new Vector3();
  const tangentAxis = new Vector3();
  const forwardAxis = new Vector3();
  const fallbackTangent = new Vector3(0, 0, 1);
  const basis = new Matrix4();

  function refreshFlag(): void {
    const anchor = selectedCode ? anchors.get(selectedCode) : undefined;
    if (!flagTexture || !anchor) {
      flag.visible = false;
      return;
    }
    const [x, y, z] = lonLatToVec3(anchor[0], anchor[1], FLAG_RADIUS);
    const position = new Vector3(x, y, z);
    flag.position.copy(position);
    surfaceQuaternion.setFromUnitVectors(up, position.normalize());
    flag.quaternion.copy(surfaceQuaternion);
    flagUniforms.uMap.value = flagTexture;
    flag.visible = true;
  }

  let disposed = false;
  return {
    group,
    countryIndexOf,
    noSelectionIndex,
    setSelected(code) {
      selectedCode = code;
      const index = code === null ? noSelectionIndex : countryIndexOf(code);
      selectedIndex.value = index < 0 ? noSelectionIndex : index;
      refreshFlag();
    },
    setJump(t) {
      const profile = t === null || t >= JUMP_DURATION ? { lift: 0, wobble: 0 } : jumpProfile(t);
      lift.value = profile.lift;
      wobble.value = profile.wobble;
    },
    setTime(seconds) {
      flagUniforms.uTime.value = seconds;
    },
    setFlag(texture) {
      flagTexture = texture;
      refreshFlag();
    },
    faceCamera(cameraPosition) {
      if (!flag.visible) return;
      toCamera.set(cameraPosition[0], cameraPosition[1], cameraPosition[2]).sub(flag.position);
      if (toCamera.lengthSq() === 0) return;
      toCamera.normalize();
      normalAxis.copy(flag.position).normalize();
      // Tiang searah normal permukaan yang diproyeksikan ke bidang layar.
      upAxis.copy(normalAxis).addScaledVector(toCamera, -normalAxis.dot(toCamera));
      if (upAxis.lengthSq() < 1e-6) {
        upAxis.copy(fallbackTangent).applyQuaternion(surfaceQuaternion);
        upAxis.addScaledVector(toCamera, -upAxis.dot(toCamera));
      }
      upAxis.normalize();
      // Batasi kemiringan tiang terhadap normal permukaan supaya kain tidak condong masuk ke bola.
      const cosTilt = upAxis.dot(normalAxis);
      if (cosTilt < MAX_TILT_COS) {
        tangentAxis.copy(upAxis).addScaledVector(normalAxis, -cosTilt).normalize();
        upAxis
          .copy(normalAxis)
          .multiplyScalar(MAX_TILT_COS)
          .addScaledVector(tangentAxis, MAX_TILT_SIN);
      }
      rightAxis.crossVectors(upAxis, toCamera).normalize();
      forwardAxis.crossVectors(rightAxis, upAxis);
      basis.makeBasis(rightAxis, upAxis, forwardAxis);
      flag.quaternion.setFromRotationMatrix(basis);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const mesh of [ocean, land, borders, markers, flag]) {
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
      markers.dispose();
    },
  };
}
