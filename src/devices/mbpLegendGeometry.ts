// Vector key legends for the 16" MacBook Pro, built from Carlos's outlined SVG.
// The PNG sheet (mbp-keyboard-legends.png) was a 5520x2208 crop of this drawing, mapped onto a
// 15-by-6 pitch plane with the function row at the top. We load the same SVG and fit that crop
// onto the same rectangle, as filled shapes, so the letters stay sharp at any zoom or angle.
import * as THREE from 'three'
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js'
import svgText from './mbp-keyboard.svg?raw'

// Keycap block in the SVG viewBox (fill #1C1C1F), expanded by half the inter-key gap so the
// rectangle is exactly 15 pitches wide and 6 pitches tall. Function row at the top (smaller y).
const KEYS_L = 72.9448, KEYS_T = 156.094, KEYS_R = 1106.27, KEYS_B = 563.527
const GAP = 9.827
export const MBP_LEGEND_CROP = {
  x: KEYS_L - GAP / 2,
  y: KEYS_T - GAP / 2,
  w: (KEYS_R + GAP / 2) - (KEYS_L - GAP / 2),
  h: (KEYS_B + GAP / 2) - (KEYS_T - GAP / 2),
}

export const MBP_LEGEND_INK = '#8E8E96' // rgb(142, 142, 150), the PNG ink
const TOUCH_FILL = '#101012'
const TOUCH_RING = '#6A6A70'
const SEGMENTS = 24

export function svgToPlane(x: number, y: number, planeW: number, planeH: number): [number, number] {
  const { x: cx, y: cy, w, h } = MBP_LEGEND_CROP
  return [(x - cx) / w * planeW - planeW / 2, planeH / 2 - (y - cy) / h * planeH]
}

function mapGeometry(geo: THREE.BufferGeometry, planeW: number, planeH: number) {
  const pos = geo.attributes.position
  for (let i = 0; i < pos.count; i++) {
    const [x, y] = svgToPlane(pos.getX(i), pos.getY(i), planeW, planeH)
    pos.setXYZ(i, x, y, 0)
  }
  pos.needsUpdate = true
  geo.computeVertexNormals()
}

function merge(parts: THREE.BufferGeometry[]) {
  const ps: number[] = [], ns: number[] = []
  for (const g0 of parts) {
    const g = g0.index ? g0.toNonIndexed() : g0
    const P = g.attributes.position, N = g.attributes.normal
    for (let i = 0; i < P.count; i++) {
      ps.push(P.getX(i), P.getY(i), P.getZ(i))
      if (N) ns.push(N.getX(i), N.getY(i), N.getZ(i))
      else ns.push(0, 0, 1)
    }
    if (g !== g0) g.dispose()
    g0.dispose()
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.Float32BufferAttribute(ps, 3))
  out.setAttribute('normal', new THREE.Float32BufferAttribute(ns, 3))
  return out
}

export type MbpLegendGeos = {
  ink: THREE.BufferGeometry
  touchFill: THREE.BufferGeometry | null
  touchRing: THREE.BufferGeometry | null
}

let cached: MbpLegendGeos | null = null

/** Filled legend shapes in the legend plane's local frame (centred, y toward the hinge). Built once.
 *  `pitch` is the key pitch in model units (mm(MBP.kb.pitch)). */
export function mbpLegendGeos(pitch: number): MbpLegendGeos {
  if (cached) return cached
  const planeW = 15 * pitch, planeH = 6 * pitch
  const data = new SVGLoader().parse(svgText)
  const inkParts: THREE.BufferGeometry[] = []
  const fillParts: THREE.BufferGeometry[] = []
  const ringParts: THREE.BufferGeometry[] = []

  const addShapes = (shapes: THREE.Shape[], bucket: THREE.BufferGeometry[]) => {
    for (const shape of shapes) {
      const g = new THREE.ShapeGeometry(shape, SEGMENTS)
      mapGeometry(g, planeW, planeH)
      bucket.push(g)
    }
  }

  for (const path of data.paths) {
    const style = (path.userData?.style ?? {}) as { fill?: string; stroke?: string; strokeWidth?: number }
    const fill = (style.fill ?? '').toLowerCase()
    const stroke = (style.stroke ?? '').toLowerCase()
    if (fill === MBP_LEGEND_INK.toLowerCase()) addShapes(path.toShapes(), inkParts)
    else if (fill === TOUCH_FILL.toLowerCase()) addShapes(path.toShapes(), fillParts)
    if (stroke && stroke !== 'none' && stroke === TOUCH_RING.toLowerCase()) {
      for (const sub of path.subPaths) {
        const g = SVGLoader.pointsToStroke(sub.getPoints(SEGMENTS), style as never)
        if (!g) continue
        mapGeometry(g, planeW, planeH)
        ringParts.push(g)
      }
    }
  }

  cached = {
    ink: merge(inkParts),
    touchFill: fillParts.length ? merge(fillParts) : null,
    touchRing: ringParts.length ? merge(ringParts) : null,
  }
  return cached
}
