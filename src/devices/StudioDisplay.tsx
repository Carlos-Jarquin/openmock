import { memo, useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { DeviceProps } from '../types'
import { fitTexture, DEFAULT_LOGO_TINT } from './shared'
import { slab, rrect } from './IPhonePro'
import { mechLiveFor, SD_TILT0, SD_RISE0 } from './mech'
// Apple Studio Display (27" 5K): unofficial procedural model, not affiliated with Apple. From the published sizes:
// 623 mm wide, panel 362 mm tall; 31 mm deep with the VESA mount adapter (a 20 mm panel plus the 11 mm adapter).
// 5120 x 2880 at 218 ppi gives a 596.5 x 335.5 mm active area inside a thin black border, camera centred in the top.
// Tilt stand: 478 mm high, 168 mm deep, one aluminium arm with a hinge behind the panel, tilt -5 to 25 degrees.
// Tilt and height stand: 479 to 583 mm high, 207 mm deep, a counterbalanced arm with two pivots and 105 mm of travel.
// VESA mount adapter: a 100 x 100 plate, the panel landscape or portrait. Stand part sizes are read off the drawings.
// 1 unit = 100 mm, floor at y = 0, the screen faces +z.
const mm = (v: number) => v / 100
const all = (r: number) => [r, r, r, r]
const E = 0.0006
export type SdStand = 'tilt' | 'height' | 'vesa'
export const SD = { panel: { w: 623, h: 362, t: 20, r: 9, edge: 3 }, screen: { w: 596.5, h: 335.5 }, px: { w: 5120, h: 2880 },
  tilt: { base: { w: 151, d: 166, t: 7, z0: 18 }, hinge: { y: 220, z: 12 }, foot: 140, arm: { w: 151, t: 9 } },
  height: { base: { w: 151, d: 205, t: 7, z0: 20 }, post: { z: -168, top: 345, t: 12 }, p1: 323.7, link: 114.6, a0: -35, a1: 20, attach: 40 },
  vesa: { plate: 100, depth: 11, y: 300 }, bottom: 117 }
export const SD_ASPECT = SD.px.w / SD.px.h
export const SD_FINISHES: Record<string, { label: string; body: string }> = { silver: { label: 'Silver', body: '#d9dadc' } }
const PT = mm(SD.panel.t)
/** Where the panel sits: its centre and tilt (turn about x), plus the stand parts' joints. */
export function sdFrame(stand: SdStand, tilt: number, rise: number) {
  const rx = -THREE.MathUtils.degToRad(tilt), X = new THREE.Vector3(1, 0, 0)
  if (stand === 'height') { const h = SD.height, a = THREE.MathUtils.degToRad(h.a0 + (h.a1 - h.a0) * Math.min(1, Math.max(0, rise))), L = mm(h.link)
    const p1 = new THREE.Vector3(0, mm(h.p1), mm(h.post.z) + mm(h.post.t) / 2), p2 = p1.clone().add(new THREE.Vector3(0, L * Math.sin(a), L * Math.cos(a)))
    const off = new THREE.Vector3(0, mm(h.attach), PT / 2 + mm(12)).applyAxisAngle(X, rx)
    return { rx, centre: p2.clone().add(off), j: p2, p1, a } }
  if (stand === 'vesa') { const c = new THREE.Vector3(0, mm(SD.vesa.y), 0); return { rx, centre: c, j: c.clone().add(new THREE.Vector3(0, 0, -PT / 2 - mm(SD.vesa.depth))), p1: c, a: 0 } }
  const t = SD.tilt, j = new THREE.Vector3(0, mm(t.hinge.y), -PT / 2 - mm(t.hinge.z))
  const off = new THREE.Vector3(0, mm(SD.bottom + SD.panel.h / 2 - t.hinge.y), PT / 2 + mm(t.hinge.z)).applyAxisAngle(X, rx)
  return { rx, centre: j.clone().add(off), j, p1: new THREE.Vector3(0, mm(t.base.t), mm(t.base.z0 - t.foot)), a: 0 }
}
const geoCache = new Map<string, THREE.BufferGeometry>()
const once = (k: string, f: () => THREE.BufferGeometry) => { let g = geoCache.get(k); if (!g) geoCache.set(k, g = f()); return g }
/** A flat bar from a to b (y-z plane), w wide along x and t thick. */
function Bar({ a, b, w, t, mat, r = 0 }: { a: THREE.Vector3; b: THREE.Vector3; w: number; t: number; mat: THREE.Material; r?: number }) {
  const d = b.clone().sub(a), L = d.length(), ang = Math.atan2(d.z, d.y)
  return <mesh position={a.clone().add(b).multiplyScalar(0.5).toArray()} rotation={[ang, 0, 0]} castShadow userData={{ sketchHull: true }}>
    {r ? <capsuleGeometry args={[r, L, 6, 20]} /> : <boxGeometry args={[w, L, t]} />}<primitive object={mat} attach="material" /></mesh>
}
function Pivot({ at, mat, r = mm(13), w = mm(160) }: { at: THREE.Vector3; mat: THREE.Material; r?: number; w?: number }) {
  return <mesh position={at.toArray()} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[r, r, w, 40]} /><primitive object={mat} attach="material" /></mesh>
}

function StudioDisplay({ texture, mediaAspect, opts, uid }: DeviceProps) {
  const fin = SD_FINISHES.silver, stand: SdStand = opts.sdStand ?? 'tilt', portrait = stand === 'vesa' && !!opts.sdPortrait
  const pw = mm(SD.panel.w), ph = mm(SD.panel.h), sw = mm(SD.screen.w), sh = mm(SD.screen.h)
  const g = useMemo(() => ({
    body: once('body', () => slab(rrect(pw, ph, all(mm(SD.panel.r))), PT, mm(SD.panel.edge))),
    glass: once('glass', () => new THREE.ShapeGeometry(rrect(pw - mm(1.2), ph - mm(1.2), all(mm(SD.panel.r - 0.6))), 16)),
  }), [pw, ph])
  useMemo(() => fitTexture(texture, mediaAspect, portrait ? 1 / SD_ASPECT : SD_ASPECT), [texture, mediaAspect, portrait])
  const alu = useMemo(() => new THREE.MeshPhysicalMaterial({ color: fin.body, metalness: 0.9, roughness: 0.34, envMapIntensity: 1 }), [fin.body])
  const nano = !!opts.nano
  // standard glass: a sharp reflection over the screen; nano-texture: the same reflection scattered and dimmed (matte).
  // Black base colour, so only the reflection shows and the screen keeps its contrast.
  const cover = useMemo(() => nano
    ? new THREE.MeshPhysicalMaterial({ color: '#000000', roughness: 0.85, transparent: true, opacity: 0.5, depthWrite: false, envMapIntensity: 0.35 })
    : new THREE.MeshPhysicalMaterial({ color: '#000000', roughness: 0.03, metalness: 0, transparent: true, opacity: 0.5, depthWrite: false, envMapIntensity: 1.6 }), [nano])
  useEffect(() => () => { alu.dispose(); cover.dispose() }, [alu, cover])
  const live = mechLiveFor(uid)
  const panel = useRef<THREE.Group>(null), link = useRef<THREE.Group>(null)
  const frame = (t?: number[] | null) => sdFrame(stand, t?.[0] ?? opts.tilt ?? SD_TILT0, t?.[1] ?? opts.rise ?? SD_RISE0)
  const f0 = frame(null)
  useFrame(() => { const f = frame(live.tl)
    if (panel.current) { panel.current.position.copy(f.centre); panel.current.rotation.x = f.rx }
    if (link.current) { link.current.position.copy(f.p1); link.current.rotation.x = -f.a } })
  const logo = opts.logo && <mesh position={[0, ph * 0.17, -PT / 2 - E * 2]} rotation={[0, Math.PI, 0]}><planeGeometry args={[0.36 + opts.logoSize * 1.4, (0.36 + opts.logoSize * 1.4) / opts.logo.aspect]} />
    <meshPhysicalMaterial color={opts.logoTint !== DEFAULT_LOGO_TINT ? opts.logoTint : '#1a1a1c'} roughness={0.2} clearcoat={1} alphaMap={opts.logo.mask} transparent depthWrite={false} polygonOffset polygonOffsetFactor={-2} /></mesh>
  // ports on the back, lower left seen from behind: USB-C, USB-C, Thunderbolt 5, Thunderbolt 5 (upstream, with a dot)
  const port = (i: number) => { const x = mm(-235 + i * 11), y = -ph / 2 + mm(52)
    return <group key={i} position={[x, y, 0]}>
      <mesh><planeGeometry args={[mm(2.6), mm(8.4)]} /><meshBasicMaterial color="#121214" /></mesh>
      {i >= 2 && <mesh position={[0, mm(8.5), 0]} rotation={[0, 0, -0.5]}><planeGeometry args={[mm(0.7), mm(3.2)]} /><meshBasicMaterial color="#7a7c80" /></mesh>}
      {i === 3 && <mesh position={[0, -mm(7.5), 0]}><circleGeometry args={[mm(0.8), 12]} /><meshBasicMaterial color="#7a7c80" /></mesh>}</group> }
  const h = SD.height, tb = SD.tilt
  return (
    <group>
      {stand === 'tilt' && <group>
        <mesh position={[0, mm(tb.base.t) / 2, mm(tb.base.z0 - tb.base.d / 2)]} castShadow receiveShadow userData={{ sketchHull: true }}><boxGeometry args={[mm(tb.base.w), mm(tb.base.t), mm(tb.base.d)]} /><primitive object={alu} attach="material" /></mesh>
        <Bar a={f0.p1} b={f0.j} w={mm(tb.arm.w)} t={mm(tb.arm.t)} mat={alu} />
        <Pivot at={f0.j} mat={alu} w={mm(tb.arm.w - 4)} />
        {/* cable hole through the arm */}
        <mesh position={f0.p1.clone().lerp(f0.j, 0.55).add(new THREE.Vector3(0, 0, -mm(tb.arm.t) / 2 - E)).toArray()} rotation={[Math.atan2(f0.j.z - f0.p1.z, f0.j.y - f0.p1.y), Math.PI, 0]}><circleGeometry args={[mm(14), 32]} /><meshBasicMaterial color="#141416" /></mesh>
      </group>}
      {stand === 'height' && <group>
        <mesh position={[0, mm(h.base.t) / 2, mm(h.base.z0 - h.base.d / 2)]} castShadow receiveShadow userData={{ sketchHull: true }}><boxGeometry args={[mm(h.base.w), mm(h.base.t), mm(h.base.d)]} /><primitive object={alu} attach="material" /></mesh>
        <mesh position={[0, mm(h.post.top) / 2, mm(h.post.z)]} castShadow userData={{ sketchHull: true }}><boxGeometry args={[mm(h.base.w), mm(h.post.top), mm(h.post.t)]} /><primitive object={alu} attach="material" /></mesh>
        {/* counterbalanced link: pivots on the post and behind the panel */}
        <group ref={link} position={f0.p1.toArray()} rotation={[-f0.a, 0, 0]}>
          <mesh position={[0, 0, mm(h.link) / 2]} rotation={[Math.PI / 2, 0, 0]} castShadow><capsuleGeometry args={[mm(16), mm(h.link), 6, 24]} /><primitive object={alu} attach="material" /></mesh>
          {[0, mm(h.link)].map(z => <mesh key={z} position={[mm(30), 0, z]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[mm(7), mm(7), mm(62), 24]} /><meshStandardMaterial color="#b9bbbf" metalness={0.8} roughness={0.3} /></mesh>)}
        </group>
      </group>}
      <group ref={panel} position={f0.centre.toArray()} rotation={[f0.rx, 0, 0]}>
        <group rotation={[0, 0, portrait ? -Math.PI / 2 : 0]}>
          <mesh geometry={g.body} castShadow name="sd-panel" userData={{ sketchHull: true }}><primitive object={alu} attach="material" /></mesh>
          <mesh geometry={g.glass} position={[0, 0, PT / 2 + E]}><meshBasicMaterial color="#050506" /></mesh>
          <mesh position={[0, ph / 2 - mm(6.6), PT / 2 + E * 2]}><circleGeometry args={[mm(1.6), 20]} /><meshStandardMaterial color="#1a1c22" roughness={0.1} /></mesh>
          <group position={[0, 0, -PT / 2 - E]} rotation={[0, Math.PI, 0]}>{[0, 1, 2, 3].map(port)}</group>
          {logo}
          {stand !== 'tilt' && stand !== 'height' && <group position={[0, 0, -PT / 2]}>
            {/* VESA mount adapter: the 100 x 100 plate with its four bolts, on a bar to the cable entry */}
            <mesh position={[0, 0, -mm(SD.vesa.depth) / 2]} castShadow><boxGeometry args={[mm(SD.vesa.plate + 12), mm(SD.vesa.plate + 30), mm(SD.vesa.depth)]} /><primitive object={alu} attach="material" /></mesh>
            {[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y], i) => <mesh key={i} position={[x * mm(50), y * mm(50), -mm(SD.vesa.depth) - E]} rotation={[0, Math.PI, 0]}><circleGeometry args={[mm(3.4), 20]} /><meshStandardMaterial color="#8d8f93" metalness={0.8} roughness={0.3} /></mesh>)}
          </group>}
          {stand === 'height' && <mesh position={[0, mm(-h.attach), -PT / 2 - mm(6)]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[mm(26), mm(30), mm(12), 32]} /><primitive object={alu} attach="material" /></mesh>}
        </group>
        <mesh position={[0, 0, PT / 2 + E * 3]} name="screen">
          <planeGeometry args={portrait ? [sh, sw] : [sw, sh]} />
          {texture ? <meshBasicMaterial key="tex" map={texture} toneMapped={false} /> : <meshBasicMaterial key="idle" color="#08090c" />}</mesh>
        <mesh position={[0, 0, PT / 2 + E * 4]} renderOrder={2} userData={{ sketchHide: true }}><planeGeometry args={portrait ? [ph, pw] : [pw, ph]} /><primitive object={cover} attach="material" /></mesh>
      </group>
    </group>)
}
export default memo(StudioDisplay)
