import { memo, useEffect, useMemo, type ReactNode } from 'react'
import * as THREE from 'three'
import type { DeviceProps } from '../types'
import { fitTexture, DEFAULT_LOGO_TINT } from './shared'
import { frostRoughness, brushedRoughness, smudgeRoughness } from './materials'
import { Pressable, RearLens, LensStack, slab, rrect, smoothNormals } from './IPhonePro'
import type { IPadSpec } from './ipadSpecs'
// Parametric iPad family: unofficial procedural model, not affiliated with Apple.
// Every measurement comes from a pure data spec (./ipadSpecs.ts); this file only turns it into geometry.
// Built like the iPhone 18 Pro (same lens, button, press and antenna band treatment). 1 unit = 100 mm before the
// view scale; origin at the body centre, display faces +z, top is +y.
const mm = (v: number) => v / 100
const all = (r: number) => [r, r, r, r]
const E = 0.0003

export const IPAD_FINISHES: Record<string, { label: string; frame: string; back: string }> = {
  spaceblack: { label: 'Space Black', frame: '#2b2c2f', back: '#2b2c2f' },
  spacegrey: { label: 'Space Grey', frame: '#3a3b3e', back: '#3a3b3e' },
  silver: { label: 'Silver', frame: '#dcdddf', back: '#dcdddf' },
  blue: { label: 'Blue', frame: '#a9b6c6', back: '#a9b6c6' },
  purple: { label: 'Purple', frame: '#c3b8cc', back: '#c3b8cc' },
  starlight: { label: 'Starlight', frame: '#e3ddd2', back: '#e3ddd2' },
}
export const IPAD_PRO_FINISHES = { spaceblack: IPAD_FINISHES.spaceblack, silver: IPAD_FINISHES.silver }
export const IPAD_PRO6_FINISHES = { spacegrey: IPAD_FINISHES.spacegrey, silver: IPAD_FINISHES.silver }
export const IPAD_MINI_FINISHES = { spacegrey: IPAD_FINISHES.spacegrey, blue: IPAD_FINISHES.blue, purple: IPAD_FINISHES.purple, starlight: IPAD_FINISHES.starlight }

const geoCache = new Map<string, THREE.BufferGeometry>()
const geoOnce = (k: string, f: () => THREE.BufferGeometry) => { let g = geoCache.get(k); if (!g) geoCache.set(k, g = f()); return g }
if (import.meta.hot) {
  const w = globalThis as unknown as { __omIpadFree?: () => void }
  const prev = w.__omIpadFree; if (prev) setTimeout(prev, 1000)
  w.__omIpadFree = () => { geoCache.forEach(g => g.dispose()); geoCache.clear() }
}
// Buttons: pill in side view, extruded out of the frame along local +x, 0.3 mm sunk so no gap shows (as on the 18 Pro).
const SINK = mm(0.3)
const btnGeo = (len: number, wz: number, prot: number) => geoOnce(`ipbtn${len}|${wz}|${prot}`, () => {
  const bev = Math.min(prot * 0.45, mm(0.2))
  const g = new THREE.ExtrudeGeometry(rrect(wz - bev * 2, len - bev * 2, all(wz / 2 - bev)), { depth: prot + SINK - bev, bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelSegments: 10, curveSegments: 32 })
  g.translate(0, 0, -SINK); g.rotateY(Math.PI / 2); return smoothNormals(g)
})

function IPad({ spec: s, texture, mediaAspect, opts }: DeviceProps & { spec: IPadSpec }) {
  const fin = (IPAD_FINISHES as Record<string, { frame: string; back: string }>)[opts.finish] ?? IPAD_FINISHES.silver
  const W = mm(s.body.w), H = mm(s.body.h), T = mm(s.body.t), CR = mm(s.body.cornerR), EDGE = mm(s.body.edge)
  // built at true size; the scene applies the tablet's view scale (or the shared true-scale factor), see deviceScale in App
  const view = 1
  const ty = (y: number) => H / 2 - mm(y), bx = (x: number) => W / 2 - mm(x), fx = (x: number) => -W / 2 + mm(x)
  const zf = T / 2, zb = -T / 2
  const aspect = s.px.w / s.px.h
  const g = useMemo(() => {
    const k = s.id
    const body = geoOnce(`${k}body`, () => slab(rrect(W, H, all(CR)), T, EDGE))
    const glass = geoOnce(`${k}glass`, () => new THREE.ShapeGeometry(rrect(W - EDGE * 1.6, H - EDGE * 1.6, all(CR - EDGE * 0.8)), 64))
    const screen = geoOnce(`${k}screen`, () => {
      const aw = mm(s.active.w), ah = mm(s.active.h)
      const sg = new THREE.ShapeGeometry(rrect(aw, ah, all(mm(s.active.r))), 32), p = sg.attributes.position, uv = sg.attributes.uv
      for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / aw + 0.5, p.getY(i) / ah + 0.5)
      uv.needsUpdate = true; return sg
    })
    const back = geoOnce(`${k}back`, () => new THREE.ShapeGeometry(rrect(W - EDGE * 1.6, H - EDGE * 1.6, all(CR - EDGE * 0.8)), 64))
    let turret: THREE.BufferGeometry | null = null, turretTop: THREE.BufferGeometry | null = null
    if (s.turret) {
      const t = s.turret, bw = mm(t.base[1] - t.base[0]), tw = mm(t.top[1] - t.top[0])
      turret = geoOnce(`${k}tur`, () => slab(rrect(bw, bw, all(mm(t.r))), mm(t.rise) * 2, mm(Math.min(t.rise * 0.8, 0.6)), 10))
      turretTop = geoOnce(`${k}turtop`, () => slab(rrect(tw, tw, all(mm(t.r - (t.top[0] - t.base[0])))), mm(t.topRise) * 2 + mm(0.02), mm(t.topRise * 0.9), 4))
    }
    return { body, glass, screen, back, turret, turretTop }
  }, [s, W, H, T, CR, EDGE])
  useMemo(() => fitTexture(texture, mediaAspect, aspect), [texture, mediaAspect, aspect])

  const darkF = new THREE.Color(fin.frame).getHSL({ h: 0, s: 0, l: 0 }).l < 0.35
  const bR = brushedRoughness(), fR = frostRoughness(), sR = smudgeRoughness()
  const grain = useMemo(() => { if (!bR) return null; const t = bR.clone(); t.repeat.set(bR.repeat.x * 8, bR.repeat.y * 8); return t }, [bR])
  // One bead-blasted aluminium material for the whole unibody, buttons and turret (iPads have an aluminium back).
  const alu = useMemo(() => new THREE.MeshPhysicalMaterial({ color: fin.frame, metalness: 0.3, roughness: 0.62, roughnessMap: grain,
    envMapIntensity: darkF ? 0.4 : 0.26, specularIntensity: darkF ? 0.3 : 0.35 }), [fin.frame, darkF, grain])
  const backMat = useMemo(() => new THREE.MeshPhysicalMaterial({ color: fin.back, metalness: 0.3, roughness: 0.66, roughnessMap: fR,
    envMapIntensity: darkF ? 0.4 : 0.26, specularIntensity: darkF ? 0.3 : 0.35, polygonOffset: true, polygonOffsetFactor: -1 }), [fin.back, darkF, fR])
  useEffect(() => () => { alu.dispose(); backMat.dispose() }, [alu, backMat])
  const metal = <primitive object={alu} attach="material" />
  const black = <meshPhysicalMaterial color="#020203" roughness={1} roughnessMap={sR} clearcoat={1} clearcoatRoughness={0.04} />

  // Antenna splits: moulded resin, the frame colour pulled toward neutral grey (low contrast, like the 18 Pro).
  // Drawn as an overlay on the body itself, kept to the band ranges on the frame faces only.
  const bandMat = useMemo(() => {
    const col = new THREE.Color(fin.frame).lerp(new THREE.Color('#77797e'), darkF ? 0.07 : 0.3)
    const m = new THREE.MeshPhysicalMaterial({ color: col, metalness: 0.05, roughness: 0.62, clearcoat: 0.25, clearcoatRoughness: 0.4,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, depthFunc: THREE.LessEqualDepth })
    const top = s.bands.top.slice(0, 4).map(([a, b]) => new THREE.Vector2(fx(a), fx(b)))
    const side = s.bands.side.slice(0, 4).map(([a, b]) => new THREE.Vector2(ty(b), ty(a)))
    while (top.length < 4) top.push(new THREE.Vector2(9, 9)); while (side.length < 4) side.push(new THREE.Vector2(9, 9))
    m.onBeforeCompile = sh => {
      sh.uniforms.uTop = { value: top }; sh.uniforms.uSide = { value: side }
      sh.vertexShader = 'varying vec3 vDev;\nvarying vec3 vDevN;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvDev = position; vDevN = objectNormal;')
      sh.fragmentShader = 'uniform vec2 uTop[4];\nuniform vec2 uSide[4];\nvarying vec3 vDev;\nvarying vec3 vDevN;\n' + sh.fragmentShader.replace('void main() {',
        `void main() {
  bool keep = false;
  if (abs(vDevN.z) < 0.93) {
    for (int i = 0; i < 4; i++) {
      if (vDevN.y > 0.5 && vDev.x > uTop[i].x && vDev.x < uTop[i].y) keep = true;
      if (abs(vDevN.x) > 0.5 && vDev.y > uSide[i].x && vDev.y < uSide[i].y) keep = true;
    }
  }
  if (!keep) discard;`)
    }
    m.customProgramCacheKey = () => `om-ipad-band-${s.id}`
    return m
  }, [fin.frame, darkF, s, W, H])
  useEffect(() => () => bandMat.dispose(), [bandMat])
  const hasBands = s.bands.top.length + s.bands.side.length > 0

  const press = (pos: [number, number, number], rot: [number, number, number], len: number, key: string) => (
    <Pressable key={key} depth={mm(0.3)} position={pos} rotation={rot}>
      <mesh geometry={btnGeo(mm(len), mm(s.btn.w), mm(s.btn.protrude))} castShadow userData={{ sketchHull: true }}>{metal}</mesh></Pressable>)
  // Top edge: rotate local +x (outward) to +y; the button length then runs across the width.
  const topBtn = (xFromLeft: number, len: number, key: string) => press([fx(xFromLeft + len / 2), H / 2, 0], [0, 0, Math.PI / 2], len, key)
  const sideBtn = (yTop: number, len: number, key: string) => press([W / 2, ty(yTop + len / 2), 0], [0, 0, 0], len, key)
  const v = s.vol
  const buttons = [
    topBtn(s.body.w - s.topBtn.fromRight - s.topBtn.len, s.topBtn.len, 'top'),
    ...(v.where === 'top' ? [topBtn(v.up, v.len, 'vup'), topBtn(v.down, v.len, 'vdn')] : [sideBtn(v.up, v.len, 'vup'), sideBtn(v.down, v.len, 'vdn')]),
  ]

  const zT = s.turret ? zb - mm(s.turret.rise + s.turret.topRise) : s.roundTurret ? zb : zb
  const ring = mm(s.lensRing)
  const holes = (ranges: [number, number][], n: number) => ranges.flatMap(([a, b]) => Array.from({ length: n }, (_, i) => a + (b - a) * (n === 1 ? 0.5 : i / (n - 1))))
  const hole = (x: number, key: string) => <mesh key={key} position={[fx(x), 0, 0]}><circleGeometry args={[mm(s.speakers.d / 2), 16]} /><meshBasicMaterial color="#050506" side={THREE.DoubleSide} /></mesh>
  const disc = (l: { bx: number; y: number; d: number }, z: number, mat: ReactNode, key: string) => (
    <mesh key={key} position={[bx(l.bx), ty(l.y), z]} rotation={[0, Math.PI, 0]}><circleGeometry args={[mm(l.d / 2), 40]} />{mat}</mesh>)
  const fc = s.frontCam

  return (
    <group scale={view}>
      <mesh geometry={g.body} castShadow name="ipad-body" userData={{ sketchHull: true }}>{metal}</mesh>
      {hasBands && <mesh geometry={g.body} renderOrder={1} material={bandMat} userData={{ sketchHide: true }} />}
      {/* front: black cover glass edge to edge, the display inside the drawn active area */}
      <mesh geometry={g.glass} position={[0, 0, zf + E]} name="ip18-cover">{black}</mesh>
      <mesh geometry={g.screen} position={[0, 0, zf + E * 2]} name="screen">
        {texture ? <meshBasicMaterial key="tex" map={texture} toneMapped={false} /> : <meshBasicMaterial key="idle" color="#07080b" />}
      </mesh>
      <mesh geometry={g.screen} position={[0, 0, zf + E * 4.5]} renderOrder={10}>
        <meshPhysicalMaterial color="#000" roughness={1} specularIntensity={0.14} transparent blending={THREE.AdditiveBlending} depthWrite={false} polygonOffset polygonOffsetFactor={-8} /></mesh>
      <group position={[fx(fc.x), ty(fc.y), zf + E * 5]}><LensStack r={mm(fc.r)} order={4} /></group>
      {fc.extra?.map((c, i) => <mesh key={i} position={[fx(c.x), ty(c.y), zf + E * 5]}><circleGeometry args={[mm(c.r), 24]} /><meshBasicMaterial color="#0a0a0c" /></mesh>)}
      {/* back: one aluminium face, slightly finer bead blast than the frame */}
      <mesh geometry={g.back} position={[0, 0, zb - E]} rotation={[0, Math.PI, 0]} material={backMat} />
      {s.turret && g.turret && g.turretTop && (() => { const t = s.turret, c = (t.base[0] + t.base[1]) / 2, ct = (t.top[0] + t.top[1]) / 2
        return <>
          <mesh geometry={g.turret} position={[bx(c), ty(c), zb]} castShadow userData={{ sketchHull: true }}>{metal}</mesh>
          {/* flat glass top of the module, a shade glossier than the metal */}
          <mesh geometry={g.turretTop} position={[bx(ct), ty(ct), zb - mm(t.rise)]}>
            <meshPhysicalMaterial color={fin.back} metalness={0.2} roughness={0.25} clearcoat={1} clearcoatRoughness={0.05} envMapIntensity={0.7} /></mesh>
        </> })()}
      {s.roundTurret && (() => { const r = s.roundTurret
        return <mesh position={[bx(r.bx), ty(r.y), zb - mm(r.baseRise) / 2]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[mm(r.baseD / 2) + mm(0.1), mm(r.baseD / 2), mm(r.baseRise), 64]} />{metal}</mesh> })()}
      {/* rear lenses: the 18 Pro lens build, ring diameter from the drawing (assumed where it is only a keepout) */}
      {s.lenses.map((l, i) => s.roundTurret
        ? <group key={i} position={[bx(l.bx), ty(l.y), zb - mm(s.roundTurret.baseRise)]}><RearLens d={mm(s.roundTurret.d)} rise={mm(s.roundTurret.rise - s.roundTurret.baseRise)} frame={fin.frame} /></group>
        : <group key={i} position={[bx(l.bx), ty(l.y), zT]}><RearLens d={ring} rise={mm(0.55)} frame={fin.frame} /></group>)}
      {disc(s.flash, zT - E * 3, <meshStandardMaterial color="#efe6cf" roughness={0.3} />, 'flash')}
      {s.lidar && disc(s.lidar, zT - E * 3, black, 'lidar')}
      {s.rearAls && disc(s.rearAls, zT - E * 3, black, 'als')}
      {disc(s.rearMic, zT - E * 3, <meshBasicMaterial color="#111" />, 'mic')}
      {s.smartConnector && (() => { const c = s.smartConnector
        return [-1, 0, 1].map(k => <group key={k} position={[mm(c.pitch * k), -H / 2 + mm(c.y), zb - E * 3]} rotation={[0, Math.PI, 0]}>
          <mesh><circleGeometry args={[mm(c.open / 2), 32]} /><meshStandardMaterial color={fin.frame} metalness={0.5} roughness={0.5} /></mesh>
          <mesh position={[0, 0, E]}><circleGeometry args={[mm(c.d / 2), 32]} /><meshStandardMaterial color="#b9a46a" metalness={0.9} roughness={0.3} /></mesh>
        </group>) })()}
      {buttons}
      {/* top edge speaker holes and bottom edge USB-C plus speakers, centred in the thickness */}
      <group position={[0, H / 2 + E, 0]} rotation={[-Math.PI / 2, 0, 0]}>{holes(s.speakers.top, s.speakers.n).map((x, i) => hole(x, `t${i}`))}</group>
      <group position={[0, -H / 2 - E, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <mesh><shapeGeometry args={[rrect(mm(s.usbc.w), mm(s.usbc.h), all(mm(s.usbc.h / 2))), 24]} /><meshBasicMaterial color="#050506" side={THREE.DoubleSide} /></mesh>
        {holes(s.speakers.bottom, s.speakers.n).map((x, i) => hole(x, `b${i}`))}
      </group>
      {opts.logo && (
        <mesh position={[0, 0, zb - E * 4]} rotation={[0, Math.PI, 0]}>
          <planeGeometry args={[opts.logoSize / view, opts.logoSize / view / opts.logo.aspect]} />
          <meshPhysicalMaterial color={opts.logoTint !== DEFAULT_LOGO_TINT ? opts.logoTint : fin.back} metalness={0.55} roughness={0.04} clearcoat={1} clearcoatRoughness={0.02} envMapIntensity={1.6}
            alphaMap={opts.logo.mask} transparent depthWrite={false} polygonOffset polygonOffsetFactor={-2} />
        </mesh>)}
    </group>
  )
}
const Base = memo(IPad)
export default Base
