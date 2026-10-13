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
  black: { label: 'Black', frame: '#26272a', back: '#2b2c2f' },
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
function slab(shape: THREE.Shape, depth: number, edge: number, segs = 8) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: depth - edge * 2, bevelEnabled: true, bevelThickness: edge, bevelSize: edge, bevelOffset: -edge, bevelSegments: segs, curveSegments: 48 })
  g.translate(0, 0, -(depth - edge * 2) / 2); g.computeVertexNormals(); return g
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
  g.rotateX(-Math.PI / 2); g.translate(0, -h / 2, 0); g.computeVertexNormals(); return g
}
function flatUV(shape: THREE.Shape, w: number, h: number) {
  const g = new THREE.ShapeGeometry(shape, 48), p = g.attributes.position, uv = g.attributes.uv
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / w + 0.5, p.getY(i) / h + 0.5)
  uv.needsUpdate = true; return g
}
const E = 0.0003

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
  const capGeo = geoOnce(`cap${r}`, () => {
    const g = new THREE.SphereGeometry(r * 3, 48, 8, 0, Math.PI * 2, 0, Math.asin(1 / 3))
    g.rotateX(Math.PI / 2); g.translate(0, 0, -r * 3 * Math.cos(Math.asin(1 / 3))); g.scale(1, 1, 0.35); return g
  })
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
    const plateau = slab(rrect(W, plH, [mm(P.bottomR), mm(P.bottomR), mm(P.cornerR), mm(P.cornerR)]), rise * 2, rise * 0.35, 6)
    // Back glass (MagSafe window): top edge and top corner radius from sheet 4; sides and bottom follow the edge band.
    const bgTop = mm(s.backGlass.top), bgH = H - bgTop - EDGE * 0.8
    const backGlass = new THREE.ShapeGeometry(rrect(W - EDGE * 2.2, bgH, [CR - EDGE, CR - EDGE, mm(s.backGlass.topR), mm(s.backGlass.topR)]), 48)
    const bandH = mm(s.antennaBands[0][1] - s.antennaBands[0][0])
    const band = sideBand(W, T, EDGE, bandH)
    return { body, glass, screen, island, plateau, backGlass, band }
  })
  useMemo(() => fitTexture(texture, mediaAspect, aspect), [texture, mediaAspect, aspect])
  // Brushed aluminium frame: anisotropic highlight along the band, streaky roughness and faint grooves.
  const bR = brushedRoughness(), bN = brushedNormal(), fR = frostRoughness(), sR = smudgeRoughness()
  const metal = <meshPhysicalMaterial color={f.frame} metalness={0.3} roughness={0.5} roughnessMap={bR} normalMap={bN} normalScale={NORMAL_SCALE}
    anisotropy={0.55} clearcoat={0.08} clearcoatRoughness={0.3} envMapIntensity={1.15} />
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
    const g = new THREE.ExtrudeGeometry(rrect(wz - bev * 2, len - bev * 2, all(r - bev)), { depth: prot + SINK - bev, bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelSegments: 4, curveSegments: 24 })
    g.translate(0, 0, -SINK); g.rotateY(Math.PI / 2); return g // extrusion now runs along +x
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
  const bandMat = <meshPhysicalMaterial color={bandColour} metalness={0} roughness={0.72} clearcoat={0.15} clearcoatRoughness={0.5} polygonOffset polygonOffsetFactor={-1} />
  return (
    <group>
      <mesh geometry={g.body} castShadow name="ip18-body">{metal}</mesh>
      {/* antenna split bands on both long sides, from the side views */}
      {s.antennaBands.map(([a, b]) => [1, -1].map(sx => (
        <mesh key={`${a}${sx}`} geometry={g.band} position={[0, ty((a + b) / 2), 0]} scale={[sx, 1, 1]}>{bandMat}</mesh>)))}
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
      <mesh geometry={g.plateau} position={[0, H / 2 - plH / 2, zb]}>{metal}</mesh>
      {s.lens.at.map(([x, y]) => (
        <group key={`${x}-${y}`} position={[bx(x), ty(y), zPlat]}>
          <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, -lensRise / 2]}><cylinderGeometry args={[lensD / 2, lensD / 2, lensRise, 64]} /><meshPhysicalMaterial color={f.frame} metalness={1} roughness={0.14} envMapIntensity={1.4} /></mesh>
          <group position={[0, 0, -lensRise - E]} rotation={[0, Math.PI, 0]}><LensStack r={lensD / 2 - mm(1.1)} /></group>
        </group>))}
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
