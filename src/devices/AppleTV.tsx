import { memo, useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { DeviceProps } from '../types'
import { DEFAULT_LOGO_TINT } from './shared'
import { slab, rrect } from './IPhonePro'
// Apple TV 4K (3rd generation) and Siri Remote: unofficial procedural model, not affiliated with Apple. The box is from
// the dimensional drawing: 93.24 x 93.24 mm, 31.00 mm high (28 mm body over a 3 mm inset foot), large corner radius,
// status light on the front, power, Ethernet and HDMI on the back. It has no screen of its own, so the device takes no screen
// media. The Siri Remote (136 x 35 x 9.25 mm, clickpad and buttons)
// is not in that drawing; its sizes are approximations.
// 1 unit = 100 mm, centred on the box, y up, the front faces +z.
const mm = (v: number) => v / 100
const all = (r: number) => [r, r, r, r]
const E = 0.0006
export const ATV = { w: 93.24, h: 31, foot: 3, r: 27, edge: 2.5, led: { x: 24.67, y: 11 } }
export const REMOTE = { w: 35, h: 136, t: 9.25, r: 6.5, edge: 3.6, pad: { d: 30.5, y: 41 } }
/** Where the remote sits: upright in the hand, or lying face up beside the box. */
export const REMOTE_HELD = { x: 0.95, y: 0.5, z: 0.7 }
export const ATV_FINISHES: Record<string, { label: string; body: string }> = { black: { label: 'Black', body: '#141416' } }
export const REMOTE_FINISHES: Record<string, string> = { silver: '#d4d6d9' }
const geoCache = new Map<string, THREE.BufferGeometry>()
const once = (k: string, f: () => THREE.BufferGeometry) => { let g = geoCache.get(k); if (!g) geoCache.set(k, g = f()); return g }

function Remote({ alu }: { alu: THREE.Material }) {
  const W = mm(REMOTE.w), H = mm(REMOTE.h), T = mm(REMOTE.t), Z = T / 2
  const body = once('remote', () => slab(rrect(W, H, all(mm(REMOTE.r))), T, mm(REMOTE.edge)))
  const btn = (x: number, y: number, d: number, k: string, label?: string) => <group key={k} position={[mm(x), mm(y), Z + E]}>
    <mesh><circleGeometry args={[mm(d) / 2, 40]} /><meshStandardMaterial color="#1b1b1e" roughness={0.5} /></mesh>{label && <Glyph k={label} />}</group>
  const padY = H / 2 - mm(REMOTE.pad.y) + mm(14)
  return <group>
    <mesh geometry={body} castShadow receiveShadow name="remote" userData={{ sketchHull: true }}><primitive object={alu} attach="material" /></mesh>
    {/* clickpad: touch ring round a centre button */}
    <mesh position={[0, padY, Z + E]}><circleGeometry args={[mm(REMOTE.pad.d) / 2, 64]} /><meshStandardMaterial color="#1b1b1e" roughness={0.35} /></mesh>
    <mesh position={[0, padY, Z + E * 2]}><ringGeometry args={[mm(10.2), mm(10.6), 64]} /><meshStandardMaterial color="#2c2c30" roughness={0.4} /></mesh>
    {btn(-8.2, -8, 11, 'back', 'back')}{btn(8.2, -8, 11, 'tv', 'tv')}{btn(-8.2, -22, 11, 'play', 'play')}{btn(-8.2, -36, 11, 'mute', 'mute')}
    <mesh position={[mm(8.2), mm(-29), Z + E]}><shapeGeometry args={[rrect(mm(11), mm(25), all(mm(5.5))), 16]} /><meshStandardMaterial color="#1b1b1e" roughness={0.5} /></mesh>
    <Glyph k="plus" at={[mm(8.2), mm(-21.5)]} /><Glyph k="minus" at={[mm(8.2), mm(-36.5)]} />
    {/* power, top right; Siri button on the right side */}
    <mesh position={[mm(10.5), H / 2 - mm(8), Z + E]}><circleGeometry args={[mm(2.6), 24]} /><meshStandardMaterial color="#1b1b1e" roughness={0.5} /></mesh>
    <mesh position={[W / 2 + E, H / 2 - mm(38), 0]} rotation={[0, Math.PI / 2, 0]}><shapeGeometry args={[rrect(mm(3), mm(9), all(mm(1.5))), 8]} /><meshStandardMaterial color="#9a9ca0" roughness={0.4} metalness={0.6} /></mesh>
  </group>
}
/** Button symbols drawn as thin white strokes (our own shapes). */
function Glyph({ k, at = [0, 0] }: { k: string; at?: [number, number] }) {
  const s = mm(1), lines: [number, number, number, number][] =
    k === 'plus' ? [[-2, 0, 2, 0], [0, -2, 0, 2]] : k === 'minus' ? [[-2, 0, 2, 0]]
    : k === 'back' ? [[1.6, 2.2, -1.2, 0], [-1.2, 0, 1.6, -2.2]]
    : k === 'tv' ? [[-2.4, 1.6, 2.4, 1.6], [2.4, 1.6, 2.4, -1.2], [2.4, -1.2, -2.4, -1.2], [-2.4, -1.2, -2.4, 1.6], [-1, -2.2, 1, -2.2]]
    : k === 'play' ? [[-2.6, 2, -2.6, -2], [-2.6, 2, -0.6, 0], [-0.6, 0, -2.6, -2], [0.9, 1.8, 0.9, -1.8], [2.2, 1.8, 2.2, -1.8]]
    : k === 'mute' ? [[-2.4, 0.9, -1.2, 0.9], [-1.2, 0.9, 0.6, 2.2], [0.6, 2.2, 0.6, -2.2], [0.6, -2.2, -1.2, -0.9], [-1.2, -0.9, -2.4, -0.9], [-2.4, -0.9, -2.4, 0.9], [1.6, 1, 2.8, -1], [2.8, 1, 1.6, -1]] : []
  return <group position={[at[0], at[1], E]}>{lines.map(([a, b, c, d], i) => { const L = Math.hypot(c - a, d - b) * s
    return <mesh key={i} position={[(a + c) / 2 * s, (b + d) / 2 * s, 0]} rotation={[0, 0, Math.atan2(d - b, c - a)]}><planeGeometry args={[L + s * 0.35, s * 0.35]} /><meshBasicMaterial color="#e9e9ea" /></mesh> })}</group>
}

function AppleTV({ opts }: DeviceProps) {
  const fin = ATV_FINISHES.black
  const W = mm(ATV.w), Hb = mm(ATV.h - ATV.foot), foot = mm(ATV.foot), H = mm(ATV.h)
  const g = useMemo(() => ({
    // the box is extruded in plan (x by z) and stood up: y is its height
    body: once('atv', () => { const b = slab(rrect(W, W, all(mm(ATV.r))), Hb, mm(ATV.edge)); b.rotateX(-Math.PI / 2); return b }),
    foot: once('atv-foot', () => { const b = slab(rrect(W - mm(10), W - mm(10), all(mm(ATV.r - 5))), foot + mm(1), mm(0.6)); b.rotateX(-Math.PI / 2); return b }),
    top: once('atv-top', () => { const s = new THREE.ShapeGeometry(rrect(W - mm(2 * ATV.edge), W - mm(2 * ATV.edge), all(mm(ATV.r - ATV.edge))), 32); s.rotateX(-Math.PI / 2); return s }),
  }), [W, Hb, foot])
  const matte = useMemo(() => new THREE.MeshPhysicalMaterial({ color: fin.body, roughness: 0.55, envMapIntensity: 0.5 }), [fin.body])
  const gloss = useMemo(() => new THREE.MeshPhysicalMaterial({ color: '#0d0d0f', roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.1 }), [])
  const alu = useMemo(() => new THREE.MeshPhysicalMaterial({ color: REMOTE_FINISHES.silver, metalness: 0.9, roughness: 0.32, envMapIntensity: 1 }), [])
  useEffect(() => () => { matte.dispose(); gloss.dispose(); alu.dispose() }, [matte, gloss, alu])
  const by = -H / 2 + foot + Hb / 2, ty = -H / 2 + foot + Hb, z = W / 2
  const showRemote = opts.remote !== false
  return (
    <group>
      <mesh geometry={g.body} position={[0, by, 0]} castShadow receiveShadow name="atv-box" userData={{ sketchHull: true }}><primitive object={matte} attach="material" /></mesh>
      <mesh geometry={g.top} position={[0, ty + E, 0]}><primitive object={gloss} attach="material" /></mesh>
      <mesh geometry={g.foot} position={[0, -H / 2 + (foot + mm(1)) / 2, 0]}><meshStandardMaterial color="#0a0a0b" roughness={0.9} /></mesh>
      {opts.logo && <mesh position={[0, ty + E * 3, 0]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[0.2 + opts.logoSize, (0.2 + opts.logoSize) / opts.logo.aspect]} />
        <meshPhysicalMaterial color={opts.logoTint !== DEFAULT_LOGO_TINT ? opts.logoTint : '#2a2a2e'} roughness={0.5} alphaMap={opts.logo.mask} transparent depthWrite={false} polygonOffset polygonOffsetFactor={-2} /></mesh>}
      {/* front: status light */}
      <mesh position={[mm(ATV.led.x), -H / 2 + mm(ATV.led.y), z + E]}><circleGeometry args={[mm(1.2), 20]} /><meshBasicMaterial color="#e8f6ea" toneMapped={false} /></mesh>
      {/* back: power (figure eight), Ethernet, HDMI */}
      <group position={[0, -H / 2 + mm(16.4), -z - E]} rotation={[0, Math.PI, 0]}>
        {[-1, 1].map(s => <mesh key={s} position={[mm(-23.4 + s * 2.6), 0, 0]}><circleGeometry args={[mm(3.4), 24]} /><meshBasicMaterial color="#050505" /></mesh>)}
        <mesh position={[0, mm(0.6), 0]}><planeGeometry args={[mm(12.7), mm(10.2)]} /><meshBasicMaterial color="#050505" /></mesh>
        <mesh position={[mm(22.2), 0, 0]}><shapeGeometry args={[rrect(mm(14.3), mm(4.6), [mm(1.6), mm(1.6), mm(0.4), mm(0.4)]), 6]} /><meshBasicMaterial color="#050505" /></mesh>
      </group>
      {showRemote && (opts.held
        ? <group position={[REMOTE_HELD.x, REMOTE_HELD.y, REMOTE_HELD.z]}><Remote alu={alu} /></group>
        : <group position={[W / 2 + mm(45), -H / 2 + mm(REMOTE.t) / 2, mm(10)]} rotation={[-Math.PI / 2, 0, -0.18]}><Remote alu={alu} /></group>)}
    </group>)
}
export default memo(AppleTV)
