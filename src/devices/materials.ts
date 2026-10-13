import * as THREE from 'three'
// Procedural surface maps, generated once in a canvas and shared by every device.
// Nothing here is a photo or a scan, so the repo stays free of third-party textures.

function rng(seed: number) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) }
// Maps are built straight into a typed array (DataTexture): no canvas, no createImageData, and the
// buffer is dropped once the GPU has it. If allocation fails the material simply renders without the map.
function canvasTex(size: number, paint: (d: Uint8ClampedArray, n: number) => void, repeat: number): THREE.Texture | null {
  try {
    const data = new Uint8ClampedArray(size * size * 4); paint(data, size)
    const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat); t.anisotropy = 8
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true
    t.colorSpace = THREE.NoColorSpace; t.needsUpdate = true
    t.onUpdate = () => { (t.image as { data: unknown }).data = null; t.onUpdate = null }
    return t
  } catch (e) { console.warn('Openmock: surface map skipped', e); return null }
}
const cache: Record<string, THREE.Texture | null> = {}
const once = (k: string, f: () => THREE.Texture | null) => (k in cache ? cache[k] : (cache[k] = f()))

/** Brushed metal: fine streaks along u. Roughness lives in G (three reads G for roughness). */
export const brushedRoughness = () => once('brushR', () => canvasTex(256, (d, n) => {
  const r = rng(7), rows = new Float32Array(n)
  for (let y = 0; y < n; y++) rows[y] = r()
  for (let y = 0; y < n; y++) {
    const base = 0.5 * rows[y] + 0.3 * rows[(y + 1) % n] + 0.2 * rows[(y + n - 1) % n]
    for (let x = 0; x < n; x++) {
      const v = 150 + (base - 0.5) * 12 + (r() - 0.5) * 4
      const i = (y * n + x) * 4; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255
    }
  }
}, 14))
/** Matching tangent-space normal map: faint grooves across the brush direction. */
export const brushedNormal = () => once('brushN', () => canvasTex(256, (d, n) => {
  const r = rng(11), rows = new Float32Array(n)
  for (let y = 0; y < n; y++) rows[y] = r()
  for (let y = 0; y < n; y++) {
    const dy = rows[(y + 1) % n] - rows[y]
    for (let x = 0; x < n; x++) { const i = (y * n + x) * 4; d[i] = 128; d[i + 1] = 128 + dy * 18; d[i + 2] = 255; d[i + 3] = 255 }
  }
}, 14))
/** Frosted glass microtexture: soft value noise around mid roughness. */
export const frostRoughness = () => once('frost', () => canvasTex(256, (d, n) => {
  const r = rng(23), g = 64, grid = new Float32Array(g * g).map(() => r())
  const at = (x: number, y: number) => grid[((y % g + g) % g) * g + ((x % g + g) % g)]
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const fx = x / n * g, fy = y / n * g, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy
    const a = at(ix, iy) * (1 - tx) + at(ix + 1, iy) * tx, b = at(ix, iy + 1) * (1 - tx) + at(ix + 1, iy + 1) * tx
    const v = 175 + ((a * (1 - ty) + b * ty) - 0.5) * 40 + (r() - 0.5) * 26
    const i = (y * n + x) * 4; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255
  }
}, 2))
/** Cover glass imperfections: mostly clean, a few faint wipe arcs and specks. Used as a roughness map near 0. */
export const smudgeRoughness = () => once('smudge', () => { try {
  const c = document.createElement('canvas'); c.width = c.height = 512
  const ctx = c.getContext('2d')!, r = rng(5)
  ctx.fillStyle = 'rgb(8,8,8)'; ctx.fillRect(0, 0, 512, 512)
  ctx.lineCap = 'round'
  for (let k = 0; k < 9; k++) {
    ctx.strokeStyle = `rgba(60,60,60,${0.05 + r() * 0.06})`; ctx.lineWidth = 18 + r() * 30
    ctx.beginPath(); ctx.arc(r() * 512, r() * 512, 80 + r() * 160, r() * 6, r() * 6 + 1.2); ctx.stroke()
  }
  for (let k = 0; k < 220; k++) { ctx.fillStyle = `rgba(90,90,90,${r() * 0.25})`; ctx.fillRect(r() * 512, r() * 512, 1.2, 1.2) }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.NoColorSpace; return t
} catch (e) { console.warn('Openmock: smudge map skipped', e); return null } })

// Hot reload: free the previous copy's generated maps when this module is re-run, so edits don't stack copies on the GPU.
if (import.meta.hot) {
  const w = globalThis as unknown as { __omMatFree?: () => void }
  // Wait until the new copy has rendered, or the old meshes draw one more frame and re-upload what was freed.
  const prev = w.__omMatFree; if (prev) setTimeout(prev, 1000)
  w.__omMatFree = () => { for (const k in cache) { cache[k]?.dispose(); delete cache[k] } }
}
