import { memo, useMemo, useRef, type ReactNode } from 'react'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import type { DeviceProps } from '../types'
import { fitTexture, DEFAULT_LOGO_TINT, sceneHit } from './shared'
import { brushedNormal, brushedRoughness, frostRoughness, smudgeRoughness } from './materials'
import type { IPhoneSpec } from './iphoneSpecs'
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
const geoOnce = (k: string, f: () => THREE.BufferGeometry) => { let g = geoCache.get(k); if (!g) geoCache.set(k, g = f()); return g }
/** Smooth shading for extruded parts: ExtrudeGeometry is unindexed, so computeVertexNormals gives one normal per face
 * and every bevel facet shows. Average normals of faces meeting at the same point when they are within creaseDeg. */
function smoothNormals(g: THREE.BufferGeometry, creaseDeg = 50) {
  const pos = g.attributes.position, n = pos.count, cos = Math.cos(creaseDeg * Math.PI / 180)
  const fn = new Float32Array(n * 3), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3()
  for (let i = 0; i < n; i += 3) {
    a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2)
    c.sub(b); b.sub(a); c.cross(b) // area-weighted face normal
    for (let k = 0; k < 3; k++) fn.set([c.x, c.y, c.z], (i + k) * 3)
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
function rrect(w: number, h: number, [bl, br, tr, tl]: number[], cx = 0, cy = 0) {
  const s = new THREE.Shape(), x = cx - w / 2, y = cy - h / 2
  const arc = (px: number, py: number, r: number, a0: number) => s.absarc(px, py, r, a0, a0 + Math.PI / 2, false)
  s.moveTo(x + bl, y); s.lineTo(x + w - br, y); arc(x + w - br, y + br, br, -Math.PI / 2)
  s.lineTo(x + w, y + h - tr); arc(x + w - tr, y + h - tr, tr, 0)
  s.lineTo(x + tl, y + h); arc(x + tl, y + h - tl, tl, Math.PI / 2)
  s.lineTo(x, y + bl); arc(x + bl, y + bl, bl, Math.PI); return s
}
const all = (r: number) => [r, r, r, r]
/** Slab with a rounded (quarter-round style) edge band, centred in z. */
function slab(shape: THREE.Shape, depth: number, edge: number, segs = 16) {
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
function plateauFillet(shape: THREE.Shape, h: number, xMax: number, f: number, steps = 8) {
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
      const th = (k / steps) * Math.PI / 2, off = f * (1 - Math.sin(th)), up = f * (1 - Math.cos(th))
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
function Pressable({ depth, children, ...rest }: { depth: number; children: ReactNode; position: [number, number, number]; rotation?: [number, number, number] }) {
  const inner = useRef<THREE.Group>(null), t0 = useRef(-1e9)
  const h = useClickable(() => { t0.current = performance.now() })
  useFrame(() => { if (inner.current) inner.current.position.x = -depth * pressCurve(performance.now() - t0.current) })
  return <group {...rest}><group ref={inner} {...h}>{children}</group></group>
}

// SIM tray: position, length and width from the left side view; ejector hole, carrier and travel are assumed.
const NANO = { l: mm(12.3), w: mm(8.8), t: mm(0.67) }
const EJECT = mm(15), EJECT_MS = 420
const ease = (t: number) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
function SimTray({ frame, x, y, len, w }: { frame: string; x: number; y: number; len: number; w: number }) {
  const slide = useRef<THREE.Group>(null), st = useRef({ out: false, from: 0, t0: -1e9 })
  const cur = () => { const s = st.current, k = Math.min(1, (performance.now() - s.t0) / EJECT_MS); return s.from + ((s.out ? 1 : 0) - s.from) * ease(k) }
  const h = useClickable(() => { const v = cur(); st.current = { out: !st.current.out, from: v, t0: performance.now() } })
  useFrame(() => { if (slide.current) slide.current.position.x = -EJECT * cur() })
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
        {/* face plate thickness and carrier that live inside the frame */}
        <mesh position={[mm(0.5), 0, 0]}><boxGeometry args={[mm(1), len - mm(0.2), w - mm(0.2)]} />
          <meshPhysicalMaterial color={frame} metalness={0.85} roughness={0.35} /></mesh>
        <mesh position={[mm(1) + carrier.x / 2, 0, 0]}><boxGeometry args={[carrier.x, carrier.y, carrier.t]} />
          <meshPhysicalMaterial color={frame} metalness={0.8} roughness={0.4} /></mesh>
        {/* nano-SIM, 12.3 x 8.8 x 0.67 mm, gold contacts facing the display */}
        <mesh position={[mm(1.3) + NANO.w / 2, 0, carrier.t / 2 + NANO.t / 2]}><boxGeometry args={[NANO.w, NANO.l, NANO.t]} />
          <meshStandardMaterial color="#f2f2ef" roughness={0.55} /></mesh>
        <mesh position={[mm(1.3) + NANO.w / 2, mm(1.2), carrier.t / 2 + NANO.t + E / 4]}><planeGeometry args={[mm(6.6), mm(5.6)]} />
          <meshStandardMaterial color="#c9a54a" metalness={0.9} roughness={0.25} /></mesh>
      </group>
    </group>)
}

/** Camera lens as seen through cover glass, facing +z. r is the visible outer radius.
 * Layers: dark barrel ring, lens body, AR-coated element (thin-film iridescence for the blue/purple sheen),
 * two concentric element edges, a small iris, and a curved additive glass cap that only adds reflections. */
function LensStack({ r, order = 0 }: { r: number; order?: number }) {
  const off = (k: number) => ({ polygonOffset: true, polygonOffsetFactor: -6 - k, polygonOffsetUnits: -6 - k })
  // Flat cover glass, as on the real phone: a disc that only adds reflections over the lens.
  const capGeo = geoOnce(`capflat${r}`, () => new THREE.CircleGeometry(r, 64))
  return (
    <group>
      <mesh renderOrder={order}><ringGeometry args={[r * 0.74, r, 64]} />
        <meshPhysicalMaterial color="#0c0d11" metalness={0.85} roughness={0.32} {...off(0)} /></mesh>
      <mesh renderOrder={order}><circleGeometry args={[r * 0.74, 64]} />
        <meshPhysicalMaterial color="#0b0d14" roughness={0.1} clearcoat={1} envMapIntensity={1.6} {...off(0)} /></mesh>
      <mesh renderOrder={order + 1}><circleGeometry args={[r * 0.6, 64]} />
        <meshPhysicalMaterial color="#141a33" metalness={0.35} roughness={0.05} iridescence={1} iridescenceIOR={1.45}
          iridescenceThicknessRange={[260, 420]} clearcoat={1} clearcoatRoughness={0.03} envMapIntensity={2.2} {...off(1)} /></mesh>
      {[0.5, 0.36].map((k, i) => <mesh key={k} renderOrder={order + 2}><ringGeometry args={[r * k - r * 0.025, r * k, 64]} />
        <meshPhysicalMaterial color={i ? '#2a2546' : '#1b2442'} metalness={0.9} roughness={0.18} {...off(2)} /></mesh>)}
      <mesh renderOrder={order + 3}><circleGeometry args={[r * 0.2, 40]} /><meshBasicMaterial color="#000" {...off(3)} /></mesh>
      <mesh geometry={capGeo} renderOrder={order + 4}>
        <meshPhysicalMaterial color="#000" roughness={0.02} specularIntensity={1} envMapIntensity={1.5}
          transparent blending={THREE.AdditiveBlending} depthWrite={false} {...off(4)} /></mesh>
    </group>)
}

/** Rear camera, built in true 3D on the plateau (local +y = out of the back, 0 = plateau surface).
 * Polished ring with chamfered lips, a dark recessed barrel, three glass elements at different depths with AR
 * coatings, an iris ring and a domed sapphire cover. All sizes not on the drawing are estimates. */
function RearLens({ d, rise, frame }: { d: number; rise: number; frame: string }) {
  // Ring: outer edge at the drawn 16.58 diameter; width 1.25 mm, measured from Apple's hero photo along the unforeshortened axis (ring/diameter ~0.075).
  const R = d / 2, w = mm(1.25), ri = R - w, c = mm(0.32), floor = mm(0.12)
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
    <group rotation={[-Math.PI / 2, 0, 0]}>
      <mesh geometry={ring} castShadow><meshPhysicalMaterial color={frame} metalness={0.3} roughness={0.56} roughnessMap={frostRoughness()} envMapIntensity={0.85} side={THREE.DoubleSide} /></mesh>
      <mesh geometry={wall} castShadow><meshPhysicalMaterial color={frame} metalness={0.3} roughness={0.7} envMapIntensity={0.45} side={THREE.DoubleSide} /></mesh>
      <mesh geometry={lip}><meshPhysicalMaterial color={frame} metalness={0.85} roughness={0.2} envMapIntensity={1.1} side={THREE.DoubleSide} /></mesh>
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
    const sh = mm(P.shoulder), grow = mm(0.01), baseH = plH + sh, plDepth = T - mm(0.3) + rise
    const flatR = mm(P.topR), baseShape = rrect(W + grow * 2, baseH + grow, [flatR + sh, flatR + sh, mm(P.cornerR), mm(P.cornerR)], 0, grow / 2)
    const plateau = smoothNormals(new THREE.ExtrudeGeometry(baseShape, { depth: plDepth - rise * 2, bevelEnabled: true, bevelThickness: rise,
      bevelSize: sh, bevelOffset: -sh, bevelSegments: 24, curveSegments: 64 }), 60)
    // Concave fillet where the shoulder meets the flat back below the plateau.
    const fillet = plateauFillet(rrect(W, baseH, [flatR + sh, flatR + sh, mm(P.cornerR), mm(P.cornerR)]), baseH, W / 2 - EDGE, mm(0.8))
    // Back glass (MagSafe window): top edge and top corner radius from sheet 4; sides and bottom follow the edge band.
    const bgTop = mm(s.backGlass.top), bgH = H - bgTop - EDGE * 0.8
    const backGlass = new THREE.ShapeGeometry(rrect(W - EDGE * 2.2, bgH, [CR - EDGE, CR - EDGE, mm(s.backGlass.topR), mm(s.backGlass.topR)]), 48)
    const bandH = mm(s.antennaBands[0][1] - s.antennaBands[0][0])
    const band = sideBand(W, T, EDGE, bandH)
    return { body, glass, screen, island, plateau, fillet, backGlass, band }
  })
  useMemo(() => fitTexture(texture, mediaAspect, aspect), [texture, mediaAspect, aspect])
  // Brushed aluminium frame: anisotropic highlight along the band, streaky roughness and faint grooves.
  const darkF = new THREE.Color(f.frame).getHSL({ h: 0, s: 0, l: 0 }).l < 0.35
  const bR = brushedRoughness(), bN = brushedNormal(), fR = frostRoughness(), sR = smudgeRoughness()
  // The brushed roughness/normal maps caused large blotches on the frame at this scale, so the frame is a clean satin.
  const metal = <meshPhysicalMaterial color={f.frame} metalness={0.3} roughness={0.5}
    anisotropy={0.3} clearcoat={0.04} clearcoatRoughness={0.4} envMapIntensity={darkF ? 0.45 : 0.5} specularIntensity={darkF ? 0.5 : 0.6} />
  // Plateau: same bead-blasted aluminium but matte, so the wide shoulder rolls off softly with no hot streak.
  const plateauMetal = <meshPhysicalMaterial color={f.frame} metalness={0.25} roughness={0.66}
    envMapIntensity={darkF ? 0.45 : 0.7} specularIntensity={darkF ? 0.5 : 0.75} />
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
  const side = (x: number, b: { cy: number; len: number }, key: string) => (
    <Pressable key={key} depth={mm(0.3)} position={[x, ty(b.cy), 0]} rotation={[0, x < 0 ? Math.PI : 0, 0]}>
      <mesh geometry={btnGeo(mm(b.len), mm(s.btn.w), mm(s.btn.protrude))} castShadow>{metal}</mesh></Pressable>)
  // Camera Control: flush (0.00 on the drawing). Thin metal surround sized to the 3.40 x 17.50 keepout,
  // and a sapphire inset at the drawn 3.03 x 17.10.
  const cc = s.cameraControl
  const cameraControl = (
    <Pressable depth={mm(0.1)} position={[W / 2, ty(cc.cy), 0]}>
      <mesh rotation={[0, Math.PI / 2, 0]} position={[mm(0.01), 0, 0]}><shapeGeometry args={[rrC(mm(cc.keepW), mm(cc.keepLen), all(mm(cc.keepW / 2))), 32]} />
        <meshPhysicalMaterial color={f.frame} metalness={0.95} roughness={0.18} polygonOffset polygonOffsetFactor={-2} /></mesh>
      <mesh rotation={[0, Math.PI / 2, 0]} position={[mm(0.03), 0, 0]}><shapeGeometry args={[rrC(mm(cc.w), mm(cc.len), all(mm(cc.w / 2))), 32]} />
        <meshPhysicalMaterial color="#5e6672" metalness={0.1} roughness={0.04} clearcoat={1} clearcoatRoughness={0.02} ior={1.77} polygonOffset polygonOffsetFactor={-4} /></mesh>
    </Pressable>)
  const zPlat = zb - rise
  const lensD = mm(s.lens.d), lensRise = mm(s.lens.rise)
  // Front camera: the drawing gives only the island (front camera keepout); the lens sits in the right-hand cap (assumed).
  const fcamX = mm(s.island.w / 2 - s.island.h / 2)
  const isl = ty(s.island.cy)
  // Antenna bands are a moulded resin: the frame colour pulled toward a neutral grey, matte, non-metallic.
  const bandColour = useMemo(() => new THREE.Color(f.frame).lerp(new THREE.Color('#77797e'), 0.45), [f.frame])
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
  // Inner edge of the plateau: a thin crisp line where the shoulder meets the flat top (normal-band overlay on the plateau).
  const creaseMat = useMemo(() => {
    const m = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(f.frame).lerp(new THREE.Color('#ffffff'), darkF ? 0.12 : 0.3),
      metalness: 0.5, roughness: 0.3, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, depthFunc: THREE.LessEqualDepth })
    m.onBeforeCompile = sh => {
      sh.vertexShader = 'varying float vNz;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvNz = objectNormal.z;')
      sh.fragmentShader = 'varying float vNz;\n' + sh.fragmentShader.replace('void main() {', 'void main() {\n  if (abs(vNz) < 0.93 || abs(vNz) > 0.975) discard;')
    }
    m.customProgramCacheKey = () => 'om-crease'
    return m
  }, [f.frame, darkF])
  const plY = H / 2 - (plH + mm(P.shoulder)) / 2
  const bandMats = useMemo(() => [0, plY].map(y => {
    const mat = bandMaterial.clone(); mat.onBeforeCompile = sh => { bandMaterial.onBeforeCompile(sh, null as never); sh.uniforms.uOff.value = y }
    mat.customProgramCacheKey = () => 'om-band'; return mat
  }), [bandMaterial, plY])
  const bandOn = (geo: THREE.BufferGeometry, y: number, z: number) =>
    <mesh geometry={geo} position={[0, y, z]} renderOrder={1} material={bandMats[y === 0 ? 0 : 1]} />
  return (
    <group>
      <mesh geometry={g.body} castShadow name="ip18-body">{metal}</mesh>
      {/* antenna split bands on both long sides, from the side views */}
      {bandOn(g.body, 0, 0)}
      {/* front cover glass and display */}
      <mesh geometry={g.glass} position={[0, 0, zf + E]} name="ip18-cover">{black}</mesh>
      <mesh geometry={g.screen} position={[0, 0, zf + E * 2]} name="screen">
        {texture ? <meshBasicMaterial key="tex" map={texture} toneMapped={false} /> : <meshBasicMaterial key="idle" color="#07080b" />}
      </mesh>
      <mesh geometry={g.island} position={[0, isl, zf + E * 4]} renderOrder={3}>
        <meshBasicMaterial color="#010101" polygonOffset polygonOffsetFactor={-3} polygonOffsetUnits={-3} /></mesh>
      <group position={[fcamX, isl, zf + E * 5]}><LensStack r={mm(s.frontCam.r)} order={4} /></group>
      {/* receiver slot along the top glass edge */}
      <mesh position={[0, ty(s.receiver.cy), zf + E * 3]}><shapeGeometry args={[rrC(mm(s.receiver.w), mm(s.receiver.h), all(mm(s.receiver.h / 2))), 16]} />
        <meshBasicMaterial color="#0b0b0d" polygonOffset polygonOffsetFactor={-3} /></mesh>
      {/* cover glass reflection over the display: black base, additive, so only the fresnel reflection and faint smudges show */}
      <mesh geometry={g.screen} position={[0, 0, zf + E * 4.5]} renderOrder={10}>
        <meshPhysicalMaterial color="#000" roughness={1} roughnessMap={sR} specularIntensity={0.14}
          transparent blending={THREE.AdditiveBlending} depthWrite={false} polygonOffset polygonOffsetFactor={-8} /></mesh>
      {/* back: aluminium between the plateau and the glass, then the matte glass window */}
      <mesh geometry={g.backGlass} position={[0, ty(s.backGlass.top) - (H - mm(s.backGlass.top) - EDGE * 0.8) / 2, zb - E]} rotation={[0, Math.PI, 0]}>{matte}</mesh>
      {/* camera plateau: a full-width raised bar of the same aluminium unibody, lenses, flash and sensor sit directly on it */}
      <mesh geometry={g.plateau} position={[0, H / 2 - (plH + mm(P.shoulder)) / 2, zb]}>{plateauMetal}</mesh>
      <mesh geometry={g.fillet} position={[0, H / 2 - (plH + mm(P.shoulder)) / 2, zb]}>{plateauMetal}</mesh>
      {/* Antenna bands run over the plateau's outer shoulder and stop at the inner edge of the flat top (normal-based cut). */}
      {bandOn(g.plateau, plY, zb)}
      {bandOn(g.fillet, plY, zb)}
      <mesh geometry={g.plateau} position={[0, plY, zb]} renderOrder={2} material={creaseMat} />
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
