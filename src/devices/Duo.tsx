import { useMemo } from 'react'
import * as THREE from 'three'
import type { DeviceProps } from '../types'
import { fitTexture } from './shared'
// iPhone Duo: unofficial procedural model. Overall size and screen sizes from Apple's published specs;
// details (bezels, island, buttons, camera) are estimates from Apple's product imagery.
// Scale: 1 unit = 100 mm. Open 164.6 x 117.8 x 5.2 mm, closed 84.1 x 117.8 x 11.3 mm.
// Layout: right half is fixed (camera + logo on its back); left half swings on the hinge at x = 0
// and carries the outer display on its back. Free edges (buttons) are at x = +W when closed.
const W = 0.823, H = 1.178, T = 0.052, GAP = 0.0012
const CR = 0.105      // outer body corner radius, about 10.5 mm
const HR = 0.008      // body corner radius at the hinge
export const INNER_PX = { w: 2670, h: 1878 }
export const OUTER_PX = { w: 1398, h: 2034 }
export const INNER_ASPECT = INNER_PX.w / INNER_PX.h
export const OUTER_ASPECT = OUTER_PX.w / OUTER_PX.h
const SH = 1.11, SW = (SH * INNER_ASPECT) / 2   // one half of the inner screen (bezel about 3.4 mm)
const SCR = 0.072                                // inner screen outer corner radius
const OH = 1.122, OW = OH * OUTER_ASPECT, OCR = 0.085
const ISL = { w: 0.19, h: 0.058 }                // Dynamic Island pill, about 19 x 5.8 mm
export const FINISHES = {
  night: { frame: '#3a3f4b', back: '#1d212b', label: 'Night Sky' },
  star: { frame: '#d8d4cc', back: '#ece9e3', label: 'Star White' },
}

/** Rounded rect shape with per-corner radii [bl, br, tr, tl], centred on (cx, cy). */
function rrect(w: number, h: number, [bl, br, tr, tl]: number[], cx = 0, cy = 0) {
  const s = new THREE.Shape(), x = cx - w / 2, y = cy - h / 2
  s.moveTo(x + bl, y); s.lineTo(x + w - br, y); s.quadraticCurveTo(x + w, y, x + w, y + br)
  s.lineTo(x + w, y + h - tr); s.quadraticCurveTo(x + w, y + h, x + w - tr, y + h)
  s.lineTo(x + tl, y + h); s.quadraticCurveTo(x, y + h, x, y + h - tl)
  s.lineTo(x, y + bl); s.quadraticCurveTo(x, y, x + bl, y); return s
}
function flat(shape: THREE.Shape, w: number, h: number, u0 = 0, u1 = 1, cx = 0) {
  const g = new THREE.ShapeGeometry(shape, 20), p = g.attributes.position, uv = g.attributes.uv
  for (let i = 0; i < p.count; i++) uv.setXY(i, u0 + ((p.getX(i) - cx) / w + 0.5) * (u1 - u0), p.getY(i) / h + 0.5)
  uv.needsUpdate = true; return g
}
/** Body slab with chamfered (bevelled) titanium edge, centred in z. */
function slab(shape: THREE.Shape, depth: number, bevel: number) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: depth - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 3, curveSegments: 24 })
  g.translate(0, 0, -(depth - bevel * 2) / 2); return g
}
const pill = (w: number, h: number) => rrect(w, h, [h / 2, h / 2, h / 2, h / 2])
const E = 0.0004 // z separation between stacked flat layers

function Overlay({ geo, z, color = '#000', order = 2 }: { geo: THREE.BufferGeometry; z: number; color?: string; order?: number }) {
  return <mesh geometry={geo} position={[0, 0, z]} renderOrder={order}>
    <meshBasicMaterial color={color} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} />
  </mesh>
}

export default function Duo({ texture, mediaAspect, opts }: DeviceProps) {
  const f = FINISHES[opts.finish]
  const g = useMemo(() => {
    // Right half spans x 0..W, left half spans -W..0 (in its own frame before swinging).
    const rightBody = slab(rrect(W, H, [HR, CR, CR, HR], W / 2), T, 0.006)
    const leftBody = slab(rrect(W, H, [CR, HR, HR, CR], -W / 2), T, 0.006)
    const bezelR = flat(rrect(W - 0.004, H - 0.004, [HR, CR - 0.004, CR - 0.004, HR], W / 2), W, H, 0, 1, W / 2)
    const bezelL = flat(rrect(W - 0.004, H - 0.004, [CR - 0.004, HR, HR, CR - 0.004], -W / 2), W, H, 0, 1, -W / 2)
    const scrR = flat(rrect(SW, SH, [0.0005, SCR, SCR, 0.0005], SW / 2), SW, SH, 0.5, 1, SW / 2)
    const scrL = flat(rrect(SW, SH, [SCR, 0.0005, 0.0005, SCR], -SW / 2), SW, SH, 0, 0.5, -SW / 2)
    const outer = flat(rrect(OW, OH, [OCR, OCR, OCR, OCR]), OW, OH)
    const island = new THREE.ShapeGeometry(pill(ISL.w, ISL.h), 16)
    const udc = new THREE.CircleGeometry(0.011, 24)
    return { rightBody, leftBody, bezelR, bezelL, scrR, scrL, outer, island, udc }
  }, [])
  const innerTex = opts.screen === 'inner' ? texture : null
  const outerTex = opts.screen === 'outer' ? texture : null
  useMemo(() => fitTexture(texture, mediaAspect, opts.screen === 'inner' ? INNER_ASPECT : OUTER_ASPECT), [texture, mediaAspect, opts.screen])
  const swing = THREE.MathUtils.degToRad(180 - opts.fold)
  const shiftX = (W / 2) * (1 - opts.fold / 180)
  const frameMat = <meshPhysicalMaterial color={f.frame} metalness={0.9} roughness={0.28} clearcoat={0.3} />
  const glassBack = <meshPhysicalMaterial color={f.back} metalness={0.1} roughness={0.55} clearcoat={0.6} clearcoatRoughness={0.4} />
  const screenMat = (tex: THREE.Texture | null) => tex
    ? <meshBasicMaterial key="tex" color="#ffffff" map={tex} toneMapped={false} />
    : <meshBasicMaterial key="idle" color="#07080b" />
  const zf = T / 2 + E          // front face layers
  // Free edge buttons (right half, x = W, viewed with the outer screen facing you they sit on the right).
  const btn = (y: number, len: number, key: string, extra = 0) => (
    <mesh key={key} position={[W + 0.0015 + extra / 2, y, 0]} castShadow>
      <boxGeometry args={[0.006 + extra, len, T * 0.42]} />{frameMat}
    </mesh>)
  const logo = opts.logo
  return (
    <group position={[-shiftX, 0, 0]}>
      {/* ---------- right half (fixed) ---------- */}
      <mesh geometry={g.rightBody} castShadow>{frameMat}</mesh>
      <mesh geometry={g.bezelR} position={[0, 0, zf]}><meshPhysicalMaterial color="#050506" roughness={0.12} clearcoat={1} /></mesh>
      <mesh geometry={g.scrR} position={[0, 0, zf + E]}>{screenMat(innerTex)}</mesh>
      {/* inner Dynamic Island: top centre of the right half's screen area as shown in Apple imagery */}
      <group position={[SW / 2, SH / 2 - 0.035 - ISL.h / 2, 0]}><Overlay geo={g.island} z={zf + E * 3} /></group>
      {/* back glass */}
      <mesh position={[0, 0, -T / 2 - E]} rotation={[0, Math.PI, 0]}>
        <shapeGeometry args={[rrect(W - 0.004, H - 0.004, [CR - 0.004, HR, HR, CR - 0.004], -W / 2), 24]} />{glassBack}
      </mesh>
      {/* camera plateau: vertical pill near the top outer corner, two lenses + flash */}
      <group position={[W - 0.17, H / 2 - 0.25, -T / 2]}>
        <mesh rotation={[Math.PI, 0, 0]}><extrudeGeometry args={[pill(0.2, 0.39), { depth: 0.006, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 3, curveSegments: 32 }]} />{glassBack}</mesh>
        {[0.095, -0.095].map(y => (
          <group key={y} position={[0, y, -0.004]}>
            <mesh rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.07, 0.072, 0.014, 48]} />{frameMat}</mesh>
            <mesh position={[0, 0, -0.0072]} rotation={[Math.PI, 0, 0]}><circleGeometry args={[0.058, 48]} /><meshPhysicalMaterial color="#07080b" roughness={0.05} clearcoat={1} /></mesh>
            <mesh position={[0, 0, -0.0074]} rotation={[Math.PI, 0, 0]}><ringGeometry args={[0.03, 0.04, 48]} /><meshPhysicalMaterial color="#1a2340" metalness={0.6} roughness={0.1} /></mesh>
          </group>))}
        <mesh position={[0.0, 0, -0.0085]} rotation={[Math.PI, 0, 0]}><circleGeometry args={[0.016, 24]} /><meshStandardMaterial color="#f1e7cf" roughness={0.3} /></mesh>
      </group>
      {/* logo spot: centre of the right half's back; user-supplied art only */}
      {logo && (
        <mesh position={[W / 2, 0, -T / 2 - E * 3]} rotation={[0, Math.PI, 0]}>
          <planeGeometry args={[opts.logoSize, opts.logoSize / logo.aspect]} />
          <meshPhysicalMaterial color={opts.logoTint} metalness={0.95} roughness={0.12} clearcoat={1}
            alphaMap={logo.mask} bumpMap={logo.mask} bumpScale={4} transparent depthWrite={false} polygonOffset polygonOffsetFactor={-2} />
        </mesh>)}
      {/* free-edge controls: volume up/down, side button with Touch ID, Camera Control */}
      {btn(H / 2 - 0.2, 0.09, 'vu')}
      {btn(H / 2 - 0.31, 0.09, 'vd')}
      <mesh position={[W + 0.0018, H / 2 - 0.47, 0]}><boxGeometry args={[0.0065, 0.15, T * 0.46]} />
        <meshPhysicalMaterial color={f.frame} metalness={0.6} roughness={0.15} clearcoat={1} /></mesh>
      <mesh position={[W + 0.0012, -H / 2 + 0.33, 0]}><boxGeometry args={[0.004, 0.11, T * 0.4]} />
        <meshPhysicalMaterial color="#9aa0aa" metalness={0.2} roughness={0.05} clearcoat={1} transmission={0.2} /></mesh>
      {/* USB-C on the bottom edge of the right half */}
      <mesh position={[W / 2, -H / 2 - 0.0005, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <shapeGeometry args={[pill(0.09, 0.028)]} /><meshBasicMaterial color="#050506" side={THREE.DoubleSide} />
      </mesh>
      {[-1, 1].flatMap(s => [0, 1, 2, 3].map(i => (
        <mesh key={`${s}${i}`} position={[W / 2 + s * (0.11 + i * 0.022), -H / 2 - 0.0005, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.006, 12]} /><meshBasicMaterial color="#050506" side={THREE.DoubleSide} /></mesh>)))}
      {/* hinge cover */}
      <mesh position={[0, 0, -0.004]}><cylinderGeometry args={[T / 2 + 0.002, T / 2 + 0.002, H - 0.012, 32, 1, false, Math.PI / 2, Math.PI]} />{frameMat}</mesh>
      {/* ---------- left half (swings) ---------- */}
      <group position={[0, 0, T / 2 + GAP]} rotation={[0, swing, 0]}>
        <group position={[0, 0, -T / 2 - GAP]}>
          <mesh geometry={g.leftBody} castShadow>{frameMat}</mesh>
          <mesh geometry={g.bezelL} position={[0, 0, zf]}><meshPhysicalMaterial color="#050506" roughness={0.12} clearcoat={1} /></mesh>
          <mesh geometry={g.scrL} position={[0, 0, zf + E]}>{screenMat(innerTex)}</mesh>
          {/* under-display FaceTime camera, barely visible */}
          <mesh geometry={g.udc} position={[-SW / 2, SH / 2 - 0.06, zf + E * 3]} renderOrder={2}>
            <meshBasicMaterial color="#000" transparent opacity={0.25} polygonOffset polygonOffsetFactor={-2} /></mesh>
          {/* outer display on the back, cover glass then screen */}
          <group position={[-W / 2, 0, -T / 2]} rotation={[0, Math.PI, 0]}>
            <mesh position={[0, 0, E]}><shapeGeometry args={[rrect(W - 0.03, H - 0.03, [HR, CR - 0.015, CR - 0.015, HR]), 24]} />
              <meshPhysicalMaterial color="#050506" roughness={0.12} clearcoat={1} /></mesh>
            <mesh geometry={g.outer} position={[0, 0, E * 2]}>{screenMat(outerTex)}</mesh>
            <group position={[0, OH / 2 - 0.035 - ISL.h / 2, 0]}><Overlay geo={g.island} z={E * 4} /></group>
          </group>
        </group>
      </group>
    </group>
  )
}
