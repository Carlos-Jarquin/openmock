import * as THREE from 'three'
// Procedural surface maps, generated once in a canvas and shared by every device.
// Nothing here is a photo or a scan, so the repo stays free of third-party textures.

function rng(seed: number) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) }
function canvasTex(size: number, paint: (d: Uint8ClampedArray, n: number) => void, repeat: number) {
  const c = document.createElement('canvas'); c.width = c.height = size
  const ctx = c.getContext('2d')!, img = ctx.createImageData(size, size)
  paint(img.data, size); ctx.putImageData(img, 0, 0)
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat); t.anisotropy = 8
  t.colorSpace = THREE.NoColorSpace; return t
}
const cache: Record<string, THREE.Texture> = {}
const once = (k: string, f: () => THREE.Texture) => (cache[k] ??= f())

/** Brushed metal: fine streaks along u. Roughness lives in G (three reads G for roughness). */
export const brushedRoughness = () => once('brushR', () => canvasTex(512, (d, n) => {
  const r = rng(7), rows = new Float32Array(n)
  for (let y = 0; y < n; y++) rows[y] = r()
  for (let y = 0; y < n; y++) {
    const base = 0.5 * rows[y] + 0.3 * rows[(y + 1) % n] + 0.2 * rows[(y + n - 1) % n]
    for (let x = 0; x < n; x++) {
      const v = 150 + (base - 0.5) * 34 + (r() - 0.5) * 10
      const i = (y * n + x) * 4; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255
    }
  }
}, 28))
/** Matching tangent-space normal map: faint grooves across the brush direction. */
export const brushedNormal = () => once('brushN', () => canvasTex(512, (d, n) => {
  const r = rng(11), rows = new Float32Array(n)
  for (let y = 0; y < n; y++) rows[y] = r()
  for (let y = 0; y < n; y++) {
    const dy = rows[(y + 1) % n] - rows[y]
    for (let x = 0; x < n; x++) { const i = (y * n + x) * 4; d[i] = 128; d[i + 1] = 128 + dy * 40; d[i + 2] = 255; d[i + 3] = 255 }
  }
}, 28))
/** Frosted glass microtexture: soft value noise around mid roughness. */
export const frostRoughness = () => once('frost', () => canvasTex(512, (d, n) => {
  const r = rng(23), g = 64, grid = new Float32Array(g * g).map(() => r())
  const at = (x: number, y: number) => grid[((y % g + g) % g) * g + ((x % g + g) % g)]
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const fx = x / n * g, fy = y / n * g, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy
    const a = at(ix, iy) * (1 - tx) + at(ix + 1, iy) * tx, b = at(ix, iy + 1) * (1 - tx) + at(ix + 1, iy + 1) * tx
    const v = 175 + ((a * (1 - ty) + b * ty) - 0.5) * 40 + (r() - 0.5) * 26
    const i = (y * n + x) * 4; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255
  }
}, 4))
/** Cover glass imperfections: mostly clean, a few faint wipe arcs and specks. Used as a roughness map near 0. */
export const smudgeRoughness = () => once('smudge', () => {
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
})
