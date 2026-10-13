import { useMemo } from 'react'
import * as THREE from 'three'
import type { DeviceProps } from '../types'
import { fitTexture } from './shared'
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
  const metal = <meshPhysicalMaterial color={f.frame} metalness={0.85} roughness={0.32} clearcoat={0.15} />
  const matte = <meshPhysicalMaterial color={f.back} metalness={0.15} roughness={0.6} clearcoat={0.5} clearcoatRoughness={0.45} />
  const black = <meshPhysicalMaterial color="#040405" roughness={0.08} clearcoat={1} />
  const zf = T / 2
  const zb = -T / 2
  const side = (x: number, cy: number, len: number, prot: number, wz: number, key: string, mat = metal) => (
    <mesh key={key} position={[x + Math.sign(x) * (prot / 2 - mm(0.3)), ty(cy), 0]}>
      <capsuleGeometry args={[wz / 2, len - wz, 6, 16]} />{mat}
    </mesh>)
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
        <meshBasicMaterial color="#000" polygonOffset polygonOffsetFactor={-3} polygonOffsetUnits={-3} /></mesh>
      {/* back: matte glass below the plateau */}
      <mesh geometry={g.backGlass} position={[0, -PLATEAU.h / 2 + mm(0.8), zb - E]} rotation={[0, Math.PI, 0]}>{matte}</mesh>
      {/* camera plateau, part of the aluminium unibody */}
      <mesh geometry={g.plateau} position={[0, ty(PLATEAU.h / 2 * 100), zb]}>{metal}</mesh>
      <mesh geometry={g.window} position={[bx(35.5), ty(23.99), zPlat - E]} rotation={[0, Math.PI, 0]}>
        <meshPhysicalMaterial color={f.back} roughness={0.5} clearcoat={0.6} metalness={0.1} /></mesh>
      {LENSES.map(([x, y]) => (
        <group key={`${x}-${y}`} position={[lensX(x), lensY(y), zPlat]}>
          <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, -LENS_RISE / 2]}><cylinderGeometry args={[LENS_D / 2, LENS_D / 2 + mm(0.4), LENS_RISE, 64]} />{metal}</mesh>
          <mesh position={[0, 0, -LENS_RISE - E]} rotation={[0, Math.PI, 0]}><circleGeometry args={[LENS_D / 2 - mm(1.1), 64]} />{black}</mesh>
          <mesh position={[0, 0, -LENS_RISE - E * 2]} rotation={[0, Math.PI, 0]}><ringGeometry args={[mm(2.6), mm(4.0), 48]} /><meshPhysicalMaterial color="#1c2440" metalness={0.6} roughness={0.1} /></mesh>
        </group>))}
      <mesh position={[bx(FLASH[0]), ty(FLASH[1]), zPlat - E * 3]} rotation={[0, Math.PI, 0]}><circleGeometry args={[mm(3.45), 40]} /><meshStandardMaterial color="#efe6cf" roughness={0.3} /></mesh>
      <mesh position={[bx(SENSOR[0]), ty(SENSOR[1]), zPlat - E * 3]} rotation={[0, Math.PI, 0]}><circleGeometry args={[mm(3.45), 40]} />{black}</mesh>
      <mesh position={[bx(MIC[0]), ty(MIC[1]), zPlat - E * 3]} rotation={[0, Math.PI, 0]}><circleGeometry args={[mm(0.575), 16]} /><meshBasicMaterial color="#111" /></mesh>
      {/* left side (seen from the front): Action button and volume, centres 34.28 / 48.43 / 62.63 mm from the top */}
      {side(-W / 2, 34.28, mm(7.8), mm(0.45), mm(2.66), 'act')}
      {side(-W / 2, 48.43, mm(11.8), mm(0.45), mm(2.66), 'vup')}
      {side(-W / 2, 62.63, mm(11.8), mm(0.45), mm(2.66), 'vdn')}
      {/* right side: side button (centre 55.53, 17.7 long) and flush sapphire Camera Control (centre 98.40, 17.1 long) */}
      {side(W / 2, 55.53, mm(17.7), mm(0.45), mm(2.66), 'side')}
      {side(W / 2, 98.40, mm(17.1), mm(0.1), mm(3.03), 'cc', <meshPhysicalMaterial color="#8d939c" metalness={0.3} roughness={0.05} clearcoat={1} />)}
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
          <meshPhysicalMaterial color={opts.logoTint} metalness={0.95} roughness={0.12} clearcoat={1}
            alphaMap={opts.logo.mask} transparent depthWrite={false} polygonOffset polygonOffsetFactor={-2} />
        </mesh>)}
    </group>
  )
}
