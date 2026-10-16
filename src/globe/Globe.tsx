import { Canvas, addAfterEffect, useFrame, useThree } from '@react-three/fiber';
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from 'react';
import { PerspectiveCamera, Ray, SRGBColorSpace, Sphere, Texture, Vector2, Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  JUMP_DURATION,
  classifyPointer,
  fitDistance,
  flyPath,
  freeAreaCenter,
  lonLatToVec3,
  lookupAt,
  pickMarker,
  rotateSpeedFor,
  vecToLonLat,
  zoomStep,
  type HitResult,
  type Insets,
  type MarkerScreen,
  type Vec3,
} from '@/domain/geo';
import type { FlagImage, GlobeData } from '@/services/content';
import { createFlagSlot, type FlagSlot } from './flagSlot';
import { readGlobePaletteFromDocument } from './palette-dom';
import { createReadyQueue, type ReadyQueue } from './pending';
import { createGlobeScene, type GlobeScene } from './scene';
import { useReducedMotion } from './useReducedMotion';

export interface GlobeProps {
  data: GlobeData;
  selected: { code: string; seq: number } | null;
  insets?: Insets;
  autoRotate?: boolean;
  loadFlag?: (code: string) => Promise<FlagImage | null>;
  onTap: (hit: HitResult) => void;
  onReady?: () => void;
  onError?: (e: { kind: 'webgl' | 'data' }) => void;
  debug?: boolean;
  onFrame?: (frame: GlobeFrame) => void;
}

/** Diberikan tiap frame; `project` memetakan bujur/lintang ke piksel CSS di dalam globe. */
export interface GlobeFrame {
  project: (lon: number, lat: number) => { x: number; y: number; visible: boolean };
  drawCalls: number;
}

export interface GlobeHandle {
  flyTo: (code: string) => Promise<void>;
  zoomIn: () => void;
  zoomOut: () => void;
  getZoomState: () => { atMin: boolean; atMax: boolean };
}

const FOV = 35;
const FILL = 0.75;
const MIN_DISTANCE = 1.4;
const MAX_FACTOR = 1.35;
const FALLBACK_DISTANCE = 3;
const START_LON_LAT: [number, number] = [118, -2];
const FLY_MS = 900;
const ZOOM_MS = 200;
const MARKER_RADIUS = 1.03;
const EDGE = 1e-6;
const UNIT_SPHERE = new Sphere(new Vector3(0, 0, 0), 1);

interface Limits {
  start: number;
  min: number;
  max: number;
}

function limitsFor(width: number, height: number): Limits {
  const aspect = width > 0 && height > 0 ? width / height : 1;
  const start = fitDistance({ fovYDeg: FOV, aspect, fill: FILL });
  const safeStart = Number.isFinite(start) ? start : FALLBACK_DISTANCE;
  return {
    start: safeStart,
    min: Math.min(MIN_DISTANCE, safeStart * 0.6),
    max: safeStart * MAX_FACTOR,
  };
}

interface Fly {
  from: Vec3;
  to: Vec3;
  distance: number;
  start: number;
  done: () => void;
}

interface ZoomAnim {
  from: number;
  to: number;
  start: number;
}

interface Callbacks {
  onTap: GlobeProps['onTap'];
  onReady: GlobeProps['onReady'];
  onError: GlobeProps['onError'];
  loadFlag: GlobeProps['loadFlag'];
  onFrame: GlobeProps['onFrame'];
}

function hasWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    context?.getExtension('WEBGL_lose_context')?.loseContext();
    return Boolean(context);
  } catch {
    return false;
  }
}

function toTexture(image: FlagImage): Texture | null {
  if (typeof ImageBitmap === 'undefined' || !(image instanceof ImageBitmap)) return null;
  const texture = new Texture(image);
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

interface InnerProps extends GlobeProps {
  apiRef: MutableRefObject<GlobeHandle | null>;
  wrapperRef: MutableRefObject<HTMLDivElement | null>;
  reducedMotion: boolean;
  queue: ReadyQueue;
}

function GlobeInner(props: InnerProps) {
  const { data, selected, insets, autoRotate = false, debug = false } = props;
  const { apiRef, wrapperRef, reducedMotion, queue } = props;
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const threeScene = useThree((s) => s.scene);
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const palette = useMemo(() => readGlobePaletteFromDocument(), []);

  const sceneRef = useRef<GlobeScene | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const flyRef = useRef<Fly | null>(null);
  const zoomRef = useRef<ZoomAnim | null>(null);
  const jumpStartRef = useRef<number | null>(null);
  const flagShownRef = useRef(false);
  const flagSlotRef = useRef<FlagSlot | null>(null);
  const readyRef = useRef(false);
  const sizeRef = useRef({ width: size.width, height: size.height });
  const limitsRef = useRef<Limits>(limitsFor(size.width, size.height));
  const interactedRef = useRef(false);
  const projectRef = useRef<GlobeFrame['project']>(() => ({ x: 0, y: 0, visible: false }));
  const reducedRef = useRef(reducedMotion);
  const autoRotateRef = useRef(autoRotate);
  const debugRef = useRef(debug);
  const callbacks = useRef<Callbacks>({
    onTap: props.onTap,
    onReady: props.onReady,
    onError: props.onError,
    loadFlag: props.loadFlag,
    onFrame: props.onFrame,
  });

  useEffect(() => {
    callbacks.current = {
      onTap: props.onTap,
      onReady: props.onReady,
      onError: props.onError,
      loadFlag: props.loadFlag,
      onFrame: props.onFrame,
    };
    reducedRef.current = reducedMotion;
    autoRotateRef.current = autoRotate;
    debugRef.current = debug;
  });

  // Scene: dibangun di efek agar dispose saat unmount aman di StrictMode.
  useEffect(() => {
    let scene: GlobeScene;
    try {
      performance.mark('globe-build-start');
      scene = createGlobeScene(data, palette);
      performance.mark('globe-build-end');
      performance.measure('globe-build', 'globe-build-start', 'globe-build-end');
    } catch {
      callbacks.current.onError?.({ kind: 'data' });
      return;
    }
    sceneRef.current = scene;
    threeScene.add(scene.group);
    readyRef.current = false;
    const removeAfter = addAfterEffect(() => {
      const wrapper = wrapperRef.current;
      callbacks.current.onFrame?.({
        project: projectRef.current,
        drawCalls: gl.info.render.calls,
      });
      if (debugRef.current && wrapper) {
        wrapper.dataset.drawCalls = String(gl.info.render.calls);
        const dir = camera.position.clone().normalize();
        const [lon, lat] = vecToLonLat([dir.x, dir.y, dir.z]);
        wrapper.dataset.cameraLonlat = `${lon.toFixed(2)},${lat.toFixed(2)}`;
        wrapper.dataset.cameraDistance = camera.position.length().toFixed(3);
      }
      if (!readyRef.current) {
        readyRef.current = true;
        // Di luar siklus render: invalidate dari dalam after-effect bisa hilang.
        queueMicrotask(() => callbacks.current.onReady?.());
      }
    });
    invalidate();
    return () => {
      removeAfter();
      threeScene.remove(scene.group);
      scene.dispose();
      sceneRef.current = null;
    };
  }, [data, palette, threeScene, gl, invalidate, wrapperRef, camera]);

  // Proyeksi bujur/lintang ke layar untuk overlay DOM (ikon rumah).
  useEffect(() => {
    const point = new Vector3();
    projectRef.current = (lon, lat) => {
      const [x, y, z] = lonLatToVec3(lon, lat, 1);
      point.set(x, y, z);
      const visible = point.dot(camera.position) > 1;
      point.project(camera);
      return {
        x: ((point.x + 1) / 2) * size.width,
        y: ((1 - point.y) / 2) * size.height,
        visible,
      };
    };
  }, [camera, size.width, size.height]);

  // Kamera awal dan kontrol orbit.
  useEffect(() => {
    if (!(camera instanceof PerspectiveCamera)) return;
    const limits = limitsFor(sizeRef.current.width, sizeRef.current.height);
    limitsRef.current = limits;
    interactedRef.current = false;
    const [x, y, z] = lonLatToVec3(START_LON_LAT[0], START_LON_LAT[1], limits.start);
    camera.position.set(x, y, z);
    camera.lookAt(0, 0, 0);
    const controls = new OrbitControls(camera, gl.domElement);
    controls.enablePan = false;
    controls.enableZoom = true;
    controls.minDistance = limits.min;
    controls.maxDistance = limits.max;
    controls.dampingFactor = 0.08;
    const onChange = () => invalidate();
    const onStart = () => {
      interactedRef.current = true;
    };
    controls.addEventListener('change', onChange);
    controls.addEventListener('start', onStart);
    controlsRef.current = controls;
    queue.markReady();
    invalidate();
    return () => {
      queue.reset();
      controls.removeEventListener('change', onChange);
      controls.removeEventListener('start', onStart);
      controls.dispose();
      controlsRef.current = null;
    };
  }, [camera, gl, invalidate, queue]);

  // Framing mengikuti ukuran, hanya sebelum pengguna berinteraksi.
  useEffect(() => {
    sizeRef.current = { width: size.width, height: size.height };
    const controls = controlsRef.current;
    if (!controls || interactedRef.current) return;
    const limits = limitsFor(size.width, size.height);
    limitsRef.current = limits;
    controls.minDistance = limits.min;
    controls.maxDistance = limits.max;
    camera.position.setLength(limits.start);
    invalidate();
  }, [camera, size.width, size.height, invalidate]);

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    controls.enableDamping = !reducedMotion;
    controls.autoRotate = autoRotate && !reducedMotion;
    invalidate();
  }, [reducedMotion, autoRotate, invalidate]);

  // Insets UI: geser titik pusat bola ke pusat area bebas.
  useEffect(() => {
    if (!(camera instanceof PerspectiveCamera)) return;
    if (insets) {
      const center = freeAreaCenter({ width: size.width, height: size.height }, insets);
      camera.setViewOffset(
        size.width,
        size.height,
        size.width / 2 - center.x,
        size.height / 2 - center.y,
        size.width,
        size.height,
      );
    } else {
      camera.clearViewOffset();
    }
    camera.updateProjectionMatrix();
    invalidate();
  }, [camera, insets, size.width, size.height, invalidate]);

  // Konteks WebGL hilang.
  useEffect(() => {
    const canvas = gl.domElement;
    const onLost = (event: Event) => {
      event.preventDefault();
      callbacks.current.onError?.({ kind: 'webgl' });
    };
    canvas.addEventListener('webglcontextlost', onLost);
    return () => canvas.removeEventListener('webglcontextlost', onLost);
  }, [gl]);

  // Ketukan: penanda lebih dulu, lalu bola matematis.
  useEffect(() => {
    const canvas = gl.domElement;
    const active = new Map<number, { x: number; y: number }>();
    let start: { x: number; y: number; at: number } | null = null;
    let maxPointers = 0;

    const reset = () => {
      active.clear();
      start = null;
      maxPointers = 0;
    };

    const resolveTap = (clientX: number, clientY: number) => {
      const scene = sceneRef.current;
      if (!scene || !(camera instanceof PerspectiveCamera)) return;
      const rect = canvas.getBoundingClientRect();
      const px = clientX - rect.left;
      const py = clientY - rect.top;
      camera.updateMatrixWorld();

      const camPos = camera.position;
      const markers: MarkerScreen[] = [];
      const point = new Vector3();
      for (const entry of data.catalog) {
        if (!entry.marker) continue;
        const [x, y, z] = lonLatToVec3(entry.anchor[0], entry.anchor[1], 1);
        point.set(x, y, z);
        const facing = point.dot(camPos) > 1;
        point.setLength(MARKER_RADIUS).project(camera);
        markers.push({
          code: entry.alpha2,
          x: ((point.x + 1) / 2) * rect.width,
          y: ((1 - point.y) / 2) * rect.height,
          facing,
        });
      }
      const marker = pickMarker({ x: px, y: py }, markers);
      if (marker) {
        const hit = data.catalog.some((c) => c.alpha2 === marker && c.marker);
        if (hit) {
          callbacks.current.onTap({ kind: 'country', code: marker });
          return;
        }
      }

      const ndc = new Vector2((px / rect.width) * 2 - 1, -(py / rect.height) * 2 + 1);
      const origin = new Vector3().setFromMatrixPosition(camera.matrixWorld);
      const direction = new Vector3(ndc.x, ndc.y, 0.5).unproject(camera).sub(origin).normalize();
      const target = new Vector3();
      if (!new Ray(origin, direction).intersectSphere(UNIT_SPHERE, target)) return;
      const [lon, lat] = vecToLonLat([target.x, target.y, target.z]);
      callbacks.current.onTap(lookupAt(data.map, data.grid, lon, lat));
    };

    const onDown = (e: PointerEvent) => {
      if (active.size === 0) {
        start = { x: e.clientX, y: e.clientY, at: e.timeStamp };
        maxPointers = 0;
      }
      active.set(e.pointerId, { x: e.clientX, y: e.clientY });
      maxPointers = Math.max(maxPointers, active.size);
    };
    const onUp = (e: PointerEvent) => {
      if (!active.has(e.pointerId)) return;
      active.delete(e.pointerId);
      if (active.size > 0 || !start) return;
      const gesture = {
        downAt: start.at,
        upAt: e.timeStamp,
        dx: e.clientX - start.x,
        dy: e.clientY - start.y,
        pointers: maxPointers,
      };
      reset();
      if (classifyPointer(gesture) === 'tap') resolveTap(e.clientX, e.clientY);
    };
    const onCancel = () => reset();

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onCancel);
    return () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onCancel);
    };
  }, [gl, camera, data]);

  // Slot bendera: hanya satu tekstur terpasang; dibuang saat unmount.
  useEffect(() => {
    const slot = createFlagSlot<Texture>({
      load: (flagCode) => callbacks.current.loadFlag?.(flagCode) ?? Promise.resolve(null),
      toTexture,
      apply: (value) => {
        const texture = value instanceof Texture ? value : null;
        sceneRef.current?.setFlag(texture);
        flagShownRef.current = texture !== null;
        const wrapper = wrapperRef.current;
        if (debugRef.current && wrapper) wrapper.dataset.flag = texture ? 'loaded' : 'none';
        invalidate();
      },
    });
    flagSlotRef.current = slot;
    return () => {
      slot.dispose();
      flagSlotRef.current = null;
    };
  }, [invalidate, wrapperRef]);

  // Seleksi: sorot, lompat, dan bendera.
  const code = selected?.code ?? null;
  const seq = selected?.seq ?? null;
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    flagSlotRef.current?.select(code);
    if (code === null) {
      scene.setSelected(null);
      scene.setJump(null);
      jumpStartRef.current = null;
      invalidate();
      return;
    }
    scene.setSelected(code);
    if (reducedRef.current) {
      scene.setJump(null);
      jumpStartRef.current = null;
    } else {
      jumpStartRef.current = performance.now();
    }
    invalidate();
  }, [code, seq, data, invalidate, wrapperRef]);

  useFrame((_, delta) => {
    const controls = controlsRef.current;
    const scene = sceneRef.current;
    const wrapper = wrapperRef.current;
    const now = performance.now();

    if (controls && camera instanceof PerspectiveCamera) {
      const fly = flyRef.current;
      const zoom = zoomRef.current;
      if (fly) {
        const t = Math.min(1, (now - fly.start) / FLY_MS);
        const [x, y, z] = flyPath(fly.from, fly.to, t);
        camera.position.set(x * fly.distance, y * fly.distance, z * fly.distance);
        camera.lookAt(0, 0, 0);
        if (t >= 1) {
          flyRef.current = null;
          controls.enabled = true;
          fly.done();
        }
        invalidate();
      } else {
        if (zoom) {
          const t = Math.min(1, (now - zoom.start) / ZOOM_MS);
          const distance = zoom.from + (zoom.to - zoom.from) * t;
          camera.position.setLength(distance);
          if (t >= 1) zoomRef.current = null;
          invalidate();
        }
        controls.rotateSpeed = rotateSpeedFor(
          camera.position.length(),
          limitsRef.current.min,
          limitsRef.current.max,
        );
        controls.update(delta);
        if (controls.autoRotate) invalidate();
      }
    }

    let jumping = false;
    const jumpStart = jumpStartRef.current;
    if (scene && jumpStart !== null) {
      const t = (now - jumpStart) / 1000;
      if (t >= JUMP_DURATION) {
        scene.setJump(null);
        jumpStartRef.current = null;
      } else {
        scene.setJump(t);
        jumping = true;
        invalidate();
      }
    }

    if (scene && flagShownRef.current && !reducedRef.current) {
      scene.setTime(now / 1000);
      invalidate();
    }
    if (scene && flagShownRef.current) {
      scene.faceCamera([camera.position.x, camera.position.y, camera.position.z]);
    }

    if (debugRef.current && wrapper) {
      wrapper.dataset.autoRotate = String(Boolean(controls?.autoRotate));
      wrapper.dataset.jumping = String(jumping);
    }
  });

  useImperativeHandle(apiRef, () => {
    const currentDistance = (): number => camera.position.length();
    const zoomBy = (dir: 'in' | 'out') => {
      const base = zoomRef.current?.to ?? currentDistance();
      const { min, max } = limitsRef.current;
      const { distance } = zoomStep(base, dir, min, max);
      interactedRef.current = true;
      if (reducedRef.current) {
        camera.position.setLength(distance);
        zoomRef.current = null;
      } else {
        zoomRef.current = { from: currentDistance(), to: distance, start: performance.now() };
      }
      invalidate();
    };
    return {
      flyTo(target) {
        const controls = controlsRef.current;
        const entry = data.catalog.find((c) => c.alpha2 === target);
        if (!controls || !entry) return Promise.resolve();
        flyRef.current?.done();
        zoomRef.current = null;
        const to = lonLatToVec3(entry.anchor[0], entry.anchor[1], 1);
        const distance = currentDistance();
        // Kuras sisa inersia sebelum kamera diambil alih.
        const damping = controls.enableDamping;
        controls.enableDamping = false;
        controls.update();
        controls.enableDamping = damping;
        if (reducedRef.current) {
          camera.position.set(to[0] * distance, to[1] * distance, to[2] * distance);
          camera.lookAt(0, 0, 0);
          controls.update();
          invalidate();
          return Promise.resolve();
        }
        return new Promise<void>((resolve) => {
          const from = camera.position.toArray();
          flyRef.current = {
            from: [from[0] ?? 0, from[1] ?? 0, from[2] ?? 0],
            to,
            distance,
            start: performance.now(),
            done: resolve,
          };
          controls.enabled = false;
          invalidate();
        });
      },
      zoomIn: () => zoomBy('in'),
      zoomOut: () => zoomBy('out'),
      getZoomState() {
        const base = zoomRef.current?.to ?? currentDistance();
        const { min, max } = limitsRef.current;
        return { atMin: base <= min + EDGE, atMax: base >= max - EDGE };
      },
    };
  }, [camera, data, invalidate]);

  return null;
}

export const Globe = forwardRef<GlobeHandle, GlobeProps>(function Globe(props, ref) {
  const apiRef = useRef<GlobeHandle | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const reducedMotion = useReducedMotion();
  const [supported] = useState(hasWebGL);
  const { onError } = props;
  const [queue] = useState(createReadyQueue);

  useEffect(() => {
    if (!supported) onError?.({ kind: 'webgl' });
  }, [supported, onError]);

  useImperativeHandle(
    ref,
    () => ({
      flyTo: (code) => queue.run(() => apiRef.current?.flyTo(code) ?? Promise.resolve()),
      zoomIn: () => void queue.run(() => Promise.resolve(apiRef.current?.zoomIn())),
      zoomOut: () => void queue.run(() => Promise.resolve(apiRef.current?.zoomOut())),
      getZoomState: () => apiRef.current?.getZoomState() ?? { atMin: false, atMax: false },
    }),
    [queue],
  );

  const startPosition = useMemo(
    () => lonLatToVec3(START_LON_LAT[0], START_LON_LAT[1], FALLBACK_DISTANCE),
    [],
  );

  return (
    <div
      ref={wrapperRef}
      data-selected={props.selected?.code ?? ''}
      style={{ position: 'relative', width: '100%', height: '100%' }}
    >
      {supported ? (
        <Canvas
          frameloop="demand"
          dpr={[1, 2]}
          gl={{ antialias: true }}
          camera={{ fov: FOV, near: 0.1, far: 20, position: startPosition }}
          style={{ touchAction: 'none' }}
        >
          <GlobeInner
            {...props}
            apiRef={apiRef}
            wrapperRef={wrapperRef}
            reducedMotion={reducedMotion}
            queue={queue}
          />
        </Canvas>
      ) : null}
    </div>
  );
});
