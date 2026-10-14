import { memo, useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { DeviceProps } from '../types'
import { fitTexture, DEFAULT_LOGO_TINT } from './shared'
import { brushedRoughness } from './materials'
import { slab, rrect } from './IPhonePro'
import { mechLiveFor, LID0 } from './mech'
// MacBook Pro 16" (2021): unofficial procedural model, not affiliated with Apple. Sizes from the dimensional drawing:
// 355.7 x 248.1 x 16.8 mm closed, 16.2" display of 3456 x 2234 px at 254 ppi (345.6 x 223.4 mm) with a camera notch.
// 1 unit = 100 mm. The base lies on the floor plane, keyboard up (+y), front edge toward +z; the lid turns about the
// hinge at the back edge. Inside the base group (rotated flat) x is right, y runs from the front edge to the hinge and
// z is up, which is the frame the hands use (see App fitFor).
const mm = (v: number) => v / 100
const all = (r: number) => [r, r, r, r]
const E = 0.0004
export const MBP = { w: 355.7, d: 248.1, tb: 9.8, tl: 7.0, r: 11, edge: 1.4,
  px: { w: 3456, h: 2234 }, disp: { w: 345.6, h: 223.4, top: 5.5, r: 9 }, notch: { w: 31, h: 6.4 },
  pad: { w: 160.5, h: 99.5, front: 7, r: 6 }, kb: { pitch: 18.4, gap: 2.6, bottom: 127, rows: 6 } }
export const MBP_ASPECT = MBP.px.w / MBP.px.h
export const MBP_FINISHES: Record<string, { label: string; body: string }> = {
  spacegrey: { label: 'Space Grey', body: '#7b7d82' },
  silver: { label: 'Silver', body: '#d9dadc' },
}
// Rows from the bottom (space row) up, key widths in key units (each row is 15 units wide).
const ROWS: number[][] = [
  [1, 1, 1, 1.25, 5.5, 1.25, 1, 1, 1, 1],
  [2.35, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2.65],
  [1.8, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2.2],
  [1.5, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.5],
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2],
  [1.5, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.5],
]
/** Key centres in the base frame (model units), for the typing hands: row, column. */
export function mbpKey(row: number, col: number) {
  const p = mm(MBP.kb.pitch), widths = ROWS[row]; let x = -7.5 * p
  for (let i = 0; i < col; i++) x += widths[i] * p
  return { x: x + widths[col] * p / 2, y: -mm(MBP.d) / 2 + mm(MBP.kb.bottom) + (row + 0.5) * p }
}
const geoCache = new Map<string, THREE.BufferGeometry>()
const once = (k: string, f: () => THREE.BufferGeometry) => { let g = geoCache.get(k); if (!g) geoCache.set(k, g = f()); return g }

function MacBookPro({ texture, mediaAspect, opts, uid }: DeviceProps) {
  const fin = MBP_FINISHES[opts.finish] ?? MBP_FINISHES.spacegrey
  const W = mm(MBP.w), D = mm(MBP.d), TB = mm(MBP.tb), TL = mm(MBP.tl), DL = D - TL / 2
  const p = mm(MBP.kb.pitch), kgap = mm(MBP.kb.gap)
  const g = useMemo(() => {
    const base = once('base', () => slab(rrect(W, D, all(mm(MBP.r))), TB, mm(MBP.edge)))
    const lid = once('lid', () => { const s = slab(rrect(W, DL, all(mm(MBP.r))), TL, mm(MBP.edge) * 0.8); s.translate(0, DL / 2, -TL / 2); return s })
    const front = once('front', () => new THREE.ShapeGeometry(rrect(W - 0.02, DL - 0.02, all(mm(MBP.r) - 0.01), 0, DL / 2), 48))
    const dw = mm(MBP.disp.w), dh = mm(MBP.disp.h), dy = DL - mm(MBP.disp.top) - dh / 2
    const screen = once('screen', () => { const s = new THREE.ShapeGeometry(rrect(dw, dh, [0, 0, mm(MBP.disp.r), mm(MBP.disp.r)], 0, dy), 24)
      const pos = s.attributes.position, uv = s.attributes.uv
      for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / dw + 0.5, (pos.getY(i) - dy) / dh + 0.5)
      uv.needsUpdate = true; return s })
    const nw = mm(MBP.notch.w), nh = mm(MBP.notch.h)
    const notch = once('notch', () => new THREE.ShapeGeometry(rrect(nw, nh, [mm(2), mm(2), 0, 0], 0, dy + dh / 2 - nh / 2), 16))
    // keys: one slab per key, merged per row into a single geometry
    const keys = once('keys', () => {
      const parts: THREE.BufferGeometry[] = []
      ROWS.forEach((ws, r) => { let x = -7.5 * p
        ws.forEach((w, c) => {
          const kw = w * p - kgap, cx = x + w * p / 2, cy = -D / 2 + mm(MBP.kb.bottom) + (r + 0.5) * p
          const arrows = r === 0 && c >= 7
          if (arrows && c === 8) { // up and down arrows share one slot, each half height
            for (const s of [-1, 1]) { const k = slab(rrect(kw, p / 2 - kgap, all(mm(1))), mm(1.2), mm(0.4), 3); k.translate(cx, cy + s * p / 4, 0); parts.push(k) }
          } else { const kh = arrows ? p / 2 - kgap : p - kgap, k = slab(rrect(kw, kh, all(mm(1.6))), mm(1.2), mm(0.4), 3); k.translate(cx, arrows ? cy - p / 4 : cy, 0); parts.push(k) }
          x += w * p })
      })
      return mergeAll(parts)
    })
    const well = once('well', () => new THREE.ShapeGeometry(rrect(15 * p + mm(5), MBP.kb.rows * p + mm(5), all(mm(4)), 0, -D / 2 + mm(MBP.kb.bottom) + MBP.kb.rows * p / 2), 24))
    const pad = once('pad', () => new THREE.ShapeGeometry(rrect(mm(MBP.pad.w), mm(MBP.pad.h), all(mm(MBP.pad.r)), 0, -D / 2 + mm(MBP.pad.front) + mm(MBP.pad.h) / 2), 24))
    // speaker grilles either side of the keyboard: a grid of small holes
    const grille = once('grille', () => { const parts: THREE.BufferGeometry[] = [], y0 = -D / 2 + mm(MBP.kb.bottom), n = 46, m = 9
      for (const side of [-1, 1]) for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
        const c = new THREE.CircleGeometry(mm(0.45), 6); c.translate(side * (7.5 * p + mm(14) + j * mm(2.6)), y0 + mm(3) + i * mm(2.4), 0); parts.push(c) }
      return mergeAll(parts) })
    return { base, lid, front, screen, notch, keys, well, pad, grille, dy, dh }
  }, [W, D, TB, TL, DL, p, kgap])
  useMemo(() => fitTexture(texture, mediaAspect, MBP_ASPECT), [texture, mediaAspect])
  const bR = brushedRoughness()
  const alu = useMemo(() => new THREE.MeshPhysicalMaterial({ color: fin.body, metalness: 0.35, roughness: 0.55, roughnessMap: bR, envMapIntensity: 0.32, specularIntensity: 0.35 }), [fin.body, bR])
  useEffect(() => () => alu.dispose(), [alu])
  const metal = <primitive object={alu} attach="material" />
  const lid = useRef<THREE.Group>(null)
  const live = mechLiveFor(uid)
  useFrame(() => { if (lid.current) lid.current.rotation.x = THREE.MathUtils.degToRad(90 - (live.tl?.[0] ?? opts.lid ?? LID0)) })
  const port = (w: number, h: number, y: number, side: 1 | -1, key: string, round = false) => (
    <mesh key={key} position={[side * (W / 2 + E), TB / 2, -y]} rotation={[0, side * Math.PI / 2, 0]}>
      {round ? <circleGeometry args={[w / 2, 24]} /> : <shapeGeometry args={[rrect(w, h, all(h / 2 - 0.0001)), 12]} />}
      <meshBasicMaterial color="#0b0b0d" /></mesh>)
  return (
    <group>
      {/* base: lying flat, top face (keyboard) up */}
      <group position={[0, TB / 2, 0]} rotation={[-Math.PI / 2, 0, 0]} name="mbp-base">
        <mesh geometry={g.base} castShadow receiveShadow userData={{ sketchHull: true }}>{metal}</mesh>
        <mesh geometry={g.well} position={[0, 0, TB / 2 + E]}><meshStandardMaterial color="#141416" roughness={0.8} /></mesh>
        <mesh geometry={g.keys} position={[0, 0, TB / 2 + mm(0.4)]} userData={{ sketchTone: 'dark' }}><meshStandardMaterial color="#1c1c1f" roughness={0.55} /></mesh>
        <mesh geometry={g.grille} position={[0, 0, TB / 2 + E]}><meshBasicMaterial color="#202124" /></mesh>
        <mesh geometry={g.pad} position={[0, 0, TB / 2 + E]}><meshPhysicalMaterial color={fin.body} metalness={0.2} roughness={0.32} clearcoat={0.6} clearcoatRoughness={0.25} /></mesh>
        {/* front thumb scoop and four feet */}
        <mesh position={[0, -D / 2 - E, TB / 2 - mm(1.6)]} rotation={[Math.PI / 2, 0, 0]}><shapeGeometry args={[rrect(mm(64), mm(1.6), all(mm(0.79))), 8]} /><meshBasicMaterial color="#2a2b2e" side={THREE.DoubleSide} /></mesh>
        {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy], i) => <mesh key={i} position={[sx * (W / 2 - mm(22)), sy * (D / 2 - mm(22)), -TB / 2 - E]} rotation={[Math.PI, 0, 0]}><circleGeometry args={[mm(9), 24]} /><meshStandardMaterial color="#1a1a1c" roughness={0.9} /></mesh>)}
      </group>
      {/* ports: left MagSafe 3, two Thunderbolt 4, headphone; right HDMI, Thunderbolt 4, SDXC (back to front) */}
      {port(mm(15.5), mm(4.2), mm(78), -1, 'magsafe')}{port(mm(8.6), mm(3.2), mm(52), -1, 'tb1')}{port(mm(8.6), mm(3.2), mm(36), -1, 'tb2')}{port(mm(4), 0, mm(4), -1, 'hp', true)}
      {port(mm(14.5), mm(4.8), mm(70), 1, 'hdmi')}{port(mm(8.6), mm(3.2), mm(30), 1, 'tb3')}{port(mm(24), mm(2.2), mm(-40), 1, 'sd')}
      {/* lid: turns about the hinge at the back edge; 0 is closed, 90 upright */}
      <group ref={lid} position={[0, TB, -D / 2 + TL / 2]}>
        <mesh geometry={g.lid} castShadow userData={{ sketchHull: true }}>{metal}</mesh>
        <mesh geometry={g.front} position={[0, 0, E]} name="mbp-bezel"><meshPhysicalMaterial color="#050506" roughness={0.2} clearcoat={1} clearcoatRoughness={0.05} /></mesh>
        <mesh geometry={g.screen} position={[0, 0, E * 2]} name="screen">
          {texture ? <meshBasicMaterial key="tex" map={texture} toneMapped={false} /> : <meshBasicMaterial key="idle" color="#07080b" />}</mesh>
        <mesh geometry={g.notch} position={[0, 0, E * 3]}><meshBasicMaterial color="#020203" /></mesh>
        <mesh position={[0, g.dy + g.dh / 2 - mm(3.2), E * 4]}><circleGeometry args={[mm(1.1), 20]} /><meshBasicMaterial color="#14161c" /></mesh>
        {opts.logo && (
          <mesh position={[0, DL / 2, -TL - E]} rotation={[0, Math.PI, 0]}>
            <planeGeometry args={[opts.logoSize * 2.2, opts.logoSize * 2.2 / opts.logo.aspect]} />
            <meshPhysicalMaterial color={opts.logoTint !== DEFAULT_LOGO_TINT ? opts.logoTint : fin.body} metalness={0.6} roughness={0.05} clearcoat={1} clearcoatRoughness={0.02} envMapIntensity={1.6}
              alphaMap={opts.logo.mask} transparent depthWrite={false} polygonOffset polygonOffsetFactor={-2} />
          </mesh>)}
      </group>
    </group>)
}
/** Merges non-indexed copies of simple geometries (position, normal, uv). */
export function mergeAll(parts: THREE.BufferGeometry[]) {
  const ps: number[] = [], ns: number[] = [], us: number[] = []
  for (const g0 of parts) { const g = g0.index ? g0.toNonIndexed() : g0, P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv
    for (let i = 0; i < P.count; i++) { ps.push(P.getX(i), P.getY(i), P.getZ(i)); if (N) ns.push(N.getX(i), N.getY(i), N.getZ(i)); else ns.push(0, 0, 1); if (U) us.push(U.getX(i), U.getY(i)); else us.push(0, 0) }
    if (g !== g0) g.dispose(); g0.dispose() }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.Float32BufferAttribute(ps, 3)); out.setAttribute('normal', new THREE.Float32BufferAttribute(ns, 3)); out.setAttribute('uv', new THREE.Float32BufferAttribute(us, 2))
  return out
}
export default memo(MacBookPro)
