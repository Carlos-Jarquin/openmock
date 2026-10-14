import { memo, useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { DeviceProps } from '../types'
import { DEFAULT_LOGO_TINT } from './shared'
// iPhone Duo: unofficial procedural model. Overall size and screen sizes from Apple's published specs;
// details (bezels, island, buttons, camera) are estimates from Apple's product imagery.
// Scale: 1 unit = 100 mm. Open 164.6 x 117.8 x 5.2 mm, closed 84.1 x 117.8 x 11.3 mm.
// Layout (matches Apple's spec drawings, viewed from the inner screen): right half is fixed and has
// the camera plateau, logo spot, volume buttons (top edge), side button and Camera Control (free edge).
// Left half swings on the hinge at x = 0, carries the outer display on its back and the USB-C port.
// Measurements taken from apple.com/iphone-duo/specs drawings scaled to 164.6 x 117.8 mm.
const W = 0.823, H = 1.178, T = 0.052, GAP = 0.0012
const CR = 0.127      // outer body corner radius, about 12.7 mm
const HR = 0.008      // body corner radius at the hinge
export const INNER_PX = { w: 2670, h: 1878 }
export const OUTER_PX = { w: 1398, h: 2034 }
export const INNER_ASPECT = INNER_PX.w / INNER_PX.h
export const OUTER_ASPECT = OUTER_PX.w / OUTER_PX.h
const SH = 1.11, SW = (SH * INNER_ASPECT) / 2   // one half of the inner screen (bezel about 3.4 mm)
const SCR = 0.113                                // inner screen outer corner radius, about 11.3 mm
const OH = 1.122, OW = OH * OUTER_ASPECT, OCR = 0.105
const ISL = { w: 0.056, h: 0.085 }               // outer Dynamic Island: vertical pill near the top free corner
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
const pill = (w: number, h: number) => { const r = Math.min(w, h) / 2; return rrect(w, h, [r, r, r, r]) }
const E = 0.0004 // z separation between stacked flat layers

function Overlay({ geo, z, color = '#000', order = 2 }: { geo: THREE.BufferGeometry; z: number; color?: string; order?: number }) {
  return <mesh geometry={geo} position={[0, 0, z]} renderOrder={order}>
    <meshBasicMaterial color={color} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} />
  </mesh>
}

function Duo({ texture, mediaAspect, opts, textureOuter, mediaAspectOuter }: DeviceProps) {
  const f = FINISHES[opts.finish as keyof typeof FINISHES] ?? FINISHES.night
  const g = useMemo(() => {
    // Right half spans x 0..W, left half spans -W..0 (in its own frame before swinging).
    const rightBody = slab(rrect(W, H, [HR, CR, CR, HR], W / 2), T, 0.006)
    const leftBody = slab(rrect(W, H, [CR, HR, HR, CR], -W / 2), T, 0.006)
    // bezels run right up to the hinge line (square there) so the open device has no notch or strip between halves
    const bezelR = flat(rrect(W - 0.002, H - 0.004, [0.0003, CR - 0.004, CR - 0.004, 0.0003], W / 2 - 0.001), W, H, 0, 1, W / 2)
    const bezelL = flat(rrect(W - 0.002, H - 0.004, [CR - 0.004, 0.0003, 0.0003, CR - 0.004], -W / 2 + 0.001), W, H, 0, 1, -W / 2)
    // the flat screen halves stop FC short of the hinge; the bent fold strip (built per frame) joins them
    const hw = SW - FC, uF = FC / (2 * SW)
    const scrR = flat(rrect(hw, SH, [0.0001, SCR, SCR, 0.0001], FC + hw / 2), hw, SH, 0.5 + uF, 1, FC + hw / 2)
    const scrL = flat(rrect(hw, SH, [SCR, 0.0001, 0.0001, SCR], -FC - hw / 2), hw, SH, 0, 0.5 - uF, -FC - hw / 2)
    const outer = flat(rrect(OW, OH, [OCR, OCR, OCR, OCR]), OW, OH)
    const island = new THREE.ShapeGeometry(pill(ISL.w, ISL.h), 16)
    const udc = new THREE.CircleGeometry(0.014, 24)
    return { rightBody, leftBody, bezelR, bezelL, scrR, scrL, outer, island, udc }
  }, [])
  useEffect(() => () => Object.values(g).forEach(x => x.dispose()), [g])
  const frameMat = <meshPhysicalMaterial color={f.frame} metalness={0.9} roughness={0.28} clearcoat={0.3} />
  const glassBack = <meshPhysicalMaterial color={f.back} metalness={0.1} roughness={0.55} clearcoat={0.6} clearcoatRoughness={0.4} />
  // The fold is applied every frame from refs (no React state per frame): the hinge angle, the self-centring shift,
  // the spine and the three screen materials all read one eased timeline while a transition runs (foldLive.anim),
  // else the Fold slider.
  const root = useRef<THREE.Group>(null), swingG = useRef<THREE.Group>(null), spineG = useRef<THREE.Group>(null), spineM = useRef<THREE.Mesh>(null)
  const grooves = useRef<(THREE.Mesh | null)[]>([])
  const mats = useMemo(() => ({ fixed: screenMaterial(), moving: screenMaterial(), outer: screenMaterial(OUTER_PROJ), strip: screenMaterial() }), [])
  const strip = useMemo(() => foldStripGeometry(), [])
  useEffect(() => () => strip.dispose(), [strip])
  const stripFold = useRef(-1)
  useEffect(() => () => Object.values(mats).forEach(m => m.dispose()), [mats])
  useEffect(() => { mats.strip.uniforms.band.value.set(0.5 - FC / (2 * SW), 0.5 + FC / (2 * SW)) }, [mats])
  // static screen inputs: each screen's own media (the outer one falls back to the inner media when it has none),
  // its fit (fill crops to cover, fit letterboxes in black), the blur strength
  const outTex = textureOuter ?? texture, outAspect = textureOuter ? (mediaAspectOuter ?? mediaAspect) : mediaAspect
  for (const [k, m] of Object.entries(mats)) {
    const isOut = k === 'outer', aspect = isOut ? OUTER_ASPECT : INNER_ASPECT, u = m.uniforms
    const ma = isOut ? outAspect : mediaAspect, fit = (isOut ? opts.fitOuter : opts.fitInner) === 'fit'
    u.map.value = isOut ? outTex : texture; u.blur.value = (opts.foldBlur ?? 0.6) * 0.09; u.aspect.value = aspect
    if (fit) {
      if (ma > aspect) { const q = ma / aspect; u.rep.value.set(1, q); u.off.value.set(0, (1 - q) / 2) }
      else { const q = aspect / ma; u.rep.value.set(q, 1); u.off.value.set((1 - q) / 2, 0) }
    } else if (ma > aspect) { const q = aspect / ma; u.rep.value.set(q, 1); u.off.value.set((1 - q) / 2, 0) }
    else { const q = ma / aspect; u.rep.value.set(1, q); u.off.value.set(0, 1 - q) }
  }
  for (const t of [texture, textureOuter]) if (t) { t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; if (t.minFilter !== THREE.LinearMipmapLinearFilter) { t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true } }
  const optsRef = useRef(opts); optsRef.current = opts
  const hasIn = texture ? 1 : 0, hasOut = outTex ? 1 : 0
  useFrame(({ camera }) => {
    const o = optsRef.current, a = foldLive.anim, now = performance.now()
    let fold = o.fold
    if (a) {
      const u = clamp01((now - a.t0) / a.dur); fold = a.from + (a.target - a.from) * smoother(u)
      // swap the screen content as the hinge passes 90 degrees, where both screens are fully dissolved
      if (!a.swapped && (a.target - 90) * (fold - 90) >= 0) { a.swapped = true; a.onSwap?.() }
      if (foldLive.follow) { if (a.camD0 === undefined) { a.camD0 = camera.position.length(); a.w0 = foldWidth(a.from) } camera.position.setLength(a.camD0 * Math.pow(foldWidth(fold) / a.w0!, 0.75)) }
      if (u >= 1) { foldLive.anim = null; a.onDone?.(fold, a.camD0 !== undefined && foldLive.follow ? Math.pow(a.w0! / foldWidth(fold), 0.75) : 1) }
    }
    if (foldLive.log) foldLive.log.push([now, fold])
    const swing = THREE.MathUtils.degToRad(180 - fold)
    // self-centring: the closed stack is centred on the hinge-side half, the open device on the hinge
    root.current?.position.set(-(W / 2) * (1 - fold / 180), 0, -(T / 2 + GAP) * (1 - fold / 180))
    swingG.current?.rotation.set(0, swing, 0)
    const sp = spineAt(swing)
    if (spineG.current && spineM.current) {
      spineG.current.visible = !!sp
      if (sp) { spineG.current.matrix.copy(sp.m); spineM.current.geometry = sp.g; grooves.current.forEach(g => g?.scale.set(sp.w * 0.98, 1, 1)) }
    }
    // the bent fold region of the inner screen follows the hinge (flat and seamless at 180)
    if (stripFold.current !== fold) { stripFold.current = fold; updateFoldStrip(strip, swing) }
    // screens: the dissolve is a function of the hinge angle alone, so it is in step with the fold whether it is
    // animating or scrubbed: each screen frosts and darkens as it leaves its resting angle (fully by about 80 degrees
    // away, so both peak mid-fold) and is perfectly clear exactly when the hinge reaches its rest. Each also fades to
    // the idle black as it turns fully away. The pass-through projection crossfades in with the angle.
    const dis = !!a || o.foldDissolve !== false
    // implied crease: soft shading with a faint highlight along the fold, zero when flat, gentle mid-fold
    const crease = 0.6 * Math.sin(swing) + 0.25 * smoother((180 - fold) / 90) * (1 - smoother((30 - fold) / 30))
    const set = (m: THREE.ShaderMaterial, on: number, blur: number, dark: number, fadeOut: number, proj: number) => {
      const u = m.uniforms; u.has.value = on * (m === mats.outer ? hasOut : hasIn); u.m.value = blur; u.md.value = dark; u.fo.value = fadeOut; u.proj.value = proj
      u.crease.value = m === mats.outer ? 0 : crease
      if (root.current) {
        u.toRoot.value.copy(_inv.copy(root.current.matrixWorld).invert())
      }
    }
    if (!dis) {
      const i = o.screen === 'inner' ? 1 : 0
      set(mats.fixed, i, 0, 0, 0, 0); set(mats.moving, i, 0, 0, 0, 0); set(mats.strip, i, 0, 0, 0, 0); set(mats.outer, 1 - i, 0, 0, 0, 0)
    } else {
      const dIn = smoother((180 - fold) / 80), dOut = smoother(fold / 80)
      // the outer screen is the exact mirror of the inner moving half: projected fixed in space onto the closed outer
      // screen's plane (full at 0, gone by 160), frosting and darkening as the hinge leaves 0, idle as it faces away
      // Content is always mapped to the panel's own uv (one continuous image across both halves and the fold strip,
      // correct from any device rotation or camera). A per-pixel projection through the viewer duplicated the image
      // and left seams and smeared clamp strips when the device was turned, so it is off (proj 0).
      const foIn = smoother((70 - fold) / 60), foOut = smoother((fold - 110) / 60)
      set(mats.fixed, 1, 0, 0, foIn, 0); set(mats.moving, 1, dIn, dIn, foIn, 0); set(mats.strip, 1, 0, dIn, foIn, 0); set(mats.outer, 1, 0.6 * dOut, 1.3 * dOut, foOut, 0)   // Apple's outer screen darkens more and frosts less
    }
  })
  const zf = T / 2 + E          // front face layers
  // Free edge buttons (right half, x = W, viewed with the outer screen facing you they sit on the right).
  const btn = (y: number, len: number, key: string, extra = 0) => (
    <mesh key={key} position={[W + 0.0015 + extra / 2, y, 0]} castShadow>
      <boxGeometry args={[0.006 + extra, len, T * 0.42]} />{frameMat}
    </mesh>)
  const logo = opts.logo
  return (
    <group ref={root} position={[-(W / 2) * (1 - opts.fold / 180), 0, -(T / 2 + GAP) * (1 - opts.fold / 180)]}>
      {/* ---------- right half (fixed) ---------- */}
      <mesh geometry={g.rightBody} castShadow>{frameMat}</mesh>
      <mesh geometry={g.bezelR} position={[0, 0, zf]}><meshPhysicalMaterial color="#050506" roughness={0.12} clearcoat={1} /></mesh>
      <mesh geometry={g.scrR} position={[0, 0, zf + E]}><primitive object={mats.fixed} attach="material" /></mesh>
      {/* the screen's bent fold region: rebuilt per frame from the hinge angle, joins both halves without a seam */}
      <mesh geometry={strip} frustumCulled={false}><primitive object={mats.strip} attach="material" /></mesh>
      {/* square hinge faces: fill the edge chamfer on the hinge side so the halves butt flush when open */}
      <HingeFill x={HR / 2}>{frameMat}</HingeFill>
      {/* inner under-display FaceTime camera (Dynamic Island area): 34 mm from hinge, 12.7 mm from top */}
      <mesh geometry={g.udc} position={[0.34, H / 2 - 0.127, zf + E * 3]} renderOrder={2}>
        <meshBasicMaterial color="#000" transparent opacity={0.45} polygonOffset polygonOffsetFactor={-2} /></mesh>
      {/* back glass */}
      <mesh position={[0, 0, -T / 2 - E]} rotation={[0, Math.PI, 0]}>
        <shapeGeometry args={[rrC(W - 0.0025, H - 0.004, [CR - 0.004, 0.0003, 0.0003, CR - 0.004], -(W - 0.0015) / 2), 24]} />{glassBack}
      </mesh>
      {/* camera plateau: horizontal rounded block near the top free corner, two lenses side by side + flash.
          About 38 x 23.6 mm, 4 mm from the top and free edge (seen from the back, lenses sit next to the free edge). */}
      <group position={[W - 0.23, H / 2 - 0.158, -T / 2]}>
        <mesh rotation={[Math.PI, 0, 0]}><extrudeGeometry args={[rrC(0.38, 0.236, [0.1, 0.1, 0.1, 0.1]), { depth: 0.01, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 4, curveSegments: 32 }]} />{glassBack}</mesh>
        {[0.075, -0.06].map(x => (
          <group key={x} position={[x, 0, -0.012]}>
            <mesh rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.0625, 0.066, 0.01, 48]} />{frameMat}</mesh>
            <mesh position={[0, 0, -0.0052]} rotation={[Math.PI, 0, 0]}><circleGeometry args={[0.052, 48]} /><meshPhysicalMaterial color="#07080b" roughness={0.05} clearcoat={1} /></mesh>
            <mesh position={[0, 0, -0.0054]} rotation={[Math.PI, 0, 0]}><ringGeometry args={[0.022, 0.032, 48]} /><meshPhysicalMaterial color="#1a2340" metalness={0.6} roughness={0.1} /></mesh>
          </group>))}
        <mesh position={[-0.145, 0.03, -0.0142]} rotation={[Math.PI, 0, 0]}><circleGeometry args={[0.0175, 24]} /><meshStandardMaterial color="#f1e7cf" roughness={0.3} /></mesh>
        <mesh position={[-0.145, -0.04, -0.0142]} rotation={[Math.PI, 0, 0]}><circleGeometry args={[0.006, 16]} /><meshBasicMaterial color="#111" /></mesh>
      </group>
      {/* logo spot: centre of the right half's back; user-supplied art only */}
      {logo && (
        <mesh position={[W / 2, 0, -T / 2 - E * 3]} rotation={[0, Math.PI, 0]}>
          <planeGeometry args={[opts.logoSize, opts.logoSize / logo.aspect]} />
          <meshPhysicalMaterial color={opts.logoTint !== DEFAULT_LOGO_TINT ? opts.logoTint : f.back} metalness={0.55} roughness={0.04} clearcoat={1} clearcoatRoughness={0.02} envMapIntensity={1.6}
            alphaMap={logo.mask} transparent depthWrite={false} polygonOffset polygonOffsetFactor={-2} />
        </mesh>)}
      {/* volume up/down on the top edge, 36.6 to 47.4 mm and 50.2 to 61 mm from the hinge */}
      {[0.42, 0.556].map(x => (
        <mesh key={x} position={[x, H / 2 + 0.0015, 0]}><boxGeometry args={[0.108, 0.006, T * 0.42]} />{frameMat}</mesh>))}
      {/* side button with Touch ID on the free edge, 33.7 to 52 mm from the top */}
      <mesh position={[W + 0.0018, H / 2 - 0.4285, 0]}><boxGeometry args={[0.0065, 0.183, T * 0.46]} />
        <meshPhysicalMaterial color={f.frame} metalness={0.6} roughness={0.15} clearcoat={1} /></mesh>
      {/* Camera Control, flush sapphire on the free edge, centred about 72 mm from the top */}
      <mesh position={[W + 0.0012, H / 2 - 0.72, 0]}><boxGeometry args={[0.004, 0.14, T * 0.4]} />
        <meshPhysicalMaterial color="#9aa0aa" metalness={0.2} roughness={0.05} clearcoat={1} /></mesh>
      {/* bottom edge speaker grilles, 16 to 23 mm and 60 to 68 mm from the hinge */}
      {[0.16, 0.60].flatMap(x0 => [0, 1, 2, 3].map(i => (
        <mesh key={`${x0}${i}`} position={[x0 + 0.01 + i * 0.022, -H / 2 - 0.0005, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.0065, 12]} /><meshBasicMaterial color="#050506" side={THREE.DoubleSide} /></mesh>)))}
      {/* hinge spine (after Carlos's reference and Apple's imagery): a thin, flat, polished titanium strip the full height
          of the hinge edge with rounded ends and two break lines. It sits on the bisector of the two halves and spans
          the chord between their back corners, so it is always joined to both: flush with both frames when closed,
          narrowing as the phone opens and tucked away inside the hinge when flat. */}
      <group ref={spineG} matrixAutoUpdate={false}>
        <mesh ref={spineM}><meshPhysicalMaterial color={f.frame} metalness={1} roughness={0.14} clearcoat={0.4} /></mesh>
        {[1, -1].map((k, i) => <mesh key={k} ref={el => { grooves.current[i] = el }} position={[0, k * (H / 2 - 0.1), SPINE_TH + 0.0002]}><planeGeometry args={[1, 0.0035]} /><meshStandardMaterial color="#5c6068" metalness={0.3} roughness={0.6} /></mesh>)}
      </group>
      {/* ---------- left half (swings) ---------- */}
      <group ref={swingG} position={[0, 0, T / 2 + GAP]} rotation={[0, THREE.MathUtils.degToRad(180 - opts.fold), 0]}>
        <group position={[0, 0, -T / 2 - GAP]}>
          <mesh geometry={g.leftBody} castShadow>{frameMat}</mesh>
          <HingeFill x={-HR / 2}>{frameMat}</HingeFill>
          {/* USB-C on the bottom edge, about 43 mm from the hinge */}
          <mesh position={[-0.43, -H / 2 - 0.0005, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <shapeGeometry args={[USB_SHAPE]} /><meshBasicMaterial color="#050506" side={THREE.DoubleSide} /></mesh>
          {/* top edge speaker grille, 36 to 51 mm from the hinge */}
          {[0, 1, 2, 3, 4, 5].map(i => (
            <mesh key={i} position={[-0.365 - i * 0.028, H / 2 + 0.0005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <circleGeometry args={[0.007, 12]} /><meshBasicMaterial color="#050506" side={THREE.DoubleSide} /></mesh>))}
          <mesh geometry={g.bezelL} position={[0, 0, zf]}><meshPhysicalMaterial color="#050506" roughness={0.12} clearcoat={1} /></mesh>
          <mesh geometry={g.scrL} position={[0, 0, zf + E]}><primitive object={mats.moving} attach="material" /></mesh>
          {/* outer display on the back, cover glass then screen */}
          <group position={[-W / 2, 0, -T / 2]} rotation={[0, Math.PI, 0]}>
            <mesh position={[0, 0, E]}><shapeGeometry args={[rrC(W - 0.03, H - 0.03, [HR, CR - 0.012, CR - 0.012, HR]), 24]} />
              <meshPhysicalMaterial color="#050506" roughness={0.12} clearcoat={1} /></mesh>
            <mesh geometry={g.outer} position={[0, 0, E * 2]}><primitive object={mats.outer} attach="material" /></mesh>
            <group position={[W / 2 - 0.105, H / 2 - 0.103, 0]}><Overlay geo={g.island} z={E * 4} /></group>
          </group>
        </group>
      </group>
    </group>
  )
}
const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
/** Smootherstep on 0..1 (zero velocity and acceleration at both ends), clamped. */
const smoother = (x: number) => { const t = clamp01(x); return t * t * t * (t * (t * 6 - 15) + 10) }
/** A running fold transition (the hinge only). Times in ms (performance.now). */
export interface FoldAnim { from: number; target: number; to: 'inner' | 'outer'; t0: number; dur: number; swapped?: boolean; camD0?: number; w0?: number
  onSwap?: () => void; onDone?: (fold: number, zoomK: number) => void }
/** Live fold state shared by the studio and the Duo, read every frame (no React state per frame). */
export const foldLive: { anim: FoldAnim | null; follow: boolean; log: [number, number][] | null } = { anim: null, follow: true, log: null }
/** Hinge swing at speed 1, in ms, on smootherstep (no snap, no rebound). The dissolve has no timer of its own. */
export const FOLD_MS = 900

/** Apparent width of the device for a fold, for the camera follow (1 closed or at 90 degrees, 2 flat). */
export const foldWidth = (f: number) => 1 + Math.max(0, -Math.cos(f * Math.PI / 180))

/** The "dissolve" (Apple's fold transition): the moving half's content stays put in space, as if seen through the
 * panel, and frosts over. m is the strength 0 to 1 (from the fold angle while moving, then a short lag that
 * clears it); the blur covers the half (ramping in over the 30% nearest the hinge) and the darkening runs from 35% at the hinge to 80% at the free edge. Blur radius is in screen heights. */
const SCREEN_VS = `uniform mat4 toRoot; varying vec2 vUv; varying vec3 vRoot;
void main() { vUv = uv; vRoot = (toRoot * modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`
const SCREEN_FS = `uniform sampler2D map; uniform float has, blur, m, md, fo, proj, aspect, plane, sw, sh, cx, eo, crease; uniform vec2 rep, off, band; uniform vec3 eye;
varying vec2 vUv; varying vec3 vRoot;
void main() {
  vec3 idle = vec3(0.0024, 0.0027, 0.0037), c = idle;
  if (has > 0.5) {
    // e: 0 at the hinge side, 1 at the free edge (inner moving half: u 0.5 to 0; outer screen: u 0 to 1)
    vec2 st = vUv; float e = eo > 0.5 ? vUv.x : clamp(1.0 - 2.0 * vUv.x, 0.0, 1.0);
    if (proj > 0.001) {
      // fixed front-view projection onto the open inner-screen plane: the image holds still while the half turns.
      // Blended in from 70 to 160 degrees; nearer edge-on the projection would smear, so it uses the panel's own uv.
      float d = (plane - eye.z) / (vRoot.z - eye.z); vec2 p = eye.xy + (vRoot.xy - eye.xy) * d;
      // where the viewer-fixed image would not reach the panel (a half tilted towards the camera), ease back to the
      // panel's own uv so the panel is always covered; whatever still falls outside is edge-extended, never black
      vec2 sp = vec2((p.x - cx) / (2.0 * sw) + 0.5, p.y / sh + 0.5);
      float out_ = max(max(-sp.x, sp.x - 1.0), max(-sp.y, sp.y - 1.0));
      st = clamp(mix(vUv, sp, proj * (1.0 - smoothstep(0.0, 0.12, out_))), 0.0, 1.0);
    }
    float r = blur * m * smoothstep(0.0, 0.3, e);
    float dark = min(0.8, md * (0.35 + 0.6 * smoothstep(0.0, 1.0, e)));
    // fold strip: its darkening runs from the moving half's edge value (left end) to the fixed half's zero (right end)
    if (band.y > band.x) dark = md * 0.35 * clamp((band.y - vUv.x) / (band.y - band.x), 0.0, 1.0);
    vec2 uv = st * rep + off;
    vec2 lo = max(off, vec2(0.0)), hi = min(off + rep, vec2(1.0));
    float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
    if (r < 0.0004) c = texture2D(map, clamp(uv, lo, hi)).rgb;
    else {
      float bias = clamp(log2(r * 1400.0) - 1.0, 0.0, 7.0); c = vec3(0.0);
      for (int i = 0; i < 32; i++) {
        float a = float(i) * 2.39996, q = sqrt((float(i) + 0.5) / 32.0) * r;
        c += texture2D(map, clamp(uv + vec2(cos(a) / aspect, sin(a)) * q * rep, lo, hi), bias).rgb;
      }
      c /= 32.0;
    }
    c *= inside;   // fit: letterbox bars are black
    if (crease > 0.0) {
      // implied crease, in screen units across the hinge line (inner halves only): a soft shadow and a thin sheen beside it
      float dx = abs(vUv.x - 0.5) * 2.0 * sw;
      // broad and soft (no hard line): about 2.5 mm shadow, a faint wide sheen beside it
      float sh0 = exp(-pow(dx / 0.025, 2.0)), hl = exp(-pow((dx - 0.035) / 0.02, 2.0));
      c = c * (1.0 - 0.35 * crease * sh0) + 0.03 * crease * hl;
    }
    c = mix(mix(c, idle, dark), idle, fo);
  }
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`
const _inv = new THREE.Matrix4()
/** Projection target of a screen: its rest plane (root z), centre x and half width / height there. */
interface ProjTarget { plane: number; cx: number; sw: number; sh: number; eo: number }
const INNER_PROJ: ProjTarget = { plane: T / 2 + E * 2, cx: 0, sw: SW, sh: SH, eo: 0 }
// the closed outer screen: the swing half turned 180 degrees about the hinge axis (0, T/2 + GAP)
const OUTER_PROJ: ProjTarget = { plane: 2 * (T / 2 + GAP) + T / 2 + E * 2, cx: W / 2, sw: OW / 2, sh: OH, eo: 1 }
function screenMaterial(pt: ProjTarget = INNER_PROJ) {
  return new THREE.ShaderMaterial({ vertexShader: SCREEN_VS, fragmentShader: SCREEN_FS, toneMapped: false, uniforms: {
    crease: { value: 0 }, band: { value: new THREE.Vector2(0, 0) },
    map: { value: null }, has: { value: 0 }, blur: { value: 0 }, m: { value: 0 }, md: { value: 0 }, fo: { value: 0 }, proj: { value: 0 }, aspect: { value: 1 }, rep: { value: new THREE.Vector2(1, 1) }, off: { value: new THREE.Vector2() },
    toRoot: { value: new THREE.Matrix4() }, eye: { value: new THREE.Vector3(pt.cx, 0, pt.plane + 4) }, plane: { value: pt.plane }, sw: { value: pt.sw }, sh: { value: pt.sh }, cx: { value: pt.cx }, eo: { value: pt.eo } } })
}

/** Half-width of the screen's bent fold region (3 mm each side of the hinge line), about a real foldable's fold zone. */
const FC = 0.003, STRIP_N = 24
/** Fold strip: STRIP_N + 1 columns, top and bottom rows; uv u runs across the fold region, v up the screen. */
function foldStripGeometry() {
  const g = new THREE.BufferGeometry(), n = STRIP_N + 1, pos = new Float32Array(n * 2 * 3), uv = new Float32Array(n * 2 * 2), idx: number[] = []
  for (let i = 0; i < n; i++) {
    const u = 0.5 + (-FC + (2 * FC * i) / STRIP_N) / (2 * SW)
    uv.set([u, 0], i * 4); uv.set([u, 1], i * 4 + 2)
    if (i < STRIP_N) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3) }
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(idx)
  return g
}
/** The fold region as a cubic Bezier from the moving half's screen edge to the fixed half's, leaving each tangent
 * to its own panel, so the screen bends instead of splitting (a straight, flat continuation at 180). Root frame. */
function updateFoldStrip(g: THREE.BufferGeometry, swing: number) {
  const zs = T / 2 + E * 2, ax = T / 2 + GAP, cs = Math.cos(swing), sn = Math.sin(swing)
  // left edge (-FC, zs) in the swing frame, rotated about the hinge axis (0, ax) by swing about +y
  const lx = -FC * cs + (zs - ax) * sn, lz = ax + FC * sn + (zs - ax) * cs
  const tx = cs, tz = -sn            // left panel's direction towards the hinge
  const h = FC * 0.6, p = g.attributes.position as THREE.BufferAttribute
  const P0 = [lx, lz], P1 = [lx + tx * h, lz + tz * h], P2 = [FC - h, zs], P3 = [FC, zs]
  for (let i = 0; i <= STRIP_N; i++) {
    const t = i / STRIP_N, a = (1 - t) ** 3, b = 3 * (1 - t) ** 2 * t, c = 3 * (1 - t) * t * t, d = t ** 3
    const x = a * P0[0] + b * P1[0] + c * P2[0] + d * P3[0], z = a * P0[1] + b * P1[1] + c * P2[1] + d * P3[1]
    p.setXYZ(i * 2, x, -SH / 2, z); p.setXYZ(i * 2 + 1, x, SH / 2, z)
  }
  p.needsUpdate = true
}
/** Square-off of a half's hinge edge: two boxes that fill the chamfer (front/back and top/bottom) beside the hinge. */
function HingeFill({ x, children }: { x: number; children: React.ReactNode }) {
  return <mesh position={[x, 0, 0]}><boxGeometry args={[HR, H - 0.0004, T - 0.0004]} />{children}</mesh>
}

const SPINE_TH = 0.012   // 1.2 mm thick strip
/** Spine strip for a swing angle: on the bisector of the two halves, its inner face on the chord between their back
 * corners (both at radius T + GAP from the hinge axis), so its width is that chord. Returns the geometry, its width
 * and the placement matrix (x across the strip, y along the hinge, z outward). */
const spineGeos = new Map<number, THREE.BufferGeometry>()
const _n = new THREE.Vector3(), _t = new THREE.Vector3(), _c = new THREE.Vector3(), _y = new THREE.Vector3(0, 1, 0), _sm = new THREE.Matrix4()
/** Per-frame spine: geometry cached by width in 0.25 mm steps, placement computed exactly. */
function spineAt(swing: number) {
  const R = T + GAP, a = swing / 2, w = 2 * R * Math.sin(a)
  if (w < 0.006) return null
  const key = Math.round(w / 0.0025); let g = spineGeos.get(key)
  if (!g) { g = hingeSpine(swing)!.g; spineGeos.set(key, g) }
  _n.set(-Math.sin(a), 0, -Math.cos(a)); _t.set(-Math.cos(a), 0, Math.sin(a))
  _c.set(0, 0, T / 2 + GAP).addScaledVector(_n, R * Math.cos(a) - 0.0005)
  return { g, w: key * 0.0025, m: _sm.makeBasis(_t, _y, _n).setPosition(_c) }
}
function hingeSpine(swing: number) {
  const R = T + GAP, a = swing / 2, w = 2 * R * Math.sin(a)
  if (w < 0.006) return null
  const wq = Math.round(w / 0.0025) * 0.0025, rEnd = Math.min(wq / 2, 0.035), shape = rrect(wq, H - 0.002, [rEnd, rEnd, rEnd, rEnd])
  const g = new THREE.ExtrudeGeometry(shape, { depth: SPINE_TH - 0.003, bevelEnabled: true, bevelThickness: 0.0015, bevelSize: 0.0012, bevelSegments: 3, curveSegments: 12 })
  g.translate(0, 0, 0.0015)
  const n = new THREE.Vector3(-Math.sin(a), 0, -Math.cos(a)), t = new THREE.Vector3(-Math.cos(a), 0, Math.sin(a))
  const c = new THREE.Vector3(0, 0, T / 2 + GAP).addScaledVector(n, R * Math.cos(a) - 0.0005)
  const m = new THREE.Matrix4().makeBasis(t, new THREE.Vector3(0, 1, 0), n).setPosition(c)
  return { g, w, m }
}

// Inline JSX shapes cached by parameters so re-renders don't rebuild geometry.
const shapeCache = new Map<string, THREE.Shape>()
function rrC(w: number, h: number, r: number[], cx = 0) {
  const k = [w, h, ...r, cx].join('|'); let s = shapeCache.get(k)
  if (!s) shapeCache.set(k, s = rrect(w, h, r, cx)); return s
}
const USB_SHAPE = pill(0.09, 0.028)
export default memo(Duo)
