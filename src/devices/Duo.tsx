import { useMemo } from 'react'
import * as THREE from 'three'
import { RoundedBox } from '@react-three/drei'
import type { DeviceProps } from '../types'
import { fitTexture } from './shared'
// iPhone Duo approximation: procedural, plausible proportions, not an official model.
// Right half stays put; left half swings on a vertical book hinge at x = 0.
// Scale: 1 unit = 100 mm. Proportions from Apple's published specs.
// Open 164.6 x 117.8 x 5.2 mm, closed 84.1 x 117.8 x 11.3 mm.
const W = 0.823, H = 1.178, T = 0.052, GAP = 0.001
// Inner 7.6 in, 2670 x 1878 px landscape when open (about 157.7 x 111 mm).
export const INNER_PX = { w: 2670, h: 1878 }
export const OUTER_PX = { w: 1398, h: 2034 }
export const INNER_ASPECT = INNER_PX.w / INNER_PX.h
const SH = 1.11, SW = (SH * INNER_ASPECT) / 2   // one half of the inner screen
const BEZ = W - SW
void BEZ
// Outer 5.4 in, 1398 x 2034 px portrait (about 77.1 x 112.2 mm) on the cover half.
export const OUTER_ASPECT = OUTER_PX.w / OUTER_PX.h
const OH = 1.122, OW = OH * OUTER_ASPECT
export const FINISHES = { night: { frame: '#2b2f3a', back: '#1b1e27', label: 'Night Sky' }, star: { frame: '#d9d6cf', back: '#efece6', label: 'Star White' } }

/** Rect with per-corner radii [bl, br, tr, tl], UVs mapped to u0..u1 across, 0..1 up. */
function panel(w: number, h: number, r: [number, number, number, number], u0: number, u1: number) {
  const s = new THREE.Shape(), x = -w / 2, y = -h / 2, [bl, br, tr, tl] = r
  s.moveTo(x + bl, y); s.lineTo(x + w - br, y); s.quadraticCurveTo(x + w, y, x + w, y + br)
  s.lineTo(x + w, y + h - tr); s.quadraticCurveTo(x + w, y + h, x + w - tr, y + h)
  s.lineTo(x + tl, y + h); s.quadraticCurveTo(x, y + h, x, y + h - tl)
  s.lineTo(x, y + bl); s.quadraticCurveTo(x, y, x + bl, y)
  const g = new THREE.ShapeGeometry(s, 16), p = g.attributes.position, uv = g.attributes.uv
  for (let i = 0; i < p.count; i++) uv.setXY(i, u0 + (p.getX(i) / w + 0.5) * (u1 - u0), p.getY(i) / h + 0.5)
  uv.needsUpdate = true; return g
}

function Screen({ geo, tex, pos, rotY = 0 }: { geo: THREE.BufferGeometry; tex: THREE.Texture | null; pos: [number, number, number]; rotY?: number }) {
  return <mesh geometry={geo} position={pos} rotation={[0, rotY, 0]}>
    {tex ? <meshBasicMaterial map={tex} toneMapped={false} /> : <meshBasicMaterial color="#14161c" />}
  </mesh>
}

export default function Duo({ texture, mediaAspect, opts }: DeviceProps) {
  const f = FINISHES[opts.finish]
  const g = useMemo(() => ({
    left: panel(SW, SH, [0.06, 0, 0, 0.06], 0, 0.5),
    right: panel(SW, SH, [0, 0.06, 0.06, 0], 0.5, 1),
    outer: panel(OW, OH, [0.07, 0.07, 0.07, 0.07], 0, 1),
  }), [])
  // Media goes to one screen; the other shows a dark idle screen.
  const innerTex = opts.screen === 'inner' ? texture : null
  const outerTex = opts.screen === 'outer' ? texture : null
  useMemo(() => fitTexture(texture, mediaAspect, opts.screen === 'inner' ? INNER_ASPECT : OUTER_ASPECT), [texture, mediaAspect, opts.screen])
  const swing = THREE.MathUtils.degToRad(180 - opts.fold)
  const shiftX = (W / 2) * (1 - opts.fold / 180)
  const body = (x: number) => (
    <RoundedBox args={[W, H, T]} radius={0.012} smoothness={4} position={[x, 0, 0]} castShadow>
      <meshStandardMaterial color={f.frame} metalness={0.85} roughness={0.32} />
    </RoundedBox>)
  const black = (x: number, z: number, w = W - 0.008, h = H - 0.008) => (
    <mesh position={[x, 0, z]}><planeGeometry args={[w, h]} /><meshStandardMaterial color="#040405" roughness={0.25} /></mesh>)
  return (
    <group position={[-shiftX, 0, 0]}>
      {/* right half (fixed) */}
      {body(W / 2)}
      {black(W / 2, T / 2 + 0.0005)}
      <Screen geo={g.right} tex={innerTex} pos={[SW / 2, 0, T / 2 + 0.001]} />
      <mesh position={[W / 2, 0, -T / 2 - 0.0005]} rotation={[0, Math.PI, 0]}><planeGeometry args={[W - 0.01, H - 0.01]} /><meshStandardMaterial color={f.back} metalness={0.2} roughness={0.55} /></mesh>
      {/* inner Dynamic Island */}
      <RoundedBox args={[0.2, 0.055, 0.003]} radius={0.0014} position={[SW / 2, SH / 2 - 0.055, T / 2 + 0.003]}><meshBasicMaterial color="#000" /></RoundedBox>
      {/* camera bump on right back */}
      <RoundedBox args={[0.26, 0.26, 0.016]} radius={0.05} position={[W - 0.2, H / 2 - 0.2, -T / 2 - 0.008]}>
        <meshStandardMaterial color={f.back} metalness={0.4} roughness={0.35} />
      </RoundedBox>
      {[[-0.055, 0.055], [0.055, -0.055]].map(([dx, dy], i) => (
        <mesh key={i} position={[W - 0.2 + dx, H / 2 - 0.2 + dy, -T / 2 - 0.017]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.042, 0.042, 0.01, 32]} /><meshStandardMaterial color="#0b0c10" metalness={0.6} roughness={0.15} />
        </mesh>))}
      {/* hinge spine */}
      <mesh position={[0, 0, T / 2 - 0.002]}><cylinderGeometry args={[T / 2 + 0.003, T / 2 + 0.003, H - 0.02, 24]} /><meshStandardMaterial color={f.frame} metalness={0.9} roughness={0.3} /></mesh>
      {/* left half swings about the hinge axis at front face */}
      <group position={[0, 0, T / 2 + GAP]} rotation={[0, swing, 0]}>
        <group position={[0, 0, -T / 2 - GAP]}>
          {body(-W / 2)}
          {black(-W / 2, T / 2 + 0.0005)}
          <Screen geo={g.left} tex={innerTex} pos={[-SW / 2, 0, T / 2 + 0.001]} />
          {/* outer display on the back */}
          {black(-W / 2, -T / 2 - 0.0005, W - 0.03, H - 0.03)}
          <Screen geo={g.outer} tex={outerTex} pos={[-W / 2, 0, -T / 2 - 0.001]} rotY={Math.PI} />
          {/* outer Dynamic Island */}
          <RoundedBox args={[0.2, 0.055, 0.003]} radius={0.0014} position={[-W / 2, OH / 2 - 0.055, -T / 2 - 0.003]}><meshBasicMaterial color="#000" /></RoundedBox>
          {/* inner under-display camera, faint */}
          <mesh position={[-SW / 2, SH / 2 - 0.05, T / 2 + 0.0015]}><circleGeometry args={[0.012, 20]} /><meshBasicMaterial color="#000" transparent opacity={0.35} /></mesh>
        </group>
      </group>
    </group>
  )
}
