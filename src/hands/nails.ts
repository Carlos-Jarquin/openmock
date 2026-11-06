// Fingernails: our own procedural nail meshes, one per digit, parented to the distal bone so they follow every pose.
// Each nail is measured from the hand's own skin at rest (where the fingertip ends, how wide and how high the back of
// the last phalanx is), then shaped from an outline (Round, Square, Oval, Almond, Stiletto, Coffin) with a free edge
// that runs past the fingertip as the length grows. The solver keeps the nails out of the phone (see Hands.tsx).
import * as THREE from 'three'

export type NailShape = 'round' | 'square' | 'oval' | 'almond' | 'stiletto' | 'coffin'
export const NAIL_SHAPES: [NailShape, string][] = [['round', 'Round'], ['square', 'Square'], ['oval', 'Oval'], ['almond', 'Almond'], ['stiletto', 'Stiletto'], ['coffin', 'Coffin']]
/** Photographic Elena FF hand, or the original smooth generic-hand material. Missing on old saves, which read as realistic. */
export type HandStyle = 'realistic' | 'studio' | 'classic'
/** How each device's hand looks: size (0.5 to 1.15), build (girth: 0.75 slender to 1.3 robust, length unchanged), nail length (0 = short and flush, 1 = long), shape and colour (null = natural). */
export interface HandLook { size: number; build: number; /** forearm shown (false: the hand fades out just past the wrist). Studio ignores this and fades the wrist instead. */ arm: boolean; /** procedural nails shown (false: none, and the touch solve ignores nail clearance) */ nails: boolean; nailLen: number; nailShape: NailShape; nailColor: string | null; /** realistic: Elena's hand, lit by the scene. studio: the same mesh with a pre-lit bake. classic: the original smooth generic-hand. Silhouette ignores this and stays on the classic mesh. Spectral uses Elena's mesh either way and keeps its own material. */ style?: HandStyle }
export const HAND_LOOK0: HandLook = { size: 1, build: 1, arm: true, nails: true, nailLen: 0, nailShape: 'round', nailColor: null, style: 'realistic' }
export const NAIL_SWATCHES = ['#f2d4cf', '#c8102e', '#7a1f3d', '#1d1d22', '#e9c7a8', '#d7b8f0']

/** Half-width (0 to 1) of the nail's free part at t (0 where the shaping starts, 1 at the very tip). */
function profile(s: NailShape, t: number) {
  switch (s) {
    case 'square': return 1 - 0.12 * Math.pow(t, 10)
    case 'coffin': return 1 - 0.42 * t - 0.1 * Math.pow(t, 12)
    case 'oval': return (1 - 0.1 * t) * Math.sqrt(Math.max(0, 1 - Math.pow(t, 2.6)))
    case 'almond': return Math.pow(Math.max(0, 1 - Math.pow(t, 1.5)), 0.75)
    case 'stiletto': return Math.pow(Math.max(0, 1 - t), 0.85)
    default: return Math.sqrt(Math.max(0, 1 - t * t))
  }
}

/** What a nail is built from, measured on the skin. All lengths in the hand model's units (metres). */
export interface NailFit { bed: number; width: number; tipW: number; skinZ: (x: number) => number }
export interface NailBuild { geo: THREE.BufferGeometry; /** points along the free edge and tip, nail frame, for the collision check */ edge: THREE.Vector3[]; /** the nail's top outline as line segment pairs (x, y, z flat), for the Spectral line pass */ outline: number[] }

/** Nail geometry in its own frame: x along the finger from the cuticle, y across, z up out of the nail. */
export function nailGeometry(f: NailFit, len: number, shape: NailShape): NailBuild {
  const NX = 28, NY = 12, base = f.width / 2, thick = Math.max(0.00025, f.width * 0.03)
  // the free edge: almost flush when short, up to about 1.25 nail widths past the fingertip when long
  const ext = f.width * (0.05 + 1.2 * Math.pow(Math.max(0, Math.min(1, len)), 1.1))
  const L = f.bed + ext, bedEnd = f.bed * 0.88, shapeFrom = Math.max(f.bed * 0.6, L - Math.max(ext * 1.15, f.width * 0.42))
  const arch = f.width * 0.17, zEnd = f.skinZ(bedEnd), slope = (zEnd - f.skinZ(bedEnd * 0.8)) / (bedEnd * 0.2)
  const zc = (x: number) => x <= bedEnd ? f.skinZ(x) : zEnd + Math.max(-0.35, Math.min(0.1, slope)) * (x - bedEnd) - 0.18 * (x - bedEnd) ** 2 / f.width
  const hwAt = (x: number) => {
    const k0 = Math.min(1, x / (f.bed * 0.16)), cut = Math.sqrt(Math.max(0, 1 - (1 - k0) ** 2))
    const t = Math.max(0, Math.min(1, (x - shapeFrom) / Math.max(1e-6, L - shapeFrom)))
    return base * (0.86 + 0.14 * cut) * profile(shape, t) * (x < 1e-9 ? 0.86 : 1)
  }
  const pos: number[] = [], idx: number[] = [], row = NY + 1, layer = (NX + 1) * row
  for (const side of [0, 1]) for (let j = 0; j <= NX; j++) {
    const x = L * j / NX, hw = hwAt(x)
    for (let i = 0; i <= NY; i++) { const b = -1 + 2 * i / NY, y = b * hw
      // a gentle C-curve across the nail; the underside sits on the skin, the top a nail-thickness above
      const z = zc(x) + arch * (1 - b * b) * (0.55 + 0.45 * Math.min(1, x / f.bed)) - arch * 0.55 + (side ? 0 : thick)
      pos.push(x, y, z) }
  }
  const at = (s: number, j: number, i: number) => s * layer + j * row + i
  for (let j = 0; j < NX; j++) for (let i = 0; i < NY; i++) {
    const a = at(0, j, i), b = at(0, j + 1, i), c = at(0, j + 1, i + 1), d = at(0, j, i + 1)
    idx.push(a, d, b, b, d, c)
    const A = at(1, j, i), B = at(1, j + 1, i), C = at(1, j + 1, i + 1), D = at(1, j, i + 1)
    idx.push(A, B, D, B, C, D)
  }
  // side walls along both edges, the cuticle end and the tip end
  for (let j = 0; j < NX; j++) for (const i of [0, NY]) { const a = at(0, j, i), b = at(0, j + 1, i), A = at(1, j, i), B = at(1, j + 1, i); if (i === 0) idx.push(a, b, A, b, B, A); else idx.push(a, A, b, b, A, B) }
  for (const j of [0, NX]) for (let i = 0; i < NY; i++) { const a = at(0, j, i), d = at(0, j, i + 1), A = at(1, j, i), D = at(1, j, i + 1); if (j === 0) idx.push(a, A, d, d, A, D); else idx.push(a, d, A, d, D, A) }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals()
  // the Spectral body shader reads smoothNormal and the effect data (a nail is thin: low mass, never arm or wrist rim)
  const nv = geo.getAttribute('position').count
  geo.setAttribute('smoothNormal', geo.getAttribute('normal').clone()); geo.setAttribute('aMass', new THREE.BufferAttribute(new Float32Array(nv).fill(0.1), 1))
  geo.setAttribute('aArm', new THREE.BufferAttribute(new Float32Array(nv), 1)); geo.setAttribute('aCut', new THREE.BufferAttribute(new Float32Array(nv), 1))
  const edge: THREE.Vector3[] = []
  for (let j = Math.floor(NX * 0.55); j <= NX; j += 2) for (const i of [0, NY / 2, NY]) edge.push(new THREE.Vector3(...pos.slice(at(1, j, i) * 3, at(1, j, i) * 3 + 3) as [number, number, number]))
  const outline: number[] = [], loop: number[] = []
  for (let j = 0; j <= NX; j++) loop.push(at(0, j, 0)); for (let i = 1; i <= NY; i++) loop.push(at(0, NX, i))
  for (let j = NX - 1; j >= 0; j--) loop.push(at(0, j, NY)); for (let i = NY - 1; i > 0; i--) loop.push(at(0, 0, i))
  for (let k = 0; k < loop.length; k++) { const a = loop[k], b = loop[(k + 1) % loop.length]; outline.push(...pos.slice(a * 3, a * 3 + 3), ...pos.slice(b * 3, b * 3 + 3)) }
  return { geo, edge, outline }
}

/** Nail colour material: natural is a pale pink-white over the skin tone with a glossy clearcoat; a colour is polish. */
export function nailMaterial(skin: string, color: string | null) {
  const c = color ? new THREE.Color(color) : new THREE.Color(skin).lerp(new THREE.Color('#f7e1dc'), 0.62)
  return new THREE.MeshPhysicalMaterial({ color: c, roughness: color ? 0.22 : 0.34, metalness: 0, clearcoat: 1, clearcoatRoughness: color ? 0.08 : 0.2, specularIntensity: 0.7, sheen: color ? 0 : 0.4, sheenColor: new THREE.Color('#ffffff') })
}
