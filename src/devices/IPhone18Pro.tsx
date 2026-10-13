import { useMemo, useRef, type ReactNode } from 'react'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import type { DeviceProps } from '../types'
import { fitTexture, DEFAULT_LOGO_TINT, sceneHit } from './shared'
import { brushedNormal, brushedRoughness, frostRoughness, smudgeRoughness } from './materials'
// iPhone 18 Pro: unofficial procedural model, not affiliated with Apple.
// Measurements from Apple's "iPhone 18 Pro Dimensional Drawings" (2026-09-09,
// developer.apple.com/accessories/dimensional-drawings). Finishes and pixel size from apple.com/iphone-18-pro/specs.
// Scale: 1 unit = 100 mm. Origin at the body centre, display faces +z, top of phone is +y.
// Drawing coordinates are measured from the top edge (y) and, for the back, from the left edge of the back view.
const mm = (v: number) => v / 100
const W = mm(71.85), H = mm(150.01), T = mm(8.75)
const CR = mm(11.81)                     // body corner radius (R11.81 / R11.82 on sheet 4)
const EDGE = mm(2.61)                    // housing edge to start of flat area on the top side (rounded edge band)
const GLASS = { w: mm(69.45), h: mm(147.61) }
const ACT = { w: mm(66.57), h: mm(144.73) } // display active area, 2.64 mm all round from the housing
const ACT_R = CR - mm(2.64)
const ISL = { w: mm(15.66), h: mm(6.07), cy: H / 2 - mm(7.99) } // Dynamic Island, centred on the 35.92 mm centre line
// Sheet 3, detail M: front camera keepout is the island itself (15.68 x 6.07, 2X R2.93, centre 7.99 from the top).
// The drawing does not place the lens inside it; Apple puts it in the right-hand cap, so we centre it on that cap.
const FCAM = { x: ISL.w / 2 - ISL.h / 2, r: mm(1.45) }
// Receiver keepout: 28.85 mm slot centred on 35.92, along the top glass edge (0.45 band). Depth into the glass is assumed.
const RECEIVER = { w: mm(28.85), h: mm(0.45), cy: H / 2 - mm(1.45) }
export const IP18_PX = { w: 1206, h: 2622 }
export const IP18_ASPECT = IP18_PX.w / IP18_PX.h
export const IP18_FINISHES: Record<string, { label: string; frame: string; back: string }> = {
  black: { label: 'Black', frame: '#2c2d31', back: '#36373c' },
  silver: { label: 'Silver', frame: '#d6d7d9', back: '#e4e4e2' },
  glacier: { label: 'Glacier', frame: '#bccbd4', back: '#cdd9df' },
  burgundy: { label: 'Burgundy', frame: '#5b2230', back: '#6a2a38' },
}
// Back view: x measured from the left of the back view, which is the right side of the phone seen from the front.
const bx = (x: number) => W / 2 - mm(x)
const ty = (y: number) => H / 2 - mm(y)
const PLATEAU = { h: mm(58.01), rise: mm(2.78), bottomR: mm(12.0) }
const LENS_D = mm(16.58), LENS_RISE = mm(2.11)
const LENSES = [[14.37, 14.37], [14.37, 33.61], [32.49, 23.99]]
const FLASH = [58.03, 13.82], SENSOR = [58.03, 34.16], MIC = [58.03, 23.99]

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

// SIM tray, from the left side view of the dimensional drawing: centre 111.97 mm from the top,
// 19.44 mm long (2X 9.72), 2.56 mm wide, centred in the 8.75 mm thickness (4X 4.375). Ejector hole drawn near the top end.
const SIM = { cy: 111.97, len: mm(19.44), w: mm(2.56), pinFromCentre: mm(7.3), pinD: mm(0.9) }
const NANO = { l: mm(12.3), w: mm(8.8), t: mm(0.67) }
const EJECT = mm(15), EJECT_MS = 420
const ease = (t: number) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
function SimTray({ frame }: { frame: string }) {
  const slide = useRef<THREE.Group>(null), st = useRef({ out: false, from: 0, t0: -1e9 })
  const cur = () => { const s = st.current, k = Math.min(1, (performance.now() - s.t0) / EJECT_MS); return s.from + ((s.out ? 1 : 0) - s.from) * ease(k) }
  const h = useClickable(() => { const v = cur(); st.current = { out: !st.current.out, from: v, t0: performance.now() } })
  useFrame(() => { if (slide.current) slide.current.position.x = -EJECT * cur() })
  const carrier = { x: mm(10.6), y: mm(14.2), t: mm(0.8) }
  return (
    <group position={[-W / 2, ty(SIM.cy), 0]}>
      {/* the slot opening, only seen once the tray is out */}
      <mesh rotation={[0, -Math.PI / 2, 0]} position={[-E / 3, 0, 0]}><shapeGeometry args={[rrect(SIM.w, SIM.len, all(SIM.w / 2)), 24]} />
        <meshBasicMaterial color="#030303" polygonOffset polygonOffsetFactor={-1} /></mesh>
      <group ref={slide} {...h}>
        {/* flush face plate with a hairline seam */}
        <mesh rotation={[0, -Math.PI / 2, 0]} position={[-E * 0.8, 0, 0]}><shapeGeometry args={[rrect(SIM.w - mm(0.12), SIM.len - mm(0.12), all(SIM.w / 2 - mm(0.06))), 24]} />
          <meshPhysicalMaterial color={frame} metalness={0.85} roughness={0.3} polygonOffset polygonOffsetFactor={-3} /></mesh>
        <mesh rotation={[0, -Math.PI / 2, 0]} position={[-E * 1.2, SIM.pinFromCentre, 0]}><circleGeometry args={[SIM.pinD / 2, 20]} />
          <meshBasicMaterial color="#060606" polygonOffset polygonOffsetFactor={-5} /></mesh>
        {/* face plate thickness and carrier that live inside the frame */}
        <mesh position={[mm(0.5), 0, 0]}><boxGeometry args={[mm(1), SIM.len - mm(0.2), SIM.w - mm(0.2)]} />
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
  const capGeo = useMemo(() => {
    const g = new THREE.SphereGeometry(r * 3, 48, 8, 0, Math.PI * 2, 0, Math.asin(1 / 3))
    g.rotateX(Math.PI / 2); g.translate(0, 0, -r * 3 * Math.cos(Math.asin(1 / 3))); g.scale(1, 1, 0.35); return g
  }, [r])
  return (
    <group>
      <mesh renderOrder={order}><ringGeometry args={[r * 0.74, r, 64]} />
        <meshPhysicalMaterial color="#0c0d11" metalness={0.85} roughness={0.32} {...off(0)} /></mesh>
      <mesh renderOrder={order}><circleGeometry args={[r * 0.74, 64]} />
        <meshPhysicalMaterial color="#040509" roughness={0.12} clearcoat={1} {...off(0)} /></mesh>
      <mesh renderOrder={order + 1}><circleGeometry args={[r * 0.6, 64]} />
        <meshPhysicalMaterial color="#0a0c1c" metalness={0.25} roughness={0.06} iridescence={1} iridescenceIOR={1.45}
          iridescenceThicknessRange={[260, 420]} clearcoat={1} clearcoatRoughness={0.03} envMapIntensity={1.4} {...off(1)} /></mesh>
      {[0.5, 0.36].map((k, i) => <mesh key={k} renderOrder={order + 2}><ringGeometry args={[r * k - r * 0.025, r * k, 64]} />
        <meshPhysicalMaterial color={i ? '#2a2546' : '#1b2442'} metalness={0.9} roughness={0.18} {...off(2)} /></mesh>)}
      <mesh renderOrder={order + 3}><circleGeometry args={[r * 0.2, 40]} /><meshBasicMaterial color="#000" {...off(3)} /></mesh>
      <mesh geometry={capGeo} renderOrder={order + 4}>
        <meshPhysicalMaterial color="#000" roughness={0.03} specularIntensity={0.35}
          transparent blending={THREE.AdditiveBlending} depthWrite={false} {...off(4)} /></mesh>
    </group>)
}

export default function IPhone18Pro({ texture, mediaAspect, opts }: DeviceProps) {
  const f = IP18_FINISHES[opts.finish] ?? IP18_FINISHES.silver
  const g = useMemo(() => {
    const body = slab(rrect(W, H, all(CR)), T, EDGE)
    const glass = new THREE.ShapeGeometry(rrect(GLASS.w, GLASS.h, all(CR - mm(1.2))), 48)
    const screen = flatUV(rrect(ACT.w, ACT.h, all(ACT_R)), ACT.w, ACT.h)
    const r = ISL.h / 2
    const island = new THREE.ShapeGeometry(rrect(ISL.w, ISL.h, all(r)), 24)
    // Camera plateau: full width from the top edge down to 58.01 mm, 2.78 mm proud of the back plate.
    const plateau = slab(rrect(W, PLATEAU.h, [PLATEAU.bottomR, PLATEAU.bottomR, CR, CR]), PLATEAU.rise * 2, PLATEAU.rise * 0.9, 6)
    const backGlass = new THREE.ShapeGeometry(rrect(W - EDGE * 2.2, H - PLATEAU.h - EDGE * 1.6, [CR - EDGE, CR - EDGE, mm(8), mm(8)]), 48)
    // Camera glass window on the plateau, enclosing the three lenses, flash, mic and sensor.
    const window = new THREE.ShapeGeometry(rrect(mm(63), mm(39.5), all(mm(9.5))), 48)
    return { body, glass, screen, island, plateau, backGlass, window }
  }, [])
  useMemo(() => fitTexture(texture, mediaAspect, IP18_ASPECT), [texture, mediaAspect])
  // Brushed aluminium frame: anisotropic highlight along the band, streaky roughness and faint grooves.
  const bR = brushedRoughness(), bN = brushedNormal(), fR = frostRoughness(), sR = smudgeRoughness()
  const metal = <meshPhysicalMaterial color={f.frame} metalness={0.9} roughness={0.55} roughnessMap={bR} normalMap={bN} normalScale={new THREE.Vector2(0.06, 0.06)}
    anisotropy={0.55} clearcoat={0.08} clearcoatRoughness={0.3} envMapIntensity={1.15} />
  // Frosted back glass: textured roughness under a thin, slightly glossy coat so highlights spread but stay soft.
  const matte = <meshPhysicalMaterial color={f.back} metalness={0} roughness={0.8} roughnessMap={fR} clearcoat={0.35} clearcoatRoughness={0.38}
    specularIntensity={0.6} envMapIntensity={0.9} />
  const black = <meshPhysicalMaterial color="#020203" roughness={1} roughnessMap={sR} clearcoat={1} clearcoatRoughness={0.04} />
  const zf = T / 2
  const zb = -T / 2
  // Buttons: pill (fully rounded ends) in side view, 2.66 wide, extruded 0.45 out of the flat side band
  // with a rounded bevel where the face meets the sides. 0.3 mm is sunk into the frame so no gap shows.
  const SINK = mm(0.3)
  const btnGeo = (len: number, wz: number, prot: number) => {
    const bev = Math.min(prot * 0.45, mm(0.2))
    const r = wz / 2
    const g = new THREE.ExtrudeGeometry(rrect(wz - bev * 2, len - bev * 2, all(r - bev)), { depth: prot + SINK - bev, bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelSegments: 4, curveSegments: 24 })
    g.translate(0, 0, -SINK); g.rotateY(Math.PI / 2); return g // extrusion now runs along +x
  }
  const side = (x: number, cy: number, len: number, key: string) => (
    <Pressable key={key} depth={mm(0.3)} position={[x, ty(cy), 0]} rotation={[0, x < 0 ? Math.PI : 0, 0]}>
      <mesh geometry={btnGeo(len, mm(2.66), mm(0.45))} castShadow>{metal}</mesh></Pressable>)
  // Camera Control: flush. Thin metal surround plus a sapphire glass inset, both within 0.05 mm of the frame surface.
  const cameraControl = (cy: number) => (
    <Pressable depth={mm(0.1)} position={[W / 2, ty(cy), 0]}>
      <mesh rotation={[0, Math.PI / 2, 0]} position={[mm(0.01), 0, 0]}><shapeGeometry args={[rrect(mm(3.43), mm(17.5), all(mm(1.715))), 32]} />
        <meshPhysicalMaterial color={f.frame} metalness={0.95} roughness={0.18} polygonOffset polygonOffsetFactor={-2} /></mesh>
      <mesh rotation={[0, Math.PI / 2, 0]} position={[mm(0.03), 0, 0]}><shapeGeometry args={[rrect(mm(3.03), mm(17.1), all(mm(1.515))), 32]} />
        <meshPhysicalMaterial color="#5e6672" metalness={0.1} roughness={0.04} clearcoat={1} clearcoatRoughness={0.02} ior={1.77} polygonOffset polygonOffsetFactor={-4} /></mesh>
    </Pressable>)
  const lensX = (x: number) => bx(x), lensY = (y: number) => ty(y)
  const zPlat = zb - PLATEAU.rise
  return (
    <group>
      <mesh geometry={g.body} castShadow name="ip18-body">{metal}</mesh>
      {/* front cover glass and display */}
      <mesh geometry={g.glass} position={[0, 0, zf + E]} name="ip18-cover">{black}</mesh>
      <mesh geometry={g.screen} position={[0, 0, zf + E * 2]} name="screen">
        {texture ? <meshBasicMaterial key="tex" map={texture} toneMapped={false} /> : <meshBasicMaterial key="idle" color="#07080b" />}
      </mesh>
      <mesh geometry={g.island} position={[0, ISL.cy, zf + E * 4]} renderOrder={3}>
        <meshBasicMaterial color="#010101" polygonOffset polygonOffsetFactor={-3} polygonOffsetUnits={-3} /></mesh>
      {/* front camera in the island's right-hand cap */}
      <group position={[FCAM.x, ISL.cy, zf + E * 5]}><LensStack r={FCAM.r} order={4} /></group>
      {/* receiver slot along the top glass edge */}
      <mesh position={[0, RECEIVER.cy, zf + E * 3]}><shapeGeometry args={[rrect(RECEIVER.w, RECEIVER.h, all(RECEIVER.h / 2)), 16]} />
        <meshBasicMaterial color="#0b0b0d" polygonOffset polygonOffsetFactor={-3} /></mesh>
      {/* cover glass reflection over the display: black base, additive, so only the fresnel reflection and faint smudges show */}
      <mesh geometry={g.screen} position={[0, 0, zf + E * 4.5]} renderOrder={10}>
        <meshPhysicalMaterial color="#000" roughness={1} roughnessMap={sR} specularIntensity={0.14}
          transparent blending={THREE.AdditiveBlending} depthWrite={false} polygonOffset polygonOffsetFactor={-8} /></mesh>
      {/* back: matte glass below the plateau */}
      <mesh geometry={g.backGlass} position={[0, -PLATEAU.h / 2 + mm(0.8), zb - E]} rotation={[0, Math.PI, 0]}>{matte}</mesh>
      {/* camera plateau, part of the aluminium unibody */}
      <mesh geometry={g.plateau} position={[0, ty(PLATEAU.h / 2 * 100), zb]}>{metal}</mesh>
      <mesh geometry={g.window} position={[bx(35.5), ty(23.99), zPlat - E]} rotation={[0, Math.PI, 0]}>
        <meshPhysicalMaterial color={f.back} roughness={0.75} roughnessMap={fR} clearcoat={0.4} clearcoatRoughness={0.3} metalness={0.05} /></mesh>
      {LENSES.map(([x, y]) => (
        <group key={`${x}-${y}`} position={[lensX(x), lensY(y), zPlat]}>
          <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, -LENS_RISE / 2]}><cylinderGeometry args={[LENS_D / 2, LENS_D / 2 + mm(0.4), LENS_RISE, 64]} />{metal}</mesh>
          <group position={[0, 0, -LENS_RISE - E]} rotation={[0, Math.PI, 0]}><LensStack r={LENS_D / 2 - mm(1.1)} /></group>
        </group>))}
      <mesh position={[bx(FLASH[0]), ty(FLASH[1]), zPlat - E * 3]} rotation={[0, Math.PI, 0]}><circleGeometry args={[mm(3.45), 40]} /><meshStandardMaterial color="#efe6cf" roughness={0.3} /></mesh>
      <mesh position={[bx(SENSOR[0]), ty(SENSOR[1]), zPlat - E * 3]} rotation={[0, Math.PI, 0]}><circleGeometry args={[mm(3.45), 40]} />{black}</mesh>
      <mesh position={[bx(MIC[0]), ty(MIC[1]), zPlat - E * 3]} rotation={[0, Math.PI, 0]}><circleGeometry args={[mm(0.575), 16]} /><meshBasicMaterial color="#111" /></mesh>
      {/* left side (seen from the front): Action button and volume, centres 34.28 / 48.43 / 62.63 mm from the top */}
      {side(-W / 2, 34.28, mm(7.8), 'act')}
      {side(-W / 2, 48.43, mm(11.8), 'vup')}
      {side(-W / 2, 62.63, mm(11.8), 'vdn')}
      {/* right side: side button (centre 55.53, 17.7 long) and flush sapphire Camera Control (centre 98.40, 17.1 long) */}
      {side(W / 2, 55.53, mm(17.7), 'side')}
      {cameraControl(98.40)}
      {opts.simTray && <SimTray frame={f.frame} />}
      {/* bottom: USB-C centred at 35.92 mm, speaker and mic holes Ø1.53, screws Ø1.50 */}
      <group position={[0, -H / 2 - E, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <mesh><shapeGeometry args={[rrect(mm(8.9), mm(3.2), all(mm(1.6))), 24]} /><meshBasicMaterial color="#050506" side={THREE.DoubleSide} /></mesh>
        {[15.40, 17.65, 19.91, 22.16, 24.42, 47.43, 49.69, 51.94, 54.20, 56.45].map(x => (
          <mesh key={x} position={[-W / 2 + mm(x), 0, 0]}><circleGeometry args={[mm(0.765), 16]} /><meshBasicMaterial color="#050506" side={THREE.DoubleSide} /></mesh>))}
        {[29.0, 42.85].map(x => (
          <mesh key={x} position={[-W / 2 + mm(x), 0, 0]}><circleGeometry args={[mm(0.75), 16]} /><meshStandardMaterial color="#777" metalness={0.8} side={THREE.DoubleSide} /></mesh>))}
      </group>
      {/* logo spot: centred 36.03 wide position, 91.20 mm from the top. User art only. */}
      {opts.logo && (
        <mesh position={[0, ty(91.2), zb - E * 4]} rotation={[0, Math.PI, 0]}>
          <planeGeometry args={[opts.logoSize, opts.logoSize / opts.logo.aspect]} />
          <meshPhysicalMaterial color={opts.logoTint !== DEFAULT_LOGO_TINT ? opts.logoTint : f.back} metalness={0.55} roughness={0.04} clearcoat={1} clearcoatRoughness={0.02} envMapIntensity={1.6}
            alphaMap={opts.logo.mask} transparent depthWrite={false} polygonOffset polygonOffsetFactor={-2} />
        </mesh>)}
    </group>
  )
}
