import { memo, useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { DeviceProps } from '../types'
import { fitTexture } from './shared'
import { slab, rrect } from './IPhonePro'
// Apple Watch Ultra 4 (49 mm): unofficial procedural model, not affiliated with Apple. From the dimensional drawing:
// case 43.32 x 49.14 mm, 12.00 mm thick at the case and 14.44 mm over the back crystal, flat cover glass 35.79 x 43.07,
// Digital Crown 8.42 mm across standing 3.17 mm off the right side, the Action button on the left, back crystal
// 36.80 x 44.07. The display (422 x 514) and the band size are not in the drawing and are approximations.
// 1 unit = 100 mm, centred on the case, the face looks along +z.
const mm = (v: number) => v / 100
const all = (r: number) => [r, r, r, r]
const E = 0.0006
export const WATCH = { w: 43.32, h: 49.14, t: 12.0, back: 2.44, r: 10, edge: 2.2, glass: { w: 35.79, h: 43.07, r: 7.5 }, screen: { w: 34.4, h: 41.9, r: 7 },
  rim: 0.9, crown: { d: 8.42, l: 3.17, y: 4.5 }, guard: { y0: -6, y1: 13, out: 1.6 }, side: { y: -11, h: 10, w: 3 }, action: { y: 5, h: 13, w: 4.6 },
  band: { w: 26, t: 3.2 }, px: { w: 422, h: 514 } }
export const WATCH_ASPECT = WATCH.px.w / WATCH.px.h
export const WATCH_FINISHES: Record<string, { label: string; body: string; metal: number }> = {
  natural: { label: 'Natural titanium', body: '#c9c5bd', metal: 0.85 }, black: { label: 'Black titanium', body: '#36363a', metal: 0.8 } }
export const WATCH_BANDS: Record<string, { label: string; color: string }> = {
  orange: { label: 'Orange', color: '#f26a21' }, black: { label: 'Black', color: '#1d1e21' }, olive: { label: 'Olive', color: '#5d6347' },
  blue: { label: 'Blue', color: '#2f4f7a' }, white: { label: 'White', color: '#eceae4' } }
const T = mm(WATCH.t), Z = T / 2

/** A flat strap of width w and thickness t swept along a path (y-z plane), the strap's width along x. */
function ribbon(path: THREE.Curve<THREE.Vector3>, w: number, t: number, n = 120, closed = false) {
  const pos: number[] = [], idx: number[] = [], P = new THREE.Vector3(), Tg = new THREE.Vector3(), Nn = new THREE.Vector3(), X = new THREE.Vector3(1, 0, 0)
  const ring = [[-w / 2, -t / 2], [w / 2, -t / 2], [w / 2, t / 2], [-w / 2, t / 2]]
  for (let i = 0; i <= n; i++) { const u = i / n; path.getPointAt(u, P); path.getTangentAt(u, Tg); Nn.crossVectors(X, Tg).normalize()
    // round the free ends off a little by narrowing the last 3%
    const k = closed ? 1 : Math.min(1, Math.sqrt(Math.min(u, 1 - u) / 0.03 + 0.15))
    for (const [a, b] of ring) pos.push(P.x + a * k, P.y + Nn.y * b, P.z + Nn.z * b) }
  for (let i = 0; i < n; i++) for (let j = 0; j < 4; j++) { const a = i * 4 + j, b = i * 4 + (j + 1) % 4, c = a + 4, d = b + 4; idx.push(a, c, b, b, c, d) }
  if (!closed) { idx.push(0, 1, 2, 0, 2, 3); const o = n * 4; idx.push(o, o + 2, o + 1, o, o + 3, o + 2) }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g
}
/** The band, laid out flat (straps out of the top and bottom, curving gently back) or wrapped round a wrist. */
export function bandGeometry(worn: { ry: number; rz: number; zc: number } | null | undefined) {
  const w = mm(WATCH.band.w), t = mm(WATCH.band.t), hy = mm(WATCH.h) / 2 - mm(1.5), z0 = -mm(1)
  if (worn) {
    // one closed loop: out of the top lug, round the wrist under the arm and back into the bottom lug
    const pts: THREE.Vector3[] = [], ry = worn.ry + t / 2, rz = worn.rz + t / 2
    for (let i = 0; i < 40; i++) { const a = -0.55 + (Math.PI + 1.1) * i / 39; pts.push(new THREE.Vector3(0, ry * Math.cos(a), worn.zc - rz * Math.sin(a))) }
    pts.unshift(new THREE.Vector3(0, hy, z0)); pts.push(new THREE.Vector3(0, -hy, z0))
    return ribbon(new THREE.CatmullRomCurve3(pts, false, 'centripetal'), w, t, 160)
  }
  const strap = (s: number, len: number) => { const p: THREE.Vector3[] = []
    for (let i = 0; i <= 12; i++) { const u = i / 12, y = hy + len * u, z = z0 - mm(7) * Math.sin(Math.min(1, u * 2.2) * Math.PI / 2) - mm(20) * u * u; p.push(new THREE.Vector3(0, s * y, z)) }
    return ribbon(new THREE.CatmullRomCurve3(p), w, t, 80) }
  const a = strap(1, mm(95)), b = strap(-1, mm(120))
  const g = mergeTwo(a, b); a.dispose(); b.dispose(); return g
}
function mergeTwo(a: THREE.BufferGeometry, b: THREE.BufferGeometry) {
  const pa = a.getAttribute('position').array as Float32Array, pb = b.getAttribute('position').array as Float32Array, ia = a.getIndex()!.array, ib = b.getIndex()!.array
  const pos = new Float32Array(pa.length + pb.length); pos.set(pa); pos.set(pb, pa.length); const off = pa.length / 3
  const idx = [...ia, ...Array.from(ib, i => i + off)], g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g
}
const geoCache = new Map<string, THREE.BufferGeometry>()
const once = (k: string, f: () => THREE.BufferGeometry) => { let g = geoCache.get(k); if (!g) geoCache.set(k, g = f()); return g }
/** A rounded rectangle face with 0 to 1 UVs, for the display. */
function face(w: number, h: number, r: number) { const g = new THREE.ShapeGeometry(rrect(w, h, all(r)), 24), p = g.getAttribute('position'), uv = g.getAttribute('uv')
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / w + 0.5, p.getY(i) / h + 0.5); return g }

function WatchUltra({ texture, mediaAspect, opts }: DeviceProps) {
  const fin = WATCH_FINISHES[opts.finish] ?? WATCH_FINISHES.natural, band = WATCH_BANDS[opts.band ?? 'orange'] ?? WATCH_BANDS.orange
  const W = mm(WATCH.w), H = mm(WATCH.h)
  const g = useMemo(() => ({
    caseG: once('case', () => slab(rrect(W, H, all(mm(WATCH.r))), T, mm(WATCH.edge))),
    // raised titanium lip round the flat glass
    rim: once('rim', () => { const s = rrect(mm(WATCH.glass.w + 2 * WATCH.rim + 1.2), mm(WATCH.glass.h + 2 * WATCH.rim + 1.2), all(mm(WATCH.glass.r + 1.8))); s.holes.push(rrect(mm(WATCH.glass.w), mm(WATCH.glass.h), all(mm(WATCH.glass.r))))
      return new THREE.ExtrudeGeometry(s, { depth: mm(0.8), bevelEnabled: true, bevelThickness: mm(0.3), bevelSize: mm(0.3), bevelSegments: 3, curveSegments: 48 }) }),
    glass: once('glass', () => new THREE.ShapeGeometry(rrect(mm(WATCH.glass.w), mm(WATCH.glass.h), all(mm(WATCH.glass.r))), 24)),
    screen: once('screen', () => face(mm(WATCH.screen.w), mm(WATCH.screen.h), mm(WATCH.screen.r))),
    back: once('back', () => { const s = new THREE.SphereGeometry(mm(40), 64, 16, 0, Math.PI * 2, 0, Math.acos(1 - WATCH.back / 40)); s.rotateX(-Math.PI / 2); s.translate(0, 0, mm(40) - mm(WATCH.back)); return s }),
    guard: once('guard', () => slab(rrect(T * 0.62, mm(WATCH.guard.y1 - WATCH.guard.y0), all(mm(2))), mm(WATCH.guard.out + 2), mm(0.8), 4)),
    pill: once('pill', () => new THREE.CapsuleGeometry(1, 1, 6, 16)),
  }), [W, H])
  const bandG = useMemo(() => bandGeometry(opts.worn), [opts.worn])
  useEffect(() => () => bandG.dispose(), [bandG])
  useMemo(() => fitTexture(texture, mediaAspect, WATCH_ASPECT), [texture, mediaAspect])
  const metal = useMemo(() => new THREE.MeshPhysicalMaterial({ color: fin.body, metalness: fin.metal, roughness: 0.38, envMapIntensity: 1 }), [fin])
  const strap = useMemo(() => new THREE.MeshPhysicalMaterial({ color: band.color, roughness: 0.8, sheen: 0.6, sheenColor: new THREE.Color(band.color).lerp(new THREE.Color('#ffffff'), 0.3) }), [band.color])
  const orange = useMemo(() => new THREE.MeshPhysicalMaterial({ color: '#f26a21', roughness: 0.35, clearcoat: 0.6 }), [])
  useEffect(() => () => { metal.dispose(); strap.dispose(); orange.dispose() }, [metal, strap, orange])
  const cr = mm(WATCH.crown.d) / 2, cl = mm(WATCH.crown.l), cy = mm(WATCH.crown.y), sx = W / 2
  return (
    <group>
      <mesh geometry={g.caseG} castShadow receiveShadow name="watch-case" userData={{ sketchHull: true }}><primitive object={metal} attach="material" /></mesh>
      <mesh geometry={g.rim} position={[0, 0, Z - mm(0.4)]}><primitive object={metal} attach="material" /></mesh>
      <mesh geometry={g.screen} position={[0, 0, Z + E]} name="screen">
        {texture ? <meshBasicMaterial key="tex" map={texture} toneMapped={false} /> : <meshBasicMaterial key="idle" color="#050506" />}</mesh>
      <mesh geometry={g.glass} position={[0, 0, Z + E * 2]} renderOrder={2} userData={{ sketchHide: true }}><meshPhysicalMaterial color="#ffffff" roughness={0.02} transparent opacity={0.05} depthWrite={false} clearcoat={1} /></mesh>
      {/* back crystal, black ceramic, over the case's back */}
      <mesh geometry={g.back} position={[0, 0, -Z]}><meshPhysicalMaterial color="#141416" roughness={0.25} clearcoat={1} /></mesh>
      {/* right side: crown guard, Digital Crown (ridged) with its orange face ring, and the side button */}
      <mesh geometry={g.guard} position={[sx - mm(0.6), mm((WATCH.guard.y0 + WATCH.guard.y1) / 2), 0]} rotation={[0, Math.PI / 2, 0]}><primitive object={metal} attach="material" /></mesh>
      <group position={[sx + mm(WATCH.guard.out) - mm(0.3), cy, 0]}>
        <mesh rotation={[0, 0, -Math.PI / 2]} position={[cl / 2, 0, 0]} castShadow name="crown"><cylinderGeometry args={[cr, cr, cl, 48, 1]} /><primitive object={metal} attach="material" /></mesh>
        {Array.from({ length: 36 }, (_, i) => { const a = i / 36 * Math.PI * 2
          return <mesh key={i} position={[cl / 2, Math.cos(a) * cr, Math.sin(a) * cr]} rotation={[a, 0, 0]}><boxGeometry args={[cl * 0.9, mm(0.35), mm(0.35)]} /><primitive object={metal} attach="material" /></mesh> })}
        <mesh rotation={[0, 0, -Math.PI / 2]} position={[cl + E, 0, 0]}><ringGeometry args={[cr * 0.55, cr * 0.7, 32]} /><primitive object={orange} attach="material" /></mesh>
      </group>
      <mesh geometry={g.pill} position={[sx + mm(0.6), mm(WATCH.side.y), 0]} scale={[mm(1.2), mm(WATCH.side.h) / 3, mm(WATCH.side.w) / 2]}><primitive object={metal} attach="material" /></mesh>
      {/* left side: the orange Action button and the speaker holes above it */}
      <mesh geometry={g.pill} position={[-sx - mm(0.5), mm(WATCH.action.y), 0]} scale={[mm(1.4), mm(WATCH.action.h) / 3, mm(WATCH.action.w) / 2]} name="action-button"><primitive object={orange} attach="material" /></mesh>
      {Array.from({ length: 7 }, (_, i) => <mesh key={i} position={[-sx - E, mm(16 + (i % 2) * 1.4), mm(-2.4 + i * 0.8)]} rotation={[0, -Math.PI / 2, 0]}><circleGeometry args={[mm(0.45), 12]} /><meshBasicMaterial color="#111" /></mesh>)}
      <mesh geometry={bandG} castShadow receiveShadow name="band"><primitive object={strap} attach="material" /></mesh>
    </group>)
}
export default memo(WatchUltra)
