import { memo, useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { DeviceProps } from '../types'
import { fitTexture, DEFAULT_LOGO_TINT } from './shared'
import { slab, rrect } from './IPhonePro'
import { mechLiveFor, TILT0, RISE0 } from './mech'
// iMac G4 20" (2002): unofficial procedural model, not affiliated with Apple. From the dimensional drawing: display
// 531 mm wide, 20" 1680 x 1050 screen; hemispherical base; chrome arm with a joint at the base and one behind the
// display. Height 354 to 530 mm and depth 270 to 439 mm across the arm's travel (approximated by one arm swing plus
// the display tilt). 1 unit = 100 mm, floor at y = 0, the screen faces +z.
const mm = (v: number) => v / 100
const all = (r: number) => [r, r, r, r]
const E = 0.0006
export const IMAC = { panel: { w: 531, h: 364, t: 32, r: 30, edge: 9 }, screen: { w: 431, h: 269, y: 6 }, px: { w: 1680, h: 1050 },
  base: { r: 130, band: 25, dome: 116 }, neck: 22, arm: { len: 255, r: 13, min: 5, max: 50 }, attach: 30 }
export const IMAC_ASPECT = IMAC.px.w / IMAC.px.h
export const IMAC_FINISHES: Record<string, { label: string; body: string }> = { white: { label: 'White', body: '#f2f2ef' } }
const P1Y = mm(IMAC.base.band + IMAC.base.dome + IMAC.neck)
/** Where the display sits for a tilt (degrees, top back) and rise (0 to 1 of the arm's travel): its centre and turn. */
export function imacFrame(tilt: number, rise: number) {
  const a = THREE.MathUtils.degToRad(IMAC.arm.min + (IMAC.arm.max - IMAC.arm.min) * Math.min(1, Math.max(0, rise))), L = mm(IMAC.arm.len)
  const j2 = new THREE.Vector3(0, P1Y + L * Math.sin(a), L * Math.cos(a))
  const rx = -THREE.MathUtils.degToRad(tilt), off = new THREE.Vector3(0, -mm(IMAC.attach), mm(IMAC.panel.t) / 2 + mm(14)).applyAxisAngle(new THREE.Vector3(1, 0, 0), rx)
  return { j2, arm: a, rx, centre: j2.clone().add(off) }
}
const geoCache = new Map<string, THREE.BufferGeometry>()
const once = (k: string, f: () => THREE.BufferGeometry) => { let g = geoCache.get(k); if (!g) geoCache.set(k, g = f()); return g }

function IMacG4({ texture, mediaAspect, opts, uid }: DeviceProps) {
  const fin = IMAC_FINISHES.white
  const pw = mm(IMAC.panel.w), ph = mm(IMAC.panel.h), pt = mm(IMAC.panel.t), sw = mm(IMAC.screen.w), sh = mm(IMAC.screen.h), sy = mm(IMAC.screen.y)
  const R = mm(IMAC.base.r), band = mm(IMAC.base.band), dome = mm(IMAC.base.dome), sq = dome / R
  const g = useMemo(() => {
    const panel = once('panel', () => slab(rrect(pw, ph, all(mm(IMAC.panel.r))), pt, mm(IMAC.panel.edge)))
    const rim = once('rim', () => slab(rrect(pw + mm(8), ph + mm(8), all(mm(IMAC.panel.r + 4))), pt * 0.55, mm(3)))
    const bezel = once('bezel', () => new THREE.ShapeGeometry(rrect(sw + mm(10), sh + mm(10), all(mm(3)), 0, sy), 16))
    const screen = once('screen', () => { const s = new THREE.PlaneGeometry(sw, sh); s.translate(0, sy, 0); return s })
    const domeG = once('dome', () => { const s = new THREE.SphereGeometry(R, 96, 48, 0, Math.PI * 2, 0, Math.PI / 2); s.scale(1, sq, 1); return s })
    const bandG = once('band', () => new THREE.CylinderGeometry(R, R * 0.985, band, 96, 1, false))
    // optical drive slot: a strip of the dome's front at 50 to 58 mm off the floor
    const slot = once('slot', () => { const h0 = mm(50) - band, r = R * Math.sqrt(1 - (h0 / dome) ** 2) + E * 2, w = mm(157)
      const s = new THREE.CylinderGeometry(r, r, mm(26), 48, 1, true, -w / r / 2, w / r); return s })
    return { panel, rim, bezel, screen, domeG, bandG, slot }
  }, [pw, ph, pt, sw, sh, sy, R, band, dome, sq])
  useMemo(() => fitTexture(texture, mediaAspect, IMAC_ASPECT), [texture, mediaAspect])
  const white = useMemo(() => new THREE.MeshPhysicalMaterial({ color: fin.body, roughness: 0.28, clearcoat: 0.8, clearcoatRoughness: 0.12, envMapIntensity: 0.45 }), [fin.body])
  const chrome = useMemo(() => new THREE.MeshPhysicalMaterial({ color: '#e8eaee', metalness: 1, roughness: 0.08, envMapIntensity: 1.2 }), [])
  const clear = useMemo(() => new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.05, transparent: true, opacity: 0.28, depthWrite: false, clearcoat: 1 }), [])
  useEffect(() => () => { white.dispose(); chrome.dispose(); clear.dispose() }, [white, chrome, clear])
  const arm = useRef<THREE.Group>(null), panelG = useRef<THREE.Group>(null)
  const live = mechLiveFor(uid)
  useFrame(() => { const t = live.tl, f = imacFrame(t?.[0] ?? opts.tilt ?? TILT0, t?.[1] ?? opts.rise ?? RISE0)
    if (arm.current) arm.current.rotation.x = Math.PI / 2 - f.arm
    if (panelG.current) { panelG.current.position.copy(f.j2); panelG.current.rotation.x = f.rx } })
  const L = mm(IMAC.arm.len), ar = mm(IMAC.arm.r)
  const logo = (pos: [number, number, number], rot: [number, number, number], s: number) => opts.logo && (
    <mesh position={pos} rotation={rot}><planeGeometry args={[s, s / opts.logo.aspect]} />
      <meshPhysicalMaterial color={opts.logoTint !== DEFAULT_LOGO_TINT ? opts.logoTint : '#d6d7d9'} metalness={0.5} roughness={0.1} clearcoat={1} alphaMap={opts.logo.mask} transparent depthWrite={false} polygonOffset polygonOffsetFactor={-2} /></mesh>)
  // front logo on the dome, set on its surface 84 mm off the floor
  const lh = mm(84) - band, lz = R * Math.sqrt(1 - (lh / dome) ** 2), ln = Math.atan2(lh / (sq * sq), lz)
  return (
    <group>
      <mesh geometry={g.bandG} position={[0, band / 2, 0]} castShadow receiveShadow userData={{ sketchHull: true }}><primitive object={white} attach="material" /></mesh>
      <mesh position={[0, band, 0]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[R * 0.97, R * 1.001, 96]} /><meshStandardMaterial color="#d9d9d6" roughness={0.5} /></mesh>
      <mesh geometry={g.domeG} position={[0, band, 0]} castShadow userData={{ sketchHull: true }}><primitive object={white} attach="material" /></mesh>
      <mesh geometry={g.slot} position={[0, mm(54), 0]}><meshStandardMaterial color="#c9cacb" roughness={0.35} metalness={0.2} side={THREE.FrontSide} /></mesh>
      {logo([0, band + lh, lz + E * 2], [-ln, 0, 0], 0.16 + opts.logoSize)}
      {/* neck and the arm: one chrome tube from the joint on the dome to the joint behind the display */}
      <mesh position={[0, P1Y - mm(IMAC.neck) / 2, 0]} userData={{ sketchHull: true }}><cylinderGeometry args={[mm(16), mm(19), mm(IMAC.neck), 32]} /><primitive object={chrome} attach="material" /></mesh>
      <group position={[0, P1Y, 0]}>
        <mesh rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[mm(17), mm(17), mm(40), 32]} /><primitive object={chrome} attach="material" /></mesh>
        <group ref={arm}>
          <mesh position={[0, L / 2, 0]} castShadow userData={{ sketchHull: true }}><capsuleGeometry args={[ar, L, 8, 24]} /><primitive object={chrome} attach="material" /></mesh>
        </group>
      </group>
      <group ref={panelG}>
        <mesh rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[mm(17), mm(17), mm(40), 32]} /><primitive object={chrome} attach="material" /></mesh>
        <group position={[0, -mm(IMAC.attach), pt / 2 + mm(14)]}>
          <mesh position={[0, mm(IMAC.attach), -pt / 2 - mm(7)]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[mm(30), mm(36), mm(14), 40]} /><primitive object={chrome} attach="material" /></mesh>
          <mesh geometry={g.panel} castShadow name="imac-panel" userData={{ sketchHull: true }}><primitive object={white} attach="material" /></mesh>
          <mesh geometry={g.rim} material={clear} renderOrder={2} userData={{ sketchHide: true }} />
          <mesh geometry={g.bezel} position={[0, 0, pt / 2 + E]}><meshStandardMaterial color="#1a1b1d" roughness={0.6} /></mesh>
          <mesh geometry={g.screen} position={[0, 0, pt / 2 + E * 2]} name="screen">
            {texture ? <meshBasicMaterial key="tex" map={texture} toneMapped={false} /> : <meshBasicMaterial key="idle" color="#07080b" />}</mesh>
          <mesh position={[pw / 2 - mm(52), -ph / 2 + mm(16), pt / 2 + E]}><ringGeometry args={[mm(2.4), mm(3.6), 24]} /><meshBasicMaterial color="#b9bbbe" /></mesh>
          {logo([0, ph / 2 - mm(80), -pt / 2 - E * 2], [0, Math.PI, 0], 0.2 + opts.logoSize * 1.4)}
        </group>
      </group>
    </group>)
}
export default memo(IMacG4)
