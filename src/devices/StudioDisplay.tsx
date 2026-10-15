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
  tilt: { base: { w: 151, d: 172, t: 7, z0: 75 }, hinge: { y: 208, z: 12 }, foot: 140, arm: { w: 151, t: 9 } },
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
  // clockwise (a hole must wind against the outline, or the bevel offset pinches it into a teardrop)
  p.absarc(0, cy - h / 2 + r, r, 0, Math.PI, true); p.absarc(0, cy + h / 2 - r, r, Math.PI, 0, true); p.closePath(); return p }
/** Speaker grilles: real holes along the top and bottom edges, a staggered hex grid of 1.4 mm round holes (0.95 mm between
 * columns, columns alternating 3 and 2 holes over 5 rows 1.65 mm apart), the strip set toward the back face of the edge.
 * No CSG: instanced invisible caps mark the holes in the stencil buffer, the panel body skips those pixels and instanced
 * dark bores (seen from inside) show the depth. */
export const GRILLE = { col: 0.95, row: 1.65, r: 0.7, rows: 5, zc: -3.6, depth: 1.6, margin: 14 }
function grilleHoles(pw: number, ph: number) {
  const G = GRILLE, n = Math.floor((pw / mm(1) - 2 * G.margin) / G.col), out: [number, number, number][] = []
  for (const sy of [-1, 1]) for (let i = 0; i < n; i++) for (let r = i % 2; r < G.rows; r += 2)
    out.push([mm((i - (n - 1) / 2) * G.col), sy, mm(G.zc + (r - (G.rows - 1) / 2) * G.row)])
  return { out, y: ph / 2 }
}
function Grilles({ pw, ph }: { pw: number; ph: number }) {
  const { caps, bores } = useMemo(() => { const { out, y } = grilleHoles(pw, ph), G = GRILLE, r = mm(G.r), dp = mm(G.depth)
    const capM = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, stencilWrite: true, stencilRef: 1, stencilFunc: THREE.AlwaysStencilFunc, stencilZPass: THREE.ReplaceStencilOp })
    const boreM = new THREE.MeshStandardMaterial({ color: '#151517', roughness: 0.8, metalness: 0.1, side: THREE.BackSide, stencilWrite: true, stencilRef: 1, stencilFunc: THREE.EqualStencilFunc })
    const caps = new THREE.InstancedMesh(new THREE.CircleGeometry(r, 16), capM, out.length), bores = new THREE.InstancedMesh(new THREE.CylinderGeometry(r, r, dp, 16, 1, false), boreM, out.length)
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), X = new THREE.Vector3(1, 0, 0), one = new THREE.Vector3(1, 1, 1)
    out.forEach(([x, sy, z], k) => { q.setFromAxisAngle(X, -sy * Math.PI / 2)
      caps.setMatrixAt(k, m.compose(new THREE.Vector3(x, sy * (y + E), z), q, one)); bores.setMatrixAt(k, m.compose(new THREE.Vector3(x, sy * (y - dp / 2 + E / 2), z), q, one)) })
    caps.renderOrder = -1; caps.frustumCulled = bores.frustumCulled = false; caps.userData.sketchHide = bores.userData.sketchHide = true
    return { caps, bores } }, [pw, ph])
  useEffect(() => () => { for (const o of [caps, bores]) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); o.dispose() } }, [caps, bores])
  return <><primitive object={caps} /><primitive object={bores} /></>
}
const padCache = new Map<number, THREE.BufferGeometry>()
function padGeo(d: number, pw: number) { const k = d * 1000 + pw; let g = padCache.get(k); if (g) return g
  const r = pw / 2, L = d, sh = new THREE.Shape(); sh.absarc(0, -L / 2 + r, r, Math.PI, 0, false); sh.absarc(0, L / 2 - r, r, 0, Math.PI, false); sh.closePath()
  g = new THREE.ExtrudeGeometry(sh, { depth: mm(0.4), bevelEnabled: false, curveSegments: 24 }); g.rotateX(Math.PI / 2); g.translate(0, mm(0.05), 0); padCache.set(k, g); return g }
/** Flat foot plate, its front end rounded (seen from above) and its edges eased. */
function Foot({ w, d, z0, alu, t = mm(5), rear = mm(6), front = mm(28), edge = mm(1.6) }: { w: number; d: number; z0: number; alu: THREE.Material; t?: number; rear?: number; front?: number; edge?: number }) {
  front = Math.min(front, w / 2)
  // shape +y maps to world -z (the rear) after the rotation
  const geo = useMemo(() => { const b = slab(rrect(w, d, [front, front, rear, rear]), t, edge, 4); b.rotateX(-Math.PI / 2); return b }, [w, d, t, rear, front, edge])
  useEffect(() => () => geo.dispose(), [geo])
  // pads: pills 9% of the width, 3.5 mm in from the sides; each end sits as far out as it can while every point of its round
  // cap stays 1 mm inside the flat underside (inside the edge roundover and clear of that end's corner radius)
  const pr = w * 0.045, side = mm(3.5), cx = side + pr, gap = edge + mm(1)
  const endIn = (R: number) => { if (cx >= R) return gap; const dx = R - cx, room = R - gap - pr; const dy = room > dx ? Math.sqrt(room * room - dx * dx) : 0; return Math.max(gap, R - dy - pr) }
  const eF = endIn(front), eR = endIn(rear), L = d - eF - eR, zc = z0 - eF - L / 2
  return <group><mesh geometry={geo} position={[0, t / 2, z0 - d / 2]} castShadow receiveShadow userData={{ sketchHull: true }}><primitive object={alu} attach="material" /></mesh>
    {[-1, 1].map(sx => <mesh key={sx} geometry={padGeo(L, 2 * pr)} position={[sx * (w / 2 - cx), 0, zc]}><meshStandardMaterial color="#1c1c1e" roughness={0.85} /></mesh>)}</group>
}
/** Tilt stand: one wide aluminium sheet bent into an L. The flat foot runs back under the panel, bends up at its rear
 * end and the upright slants forward to the round hinge behind the panel (chrome caps on its ends). A round cable hole
 * with the black power plug sits in the upright just below the panel. */
function TiltStand({ f, alu, chrome }: { f: ReturnType<typeof sdFrame>; alu: THREE.Material; chrome: THREE.Material }) {
  const t = SD.tilt, w = mm(t.arm.w), tb = mm(13), tu = mm(9), rf = mm(22), rr = mm(12), b = f.j, a = f.p1.clone().setY(tb)
  // thick flat base; the upright meets it through a concave fillet on its front and back faces (one solid, no seams)
  const u = new THREE.Vector2(b.z - a.z, b.y - a.y).normalize(), n = new THREE.Vector2(u.y, -u.x)
  const sTop = mm(70), L = Math.hypot(b.z - a.z, b.y - a.y) - sTop, ang = Math.atan2(u.x, u.y)
  const mid = new THREE.Vector3(0, a.y + u.y * (sTop + L / 2), a.z + u.x * (sTop + L / 2))
  const slotY = (0.63 - 0.5) * (L + sTop) - sTop / 2 + mm(0)
  const fillet = useMemo(() => { const P = (s: number, side: number) => new THREE.Vector2(a.z + u.x * s + n.x * side * tu / 2, a.y + u.y * s + n.y * side * tu / 2)
    const centre = (side: number, R: number) => { const q = P(0, side), nn = n.clone().multiplyScalar(side); return new THREE.Vector2(q.x + (R - (tb + R - q.y) * nn.y) / nn.x, tb + R) }
    const Cf = centre(1, rf), Cr = centre(-1, rr), sh = new THREE.Shape(), lo = tb - mm(2)
    sh.moveTo(Cr.x, lo); sh.lineTo(Cr.x, tb)
    let r0 = -Math.PI / 2, r1 = Math.atan2(n.y, n.x); if (r1 < r0) r1 += Math.PI * 2; sh.absarc(Cr.x, Cr.y, rr, r0, r1, false)
    const Sr = P(sTop, -1), Sf = P(sTop, 1); sh.lineTo(Sr.x, Sr.y); sh.lineTo(Sf.x, Sf.y)
    let f0 = Math.atan2(-n.y, -n.x), f1 = -Math.PI / 2; if (f1 < f0) f1 += Math.PI * 2; sh.absarc(Cf.x, Cf.y, rf, f0, f1, false)
    sh.lineTo(Cf.x, lo); sh.closePath()
    const fw = w - mm(1.2), g = new THREE.ExtrudeGeometry(sh, { depth: fw, bevelEnabled: false, curveSegments: 32 }); g.translate(0, 0, -fw / 2); g.rotateY(-Math.PI / 2); return g }, [w, a.y, a.z, u.x, u.y, n.x, n.y, tu, tb, rf, rr, sTop])
  const upright = useMemo(() => { const sh = rrect(w, L, all(mm(0.5))); sh.holes.push(slotShape(slotY)); return slab(sh, tu, mm(0.6), 3) }, [w, L, tu, slotY])
  useEffect(() => () => { upright.dispose(); fillet.dispose() }, [upright, fillet])
  return <group>
    <Foot w={w} d={mm(t.base.d)} z0={mm(t.base.z0)} alu={alu} t={tb} rear={mm(13)} front={mm(13)} edge={mm(2)} />
    <mesh geometry={fillet} castShadow userData={{ sketchHull: true }}><primitive object={alu} attach="material" /></mesh>
    {/* upright: the sheet with the cable slot through it */}
    <group position={mid.toArray()} rotation={[ang, 0, 0]}>
      <mesh geometry={upright} castShadow userData={{ sketchHull: true }}><primitive object={alu} attach="material" /></mesh>
    </group>
    <mesh position={b.toArray()} rotation={[0, 0, Math.PI / 2]} castShadow><cylinderGeometry args={[mm(12), mm(12), w - mm(4), 40]} /><primitive object={alu} attach="material" /></mesh>
    {[-1, 1].map(sx => <mesh key={sx} position={[sx * (w / 2 - mm(1)), b.y, b.z]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[mm(11), mm(11), mm(2), 32]} /><primitive object={chrome} attach="material" /></mesh>)}
  </group>
}
/** Black braided power cable: plugs into the round port on the panel back, runs back through the stand's slot and curves down to the floor. */
function Cable({ f }: { f: ReturnType<typeof sdFrame> }) {
  const geo = useMemo(() => { const X = new THREE.Vector3(1, 0, 0), at = (y: number, z: number) => new THREE.Vector3(0, y, z).applyAxisAngle(X, f.rx).add(f.centre)
    const py = -mm(SD.panel.h) / 2 + mm(28), p0 = at(py, -PT / 2 - mm(14)), dir = at(py, -PT / 2 - 1).sub(at(py, -PT / 2)).normalize()
    const at2 = (k: number, y: number) => new THREE.Vector3(0, y, p0.z + dir.z * k)
    const pts = [p0, p0.clone().addScaledVector(dir, mm(70)), at2(mm(130), p0.y - mm(8)), at2(mm(190), p0.y * 0.7), at2(mm(225), p0.y * 0.35), at2(mm(238), mm(10)), at2(mm(240), -mm(40))]
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'centripetal'), 160, mm(3.5), 14, false) }, [f.rx, f.centre.y, f.centre.z])
  const mat = useMemo(() => { const c = document.createElement('canvas'); c.width = 64; c.height = 64; const x = c.getContext('2d')!; x.fillStyle = '#1a1a1c'; x.fillRect(0, 0, 64, 64)
    x.strokeStyle = '#2c2c30'; x.lineWidth = 3; for (let i = -64; i < 128; i += 8) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i + 64, 64); x.stroke(); x.beginPath(); x.moveTo(i + 64, 0); x.lineTo(i, 64); x.stroke() }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(220, 2); t.colorSpace = THREE.SRGBColorSpace
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.85 }) }, [])
  useEffect(() => () => { geo.dispose(); mat.map?.dispose(); mat.dispose() }, [geo, mat])
  return <mesh geometry={geo} castShadow><primitive object={mat} attach="material" /></mesh>
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
  // the panel body skips the grille holes marked in the stencil (see Grilles)
  const bodyAlu = useMemo(() => { const m = alu.clone(); m.stencilWrite = true; m.stencilRef = 1; m.stencilFunc = THREE.NotEqualStencilFunc; return m }, [alu])
  useEffect(() => () => bodyAlu.dispose(), [bodyAlu])
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
      {opts.sdCable && <Cable f={f0} />}
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
          <mesh geometry={g.body} castShadow name="sd-panel" userData={{ sketchHull: true }}><primitive object={bodyAlu} attach="material" /></mesh>
          <mesh geometry={g.glass} position={[0, 0, PT / 2 + E]}><meshBasicMaterial color="#050506" /></mesh>
          <mesh position={[0, ph / 2 - mm(6.6), PT / 2 + E * 2]}><circleGeometry args={[mm(1.6), 20]} /><meshStandardMaterial color="#1a1c22" roughness={0.1} /></mesh>
          <group position={[0, 0, -PT / 2 - E]} rotation={[0, Math.PI, 0]}>{[0, 1, 2, 3].map(port)}</group>
          {/* round power port on the back, 28 mm above the bottom edge: behind the stand's slot, or below the VESA adapter */}
          <group position={[0, -ph / 2 + mm(28), -PT / 2 - E * 2]} rotation={[0, Math.PI, 0]}>
            <mesh><circleGeometry args={[mm(17), 48]} /><meshStandardMaterial color="#0e0e10" roughness={0.45} /></mesh>
            <mesh position={[0, 0, E]}><ringGeometry args={[mm(7), mm(11), 40]} /><meshStandardMaterial color="#2a2a2e" roughness={0.3} /></mesh>
          </group>
          {logo}
          {/* plug in the port: a short black barrel, flush on the panel back */}
          {opts.sdCable && <mesh position={[0, -ph / 2 + mm(28), -PT / 2 - mm(7)]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[mm(10), mm(10.5), mm(14), 32]} /><meshStandardMaterial color="#141416" roughness={0.6} /></mesh>}
          {/* speaker grilles: real holes along the top and bottom edges, toward the back face */}
          <Grilles pw={pw} ph={ph} />
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
