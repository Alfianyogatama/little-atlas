# Laporan spike: performa globe 3D

Isi laporan ini diambil dari kode di `spikes/globe-perf` (README, `src/*`, konfigurasi)
dan dari satu build produksi yang dijalankan pada 2026-10-14. Tidak ada kode yang diubah.
Angka FPS di tablet belum ada di sini; itu tetap harus diisi di lembar catatan README.

## 1. Ringkasan pendekatan

### Negara timbul (`src/geo.ts`, `src/Globe.tsx` → `ExtrudedGlobe`)

- Data dari `world-atlas` (110m atau 50m), di-*dynamic import* sebagai JSON, lalu diubah
  jadi GeoJSON dengan `topojson-client`. Per negara dihitung `bounds` (`geoBounds`),
  kode alpha-2 (`i18n-iso-countries`, dari id numerik), dan titik bendera `anchor` =
  centroid poligon terluas.
- Geometri dibangun di **bidang lon/lat datar**: x = bujur, y = lintang, z = 0..1.
  Setiap ring jadi `THREE.Shape`, lalu `ExtrudeGeometry` (depth 1, tanpa bevel).
- Segitiga tutup bawah (ketiga titik z = 0) dibuang karena tidak pernah terlihat.
- `TessellateModifier` memecah segitiga sampai sisi ≤ 3° supaya tutup atas yang lebar
  tidak "memotong" ke dalam bola setelah dilipat.
- Setiap vertex dilipat ke bola: radius `1 − 0.002 + z × (0.025 + 0.002)`, jadi dasar
  sedikit di bawah permukaan laut (menghindari celah/z-fighting) dan puncak di 1.025.
- Ring yang melewati garis 180° dibentangkan (bujur boleh > 180). Ring yang mengelilingi
  kutub (Antartika) ditutup dengan dua titik tambahan di lintang ±90.
- **Satu mesh per negara**, masing-masing di dalam `<group>`. Lompatan saat diketuk
  menggeser group itu sepanjang arah normal anchor (`sin`, 700 ms, tinggi 0.12, sedikit
  pantulan di akhir).
- Mode pembanding **Datar (v0)**: satu bola dengan `CanvasTexture` 4096×2048
  equirectangular yang digambar `d3-geo` `geoPath`; digambar ulang penuh setiap kali
  pilihan berubah.

### Bendera berkibar (`src/Flag.tsx`)

- Semua SVG `flag-icons/flags/4x3` didaftarkan lewat `import.meta.glob(..., { eager: true, query: '?url' })`.
- Tekstur = kanvas 256×192: diisi dulu kotak abu-abu berlabel nama negara, lalu SVG
  digambar di atasnya saat `Image` selesai dimuat (`tex.needsUpdate = true`).
- `PlaneGeometry` 24×12 segmen dengan `ShaderMaterial`. Vertex shader menggeser `z`
  (dua gelombang sinus) dan sedikit `y`, dikalikan `uv.x` supaya sisi tiang diam.
  Fragment shader memakai `cos(fase)` sebagai bayangan palsu (0.82–1.0), tanpa lampu scene.
- Tiang dan kain ada di group yang sumbu +Y-nya = normal permukaan; tiap frame group
  diputar di sekitar tiang supaya kain menghadap kamera.
- `useFrame` memanggil `invalidate()` tiap frame, jadi selama bendera tampil, render jalan
  terus walau frameloop `demand`.

### Deteksi ketukan (`src/Globe.tsx`, `src/geo.ts`)

- Tap vs seret dibedakan dengan `e.delta < 8` (jarak piksel pointerdown→up versi R3F).
- **Mode timbul**: `onClick` di setiap mesh negara → raycast R3F → `onSelect(i)`.
  `stopPropagation()` mencegah kena laut. Laut tidak punya handler, jadi ketuk laut tidak
  membatalkan pilihan.
- **Mode datar**: `onClick` di bola → `e.point` diubah ke lon/lat (`vec3ToLonLat`) →
  `findCountryAt` memindai semua negara secara linear, saring dengan bounding box
  (termasuk kasus antimeridian), lalu `geoContains`.

### Pengaturan render (`src/App.tsx`)

- `<Canvas>`: `dpr` 1 / 1.5 / 2, `frameloop` `always` / `demand`, `antialias: true`,
  kamera `fov 40` di `[0, 0.6, 3.2]`, background `#0d1b2a`.
- Lampu: `ambientLight` 2.4 + `directionalLight` 1.6. Material negara/laut
  `MeshLambertMaterial`; bola datar `MeshPhongMaterial`.
- `OrbitControls` tanpa pan, jarak 1.6–6, damping aktif.
- Semua pengaturan disimpan di query string (`?mode=&res=&dpr=&loop=&overlay=`) supaya
  muat ulang bisa mengukur muat awal per kombinasi.
- Overlay: drei `<Stats>` (default) atau `r3f-perf` (di-*lazy load*).
- `StatsProbe` mematikan `gl.info.autoReset`, me-reset di `addEffect`, membaca draw call
  dan segitiga di `addAfterEffect`, dan menghitung frame per detik yang benar-benar dirender.
- `metrics.ts` mengukur "navigasi → frame globe pertama" (t0 = 0, jadi termasuk unduh
  bundle) dan "ganti pengaturan → frame pertama".
- Tanpa `React.StrictMode`.

## 2. Potongan kode inti

### Negara timbul: ekstrusi datar lalu lipat ke bola (`src/geo.ts:137-167`)

```ts
export function buildCountryGeometry(c: Country): THREE.BufferGeometry {
  const polys = c.geom.type === 'Polygon' ? [c.geom.coordinates] : c.geom.coordinates
  const shapes = polys.flatMap(polygonShapes)
  const ext = new THREE.ExtrudeGeometry(shapes, { depth: 1, bevelEnabled: false, steps: 1 })

  // buang tutup bawah (z=0 di ketiga titik): tidak pernah terlihat
  const src = ext.attributes.position.array as Float32Array
  const kept: number[] = []
  for (let i = 0; i < src.length; i += 9) {
    if (src[i + 2] === 0 && src[i + 5] === 0 && src[i + 8] === 0) continue
    for (let k = 0; k < 9; k++) kept.push(src[i + k])
  }
  ext.dispose()
  let geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(kept, 3))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(kept.length), 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((kept.length / 3) * 2), 2))
  geo = new TessellateModifier(MAX_EDGE_DEG, 12).modify(geo)
  geo.deleteAttribute('uv')

  const pos = geo.attributes.position
  const v = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    const r = RADIUS - 0.002 + pos.getZ(i) * (EXTRUDE_H + 0.002)
    lonLatToVec3(pos.getX(i), pos.getY(i), r, v)
    pos.setXYZ(i, v.x, v.y, v.z)
  }
  geo.computeVertexNormals()
  geo.computeBoundingSphere()
  return geo
}
```

Penanganan antimeridian dan kutub (`src/geo.ts:93-131`, dipersingkat):

```ts
function unwrapRing(ring: Position[]) {
  // ... offset ±360 setiap lompatan bujur > 180
  return { pts, wraps: offset !== 0 } // wraps = ring mengelilingi kutub
}

// di polygonShapes():
const pole = lats.reduce((a, b) => a + b, 0) < 0 ? -90 : 90
shapes.push(new THREE.Shape([...r.pts, new THREE.Vector2(last.x, pole), new THREE.Vector2(first.x, pole)]))
```

Lompatan negara (`src/Globe.tsx:63-76`):

```ts
useFrame(() => {
  if (!selection) return
  const g = groups.current[selection.idx]
  if (!g) return
  const t = (performance.now() - selection.at) / JUMP_MS
  if (t >= 1) {
    g.position.set(0, 0, 0)
    return
  }
  const h = t < 0.85 ? Math.sin((t / 0.85) * Math.PI) : Math.sin(((t - 0.85) / 0.15) * Math.PI) * 0.15
  g.position.copy(dirs[selection.idx]).multiplyScalar(h * JUMP_H)
  invalidate()
})
```

### Shader bendera berkibar (`src/Flag.tsx:40-64`, `93-103`)

```glsl
// vertex
uniform float uTime;
varying vec2 vUv;
varying float vShade;
void main() {
  vUv = uv;
  vec3 p = position;
  float k = uv.x; // tiang di kiri tidak bergerak
  float ph = uv.x * 7.0 - uTime * 6.0;
  p.z += (sin(ph) * 0.010 + sin(uv.y * 5.0 + uTime * 3.0) * 0.003) * k;
  p.y += sin(ph * 0.5) * 0.003 * k;
  vShade = cos(ph) * k;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}

// fragment
uniform sampler2D uMap;
varying vec2 vUv;
varying float vShade;
void main() {
  vec3 c = texture2D(uMap, vUv).rgb;
  gl_FragColor = vec4(c * (0.82 + 0.18 * vShade), 1.0);
  #include <colorspace_fragment>
}
```

```ts
useFrame(({ clock, camera, invalidate }) => {
  uniforms.uTime.value = clock.elapsedTime
  // putar di sekitar tiang supaya kain menghadap kamera
  const g = spin.current
  if (g?.parent) {
    tmp.copy(camera.position)
    g.parent.worldToLocal(tmp)
    g.rotation.y = Math.atan2(tmp.x, tmp.z)
  }
  invalidate() // kibaran butuh frame terus, juga di frameloop "demand"
})
```

### Deteksi ketukan (`src/Globe.tsx:30`, `94-98`, `188-193`; `src/geo.ts:81-90`)

```ts
const isTap = (e: ThreeEvent<MouseEvent>) => e.delta < 8

// mode timbul: per mesh negara
onClick={(e) => {
  if (!isTap(e)) return
  e.stopPropagation()
  onSelect(i)
}}

// mode datar: titik di bola → lon/lat → cari negara
onClick={(e) => {
  if (!isTap(e)) return
  const [lon, lat] = vec3ToLonLat(e.point)
  const c = findCountryAt(countries, lon, lat)
  if (c) onSelect(c.idx)
}}
```

```ts
export function findCountryAt(list: Country[], lon: number, lat: number): Country | undefined {
  for (const c of list) {
    const [[x0, y0], [x1, y1]] = c.bounds
    if (lat < y0 || lat > y1) continue
    // bounds yang melewati antimeridian punya x0 > x1
    if (x0 <= x1 ? lon < x0 || lon > x1 : lon < x0 && lon > x1) continue
    if (geoContains(c.feature, [lon, lat])) return c
  }
  return undefined
}
```

### Pengaturan render (`src/App.tsx:237-261`)

```tsx
<Canvas
  dpr={s.dpr}
  frameloop={s.loop}
  camera={{ position: [0, 0.6, 3.2], fov: 40, near: 0.1, far: 100 }}
  gl={{ antialias: true }}
>
  <color attach="background" args={['#0d1b2a']} />
  <ambientLight intensity={2.4} />
  <directionalLight position={[-2, 2, 3]} intensity={1.6} />
  {/* ExtrudedGlobe atau FlatGlobe */}
  <OrbitControls enablePan={false} minDistance={1.6} maxDistance={6} enableDamping />
  <StatsProbe />
  {s.overlay === 'perf' ? <Suspense fallback={null}><Perf position="top-left" /></Suspense> : <Stats className="stats" />}
</Canvas>
```

## 3. Dependensi

Rentang dari `package.json`; versi terpasang dibaca dari `node_modules/*/package.json`
(dikunci `bun.lock`). Bun 1.4.1.

| Paket | Rentang | Terpasang | Dipakai untuk |
|---|---|---|---|
| three | ^0.186.1 | 0.186.1 | render, ExtrudeGeometry, TessellateModifier |
| @react-three/fiber | ^8.18.0 | 8.18.0 | renderer React, event/raycast |
| @react-three/drei | ^9.122.0 | 9.122.0 | `OrbitControls`, `Stats` |
| r3f-perf | ^7.2.3 | 7.2.3 | overlay perf opsional (lazy) |
| react / react-dom | ^18.3.1 | 18.3.1 | UI |
| d3-geo | ^3.1.1 | 3.1.1 | area, bounds, centroid, contains, proyeksi mode datar |
| topojson-client | ^3.1.0 | 3.1.0 | TopoJSON → GeoJSON |
| world-atlas | ^2.0.2 | 2.0.2 | data negara 110m / 50m |
| i18n-iso-countries | ^7.14.0 | 7.14.0 | id numerik → alpha-2 |
| flag-icons | ^7.5.0 | 7.5.0 | SVG bendera 4x3 |

Dev: `typescript` ^5.9.3 (5.9.3), `vite` ^5.4.21 (5.4.21), `@vitejs/plugin-react` ^4.7.0
(4.7.0), `@types/three` ^0.186.0, `@types/react` ^18.3.31, `@types/react-dom` ^18.3.7,
`@types/d3-geo` ^3.1.1, `@types/geojson` ^7946.0.16, `@types/topojson-client` ^3.1.5.

## 4. Ukuran bundle produksi

Perintah: `tsc -p .` (exit 0, tanpa error) lalu `vite build` (Vite 5.4.21, 1063 modul,
9,87 dtk). Output diarahkan ke folder sementara di luar repo, jadi `dist/` tidak dibuat.

| File | Ukuran | gzip | Kapan dimuat |
|---|---|---|---|
| `index-*.js` (entry) | 1.314,29 kB | 360,60 kB | muat awal |
| `countries-110m-*.js` | 106,07 kB | 38,43 kB | muat awal (default `res=110m`) |
| `countries-50m-*.js` | 754,08 kB | 232,69 kB | hanya saat 50m dipilih |
| `index-*.js` (r3f-perf) | 214,97 kB | 82,46 kB | hanya saat overlay r3f-perf |
| `index-*.css` | 1,09 kB | 0,55 kB | muat awal |
| `index.html` | 0,48 kB | 0,30 kB | muat awal |
| 71 file SVG bendera | 1,9 MB total | – | satu per ketukan negara |

- **Muat awal default (110m, stats.js)** ≈ 1,42 MB mentah / ≈ 400 kB gzip.
- Total folder build 4,2 MB.
- Vite memberi peringatan chunk > 500 kB untuk entry dan data 50m.
- Dari 271 SVG bendera, **200 yang < 4 kB di-inline sebagai data URI ke chunk entry**
  (sekitar 199 kB teks), karena `import.meta.glob` eager + `assetsInlineLimit` bawaan Vite.
  Sisanya (71) jadi file terpisah. Jadi semua bendera kecil ikut terunduh di muat awal
  walau belum diketuk.

## 5. Masalah dan jalan pintas selama spike

Yang sudah diakui di README:

- Satu mesh per negara: sekitar 180 draw call (110m) dan 245 (50m). Alternatifnya
  menggabungkan semua negara jadi satu mesh dan memindahkan lompatan ke shader.
- Tesselasi ≤ 3° menaikkan jumlah segitiga, terutama di 50m.
- Antimeridian dibentangkan, Antartika ditutup lewat kutub, ring mini di −89,999 (artefak
  data 50m) dilewati.
- Bendera memaksa render terus, jadi `demand` baru hemat bila tidak ada negara terpilih,
  dan pilihan hanya bisa dihapus dengan muat ulang halaman.
- Antialias selalu aktif; tanpa StrictMode; angka dari laptop tidak berlaku untuk tablet.

Yang saya temukan saat membaca kode:

1. **Bundle entry membawa ~199 kB SVG bendera** (lihat bagian 4). Untuk produksi,
   bendera sebaiknya dimuat per negara, bukan lewat glob eager.
2. **Glob memakai path absolut `/node_modules/flag-icons/...`**: bergantung pada letak
   `node_modules` di root proyek Vite; rapuh bila dipindah ke monorepo/workspace.
3. **Negara tanpa alpha-2** (id kosong atau tidak dikenal `i18n-iso-countries`, mis.
   wilayah sengketa di world-atlas) jatuh ke kotak abu-abu berlabel nama. Tidak ada
   daftar negara mana saja yang kena.
4. **Anchor = centroid poligon terluas**: untuk negara cekung/berbentuk sabit, titik ini bisa
   jatuh di luar daratan, sehingga bendera berdiri di laut.
5. **Pembuangan tutup bawah memakai perbandingan float persis `=== 0`**. Aman selama
   ExtrudeGeometry menulis z = 0 tepat, tapi tidak dijaga apa pun.
6. **Material tidak di-dispose**: `mats`, `selMat`, `iceMat` di `ExtrudedGlobe` dibuat
   lewat `useMemo` tanpa cleanup, jadi bocor sedikit setiap ganti mode/data. Geometri
   sudah di-dispose.
7. **Efek samping di `useMemo`**: `FlatGlobe` menggambar kanvas, `setMetrics`, dan
   `invalidate()` di dalam `useMemo`; `ExtrudedGlobe` juga `setMetrics` di `useMemo`.
   Bekerja di spike, tapi bukan pola React yang aman (bisa jalan ganda di StrictMode/concurrent).
8. **Raycast mode timbul mengenai semua mesh negara** setiap ketukan (R3F memeriksa semua
   objek yang punya handler; hanya disaring bounding sphere). Biayanya belum diukur.
9. **Ambang tap 8 px tidak diskalakan dengan DPR** dan tidak memperhitungkan waktu tekan.
10. **Ketuk laut tidak membatalkan pilihan** di mode timbul (laut tanpa handler).
11. **Mode datar menggambar ulang tekstur 4096×2048 penuh per ketukan** (memang disengaja
    untuk meniru v0 dan diukur sebagai "gambar ulang").
12. **Data JSON di-bundle sebagai modul JS** (`countries-50m` 754 kB), jadi di-parse sebagai
    JavaScript, bukan `fetch` + `JSON.parse`. Ini memengaruhi angka "data" dan "parse".
13. **`initialLoadMs` dihitung dari t0 = 0** (awal navigasi), jadi angka di mode dev tidak
    mewakili produksi; README sudah menyarankan `build` + `preview`.
14. **`gl.info.autoReset = false` diubah global** untuk renderer; r3f-perf juga membaca
    `gl.info`, jadi angka kedua overlay bisa saling memengaruhi.
15. **Viewport `user-scalable=no, maximum-scale=1`** dan `touch-action: none` di body:
    wajar untuk spike, tapi mematikan zoom halaman (masalah aksesibilitas bila dibawa ke produksi).
16. **Tanpa test dan tanpa linter.** Ada komentar `eslint-disable` di `geo.ts`, tapi ESLint
    tidak terpasang. Satu-satunya pemeriksaan otomatis adalah `tsc` (lulus).
17. **Hasil tablet belum tercatat**: lembar catatan di README masih kosong, jadi spike ini
    belum menjawab pertanyaan utamanya (timbul vs datar di tablet murah).
