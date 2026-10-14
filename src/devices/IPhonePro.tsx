import { memo, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import type { DeviceProps } from '../types'
import { fitTexture, DEFAULT_LOGO_TINT, sceneHit } from './shared'
import { brushedNormal, brushedRoughness, frostRoughness, smudgeRoughness } from './materials'
import type { IPhoneSpec } from './iphoneSpecs'
import { sliceY } from '../sketch/Sketch'
// Parametric iPhone 18 Pro family: unofficial procedural model, not affiliated with Apple.
// Every measurement comes from a pure data spec (./iphoneSpecs.ts); this file only turns it into geometry.
// Scale: 1 unit = 100 mm. Origin at the body centre, display faces +z, top of phone is +y.
const mm = (v: number) => v / 100

export const IP18_FINISHES: Record<string, { label: string; frame: string; back: string }> = {
  black: { label: 'Black', frame: '#18191b', back: '#1c1d20' },
  silver: { label: 'Silver', frame: '#e2e3e4', back: '#e6e6e4' },
  glacier: { label: 'Glacier', frame: '#aebfd2', back: '#b8c7d9' },
  burgundy: { label: 'Burgundy', frame: '#4e1c27', back: '#57202c' },
}

const NORMAL_SCALE = new THREE.Vector2(0.02, 0.02)
// Shapes and geometries are cached by their parameters (and the spec id for the body set), so a re-render
// (every drag frame) reuses them instead of building and uploading new GPU buffers that never get freed.
const shapeCache = new Map<string, THREE.Shape>()
const rrC = (w: number, h: number, r: number[], cx = 0, cy = 0) => {
  const k = [w, h, ...r, cx, cy].join('|'); let s = shapeCache.get(k)
  if (!s) shapeCache.set(k, s = rrect(w, h, r, cx, cy)); return s
}
const geoCache = new Map<string, THREE.BufferGeometry>()
const btnLineCache = new Map<string, Float32Array>()
const geoOnce = (k: string, f: () => THREE.BufferGeometry) => { let g = geoCache.get(k); if (!g) geoCache.set(k, g = f()); return g }
/** Smooth shading for extruded parts: ExtrudeGeometry is unindexed, so computeVertexNormals gives one normal per face
 * and every bevel facet shows. Average normals of faces meeting at the same point when they are within creaseDeg. */
export function smoothNormals(g: THREE.BufferGeometry, creaseDeg = 50) {
  const pos = g.attributes.position, n = pos.count, cos = Math.cos(creaseDeg * Math.PI / 180)
  const fn = new Float32Array(n * 3), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3()
  for (let i = 0; i < n; i += 3) {
    a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2)
    c.sub(b); b.sub(a); b.cross(c) // area-weighted face normal, (b - a) x (c - b): outward, same sense as three.js
    for (let k = 0; k < 3; k++) fn.set([b.x, b.y, b.z], (i + k) * 3)
  }
  const key = (i: number) => `${Math.round(pos.getX(i) * 1e5)},${Math.round(pos.getY(i) * 1e5)},${Math.round(pos.getZ(i) * 1e5)}`
  const groups = new Map<string, number[]>()
  for (let i = 0; i < n; i++) { const k = key(i); let l = groups.get(k); if (!l) groups.set(k, l = []); l.push(i) }
  const out = new Float32Array(n * 3), u = new THREE.Vector3(), v = new THREE.Vector3(), sum = new THREE.Vector3()
  groups.forEach(l => {
    for (const i of l) {
      u.fromArray(fn, i * 3).normalize(); sum.set(0, 0, 0)
      for (const j of l) { v.fromArray(fn, j * 3); const len = v.length(); if (len && u.dot(v) / len >= cos) sum.add(v) }
      if (sum.lengthSq() === 0) sum.copy(u)
      sum.normalize().toArray(out, i * 3)
    }
  })
  g.setAttribute('normal', new THREE.BufferAttribute(out, 3)); return g
}
const bodySets = new Map<string, Record<string, THREE.BufferGeometry>>()
function geoSet<T extends Record<string, THREE.BufferGeometry>>(id: string, f: () => T): T {
  let s = bodySets.get(id); if (!s) bodySets.set(id, s = f()); return s as T
}
// Hot reload: Vite re-runs this module without calling dispose here, so each new copy frees the previous copy's GPU geometry.
if (import.meta.hot) {
  const w = globalThis as unknown as { __omIp18Free?: () => void }
  // Wait until the new copy has rendered, or the old meshes draw one more frame and re-upload what was freed.
  const prev = w.__omIp18Free; if (prev) setTimeout(prev, 1000)
  w.__omIp18Free = () => {
    geoCache.forEach(g => g.dispose()); geoCache.clear(); shapeCache.clear()
    bodySets.forEach(s => Object.values(s).forEach(g => g.dispose())); bodySets.clear()
  }
}
export function rrect(w: number, h: number, [bl, br, tr, tl]: number[], cx = 0, cy = 0) {
  const s = new THREE.Shape(), x = cx - w / 2, y = cy - h / 2
  const arc = (px: number, py: number, r: number, a0: number) => s.absarc(px, py, r, a0, a0 + Math.PI / 2, false)
  s.moveTo(x + bl, y); s.lineTo(x + w - br, y); arc(x + w - br, y + br, br, -Math.PI / 2)
  s.lineTo(x + w, y + h - tr); arc(x + w - tr, y + h - tr, tr, 0)
  s.lineTo(x + tl, y + h); arc(x + tl, y + h - tl, tl, Math.PI / 2)
  s.lineTo(x, y + bl); arc(x + bl, y + bl, bl, Math.PI); return s
}
const all = (r: number) => [r, r, r, r]
/** Slab with a rounded (quarter-round style) edge band, centred in z. */
export function slab(shape: THREE.Shape, depth: number, edge: number, segs = 16) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: depth - edge * 2, bevelEnabled: true, bevelThickness: edge, bevelSize: edge, bevelOffset: -edge, bevelSegments: segs, curveSegments: 64 })
  g.translate(0, 0, -(depth - edge * 2) / 2); return smoothNormals(g)
}
/** Antenna split band: the right-hand side profile of the body (flat side plus both rounded edges), extruded along y. */
function sideBand(w: number, t: number, edge: number, h: number, segs = 8) {
  const s = new THREE.Shape(), o = mm(0.015), x0 = w / 2 - edge, R = edge + o
  s.moveTo(x0, t / 2 + o)
  for (let i = 1; i <= segs; i++) { const a = (Math.PI / 2) * (1 - i / segs); s.lineTo(x0 + R * Math.cos(a), t / 2 - edge + R * Math.sin(a)) }
  s.lineTo(w / 2 + o, -t / 2 + edge)
  for (let i = 1; i <= segs; i++) { const a = -(Math.PI / 2) * (i / segs); s.lineTo(x0 + R * Math.cos(a), -t / 2 + edge + R * Math.sin(a)) }
  s.lineTo(x0, t / 2 + o)
  const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false })
  g.rotateX(-Math.PI / 2); g.translate(0, -h / 2, 0); return smoothNormals(g)
}
function flatUV(shape: THREE.Shape, w: number, h: number) {
  const g = new THREE.ShapeGeometry(shape, 48), p = g.attributes.position, uv = g.attributes.uv
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / w + 0.5, p.getY(i) / h + 0.5)
  uv.needsUpdate = true; return g
}
const E = 0.0003
/** Concave fillet strip along the lower part of a plateau outline. Built in the outline's plane with height toward -z
 * (out of the back): at the base it starts f out from the wall, and it meets the wall f up. xMax clips it to the flat back. */
/** Signed distance to a rounded rectangle centred at (cx, cy), negative inside; radius rb for the lower half, rt for the upper. */
function sdRRect(x: number, y: number, hw: number, hh: number, cx: number, cy: number, rb: number, rt: number) {
  const r = y < cy ? rb : rt, qx = Math.abs(x - cx) - (hw - r), qy = Math.abs(y - cy) - (hh - r)
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
}
/**
 * Camera plateau as ONE swept height field over the top of the back, fused with the frame.
 * Height above the back = plateau profile minus the frame's back roundover:
 *  - plateau profile: flat top at `rise`, then a single concave fillet over the shoulder width D down to 0 (steep at the
 *    plateau wall, tangent to the back at the foot), traced from the drawing's side view, so there is no ramp or step;
 *  - roundover: the same quarter-round (radius `edge`) the frame uses, applied to the whole surface near the body outline,
 *    so at the outline the surface turns vertical and continues straight down the frame side (tangent-continuous, no kink).
 * A vertical skirt along the outline closes the gap down to where the frame's flat side starts. Built in body coordinates,
 * back plane at z = 0, outward (towards the back) is -z.
 */
function plateauSurface(o: { W: number; H: number; CR: number; edge: number; rise: number; D: number; edgeK: number; m: number; flat: { top: number; bottom: number; hw: number; rb: number; rt: number } }) {
  const { W, H, CR, edge, rise, D, flat, edgeK, m } = o
  const yFoot = flat.bottom - D - edge * 0.2, nx = 560, ny = Math.ceil(560 * (H / 2 - yFoot) / W)
  const fcy = (flat.top + flat.bottom) / 2, fhh = (flat.top - flat.bottom) / 2
  const prof = (x: number, y: number) => {
    const d = sdRRect(x, y, flat.hw, fhh, 0, fcy, flat.rb, flat.rt)
    // Shoulder per the drawing's side view: one concave superelliptic fillet, tangent to the back at the foot (d = D)
    // and rising steeply into the plateau's side wall at the flat edge (d = 0). Exponent m fitted to the drawing.
    // A tight convex radius (smooth minimum, edgeK) rounds the crisp top edge.
    if (d >= D) return 0
    // The pure curve is vertical at d = 0; starting it 3% in caps the wall slope (about 5:1) so the height field and its
    // normals stay clean at the flat's edge, then it is rescaled to reach exactly `rise`.
    const e0 = 0.03, top = 1 - Math.pow(1 - Math.pow(1 - e0, m), 1 / m)
    const s = e0 + (1 - e0) * Math.min(1, Math.max(0, d / D)), q = Math.max(0, 1 - Math.pow(1 - s, m))
    const hs = rise * (1 - Math.pow(q, 1 / m)) / top
    const k = edgeK, a = rise, b = hs, hh = Math.max(k - Math.abs(a - b), 0) / k
    return Math.min(a, b) - hh * hh * k / 4
  }
  const roll = (e: number) => e >= edge ? 0 : edge - Math.sqrt(Math.max(0, edge * edge - (edge - e) ** 2))
  const sdBody = (x: number, y: number) => sdRRect(x, y, W / 2, H / 2, 0, 0, CR, CR)
  const height = (x: number, y: number) => prof(x, y) - roll(Math.max(0, -sdBody(x, y)))
  const pos: number[] = [], idx: number[] = [], nor: number[] = []
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
    let x = -W / 2 + W * i / nx, y = yFoot + (H / 2 - yFoot) * j / ny
    // Top corners: map the grid's corner square onto the quarter disc of the body's corner radius (square-to-disc),
    // so the grid follows the rounded outline without collapsed cells.
    const ccx = W / 2 - CR, ccy = H / 2 - CR, vx = Math.abs(x) - ccx, vy = y - ccy
    if (vx > 0 && vy > 0) { const k = Math.max(vx, vy) / Math.hypot(vx, vy); x = Math.sign(x) * (ccx + vx * k); y = ccy + vy * k }
    pos.push(x, y, -height(x, y) - 1e-4) // 0.01 mm proud so the foot never z-fights the body's back
    // Analytic normal from the height gradient (exact at the frame join, where it turns horizontal like the frame side).
    const e = 2e-4, hx = (height(x + e, y) - height(x - e, y)) / (2 * e), hy = (height(x, y + e) - height(x, y - e)) / (2 * e)
    const sdx = sdBody(x, y) > -e ? 1 : 0
    const n = new THREE.Vector3(-hx, -hy, -1)
    if (sdx) { // on the outline the surface is vertical: use the outline's outward normal
      const g = 1e-5, gx = (sdBody(x + g, y) - sdBody(x - g, y)) / (2 * g), gy = (sdBody(x, y + g) - sdBody(x, y - g)) / (2 * g)
      n.set(gx, gy, 0)
    }
    n.normalize(); nor.push(n.x, n.y, n.z)
  }
  const row = nx + 1
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const a = j * row + i, b = a + 1, c = a + row, d = c + 1
    idx.push(a, c, b, b, c, d)
  }
  // Skirt: along the outline above the foot, from the surface edge straight down to the top of the frame's flat side.
  const base = pos.length / 3, outline = rrect(W, H, all(CR)).getSpacedPoints(1600).filter(p => p.y > yFoot)
  outline.sort((p, q) => Math.atan2(p.y, p.x) - Math.atan2(q.y, q.x))
  outline.forEach(p => {
    pos.push(p.x, p.y, -height(p.x, p.y) - 1e-5, p.x, p.y, edge)
    const g = 1e-5, gx = (sdBody(p.x + g, p.y) - sdBody(p.x - g, p.y)) / (2 * g), gy = (sdBody(p.x, p.y + g) - sdBody(p.x, p.y - g)) / (2 * g)
    const l = Math.hypot(gx, gy) || 1; nor.push(gx / l, gy / l, 0, gx / l, gy / l, 0)
  })
  for (let k = 0; k < outline.length - 1; k++) {
    const a = base + k * 2, b = a + 2
    idx.push(a, a + 1, b, b, a + 1, b + 1)
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx)
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  // UVs exactly as ExtrudeGeometry's world UVs (x, y on caps, so the grain map matches the body; without UVs the
  // roughness map samples one texel and the plateau reads as a different finish).
  const uv: number[] = []; for (let i = 0; i < pos.length; i += 3) uv.push(pos[i], pos[i + 1])
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  // Sketch style: the flat top's outline as line segments on the surface (the plateau's edge in an illustration).
  const loop = rrect(flat.hw * 2, flat.top - flat.bottom, [flat.rb, flat.rb, flat.rt, flat.rt], 0, fcy).getSpacedPoints(360)
  const seg: number[] = []
  for (let k = 0; k < loop.length - 1; k++) for (const q of [loop[k], loop[k + 1]]) seg.push(q.x, q.y, -height(q.x, q.y) - 3e-4)
  g.userData.topLoop = new Float32Array(seg); return g
}

function plateauFillet(shape: THREE.Shape, h: number, xMax: number, f: number, inset = 0, steps = 8) {
  const pts = shape.getSpacedPoints(400).slice(0, -1), n = pts.length
  const keep: { p: THREE.Vector2; nrm: THREE.Vector2 }[] = []
  for (let i = 0; i < n; i++) {
    const p = pts[i], a = pts[(i + n - 1) % n], b = pts[(i + 1) % n]
    if (p.y > -h / 2 + h * 0.45 || Math.abs(p.x) > xMax) continue
    const t = b.clone().sub(a).normalize(), nrm = new THREE.Vector2(t.y, -t.x) // outward for a counter-clockwise outline
    keep.push({ p, nrm })
  }
  keep.sort((u, v) => u.p.x - v.p.x)
  const pos: number[] = [], idx: number[] = []
  keep.forEach(({ p, nrm }) => {
    for (let k = 0; k <= steps; k++) {
      // Fade the fillet out over the last 3 mm before the frame so it never ends in a lip.
      const fe = f * Math.min(1, Math.max(0, (xMax - Math.abs(p.x)) / (f * 2 + 0.03)))
      const th = (k / steps) * Math.PI / 2, off = fe * (1 - Math.sin(th)) - inset, up = fe * (1 - Math.cos(th))
      pos.push(p.x + nrm.x * off, p.y + nrm.y * off, -up)
    }
  })
  for (let i = 0; i < keep.length - 1; i++) for (let k = 0; k < steps; k++) {
    const a = i * (steps + 1) + k, b = a + steps + 1
    idx.push(a, a + 1, b, a + 1, b + 1, b)
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx)
  g.computeVertexNormals(); return g
}

// Interaction. A press runs 120 ms in (ease out) and 180 ms back out with a small spring overshoot.
const PRESS_IN = 120, PRESS_OUT = 180
function pressCurve(ms: number) {
  if (ms < 0) return 0
  if (ms < PRESS_IN) { const t = ms / PRESS_IN; return 1 - (1 - t) * (1 - t) }
  const t = (ms - PRESS_IN) / PRESS_OUT
  if (t >= 1) return 0
  return (1 - t) * Math.cos(t * Math.PI * 0.62) - Math.sin(t * Math.PI) * 0.06 * (1 - t) // returns past zero briefly
}
function useClickable(onPress: () => void) {
  const gl = useThree(s => s.gl)
  return {
    onPointerDown: (e: ThreeEvent<PointerEvent>) => { if (e.button !== 0) return; e.stopPropagation(); sceneHit.current = true; onPress() },
    onPointerOver: (e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); gl.domElement.style.cursor = 'pointer' },
    onPointerOut: () => { gl.domElement.style.cursor = '' },
  }
}
/** Child geometry extrudes along local +x (outward). Pressing moves it inward by `depth`. */
export function Pressable({ depth, children, ...rest }: { depth: number; children: ReactNode; position: [number, number, number]; rotation?: [number, number, number] }) {
  const inner = useRef<THREE.Group>(null), t0 = useRef(-1e9)
  const h = useClickable(() => { t0.current = performance.now() })
  useFrame(() => { if (inner.current) inner.current.position.x = -depth * pressCurve(performance.now() - t0.current) })
  return <group {...rest}><group ref={inner} {...h}>{children}</group></group>
}

// SIM tray: position, length and width from the left side view; ejector hole, carrier and travel are assumed.
const NANO = { l: mm(12.3), w: mm(8.8), t: mm(0.67) }
const EJECT = mm(15), EJECT_MS = 420
const ease = (t: number) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
/** Extrude a shape along +z by depth with a small round bevel; normals smoothed so the rounded walls shade evenly. */
const trayGeo = (k: string, shape: THREE.Shape, depth: number) => geoOnce(`tray|${k}|${depth}`, () => {
  const b = Math.min(depth * 0.3, mm(0.2))
  const g = new THREE.ExtrudeGeometry(shape, { depth: depth - b * 2, bevelEnabled: true, bevelThickness: b, bevelSize: b * 0.6, bevelSegments: 3, curveSegments: 32 })
  g.translate(0, 0, b); smoothNormals(g, 40); return g
})
function SimTray({ frame, x, y, len, w }: { frame: string; x: number; y: number; len: number; w: number }) {
  const slide = useRef<THREE.Group>(null), st = useRef({ out: false, from: 0, t0: -1e9 })
  const cur = () => { const s = st.current, k = Math.min(1, (performance.now() - s.t0) / EJECT_MS); return s.from + ((s.out ? 1 : 0) - s.from) * ease(k) }
  const h = useClickable(() => { const v = cur(); st.current = { out: !st.current.out, from: v, t0: performance.now() } })
  useFrame(() => { if (slide.current) slide.current.position.x = -EJECT * cur() })
  useEffect(() => { // dev hook for scripted renders: window.__omSim(true|false)
    if (!import.meta.env.DEV) return
    const w = window as unknown as { __omSim?: (o: boolean) => void }
    w.__omSim = o => { st.current = { out: o, from: o ? 1 : 0, t0: -1e9 } }
    return () => { delete w.__omSim }
  }, [])
  const carrier = { x: mm(10.6), y: mm(14.2), t: mm(0.8) }, pin = { y: len / 2 - mm(2.4), d: mm(0.9) }
  return (
    <group position={[x, y, 0]}>
      {/* the slot opening, only seen once the tray is out */}
      <mesh rotation={[0, -Math.PI / 2, 0]} position={[-E / 3, 0, 0]}><shapeGeometry args={[rrC(w, len, all(w / 2)), 24]} />
        <meshBasicMaterial color="#030303" polygonOffset polygonOffsetFactor={-1} /></mesh>
      <group ref={slide} {...h}>
        {/* flush face plate with a hairline seam */}
        <mesh rotation={[0, -Math.PI / 2, 0]} position={[-E * 0.8, 0, 0]}><shapeGeometry args={[rrC(w - mm(0.12), len - mm(0.12), all(w / 2 - mm(0.06))), 24]} />
          <meshPhysicalMaterial color={frame} metalness={0.85} roughness={0.3} polygonOffset polygonOffsetFactor={-3} /></mesh>
        <mesh rotation={[0, -Math.PI / 2, 0]} position={[-E * 1.2, pin.y, 0]}><circleGeometry args={[pin.d / 2, 20]} />
          <meshBasicMaterial color="#060606" polygonOffset polygonOffsetFactor={-5} /></mesh>
        {/* face plate thickness and carrier that live inside the frame: a stadium-ended plate behind the cap and a
            round-cornered carrier, extruded so no square box corners show past the rounded cap */}
        <mesh geometry={trayGeo(`plate${w}|${len}`, rrC(w - mm(0.2), len - mm(0.2), all((w - mm(0.2)) / 2)), mm(1))}
          rotation={[0, Math.PI / 2, 0]} userData={{ sketchHull: true }}>
          <meshPhysicalMaterial color={frame} metalness={0.85} roughness={0.35} /></mesh>
        <mesh geometry={trayGeo(`carrier`, rrC(carrier.x, carrier.y, all(mm(1.6)), carrier.x / 2 + mm(1)), carrier.t)}
          position={[0, 0, -carrier.t / 2]} userData={{ sketchHull: true }}>
          <meshPhysicalMaterial color={frame} metalness={0.8} roughness={0.4} /></mesh>
        {/* nano-SIM, 12.3 x 8.8 x 0.67 mm, gold contacts facing the display */}
        <mesh position={[mm(1.3) + NANO.w / 2, 0, carrier.t / 2 + NANO.t / 2]}><boxGeometry args={[NANO.w, NANO.l, NANO.t]} />
          <meshStandardMaterial color="#f2f2ef" roughness={0.55} /></mesh>
        <mesh position={[mm(1.3) + NANO.w / 2, mm(1.2), carrier.t / 2 + NANO.t + E / 4]}><planeGeometry args={[mm(6.6), mm(5.6)]} />
          <meshStandardMaterial color="#c9a54a" metalness={0.9} roughness={0.25} /></mesh>
      </group>
    </group>)
}

// Sketch: the front camera takes the island's exact tone (same dark toon fill, no inner lines) so the island reads as one pill.
const ISLAND_TONE = { sketchTone: 'black' } as const // Sketch: island and lens are flat black, like the real island on a dark screen
/** Camera lens as seen through cover glass, facing +z. r is the visible outer radius.
 * Layers: dark barrel ring, lens body, AR-coated element (thin-film iridescence for the blue/purple sheen),
 * two concentric element edges, a small iris, and a curved additive glass cap that only adds reflections. */
export function LensStack({ r, order = 0 }: { r: number; order?: number }) {
  const off = (k: number) => ({ polygonOffset: true, polygonOffsetFactor: -6 - k, polygonOffsetUnits: -6 - k })
  // Flat cover glass, as on the real phone: a disc that only adds reflections over the lens.
  const capGeo = geoOnce(`capflat${r}`, () => new THREE.CircleGeometry(r, 64))
  return (
    <group userData={{ sketchNoEdges: true }}>
      {/* Black on black, as through the island glass: a near-black barrel, a slightly lighter grey lens disc, a faint inner ring
          and a dark pupil. Flat colours so the studio lights can't turn it into a bright dot. */}
      <mesh renderOrder={order} userData={ISLAND_TONE}><ringGeometry args={[r * 0.72, r, 64]} />
        <meshBasicMaterial color="#060607" toneMapped={false} {...off(0)} /></mesh>
      <mesh renderOrder={order} userData={ISLAND_TONE}><circleGeometry args={[r * 0.72, 64]} />
        <meshBasicMaterial color="#141519" toneMapped={false} {...off(0)} /></mesh>
      <mesh renderOrder={order + 2} userData={ISLAND_TONE}><ringGeometry args={[r * 0.45 - r * 0.03, r * 0.45 + r * 0.03, 64]} />
        <meshBasicMaterial color="#25262c" toneMapped={false} {...off(2)} /></mesh>
      <mesh renderOrder={order + 3} userData={ISLAND_TONE}><circleGeometry args={[r * 0.2, 40]} /><meshBasicMaterial color="#08080a" toneMapped={false} {...off(3)} /></mesh>
      <mesh geometry={capGeo} renderOrder={order + 4}>
        <meshPhysicalMaterial color="#000" roughness={0.02} specularIntensity={0.3} envMapIntensity={0.25}
          transparent blending={THREE.AdditiveBlending} depthWrite={false} {...off(4)} /></mesh>
    </group>)
}

/** Rear camera, built in true 3D on the plateau (local +y = out of the back, 0 = plateau surface).
 * Polished ring with chamfered lips, a dark recessed barrel, three glass elements at different depths with AR
 * coatings, an iris ring and a domed sapphire cover. All sizes not on the drawing are estimates. */
export function RearLens({ d, rise, frame }: { d: number; rise: number; frame: string }) {
  // Ring: outer edge at the drawn 16.58 diameter; width 1.25 mm, measured from Apple's hero photo along the unforeshortened axis (ring/diameter ~0.075).
  const R = d / 2, w = mm(1.25), ri = R - w, c = mm(0.32), floor = mm(0.12)
  // Sketch style: outer edge, inner lip and the front element as circles, in this group's local space (y is up).
  const circles = useMemo(() => {
    const out: number[] = [], circ = (r: number, y: number) => { for (let i = 0; i < 96; i++) { const a = i / 96 * Math.PI * 2, b = (i + 1) / 96 * Math.PI * 2
      out.push(Math.cos(a) * r, y, Math.sin(a) * r, Math.cos(b) * r, y, Math.sin(b) * r) } }
    circ(R + mm(0.02), rise - c * 0.3); circ(ri + mm(0.02), rise - c * 0.9 + mm(0.01)); circ(ri * 0.34, rise - c - mm(0.04))
    return new Float32Array(out)
  }, [R, ri, rise, c])
  const ring = geoOnce(`lring${d}|${rise}`, () => {
    // Satin body of the ring: outer wall and wide flat top.
    const pts = [[R - c * 0.3, rise - c * 0.3], [R - c, rise],
      [ri + c * 1.2, rise]].map(([x, y]) => new THREE.Vector2(x, y))
    return new THREE.LatheGeometry(pts, 128)
  })
  // Outer wall: same satin metal, but it faces away from the key lights, so it reads a shade darker as in Apple's photos.
  const wall = geoOnce(`lwall${d}|${rise}`, () => new THREE.LatheGeometry(
    [[R + mm(0.25), 0], [R, mm(0.25)], [R, rise - c], [R - c * 0.3, rise - c * 0.3]].map(([x, y]) => new THREE.Vector2(x, y)), 128))
  // Brighter chamfered inner lip, cut and polished down into the barrel.
  const lip = geoOnce(`llip${d}|${rise}`, () => {
    const pts = [[ri + c * 1.2, rise], [ri + c * 0.5, rise - c * 0.25], [ri + c * 0.1, rise - c * 0.7], [ri, rise - c * 0.9]].map(([x, y]) => new THREE.Vector2(x, y))
    return new THREE.LatheGeometry(pts, 128)
  })
  const barrel = geoOnce(`lbar${d}|${rise}`, () => {
    const pts = [[0, floor], [ri * 0.97, floor], [ri, floor + mm(0.1)], [ri, rise - c * 0.9]].map(([x, y]) => new THREE.Vector2(x, y))
    return new THREE.LatheGeometry(pts, 96)
  })
  // Flat sapphire cover sitting just below the inner lip of the ring (Apple's covers are flat, not domed).
  const dome = geoOnce(`lcover${d}|${rise}`, () => {
    const g = new THREE.CircleGeometry(ri, 96); g.rotateX(-Math.PI / 2); g.translate(0, rise - c - mm(0.05), 0); return g
  })
  const disc = (r: number, y: number, k: string, mat: ReactNode) => (
    <mesh key={k} position={[0, y, 0]} rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[r, 96]} />{mat}</mesh>)
  const ar = (col: string, t: [number, number]) => <meshPhysicalMaterial color={col} metalness={0.2} roughness={0.04} transparent opacity={0.4}
    iridescence={1} iridescenceIOR={1.4} iridescenceThicknessRange={t} clearcoat={1} clearcoatRoughness={0.02} envMapIntensity={1.5} depthWrite={false} />
  const h = rise - c
  return (
    <group rotation={[-Math.PI / 2, 0, 0]} userData={{ sketchNoEdges: true }}>
      <mesh geometry={ring} castShadow userData={{ sketchLines: circles, sketchTone: 'fill' }}><meshPhysicalMaterial color={frame} metalness={0.3} roughness={0.56} roughnessMap={frostRoughness()} envMapIntensity={0.85} side={THREE.DoubleSide} /></mesh>
      <mesh geometry={wall} castShadow userData={{ sketchTone: 'fill' }}><meshPhysicalMaterial color={frame} metalness={0.3} roughness={0.7} envMapIntensity={0.45} side={THREE.DoubleSide} /></mesh>
      <mesh geometry={lip} userData={{ sketchTone: 'fill' }}><meshPhysicalMaterial color={frame} metalness={0.85} roughness={0.2} envMapIntensity={1.1} side={THREE.DoubleSide} /></mesh>
      <mesh geometry={barrel}><meshPhysicalMaterial color="#07080b" metalness={0.4} roughness={0.55} side={THREE.DoubleSide} /></mesh>
      {disc(ri * 0.98, floor + E / 3, 'floor', <meshPhysicalMaterial color="#010103" roughness={0.3} clearcoat={0.6} envMapIntensity={0.6} />)}
      {disc(ri * 0.42, floor + h * 0.12, 'e3', ar('#11121c', [300, 480]))}
      {disc(ri * 0.62, floor + h * 0.32, 'e2', ar('#161724', [250, 420]))}
      <mesh position={[0, floor + h * 0.22, 0]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[ri * 0.3, ri * 0.44, 64]} />
        <meshPhysicalMaterial color="#1a1c24" metalness={0.9} roughness={0.25} side={THREE.DoubleSide} /></mesh>
      {[0.55, 0.7, 0.86].map((k, i) => <mesh key={k} position={[0, floor + h * (0.18 + i * 0.16), 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[ri * k - mm(0.06), ri * k, 96]} /><meshPhysicalMaterial color={i === 1 ? '#363048' : '#262b3c'} metalness={1} roughness={0.15} side={THREE.DoubleSide} /></mesh>)}
      {/* small bright front element inside a dark iris, as in Apple's photos */}
      <mesh position={[0, floor + h * 0.4, 0]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[ri * 0.2, ri * 0.34, 64]} />
        <meshPhysicalMaterial color="#050508" metalness={0.5} roughness={0.4} side={THREE.DoubleSide} /></mesh>
      <mesh position={[0, floor + h * 0.4 - ri * 0.17, 0]} scale={[1, 0.6, 1]}><sphereGeometry args={[ri * 0.2, 48, 16, 0, Math.PI * 2, 0, 0.55]} />
        <meshPhysicalMaterial color="#3c3a5e" metalness={0.4} roughness={0.04} clearcoat={1} clearcoatRoughness={0.02} iridescence={0.8} iridescenceIOR={1.4} envMapIntensity={2.6} /></mesh>
      {disc(ri * 0.85, floor + h * 0.55, 'e1', ar('#1c1d2c', [220, 380]))}
      <mesh geometry={dome} renderOrder={6}><meshPhysicalMaterial color="#000" roughness={0.015} specularIntensity={0.45} envMapIntensity={0.8}
        transparent blending={THREE.AdditiveBlending} depthWrite={false} /></mesh>
    </group>)
}

function IPhonePro({ spec: s, texture, mediaAspect, opts }: DeviceProps & { spec: IPhoneSpec }) {
  const f = IP18_FINISHES[opts.finish] ?? IP18_FINISHES.silver
  const W = mm(s.body.w), H = mm(s.body.h), T = mm(s.body.t), CR = mm(s.body.cornerR), EDGE = mm(s.body.edge)
  const ty = (y: number) => H / 2 - mm(y)       // drawing y (from the top) to model y
  const bx = (x: number) => W / 2 - mm(x)       // back view x to model x
  const fx = (x: number) => -W / 2 + mm(x)      // front / bottom view x to model x
  const P = s.plateau, plH = mm(P.bottom), rise = mm(P.rise)
  const aspect = s.px.w / s.px.h
  const g = geoSet(s.id, () => {
    const body = slab(rrect(W, H, all(CR)), T, EDGE)
    const glass = new THREE.ShapeGeometry(rrect(mm(s.glass.w), mm(s.glass.h), all(CR - mm((s.body.w - s.glass.w) / 2))), 48)
    const actR = CR - mm(s.active.inset)
    const screen = flatUV(rrect(mm(s.active.w), mm(s.active.h), all(actR)), mm(s.active.w), mm(s.active.h))
    const island = new THREE.ShapeGeometry(rrect(mm(s.island.w), mm(s.island.h), all(mm(s.island.r))), 24)
    // Camera plateau: full width from the top edge, 2.78 mm proud of the back. Its bottom edge is scaled off the side view.
    // Camera plateau, one piece with the body. Detail D of the drawing shows two outlines: the flat top (inset about 5 mm,
    // ending at P.bottom) and the base, a soft shoulder P.shoulder wide that rolls down into the back and the frame.
    // The base runs full width; its straight part reaches deep into the body (hidden) and is grown 0.01 mm so it never z-fights the frame.
    // The base outline is exactly the body outline at the sides and top. The shoulder bevel starts where the frame's flat side
    // starts (EDGE below the back) and rolls in over rise + EDGE to the flat top, so the frame side flows into the shoulder as
    // one surface, replacing the frame's back roundover under the plateau. The straight wall and lower bevel hide in the body.
    const sh = mm(P.shoulder), flatR = mm(P.topR), topIn = Math.max(mm(P.cornerR) - sh, mm(0.5))
    // Shoulder cross-section fitted to the drawing's side view (sheet 1, 1200 dpi trace of the plateau's bottom edge):
    // a concave superellipse P.filletW wide with exponent P.filletM, rising the full 2.78 mm. The flat top starts
    // P.flatTop below the top edge, as drawn; the frame's roundover takes over near the outline.
    const shD = mm(P.filletW)
    const plateau = plateauSurface({ W, H, CR, edge: EDGE, rise, D: shD, edgeK: mm(0.12), m: P.filletM,
      flat: { top: H / 2 - mm(P.flatTop), bottom: H / 2 - plH, hw: W / 2 - shD - mm(0.3), rb: flatR, rt: topIn } })
    // Back glass (MagSafe window): top edge and top corner radius from sheet 4; sides and bottom follow the edge band.
    const bgTop = mm(s.backGlass.top), bgH = H - bgTop - EDGE * 0.8
    const backGlass = new THREE.ShapeGeometry(rrect(W - EDGE * 2.2, bgH, [CR - EDGE, CR - EDGE, mm(s.backGlass.topR), mm(s.backGlass.topR)]), 48)
    const bandH = mm(s.antennaBands[0][1] - s.antennaBands[0][0])
    const band = sideBand(W, T, EDGE, bandH)
    return { body, glass, screen, island, plateau, backGlass, band }
  })
  useMemo(() => fitTexture(texture, mediaAspect, aspect), [texture, mediaAspect, aspect])
  // Brushed aluminium frame: anisotropic highlight along the band, streaky roughness and faint grooves.
  const darkF = new THREE.Color(f.frame).getHSL({ h: 0, s: 0, l: 0 }).l < 0.35
  const bR = brushedRoughness(), bN = brushedNormal(), fR = frostRoughness(), sR = smudgeRoughness()
  // The brushed roughness/normal maps caused large blotches on the frame at this scale, so the frame is a clean satin.
  // Fine satin grain: the brushed roughness map tiled much smaller (shares the uploaded source, so no re-upload).
  const grain = useMemo(() => { if (!bR) return null; const t = bR.clone(); t.repeat.set(bR.repeat.x * 8, bR.repeat.y * 8); return t }, [bR])
  // ONE aluminium material instance for the whole unibody: frame, plateau, shoulder, back band and buttons.
  // Per-finish values depend only on the finish, so every part gets the same colour, roughness, grain and reflection.
  const alu = useMemo(() => new THREE.MeshPhysicalMaterial({ color: f.frame, metalness: 0.3, roughness: 0.6, roughnessMap: grain,
    clearcoat: 0, envMapIntensity: darkF ? 0.4 : 0.26, specularIntensity: darkF ? 0.3 : 0.35 }), [f.frame, darkF, grain])
  useEffect(() => () => alu.dispose(), [alu])
  const metal = <primitive object={alu} attach="material" />
  // Frosted back glass: textured roughness under a thin, slightly glossy coat so highlights spread but stay soft.
  const matte = <meshPhysicalMaterial color={f.back} metalness={0} roughness={0.8} roughnessMap={fR} clearcoat={0.35} clearcoatRoughness={0.38}
    specularIntensity={0.6} envMapIntensity={0.9} />
  const black = <meshPhysicalMaterial color="#020203" roughness={1} roughnessMap={sR} clearcoat={1} clearcoatRoughness={0.04} />
  const zf = T / 2, zb = -T / 2
  // Buttons: pill (fully rounded ends) in side view, 2.66 wide, extruded 0.45 out of the flat side band
  // with a rounded bevel where the face meets the sides. 0.3 mm is sunk into the frame so no gap shows.
  const SINK = mm(0.3)
  const btnGeo = (len: number, wz: number, prot: number) => geoOnce(`btn${len}|${wz}|${prot}`, () => {
    const bev = Math.min(prot * 0.45, mm(0.2))
    const r = wz / 2
    const g = new THREE.ExtrudeGeometry(rrect(wz - bev * 2, len - bev * 2, all(r - bev)), { depth: prot + SINK - bev, bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelSegments: 10, curveSegments: 32 })
    g.translate(0, 0, -SINK); g.rotateY(Math.PI / 2); return smoothNormals(g) // extrusion now runs along +x
  })
  // Sketch style: the button's footprint on the frame and the edge of its face, as line loops (local +x is outward).
  const btnLines = (len: number, wz: number, prot: number) => {
    const k = `${len}|${wz}|${prot}`; let l = btnLineCache.get(k); if (l) return l
    const bev = Math.min(prot * 0.45, mm(0.2)), out: number[] = []
    const loop = (w: number, h: number, x: number) => { const p = rrect(w, h, all(w / 2)).getSpacedPoints(96)
      for (let i = 0; i < p.length - 1; i++) out.push(x, p[i].y, -p[i].x, x, p[i + 1].y, -p[i + 1].x) }
    loop(wz + mm(0.03), len + mm(0.03), mm(0.01)); loop(wz - bev * 2, len - bev * 2, prot + mm(0.005))
    btnLineCache.set(k, l = new Float32Array(out)); return l
  }
  const side = (x: number, b: { cy: number; len: number }, key: string) => (
    <Pressable key={key} depth={mm(0.3)} position={[x, ty(b.cy), 0]} rotation={[0, x < 0 ? Math.PI : 0, 0]}>
      <mesh geometry={btnGeo(mm(b.len), mm(s.btn.w), mm(s.btn.protrude))} castShadow userData={{ sketchHull: true, sketchLines: btnLines(mm(b.len), mm(s.btn.w), mm(s.btn.protrude)) }}>{metal}</mesh></Pressable>)
  // Camera Control: flush (0.00 on the drawing). A sapphire crystal cover at the drawn 3.03 x 17.10 inside a thin
  // (~0.3 mm) polished conductive ring in the frame's colour and finish, over the 3.40 x 17.50 keepout in satin frame metal.
  // Apple shows it colour-matched: a glossy, slightly deeper tint of the frame, not a separate colour.
  const cc = s.cameraControl
  const ccMats = useMemo(() => {
    const fc = new THREE.Color(f.frame)
    // Deeper tint of the frame: light finishes darken a little, dark finishes stay near the frame colour.
    const glass = fc.clone().multiplyScalar(darkF ? 0.85 : 0.8)
    const well = fc.clone().multiplyScalar(darkF ? 0.6 : 0.7) // the sensor seen through the crystal, at the rim
    return {
      ring: new THREE.MeshPhysicalMaterial({ color: fc, metalness: 0.35, roughness: 0.32, envMapIntensity: darkF ? 0.6 : 0.4, specularIntensity: 0.6, polygonOffset: true, polygonOffsetFactor: -2 }),
      well: new THREE.MeshPhysicalMaterial({ color: well, metalness: 0.2, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -3 }),
      glass: new THREE.MeshPhysicalMaterial({ color: glass, metalness: 0.15, roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.03, ior: 1.77,
        specularIntensity: 1, envMapIntensity: darkF ? 1.1 : 0.8, polygonOffset: true, polygonOffsetFactor: -4 }),
    }
  }, [f.frame, darkF])
  useEffect(() => () => { ccMats.ring.dispose(); ccMats.well.dispose(); ccMats.glass.dispose() }, [ccMats])
  const ccLines = useMemo(() => {
    const out: number[] = []
    const loop = (w: number, h: number) => { const p = rrect(w, h, all(w / 2)).getSpacedPoints(96)
      for (let i = 0; i < p.length - 1; i++) out.push(p[i].x, p[i].y, mm(0.005), p[i + 1].x, p[i + 1].y, mm(0.005)) }
    loop(mm(cc.w + 0.6), mm(cc.len + 0.6)); loop(mm(cc.w), mm(cc.len))
    return new Float32Array(out)
  }, [cc.w, cc.len])
  const ccShape = (w: number, l: number) => <shapeGeometry args={[rrC(mm(w), mm(l), all(mm(w / 2))), 32]} />
  const cameraControl = (
    <Pressable depth={mm(0.1)} position={[W / 2, ty(cc.cy), 0]}>
      <mesh rotation={[0, Math.PI / 2, 0]} position={[mm(0.01), 0, 0]} userData={{ sketchTone: 'fill' }}>{ccShape(cc.keepW + 0.4, cc.keepLen + 0.4)}{metal}</mesh>
      <mesh rotation={[0, Math.PI / 2, 0]} position={[mm(0.015), 0, 0]} material={ccMats.ring} userData={{ sketchTone: 'fill', sketchLines: ccLines }}>{ccShape(cc.w + 0.6, cc.len + 0.6)}</mesh>
      <mesh rotation={[0, Math.PI / 2, 0]} position={[mm(0.02), 0, 0]} material={ccMats.well} userData={{ sketchTone: 'fill' }}>{ccShape(cc.w, cc.len)}</mesh>
      <mesh rotation={[0, Math.PI / 2, 0]} position={[mm(0.03), 0, 0]} material={ccMats.glass} userData={{ sketchTone: 'fill' }}>{ccShape(cc.w - 0.08, cc.len - 0.08)}</mesh>
    </Pressable>)
  // Parts on the plateau sit on the flat top, which stands 0.13 mm proud of the shoulder (the inner edge step).
  const zPlat = zb - rise
  const lensD = mm(s.lens.d), lensRise = mm(s.lens.rise)
  // Front camera: the drawing gives only the island (front camera keepout); the lens sits in the right-hand cap (assumed).
  const fcamX = mm(s.island.w / 2 - s.island.h / 2)
  const isl = ty(s.island.cy)
  // Antenna bands are a moulded resin: the frame colour pulled toward a neutral grey, matte, non-metallic.
  const bandColour = useMemo(() => new THREE.Color(f.frame).lerp(new THREE.Color('#77797e'), darkF ? 0.07 : 0.3), [f.frame, darkF])
  // Frame sides only (faces whose normal points mostly sideways), never the back or the plateau. The bands are drawn as an overlay on the same body, plateau and fillet meshes, kept only inside the band heights, so they wrap
  // the frame sides and run up over the plateau shoulder exactly on the surface (same geometry, LessEqual depth, no z-fighting).
  const bandMaterial = useMemo(() => {
    const m = new THREE.MeshPhysicalMaterial({ color: bandColour, metalness: 0.05, roughness: 0.62, clearcoat: 0.25, clearcoatRoughness: 0.4,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, depthFunc: THREE.LessEqualDepth })
    const [[a1, b1], [a2, b2]] = s.antennaBands
    const yb = new THREE.Vector4(ty(b1), ty(a1), ty(b2), ty(a2))
    m.onBeforeCompile = sh => {
      sh.uniforms.uBand = { value: yb }; sh.uniforms.uOff = { value: 0 }
      sh.vertexShader = 'uniform float uOff;\nvarying float vDevY;\nvarying float vNz;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvDevY = position.y + uOff; vNz = objectNormal.z;')
      sh.fragmentShader = 'uniform vec4 uBand;\nvarying float vDevY;\nvarying float vNz;\n' + sh.fragmentShader.replace('void main() {',
        'void main() {\n  if (!((vDevY > uBand.x && vDevY < uBand.y) || (vDevY > uBand.z && vDevY < uBand.w)) || abs(vNz) > 0.93) discard;')
      m.userData.sh = sh
    }
    m.customProgramCacheKey = () => 'om-band'
    return m
  }, [bandColour, s, H])
  const plY = H / 2 - (plH + mm(P.shoulder)) / 2
  const bandMats = useMemo(() => [0, plY].map(y => {
    const mat = bandMaterial.clone(); mat.onBeforeCompile = sh => { bandMaterial.onBeforeCompile(sh, null as never); sh.uniforms.uOff.value = y }
    mat.customProgramCacheKey = () => 'om-band'; return mat
  }), [bandMaterial, plY])
  const bandOn = (geo: THREE.BufferGeometry, y: number, z: number) =>
    <mesh geometry={geo} position={[0, y, z]} renderOrder={1} material={bandMats[y === 0 ? 0 : 1]} userData={{ sketchHide: true }} />
  // Sketch style: thin lines where the antenna bands start and end, on the frame sides and over the plateau shoulder.
  const sketch = useMemo(() => {
    const ys = s.antennaBands.flat().map(ty)
    const cat = (...a: Float32Array[]) => { const o = new Float32Array(a.reduce((n, x) => n + x.length, 0)); let k = 0; for (const x of a) { o.set(x, k); k += x.length } return o }
    return { body: sliceY(g.body, ys), plateau: cat(sliceY(g.plateau, ys), g.plateau.userData.topLoop as Float32Array) }
  }, [g, s, H])
  return (
    <group>
      <mesh geometry={g.body} castShadow name="ip18-body" userData={{ sketchHull: true, sketchLines: sketch.body }}>{metal}</mesh>
      {/* antenna split bands on both long sides, from the side views */}
      {bandOn(g.body, 0, 0)}
      {/* front cover glass and display */}
      <mesh geometry={g.glass} position={[0, 0, zf + E]} name="ip18-cover">{black}</mesh>
      <mesh geometry={g.screen} position={[0, 0, zf + E * 2]} name="screen">
        {texture ? <meshBasicMaterial key="tex" map={texture} toneMapped={false} /> : <meshBasicMaterial key="idle" color="#07080b" />}
      </mesh>
      {/* with the status bar on, its 126 x 37 pt island (drawn in the screen plane) is the only island, so edges align at any angle */}
      {!opts.hideIsland && <><mesh geometry={g.island} position={[0, isl, zf + E * 4]} renderOrder={3} userData={ISLAND_TONE}>
        <meshBasicMaterial color="#010101" polygonOffset polygonOffsetFactor={-3} polygonOffsetUnits={-3} /></mesh>
      <group position={[fcamX, isl, zf + E * 5]}><LensStack r={mm(s.frontCam.r)} order={4} /></group></>}
      {/* receiver slot along the top glass edge */}
      <mesh position={[0, ty(s.receiver.cy), zf + E * 3]}><shapeGeometry args={[rrC(mm(s.receiver.w), mm(s.receiver.h), all(mm(s.receiver.h / 2))), 16]} />
        <meshBasicMaterial color="#0b0b0d" polygonOffset polygonOffsetFactor={-3} /></mesh>
      {/* cover glass reflection over the display: black base, additive, so only a soft, even fresnel reflection shows */}
      <mesh geometry={g.screen} position={[0, 0, zf + E * 4.5]} renderOrder={10}>
        {/* no smudge roughness map here: magnified on the large display it reflected as a blurry grid of dark blotches */}
        <meshPhysicalMaterial color="#000" roughness={1} specularIntensity={0.14}
          transparent blending={THREE.AdditiveBlending} depthWrite={false} polygonOffset polygonOffsetFactor={-8} /></mesh>
      {/* back: aluminium between the plateau and the glass, then the matte glass window */}
      <mesh geometry={g.backGlass} position={[0, ty(s.backGlass.top) - (H - mm(s.backGlass.top) - EDGE * 0.8) / 2, zb - E]} rotation={[0, Math.PI, 0]}>{matte}</mesh>
      {/* camera plateau: a full-width raised bar of the same aluminium unibody, lenses, flash and sensor sit directly on it */}
      <mesh geometry={g.plateau} position={[0, 0, zb]} name="ip18-plateau" userData={{ sketchHull: true, sketchEdges: false, sketchLines: sketch.plateau }}>{metal}</mesh>
      {/* Antenna bands run over the plateau's outer shoulder and stop at the inner edge of the flat top (normal-based cut). */}
      {bandOn(g.plateau, 0, zb)}
      {/* the flat top is part of the swept plateau surface */}
      {s.lens.at.map(([x, y]) => (
        <group key={`${x}-${y}`} position={[bx(x), ty(y), zPlat]}><RearLens d={lensD} rise={lensRise} frame={f.frame} /></group>))}
      <mesh position={[bx(s.flash.bx), ty(s.flash.y), zPlat - E * 3]} rotation={[0, Math.PI, 0]}><circleGeometry args={[mm(s.flash.d / 2), 40]} /><meshStandardMaterial color="#efe6cf" roughness={0.3} /></mesh>
      <mesh position={[bx(s.sensor.bx), ty(s.sensor.y), zPlat - E * 3]} rotation={[0, Math.PI, 0]}><circleGeometry args={[mm(s.sensor.d / 2), 40]} />{black}</mesh>
      <mesh position={[bx(s.rearMic.bx), ty(s.rearMic.y), zPlat - E * 3]} rotation={[0, Math.PI, 0]}><circleGeometry args={[mm(s.rearMic.d / 2), 16]} /><meshBasicMaterial color="#111" /></mesh>
      {/* left side (seen from the front): Action button and volume */}
      {side(-W / 2, s.action, 'act')}
      {side(-W / 2, s.volUp, 'vup')}
      {side(-W / 2, s.volDown, 'vdn')}
      {/* right side: side button and flush sapphire Camera Control */}
      {side(W / 2, s.sideBtn, 'side')}
      {cameraControl}
      {opts.simTray && <SimTray frame={f.frame} x={-W / 2} y={ty(s.sim.cy)} len={mm(s.sim.len)} w={mm(s.sim.w)} />}
      {/* bottom: USB-C, speaker and mic holes, screws, all centred in the thickness */}
      <group position={[0, -H / 2 - E, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <mesh position={[fx(s.usbc.cx), 0, 0]}><shapeGeometry args={[rrC(mm(s.usbc.w), mm(s.usbc.h), all(mm(s.usbc.h / 2))), 24]} /><meshBasicMaterial color="#050506" side={THREE.DoubleSide} /></mesh>
        {s.holes.x.map(x => (
          <mesh key={x} position={[fx(x), 0, 0]}><circleGeometry args={[mm(s.holes.d / 2), 16]} /><meshBasicMaterial color="#050506" side={THREE.DoubleSide} /></mesh>))}
        {s.screws.x.map(x => (
          <mesh key={x} position={[fx(x), 0, 0]}><circleGeometry args={[mm(s.screws.d / 2), 16]} /><meshStandardMaterial color="#777" metalness={0.8} side={THREE.DoubleSide} /></mesh>))}
      </group>
      {/* logo spot from the back view (16.32 x 20.04 box). User art only. */}
      {opts.logo && (
        <mesh position={[bx(s.logo.bx), ty(s.logo.cy), zb - E * 4]} rotation={[0, Math.PI, 0]}>
          <planeGeometry args={[opts.logoSize, opts.logoSize / opts.logo.aspect]} />
          <meshPhysicalMaterial color={opts.logoTint !== DEFAULT_LOGO_TINT ? opts.logoTint : f.back} metalness={0.55} roughness={0.04} clearcoat={1} clearcoatRoughness={0.02} envMapIntensity={1.6}
            alphaMap={opts.logo.mask} transparent depthWrite={false} polygonOffset polygonOffsetFactor={-2} />
        </mesh>)}
    </group>
  )
}
export default memo(IPhonePro)
