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
// Tilt and height stand: 479 to 583 mm high, 207 mm deep, a counterbalanced arm (92 mm between pivots, swinging -35 to 35 degrees) with two pivots and 105 mm of travel.
// VESA mount adapter: a 100 x 100 plate, the panel landscape or portrait. Stand part sizes are read off the drawings.
// 1 unit = 100 mm, floor at y = 0, the screen faces +z.
const mm = (v: number) => v / 100
const all = (r: number) => [r, r, r, r]
const E = 0.0006
export type SdStand = 'tilt' | 'height' | 'vesa'
export const SD = { panel: { w: 623, h: 362, t: 20, r: 9, edge: 1.8 }, screen: { w: 596.5, h: 335.5 }, px: { w: 5120, h: 2880 },
  tilt: { base: { w: 151, d: 160, t: 7, z0: 75 }, hinge: { y: 208, z: 12 }, foot: 152, arm: { w: 151, t: 9 } },
  height: { base: { w: 151, d: 205, t: 7, z0: 20 }, post: { z: -168, top: 281, t: 12 }, p1: 261, link: 92, a0: -35, a1: 35, attach: 90, fwd: 17, gap: 17, side: 79.5, plate: 6 },
  vesa: { plate: 100, depth: 11, y: 300 }, bottom: 117 }
export const SD_ASPECT = SD.px.w / SD.px.h
export const SD_FINISHES: Record<string, { label: string; body: string }> = { silver: { label: 'Silver', body: '#e6e7e9' } }
const PT = mm(SD.panel.t)
/** Where the panel sits: its centre and tilt (turn about x), plus the stand parts' joints. */
export function sdFrame(stand: SdStand, tilt: number, rise: number) {
  const rx = -THREE.MathUtils.degToRad(tilt), X = new THREE.Vector3(1, 0, 0)
  if (stand === 'height') { const h = SD.height, a = THREE.MathUtils.degToRad(h.a0 + (h.a1 - h.a0) * Math.min(1, Math.max(0, rise))), L = mm(h.link)
    const p1 = new THREE.Vector3(0, mm(h.p1), mm(h.post.z) + mm(h.fwd)), p2 = p1.clone().add(new THREE.Vector3(0, L * Math.sin(a), L * Math.cos(a)))
    const off = new THREE.Vector3(0, mm(h.attach), PT / 2 + mm(h.gap)).applyAxisAngle(X, rx)
    return { rx, centre: p2.clone().add(off), j: p2, p1, a } }
  if (stand === 'vesa') { const c = new THREE.Vector3(0, mm(SD.vesa.y), 0); return { rx, centre: c, j: c.clone().add(new THREE.Vector3(0, 0, -PT / 2 - mm(SD.vesa.depth))), p1: c, a: 0 } }
  const t = SD.tilt, j = new THREE.Vector3(0, mm(t.hinge.y), -PT / 2 - mm(t.hinge.z))
  const off = new THREE.Vector3(0, mm(SD.bottom + SD.panel.h / 2 - t.hinge.y), PT / 2 + mm(t.hinge.z)).applyAxisAngle(X, rx)
  return { rx, centre: j.clone().add(off), j, p1: new THREE.Vector3(0, mm(t.base.t), mm(t.base.z0 - t.foot)), a: 0 }
}
const geoCache = new Map<string, THREE.BufferGeometry>()
const once = (k: string, f: () => THREE.BufferGeometry) => { let g = geoCache.get(k); if (!g) geoCache.set(k, g = f()); return g }
/** (unused) A flat bar from a to b (y-z plane), w wide along x and t thick. */
function Bar({ a, b, w, t, mat, r = 0 }: { a: THREE.Vector3; b: THREE.Vector3; w: number; t: number; mat: THREE.Material; r?: number }) {
  const d = b.clone().sub(a), L = d.length(), ang = Math.atan2(d.z, d.y)
  return <mesh position={a.clone().add(b).multiplyScalar(0.5).toArray()} rotation={[ang, 0, 0]} castShadow userData={{ sketchHull: true }}>
    {r ? <capsuleGeometry args={[r, L, 6, 20]} /> : <boxGeometry args={[w, L, t]} />}<primitive object={mat} attach="material" /></mesh>
}
function Pivot({ at, mat, r = mm(13), w = mm(160) }: { at: THREE.Vector3; mat: THREE.Material; r?: number; w?: number }) {
  return <mesh position={at.toArray()} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[r, r, w, 40]} /><primitive object={mat} attach="material" /></mesh>
}

/** Cable slot: an open vertical stadium through the stand sheet, 46 x 74 mm. The panel's round power port shows through its upper half. */
/** height of the post's slot centre off the floor (mm), just below the panel at its lowest */
const POST_SLOT_Y = 150
export const SLOT = { w: 46, h: 74, plug: 19 }
function slotShape(cy: number) { const w = mm(SLOT.w), h = mm(SLOT.h), r = w / 2, p = new THREE.Path()
  p.absarc(0, cy + h / 2 - r, r, 0, Math.PI, false); p.absarc(0, cy - h / 2 + r, r, Math.PI, Math.PI * 2, false); p.closePath(); return p }
/** Flat foot plate, its front end rounded (seen from above) and its edges eased. */
function Foot({ w, d, z0, alu, t = mm(5) }: { w: number; d: number; z0: number; alu: THREE.Material; t?: number }) {
  const geo = useMemo(() => { const r = Math.min(w / 2, mm(28)), b = slab(rrect(w, d, [mm(6), mm(6), r, r]), t, mm(1.6), 4); b.rotateX(-Math.PI / 2); return b }, [w, d, t])
  useEffect(() => () => geo.dispose(), [geo])
  return <mesh geometry={geo} position={[0, t / 2, z0 - d / 2]} castShadow receiveShadow userData={{ sketchHull: true }}><primitive object={alu} attach="material" /></mesh>
}
/** Tilt stand: one wide aluminium sheet bent into an L. The flat foot runs back under the panel, bends up at its rear
 * end and the upright slants forward to the round hinge behind the panel (chrome caps on its ends). A round cable hole
 * with the black power plug sits in the upright just below the panel. */
function TiltStand({ f, alu, chrome }: { f: ReturnType<typeof sdFrame>; alu: THREE.Material; chrome: THREE.Material }) {
  const t = SD.tilt, w = mm(t.arm.w), th = mm(5), a = f.p1.clone().setY(th), b = f.j, d = b.clone().sub(a), L = d.length(), ang = Math.atan2(d.z, d.y)
  const bend = mm(10)
  const slotY = (0.63 - 0.5) * L
  const upright = useMemo(() => { const sh = rrect(w, L, all(mm(1))); sh.holes.push(slotShape(slotY)); return slab(sh, th, mm(1.2), 3) }, [w, L, th, slotY])
  useEffect(() => () => upright.dispose(), [upright])
  return <group>
    <Foot w={w} d={mm(t.base.d)} z0={mm(t.base.z0)} alu={alu} t={th} />
    {/* bend: a quarter round joining the foot's rear end to the upright */}
    <mesh position={[0, bend, a.z + bend * Math.sin(ang)]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[bend, bend, w, 24, 1, false, Math.PI, Math.PI / 2 + ang]} /><primitive object={alu} attach="material" /></mesh>
    {/* upright: the sheet with the cable slot through it */}
    <group position={a.clone().add(b).multiplyScalar(0.5).toArray()} rotation={[ang, 0, 0]}>
      <mesh geometry={upright} castShadow userData={{ sketchHull: true }}><primitive object={alu} attach="material" /></mesh>
    </group>
    {/* hinge: a round cylinder across the top with chrome end caps */}
    <mesh position={b.toArray()} rotation={[0, 0, Math.PI / 2]} castShadow><cylinderGeometry args={[mm(12), mm(12), w, 40]} /><primitive object={alu} attach="material" /></mesh>
    {[-1, 1].map(sx => <mesh key={sx} position={[sx * (w / 2 + mm(1)), b.y, b.z]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[mm(11), mm(11), mm(2), 32]} /><primitive object={chrome} attach="material" /></mesh>)}
  </group>
}

function StudioDisplay({ texture, mediaAspect, opts, uid }: DeviceProps) {
  const fin = SD_FINISHES.silver, stand: SdStand = opts.sdStand ?? 'tilt', portrait = stand === 'vesa' && !!opts.sdPortrait
  const pw = mm(SD.panel.w), ph = mm(SD.panel.h), sw = mm(SD.screen.w), sh = mm(SD.screen.h)
  const g = useMemo(() => ({
    body: once('body', () => slab(rrect(pw, ph, all(mm(SD.panel.r))), PT, mm(SD.panel.edge))),
    // black glass inside the aluminium lip: inset by the bevel width, its corner concentric with the frame's (r minus the lip)
    pill: once('pill', () => { const L = mm(SD.height.link), r = mm(17), sh = new THREE.Shape(); sh.absarc(-L / 2, 0, r, Math.PI / 2, Math.PI * 1.5, false); sh.absarc(L / 2, 0, r, -Math.PI / 2, Math.PI / 2, false)
      const d = mm(SD.height.plate), b = mm(1.6), e = new THREE.ExtrudeGeometry(sh, { depth: d - 2 * b, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: 4, curveSegments: 32 }); e.translate(0, 0, -(d - 2 * b) / 2); return e }),
    post: once('post', () => { const sh = rrect(mm(SD.height.base.w), mm(SD.height.post.top), [0, 0, mm(22), mm(22)]); sh.holes.push(slotShape(mm(POST_SLOT_Y - SD.height.post.top / 2))); return slab(sh, mm(SD.height.post.t), mm(2), 4) }),
    rail: once('rail', () => slab(rrect(mm(18), mm(150), all(mm(9))), mm(SD.vesa.depth), mm(2), 4)),
    bridge: once('bridge', () => { const sh = rrect(mm(118), mm(26), all(mm(10))); return slab(sh, mm(SD.vesa.depth), mm(2), 4) }),
    boss: once('boss', () => slab(rrect(mm(SD.tilt.arm.w), mm(46), all(mm(10))), mm(8), mm(2.5), 6)),
    glass: once('glass', () => new THREE.ShapeGeometry(rrect(pw - mm(2 * SD.panel.edge), ph - mm(2 * SD.panel.edge), all(mm(SD.panel.r - SD.panel.edge))), 32)),
  }), [pw, ph])
  useMemo(() => fitTexture(texture, mediaAspect, portrait ? 1 / SD_ASPECT : SD_ASPECT), [texture, mediaAspect, portrait])
  const alu = useMemo(() => new THREE.MeshPhysicalMaterial({ color: fin.body, metalness: 0.7, roughness: 0.36, envMapIntensity: 1 }), [fin.body])
  const nano = !!opts.nano
  // standard glass: a sharp reflection over the screen; nano-texture: the same reflection scattered and dimmed (matte).
  // Black base colour, so only the reflection shows and the screen keeps its contrast.
  const cover = useMemo(() => nano
    ? new THREE.MeshPhysicalMaterial({ color: '#000000', roughness: 0.85, transparent: true, opacity: 0.5, depthWrite: false, envMapIntensity: 0.35 })
    : new THREE.MeshPhysicalMaterial({ color: '#000000', roughness: 0.03, metalness: 0, transparent: true, opacity: 0.5, depthWrite: false, envMapIntensity: 1.6 }), [nano])
  const chrome = useMemo(() => new THREE.MeshPhysicalMaterial({ color: '#eceef0', metalness: 0.55, roughness: 0.18, clearcoat: 1, envMapIntensity: 1 }), [])
  useEffect(() => () => { alu.dispose(); cover.dispose(); chrome.dispose() }, [alu, cover, chrome])
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
      {stand === 'tilt' && <TiltStand f={f0} alu={alu} chrome={chrome} />}
      {stand === 'height' && <group>
        <Foot w={mm(h.base.w)} d={mm(h.base.d)} z0={mm(h.base.z0)} alu={alu} />
        {/* post: a flat plate with a rounded top and the cable hole near its foot */}
        <mesh geometry={g.post} position={[0, mm(h.post.top) / 2, mm(h.post.z)]} castShadow userData={{ sketchHull: true }}><primitive object={alu} attach="material" /></mesh>
        {/* counterbalanced arm: a flat pill, seen side on, with a round pivot at each end */}
        {/* counterbalanced arm: a flat pill plate on the post's side face, pivoting near the post's top and on the side
            of the bracket behind the panel, a screw head at each pivot; it clears the post and the panel */}
        <group ref={link} position={f0.p1.toArray()} rotation={[-f0.a, 0, 0]}>
          {[-1, 1].map(sx => <group key={sx} position={[sx * mm(h.side), 0, 0]} scale={[sx, 1, 1]}>
            <mesh position={[0, 0, mm(h.link) / 2]} rotation={[0, Math.PI / 2, 0]} castShadow userData={{ sketchHull: true }}><primitive object={g.pill} attach="geometry" /><primitive object={alu} attach="material" /></mesh>
            {[0, mm(h.link)].map(z => <group key={z} position={[mm(h.plate) / 2 + E, 0, z]} rotation={[0, Math.PI / 2, 0]}>
              <mesh><circleGeometry args={[mm(7.5), 32]} /><primitive object={chrome} attach="material" /></mesh>
              <mesh position={[0, 0, E]}><circleGeometry args={[mm(2.6), 6]} /><meshStandardMaterial color="#3a3b3f" roughness={0.4} /></mesh></group>)}
          </group>)}
        </group>
      </group>}
      <group ref={panel} position={f0.centre.toArray()} rotation={[f0.rx, 0, 0]}>
        <group rotation={[0, 0, portrait ? -Math.PI / 2 : 0]}>
          <mesh geometry={g.body} castShadow name="sd-panel" userData={{ sketchHull: true }}><primitive object={alu} attach="material" /></mesh>
          <mesh geometry={g.glass} position={[0, 0, PT / 2 + E]}><meshBasicMaterial color="#050506" /></mesh>
          <mesh position={[0, ph / 2 - mm(6.6), PT / 2 + E * 2]}><circleGeometry args={[mm(1.6), 20]} /><meshStandardMaterial color="#1a1c22" roughness={0.1} /></mesh>
          <group position={[0, 0, -PT / 2 - E]} rotation={[0, Math.PI, 0]}>{[0, 1, 2, 3].map(port)}</group>
          {/* round power port on the back, 28 mm above the bottom edge: behind the stand's slot, or below the VESA adapter */}
          <group position={[0, -ph / 2 + mm(28), -PT / 2 - E * 2]} rotation={[0, Math.PI, 0]}>
            <mesh><circleGeometry args={[mm(17), 48]} /><meshStandardMaterial color="#0e0e10" roughness={0.45} /></mesh>
            <mesh position={[0, 0, E]}><ringGeometry args={[mm(7), mm(11), 40]} /><meshStandardMaterial color="#2a2a2e" roughness={0.3} /></mesh>
          </group>
          {logo}
          {stand !== 'tilt' && stand !== 'height' && <group position={[0, 0, -PT / 2]}>
            {/* VESA mount adapter: the 100 x 100 plate with its four bolts, on a bar to the cable entry */}
            {/* two rails carrying the 100 x 100 bolt pattern, joined by a bridge at the bottom */}
            {[-1, 1].map(x => <mesh key={x} position={[x * mm(50), -mm(8), -mm(SD.vesa.depth) / 2]} castShadow><primitive object={g.rail} attach="geometry" /><primitive object={alu} attach="material" /></mesh>)}
            <mesh position={[0, -mm(74), -mm(SD.vesa.depth) / 2]} castShadow><primitive object={g.bridge} attach="geometry" /><primitive object={alu} attach="material" /></mesh>
            {[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y], i) => <mesh key={i} position={[x * mm(50), y * mm(50), -mm(SD.vesa.depth) - E]} rotation={[0, Math.PI, 0]}><circleGeometry args={[mm(3.4), 20]} /><meshStandardMaterial color="#8d8f93" metalness={0.8} roughness={0.3} /></mesh>)}
          </group>}
          {stand === 'tilt' && <mesh position={[0, mm(SD.tilt.hinge.y - SD.bottom - SD.panel.h / 2), -PT / 2 - mm(4)]} castShadow><primitive object={g.boss} attach="geometry" /><primitive object={alu} attach="material" /></mesh>}
          {stand === 'height' && <mesh position={[0, mm(-h.attach), -PT / 2 - mm(h.gap + 6) / 2]} castShadow><boxGeometry args={[mm(2 * h.side - h.plate - 2), mm(48), mm(h.gap + 6)]} /><primitive object={alu} attach="material" /></mesh>}
        </group>
        <mesh position={[0, 0, PT / 2 + E * 3]} name="screen">
          <planeGeometry args={portrait ? [sh, sw] : [sw, sh]} />
          {texture ? <meshBasicMaterial key="tex" map={texture} toneMapped={false} /> : <meshBasicMaterial key="idle" color="#08090c" />}</mesh>
        <mesh position={[0, 0, PT / 2 + E * 4]} renderOrder={2} userData={{ sketchHide: true }}><shapeGeometry args={[portrait ? rrect(ph - mm(2 * SD.panel.edge), pw - mm(2 * SD.panel.edge), all(mm(SD.panel.r - SD.panel.edge))) : rrect(pw - mm(2 * SD.panel.edge), ph - mm(2 * SD.panel.edge), all(mm(SD.panel.r - SD.panel.edge))), 32]} /><primitive object={cover} attach="material" /></mesh>
      </group>
    </group>)
}
export default memo(StudioDisplay)
