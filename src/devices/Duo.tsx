import { memo, useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { DeviceProps } from '../types'
import { DEFAULT_LOGO_TINT } from './shared'
import { RearLens, Pressable } from './IPhonePro'
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
// outer display (after Carlos's closed front reference): about 2 mm bezel all round, large 9.8 mm corners on the free
// side and near-square 0.8 mm corners on the hinge side, so the glass runs close to the hinge
const OH = 1.136, OW = OH * OUTER_ASPECT, OCR = 0.098, OCR_H = 0.008
const ISL = { w: 0.056, h: 0.085 }               // outer Dynamic Island: vertical pill near the top free corner
export const FINISHES = {
  night: { frame: '#3a3f4b', back: '#1d212b', label: 'Night Sky' },
  star: { frame: '#d8d4cc', back: '#ece9e3', label: 'Star White' },
  natural: { frame: '#c4c0b8', back: '#9d9a94', label: 'Natural Titanium' },
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
/** The body's outer edge sits this far outside its outline (the slab bevel grows outward); edge parts sit on it. */
const EO = 0.006 * 0.8
const pill = (w: number, h: number) => { const r = Math.min(w, h) / 2; return rrect(w, h, [r, r, r, r]) }
const E = 0.0004 // z separation between stacked flat layers

function Overlay({ geo, z, color = '#000', order = 2 }: { geo: THREE.BufferGeometry; z: number; color?: string; order?: number }) {
  return <mesh geometry={geo} position={[0, 0, z]} renderOrder={order} userData={{ sketchTone: 'black' }}>
    <meshBasicMaterial color={color} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} />
  </mesh>
}

/** Antenna bands (positions after Carlos's iPhone Duo reference; material and colour as on our 18 Pro): matte resin bands crossing the frame. Positions in model
 *  units (1 = 100 mm) as distance from the hinge for the top and bottom edges (the same on both halves, so they line up
 *  when closed), and as y on the free short edges. Band width 1.5 mm. */
const BANDS = { top: [0.165, 0.703], bottom: [0.295, 0.565], side: [H / 2 - 0.123, -H / 2 + 0.13], w: 0.015 }
function bandMaterial(colour: THREE.Color) {
  const m = new THREE.MeshPhysicalMaterial({ color: colour, metalness: 0.05, roughness: 0.6, clearcoat: 0.25, clearcoatRoughness: 0.4,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, depthFunc: THREE.LessEqualDepth })
  const hw = (BANDS.w / 2).toFixed(4), f = (v: number) => v.toFixed(4)
  m.onBeforeCompile = sh => {
    sh.vertexShader = 'varying vec3 vObj;\nvarying vec3 vNo;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = position; vNo = objectNormal;')
    sh.fragmentShader = 'varying vec3 vObj;\nvarying vec3 vNo;\n' + sh.fragmentShader.replace('void main() {', `void main() {
  float ax = abs(vObj.x), on = 0.0;
  if (vObj.y > ${f(H / 2 - 0.2)}) on += step(abs(ax - ${f(BANDS.top[0])}), ${hw}) + step(abs(ax - ${f(BANDS.top[1])}), ${hw});
  if (vObj.y < ${f(-H / 2 + 0.2)}) on += step(abs(ax - ${f(BANDS.bottom[0])}), ${hw}) + step(abs(ax - ${f(BANDS.bottom[1])}), ${hw});
  if (ax > ${f(W - 0.2)}) on += step(abs(vObj.y - ${f(BANDS.side[0])}), ${hw}) + step(abs(vObj.y - ${f(BANDS.side[1])}), ${hw});
  if (on < 0.5 || abs(normalize(vNo).z) > 0.93) discard;`)
  }
  m.customProgramCacheKey = () => 'duo-band'
  return m
}
/** Pill (stadium) face of length len and height h, extruded d out of the surface along +z with a soft edge. */
/** Button sizes from our iPhone 18 Pro (iphoneSpecs btn): width, protrusion, sink into the frame, press travel. */
const BTN = { w: 0.0266, prot: 0.0045, sink: 0.003, press: 0.003 }
const pillCache = new Map<string, THREE.BufferGeometry>()
function pillGeo(len: number, h: number, d: number) {
  const k = `${len}|${h}|${d}`, hit = pillCache.get(k); if (hit) return hit
  const b = Math.min(d * 0.45, h * 0.2)
  const g = new THREE.ExtrudeGeometry(pill(len - 2 * b, h - 2 * b), { depth: d - b, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 4, curveSegments: 20 })
  g.translate(0, 0, b); pillCache.set(k, g); return g
}

function Duo({ texture, mediaAspect, opts, textureOuter, mediaAspectOuter }: DeviceProps) {
  const f = FINISHES[opts.finish as keyof typeof FINISHES] ?? FINISHES.night
  const g = useMemo(() => {
    // Right half spans x 0..W, left half spans -W..0 (in its own frame before swinging).
    // the slabs stop RAIL.k short of the hinge; the rail (a bar along y with a fully rounded back corner) forms the
    // hinge-side frame edge, so closed the two rails frame the recessed spine panel
    const rightBody = slab(rrect(W - RAIL.k, H, [HR, CR, CR, HR], (W + RAIL.k) / 2), T, 0.006)
    const leftBody = slab(rrect(W - RAIL.k, H, [CR, HR, HR, CR], -(W + RAIL.k) / 2), T, 0.006)
    const railR = railGeo(1), railL = railGeo(-1)
    // bezels run right up to the hinge line (square there) so the open device has no notch or strip between halves
    const bezelR = flat(rrect(W - 0.002, H - 0.004, [0.0003, CR - 0.004, CR - 0.004, 0.0003], W / 2 - 0.001), W, H, 0, 1, W / 2)
    const bezelL = flat(rrect(W - 0.002, H - 0.004, [CR - 0.004, 0.0003, 0.0003, CR - 0.004], -W / 2 + 0.001), W, H, 0, 1, -W / 2)
    // the flat screen halves stop FC short of the hinge; the bent fold strip (built per frame) joins them
    // halves overlap the strip by 0.5 mm (identical mapping and shading there, so the overlap is invisible: no crack)
    const FO = FC - 0.0005, hw = SW - FO, uF = FO / (2 * SW)
    const scrR = flat(rrect(hw, SH, [0.0001, SCR, SCR, 0.0001], FO + hw / 2), hw, SH, 0.5 + uF, 1, FO + hw / 2)
    const scrL = flat(rrect(hw, SH, [SCR, 0.0001, 0.0001, SCR], -FO - hw / 2), hw, SH, 0, 0.5 - uF, -FO - hw / 2)
    const outer = flat(rrect(OW, OH, [OCR_H, OCR, OCR, OCR_H]), OW, OH)   // [bl, br, tr, tl]: local -x is the hinge side
    const island = new THREE.ShapeGeometry(pill(ISL.w, ISL.h), 16)
    const udc = new THREE.CircleGeometry(0.014, 24)
    return { rightBody, leftBody, railR, railL, bezelR, bezelL, scrR, scrL, outer, island, udc }
  }, [])
  useEffect(() => () => Object.values(g).forEach(x => x.dispose()), [g])
  const frameMat = <meshPhysicalMaterial color={f.frame} metalness={0.9} roughness={0.28} clearcoat={0.3} />
  // antenna band resin, exactly as on our iPhone 18 Pro (IPhonePro.tsx): the frame colour pulled toward a neutral grey
  // (7% on dark finishes, 30% on light ones), matte and non-metallic, so the bands read low-contrast
  const bandMat = useMemo(() => {
    const darkF = new THREE.Color(f.frame).getHSL({ h: 0, s: 0, l: 0 }).l < 0.35
    return bandMaterial(new THREE.Color(f.frame).lerp(new THREE.Color('#77797e'), darkF ? 0.07 : 0.3))
  }, [f.frame])
  useEffect(() => () => bandMat.dispose(), [bandMat])
  const glassBack = <meshPhysicalMaterial color={f.back} metalness={0.1} roughness={0.55} clearcoat={0.6} clearcoatRoughness={0.4} />
  // The fold is applied every frame from refs (no React state per frame): the hinge angle, the self-centring shift,
  // the spine and the three screen materials all read one eased timeline while a transition runs (foldLive.anim),
  // else the Fold slider.
  const root = useRef<THREE.Group>(null), swingG = useRef<THREE.Group>(null), spineM = useRef<THREE.Mesh>(null)
  const mats = useMemo(() => ({ fixed: screenMaterial(), moving: screenMaterial(), outer: screenMaterial(OUTER_PROJ), strip: screenMaterial() }), [])
  const strip = useMemo(() => foldStripGeometry(), [])
  useEffect(() => () => strip.dispose(), [strip])
  const stripFold = useRef(-1)
  useEffect(() => () => Object.values(mats).forEach(m => m.dispose()), [mats])
  // static screen inputs: each screen's own media (the outer one falls back to the inner media when it has none),
  // its fit (fill crops to cover, fit letterboxes in black), the blur strength
  const outTex = textureOuter ?? texture, outAspect = textureOuter ? (mediaAspectOuter ?? mediaAspect) : mediaAspect
  for (const [k, m] of Object.entries(mats)) {
    const isOut = k === 'outer', aspect = isOut ? OUTER_ASPECT : INNER_ASPECT, u = m.uniforms
    const ma = isOut ? outAspect : mediaAspect, fit = (isOut ? opts.fitOuter : opts.fitInner) === 'fit'
    u.map.value = isOut ? outTex : texture; u.blur.value = (opts.foldBlur ?? 0.15) * 0.09; u.aspect.value = aspect
    if (fit) {
      if (ma > aspect) { const q = ma / aspect; u.rep.value.set(1, q); u.off.value.set(0, (1 - q) / 2) }
      else { const q = aspect / ma; u.rep.value.set(q, 1); u.off.value.set((1 - q) / 2, 0) }
    } else if (ma > aspect) { const q = aspect / ma; u.rep.value.set(q, 1); u.off.value.set((1 - q) / 2, 0) }
    else { const q = ma / aspect; u.rep.value.set(1, q); u.off.value.set(0, 1 - q) }
  }
  // same media on both screens (including the outer falling back to the inner media): the outer shows exactly the
  // inner screen's right (fixed) half, same crop and scale, so the pixels line up when closed. The closed outer
  // spans x in [W/2 - OW/2, W/2 + OW/2] from the hinge and is centred vertically; the inner's right half maps
  // x in [0, SW] to u in [0.5, 1].
  if (!textureOuter || textureOuter === texture) {
    const ri = mats.fixed.uniforms.rep.value, oi = mats.fixed.uniforms.off.value, uo = mats.outer.uniforms
    const ax = 0.5 + (W / 2 - OW / 2) / (2 * SW), bx = OW / (2 * SW), ay = 0.5 - OH / (2 * SH), by = OH / SH
    uo.rep.value.set(bx * ri.x, by * ri.y); uo.off.value.set(ax * ri.x + oi.x, ay * ri.y + oi.y)
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
    // With 'Camera follows the fold' off, nothing re-centres: the fixed (right) half and the hinge keep their world
    // and screen position at every angle and only the left half swings.
    const kc = foldLive.follow ? 1 - fold / 180 : 0
    root.current?.position.set(-(W / 2) * kc, 0, -(T / 2 + GAP) * kc)
    swingG.current?.rotation.set(0, swing, 0)
    const sp = spineAt(swing)
    if (spineM.current) { spineM.current.visible = !!sp; if (sp) spineM.current.geometry = sp }
    // the bent fold region of the inner screen follows the hinge (flat and seamless at 180)
    if (stripFold.current !== fold) { stripFold.current = fold; updateFoldStrip(strip, swing) }
    // screens: the dissolve is a function of the hinge angle alone, so it is in step with the fold whether it is
    // animating or scrubbed: each screen frosts and darkens as it leaves its resting angle (fully by about 80 degrees
    // away, so both peak mid-fold) and is perfectly clear exactly when the hinge reaches its rest. Each also fades to
    // the idle black as it turns fully away. The pass-through projection crossfades in with the angle.
    const dis = !!a || o.foldDissolve !== false
    // implied crease: soft shading with a faint highlight along the fold, zero when flat, gentle mid-fold
    const crease = Math.sin(swing)
    const set = (m: THREE.ShaderMaterial, on: number, blur: number, dark: number, fadeOut: number, slide = 0, sweep = 1) => {
      m.uniforms.sweep.value = sweep
      const u = m.uniforms; u.has.value = on * (m === mats.outer ? hasOut : hasIn); u.m.value = blur; u.md.value = dark; u.fo.value = fadeOut
      u.slide.value = slide; u.aniso.value = 2.5 * Math.min(1, blur * 1.5)
      u.crease.value = m === mats.outer ? 0 : crease
      if (root.current) {
        u.toRoot.value.copy(_inv.copy(root.current.matrixWorld).invert())
      }
    }
    if (!dis) {
      const i = o.screen === 'inner' ? 1 : 0
      set(mats.fixed, i, 0, 0, 0, 0); set(mats.moving, i, 0, 0, 0, 0); set(mats.strip, i, 0, 0, 0, 0); set(mats.outer, 1 - i, 0, 0, 0, 0)
    } else {
      // Inner and outer are mirrors, each a function of the angle alone (so closing is opening played backwards):
      //  dissolve: blur + darkening, uniform over the whole screen, zero at the screen's rest angle, full ~80 deg away;
      //  slide: the whole image travels towards the hinge as the screen leaves rest (inner: u decreasing, i.e. the
      //  moving half's content passes over to the fixed half; outer: towards its hinge edge, u = 0), up to 5% of
      //  the width, with a matching zoom so no edge shows; fade to idle as the screen turns away.
      // progress is linear in the hinge angle (0 exactly at rest, 180 / 0; 1 exactly at INNER_FULL_AT / OUTER_START_AT).
      // It moves the soft front (width 0.3) across the screen at full strength, so the dissolved area grows in
      // proportion to the angle with no early saturation; the front only clears the screen edge at exactly 0 / 180
      const dIn = clamp01((180 - fold) / (180 - INNER_FULL_AT)), dOut = clamp01(fold / OUTER_START_AT)
      const sIn = 0, sOut = 0   // content never moves or scales on the panel; the sweep alone carries the motion
      const foIn = smoother((70 - fold) / 60), foOut = smoother((fold - 110) / 60)
      // the dissolve front travels from the free edge towards (and a little past) the hinge as the screen leaves rest
      for (const mm of [mats.fixed, mats.moving, mats.strip]) set(mm, 1, 1, foldLive.dark, foIn, sIn, 1.15 - 1.3 * dIn)
      set(mats.outer, 1, 1, foldLive.dark, foOut, sOut, 1.15 - 1.3 * dOut)
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
      <mesh geometry={g.railR} castShadow>{frameMat}</mesh>
      <mesh geometry={g.bezelR} position={[0, 0, zf]}><meshPhysicalMaterial color="#050506" roughness={0.12} clearcoat={1} /></mesh>
      <mesh name="screen" geometry={g.scrR} position={[0, 0, zf + E]}><primitive object={mats.fixed} attach="material" /></mesh>
      {/* the screen's bent fold region: rebuilt per frame from the hinge angle, joins both halves without a seam */}
      <mesh name="screen" geometry={strip} frustumCulled={false}><primitive object={mats.strip} attach="material" /></mesh>
      {/* hinge-side frame edges keep the body's rounded edge (no square fill): they are the rails either side of the spine */}
      {/* inner under-display FaceTime camera (Dynamic Island area): 34 mm from hinge, 12.7 mm from top */}
      <mesh geometry={g.udc} position={[0.34, H / 2 - 0.127, zf + E * 3]} renderOrder={2}>
        <meshBasicMaterial color="#000" transparent opacity={0.45} polygonOffset polygonOffsetFactor={-2} /></mesh>
      {/* back glass */}
      <mesh position={[0, 0, -T / 2 - E]} rotation={[0, Math.PI, 0]}>
        <shapeGeometry args={[rrC(W - 0.0025, H - 0.004, [CR - 0.004, 0.0003, 0.0003, CR - 0.004], -(W - 0.0015) / 2), 24]} />{glassBack}
      </mesh>
      {/* camera plateau (after Carlos's iPhone Duo reference): a pill-shaped raised plateau in the back finish, about
          59 x 26 mm, 1.8 mm in from the top and free edges, holding two large lenses side by side (the iPhone 18 Pro lens
          build, 17 mm) next to the free edge, and a small flash/sensor slot at its inner end. */}
      <group position={[W - 0.313, H / 2 - 0.148, -T / 2]}>
        <mesh rotation={[Math.PI, 0, 0]} castShadow><extrudeGeometry args={[pill(0.59, 0.26), { depth: 0.008, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 6, curveSegments: 48 }]} />{glassBack}</mesh>
        {[0.18, -0.009].map(x => (
          <group key={x} position={[x, 0.006, -0.0139]}><RearLens d={0.17} rise={0.0211} frame={f.frame} /></group>))}
        <mesh position={[-0.182, 0.074, -0.0141]} rotation={[Math.PI, 0, 0]}><shapeGeometry args={[pill(0.035, 0.014), 12]} />
          <meshPhysicalMaterial color="#1a1b1f" roughness={0.25} clearcoat={1} /></mesh>
      </group>
      {/* logo spot: centre of the right half's back; user-supplied art only */}
      {logo && (
        <mesh position={[W / 2, 0, -T / 2 - E * 3]} rotation={[0, Math.PI, 0]}>
          <planeGeometry args={[opts.logoSize, opts.logoSize / logo.aspect]} />
          <meshPhysicalMaterial color={opts.logoTint !== DEFAULT_LOGO_TINT ? opts.logoTint : f.back} metalness={0.55} roughness={0.04} clearcoat={1} clearcoatRoughness={0.02} envMapIntensity={1.6}
            alphaMap={logo.mask} transparent depthWrite={false} polygonOffset polygonOffsetFactor={-2} />
        </mesh>)}
      {/* Buttons as on our iPhone 18 Pro: 2.66 mm wide pills standing 0.45 mm proud (0.3 mm sunk into the frame so no gap
          shows), clickable with the 18 Pro's press (Pressable: 0.3 mm in, spring back). Local +x of each Pressable is
          outward. Volume up/down on the top edge (reference): 38.9 to 49.9 mm and 53.4 to 64.8 mm from the hinge. */}
      {[[0.444, 0.11], [0.591, 0.114]].map(([x, len]) => (
        <Pressable key={x} depth={BTN.press} position={[x, H / 2 + EO, 0]} rotation={[0, 0, Math.PI / 2]}>
          <mesh position={[-BTN.sink, 0, 0]} rotation={[0, Math.PI / 2, 0]} geometry={pillGeo(BTN.w, len, BTN.prot + BTN.sink)} castShadow>{frameMat}</mesh>
        </Pressable>))}
      {/* free edge (reference): the side button, 31.8 to 50.6 mm from the top, a dark pill proud like the 18 Pro's buttons;
          and Camera Control, 77 to 95.2 mm from the top, flush as on the 18 Pro (dark crystal in a thin frame-coloured
          ring, 0.1 mm press) */}
      <Pressable depth={BTN.press} position={[W + EO, H / 2 - 0.412, 0]}>
        <mesh position={[-BTN.sink, 0, 0]} rotation={[0, Math.PI / 2, 0]} geometry={pillGeo(BTN.w, 0.188, BTN.prot + BTN.sink)} castShadow>
          <meshPhysicalMaterial color="#0c0d10" metalness={0.2} roughness={0.12} clearcoat={1} /></mesh>
      </Pressable>
      <Pressable depth={0.001} position={[W + EO, H / 2 - 0.861, 0]}>
        <mesh position={[-0.0002, 0, 0]} rotation={[0, Math.PI / 2, 0]} geometry={pillGeo(BTN.w + 0.006, 0.188, 0.0004)}>{frameMat}</mesh>
        <mesh position={[-0.0002, 0, 0]} rotation={[0, Math.PI / 2, 0]} geometry={pillGeo(BTN.w, 0.182, 0.0005)}><meshPhysicalMaterial color="#0c0d10" metalness={0.2} roughness={0.06} clearcoat={1} /></mesh>
      </Pressable>
      {/* antenna bands on both halves (see BANDS) */}
      <mesh geometry={g.rightBody} material={bandMat} renderOrder={1} />
      {/* bottom edge speaker grilles, 16 to 23 mm and 60 to 68 mm from the hinge */}
      {[0.16, 0.60].flatMap(x0 => [0, 1, 2, 3].map(i => (
        <mesh key={`${x0}${i}`} position={[x0 + 0.01 + i * 0.022, -H / 2 - EO - 0.0003, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.0065, 12]} /><meshBasicMaterial color="#050506" side={THREE.DoubleSide} /></mesh>)))}
      {/* bottom edge mic holes (reference), 35 and 51 mm from the hinge, on both halves */}
      {[0.354, 0.51].map(x => (
        <mesh key={x} position={[x, -H / 2 - EO - 0.0003, 0]} rotation={[Math.PI / 2, 0, 0]}><circleGeometry args={[0.0055, 16]} /><meshBasicMaterial color="#050506" side={THREE.DoubleSide} /></mesh>))}
      {/* internal hinge spine: a rounded cover on the pivot axis, revealed between the halves as they fold (see spineGeo) */}
      <mesh ref={spineM} position={[0, 0, T / 2 + GAP]} castShadow><meshPhysicalMaterial color={f.frame} metalness={0.85} roughness={0.42} clearcoat={0.15} /></mesh>
      {/* ---------- left half (swings) ---------- */}
      <group ref={swingG} position={[0, 0, T / 2 + GAP]} rotation={[0, THREE.MathUtils.degToRad(180 - opts.fold), 0]}>
        <group position={[0, 0, -T / 2 - GAP]}>
          <mesh geometry={g.leftBody} castShadow>{frameMat}</mesh>
          <mesh geometry={g.railL} castShadow>{frameMat}</mesh>
          <mesh geometry={g.leftBody} material={bandMat} renderOrder={1} />
          {[-0.354, -0.51].map(x => (
            <mesh key={x} position={[x, -H / 2 - EO - 0.0003, 0]} rotation={[Math.PI / 2, 0, 0]}><circleGeometry args={[0.0055, 16]} /><meshBasicMaterial color="#050506" side={THREE.DoubleSide} /></mesh>))}
          {/* USB-C on the bottom edge, about 43 mm from the hinge */}
          <mesh position={[-0.43, -H / 2 - EO - 0.0003, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <shapeGeometry args={[USB_SHAPE]} /><meshBasicMaterial color="#050506" side={THREE.DoubleSide} /></mesh>
          {/* top edge speaker grille, 36 to 51 mm from the hinge */}
          {[0, 1, 2, 3, 4, 5].map(i => (
            <mesh key={i} position={[-0.365 - i * 0.028, H / 2 + EO + 0.0003, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <circleGeometry args={[0.007, 12]} /><meshBasicMaterial color="#050506" side={THREE.DoubleSide} /></mesh>))}
          <mesh geometry={g.bezelL} position={[0, 0, zf]}><meshPhysicalMaterial color="#050506" roughness={0.12} clearcoat={1} /></mesh>
          <mesh name="screen" geometry={g.scrL} position={[0, 0, zf + E]}><primitive object={mats.moving} attach="material" /></mesh>
          {/* outer display on the back, cover glass then screen */}
          <group position={[-W / 2, 0, -T / 2]} rotation={[0, Math.PI, 0]}>
            <mesh position={[0, 0, E]}><shapeGeometry args={[rrC(W - 0.03, H - 0.03, [HR, CR - 0.012, CR - 0.012, HR]), 24]} />
              <meshPhysicalMaterial color="#050506" roughness={0.12} clearcoat={1} /></mesh>
            <mesh name="screen" geometry={g.outer} position={[0, 0, E * 2]}><primitive object={mats.outer} attach="material" /></mesh>
            <group position={[W / 2 - 0.105, H / 2 - 0.103, 0]}><Overlay geo={g.island} z={E * 8} /></group>
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
/** Live fold state read in the frame loop. dark scales the dissolve's darkening (0 = blur only and the default, 1 = full, 1.5 max). */
export const foldLive: { anim: FoldAnim | null; follow: boolean; dark: number; log: [number, number][] | null } = { anim: null, follow: true, dark: 0, log: null }
/** Hinge swing at speed 1, in ms, on smootherstep (no snap, no rebound). The dissolve has no timer of its own. */
export const FOLD_MS = 900

/** Apparent width of the device for a fold, for the camera follow (1 closed or at 90 degrees, 2 flat). */
export const foldWidth = (f: number) => 1 + Math.max(0, -Math.cos(f * Math.PI / 180))

/** The "dissolve" (Apple's fold transition): the moving half's content stays put in space, as if seen through the
 * panel, and frosts over. m is the strength 0 to 1 (from the fold angle while moving, then a short lag that
 * clears it); the blur covers the half (ramping in over the 30% nearest the hinge) and the darkening runs from 35% at the hinge to 80% at the free edge. Blur radius is in screen heights. */
const SCREEN_VS = `uniform mat4 toRoot; varying vec2 vUv; varying vec3 vRoot;
void main() { vUv = uv; vRoot = (toRoot * modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`
const SCREEN_FS = `#define INNER_CLEAR 0.05
uniform sampler2D map; uniform float has, blur, m, md, fo, proj, aspect, plane, sw, sh, cx, eo, crease, slide, aniso, sweep; uniform vec2 rep, off, band; uniform vec3 eye, idleC;
varying vec2 vUv; varying vec3 vRoot;
void main() {
  vec3 idle = idleC, c = idle;
  if (has > 0.5) {
    // One image over the whole screen (both halves and the fold strip share this mapping, so there is no seam).
    // Pass-through motion: the content slides as one in the fold direction (slide, in screen widths) and is zoomed
    // in by just enough that no edge is ever exposed. The dissolve is uniform over the screen.
    float k = 1.0 - 2.0 * abs(slide);
    vec2 st = vec2(0.5 + (vUv.x - 0.5) * k + slide, 0.5 + (vUv.y - 0.5) * k);
    // Spatial dissolve that sweeps with the fold (Apple's hand-off): x runs 1 at the moving half's free edge, 0 at the
    // hinge, -1 at the fixed half's free edge (outer screen likewise: 1 at its free edge, 0 at its hinge edge). A smootherstep
    // front at sweep (moved by the hinge angle from beyond the free edge towards the hinge and a little past it) gives
    // one C2-smooth weight over both halves and the fold strip: no step anywhere, the fixed half fading in softly.
    float x = eo > 0.5 ? 1.0 - vUv.x : abs(vUv.x - 0.5) * 2.0;   // outer: u = 1 is its free (island) edge, on the right when closed
    // zone: the INNER_CLEAR (5%) of the width nearest the hinge always stays clear; the dissolve lives in the outer 95% (z = 0..1
    // across it), its front sweeping within that zone and its intensity ramping up towards the free edge
    // (e = z^2 (2 - z): zero value and slope at that boundary, so C1 with no line)
    float z = eo > 0.5 ? x : clamp((x - INNER_CLEAR) / (1.0 - INNER_CLEAR), 0.0, 1.0), e = eo > 0.5 ? 1.0 : z * z * (2.0 - z);   // outer: full width
    // outer (mirrored reverse of the inner): on opening the dissolve front starts at its hinge side (the right as seen
    // from the front) and travels to the free edge, so the content leaves right to left
    float t = clamp((eo > 0.5 ? (1.0 - sweep) - z : z - sweep) / 0.3 + 0.5, 0.0, 1.0), sw8 = e * t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
    // inner: only the moving (left, u < 0.5) half dissolves; feathered to zero across the bent strip with a C1
    // smootherstep (hinge line +-FC), so the fixed right half stays sharp with no step at the hinge
    // mv is that moving-side weight (1 on the outer): every effect (dissolve, crease shade, fade to idle) is scaled by
    // it, so the inner right half is never touched at any angle
    float mv = 1.0;
    if (eo < 0.5) { float g = clamp(((0.5 - vUv.x) * 2.0 * sw + 0.003) / 0.006, 0.0, 1.0); mv = g * g * g * (g * (g * 6.0 - 15.0) + 10.0); sw8 *= mv; }
    float r = blur * m * sw8, dark = min(0.95, md * 0.8 * sw8);   // md: Darkness (0 to 1.5, 1 = default)
    vec2 uv = st * rep + off;
    vec2 lo = max(off, vec2(0.0)), hi = min(off + rep, vec2(1.0));
    float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
    // sharp sample, cross-faded into the blur as its radius grows (no switch at a threshold, so no line where the
    // sweeping blur starts)
    c = texture2D(map, clamp(uv, lo, hi)).rgb;
    if (r > 0.0002) {
      vec3 sharp = c;
      // directional (motion) blur: the disc is stretched along the fold direction by aniso
      float bias = clamp(log2(r * 1400.0) - 1.0, 0.0, 7.0); c = vec3(0.0);
      vec2 sc = vec2((1.0 + aniso) / aspect, 1.0 / (1.0 + 0.5 * aniso));
      for (int i = 0; i < 32; i++) {
        float a = float(i) * 2.39996, q = sqrt((float(i) + 0.5) / 32.0) * r;
        c += texture2D(map, clamp(uv + vec2(cos(a), sin(a)) * sc * q * rep, lo, hi), bias).rgb;
      }
      c = mix(sharp, c / 32.0, smoothstep(0.0002, 0.004, r));
    }
    c *= inside;   // fit: letterbox bars are black
    if (crease > 0.0) {
      // implied crease: a very faint, wide gaussian shadow along the hinge line, no highlight, no edges
      float dx = abs(vUv.x - 0.5) * 2.0 * sw;
      // crease shade only on the moving side, with its own wide C1 ramp (a gaussian half that is zero with zero slope at
      // the hinge line) so it never makes a step there and never touches the fixed right half
      float cs = vUv.x < 0.5 ? 1.0 - exp(-pow(dx / 0.02, 2.0)) : 0.0;
      c *= 1.0 - 0.12 * crease * cs * exp(-pow(dx / 0.04, 2.0));
    }
    c = mix(mix(c, idle, dark), idle, fo * mv);
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
    idleC: { value: new THREE.Vector3(0.0024, 0.0027, 0.0037) }, slide: { value: 0 }, sweep: { value: 1 }, aniso: { value: 0 }, crease: { value: 0 }, band: { value: new THREE.Vector2(0, 0) },
    map: { value: null }, has: { value: 0 }, blur: { value: 0 }, m: { value: 0 }, md: { value: 0 }, fo: { value: 0 }, proj: { value: 0 }, aspect: { value: 1 }, rep: { value: new THREE.Vector2(1, 1) }, off: { value: new THREE.Vector2() },
    toRoot: { value: new THREE.Matrix4() }, eye: { value: new THREE.Vector3(pt.cx, 0, pt.plane + 4) }, plane: { value: pt.plane }, sw: { value: pt.sw }, sh: { value: pt.sh }, cx: { value: pt.cx }, eo: { value: pt.eo } } })
}

/** Half-width of the screen's bent fold region (3 mm each side of the hinge line), about a real foldable's fold zone. */
/** Fold dissolve timing (hinge angle: 180 = open, 0 = closed). The inner dissolve ramps from 180 and is at its full
 *  extent at INNER_FULL_AT; between that and OUTER_START_AT the inner holds and the outer has not started; the outer
 *  runs from OUTER_START_AT (fully dissolved) down to 0 (clear). Opening is the exact reverse. */
export const INNER_FULL_AT = 115, OUTER_START_AT = 80
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

/** Internal hinge (after Carlos's half-open reference). Both halves turn about one pivot axis at (x 0, z T/2 + GAP),
 * just in front of the screens. Each half's back face is at distance R = T + GAP from that axis and meets its hinge end
 * at the foot of the perpendicular, so a cylinder of radius R about the axis is tangent to both backs. The spine is
 * the wedge of that cylinder between the two halves' hinge ends (an annular sector, hollow inside, overlapping a
 * degree into each body): hidden when flat, progressively revealed as the phone folds, always a smooth rounded
 * corner continuous with both backs and never past them. Its outside is flattened by a plane on the bisector
 * (at R cos(a) + SPINE_FLAT R sin^2(a) from the axis, a = half the fold: SPINE_FLAT R when closed, R when flat), so closed it reads as the reference's flat
 * spine face, as wide as the stack, only about 0.8 mm proud of the hinge ends. */
// closed, the flat sits 0.29 mm out from the hinge ends' line, i.e. recessed behind the frames' rounded hinge edges
// (which stand EO = 0.48 mm out), so the two frame rails wrap a narrower inset spine as in the closed reference
const SPINE_FLAT = 0.03
const spineGeos = new Map<number, THREE.BufferGeometry>()
export function spineAt(swing: number) {
  const key = Math.round(THREE.MathUtils.radToDeg(swing) * 2)   // 0.5 degree steps
  let g = spineGeos.get(key)
  if (!g) { g = spineGeo(THREE.MathUtils.degToRad(key / 2)); spineGeos.set(key, g) }
  return g
}
function spineGeo(phi: number) {
  // R is 0.03 mm inside the backs; closed the outside is a flat panel (bisector plane at d), narrowed by pulling the two
  // back planes in by c (0 when open, so the cover stays tangent to both backs; RAIL.c when closed, so the panel shows
  // between the rails); a p-norm soft minimum rounds the panel's long edges
  const R = T + GAP - 0.0003, r0 = R * 0.45, a = phi / 2, d = R * Math.cos(a) + R * SPINE_FLAT * Math.sin(a) * Math.sin(a)
  // c (back planes pulled in) ramps in over the first 60 degrees, so the cover is recessed between the rails at every
  // angle beyond that; near flat it widens (del) into a strip just under the backs that closes the rails' V groove
  const cl = THREE.MathUtils.smoothstep(THREE.MathUtils.radToDeg(phi), 0, 60), cIn = RAIL.c * cl, P = 16, BS = 0.0005
  const dmax = Math.max(d, R * Math.cos(a) + 0.0001), del = THREE.MathUtils.degToRad(1.5 + 30 * (1 - cl)), N = 160
  const outer: [number, number][] = [], inner: [number, number][] = []
  for (let i = 0; i <= N; i++) {
    const t = -del + (phi + 2 * del) * i / N
    // distance limits along direction t: cylinder R, bisector plane, and the two back planes (normals at t = 0 and phi)
    const lim = [R, ...[[t - a, dmax], [t, R - cIn], [t - phi, R - cIn]].map(([u, D]) => Math.cos(u) > 1e-4 ? D / Math.cos(u) : 1)]
    const rho = Math.pow(lim.reduce((s, v) => s + Math.pow(v, -P), 0), -1 / P) - BS   // BS: the extrude bevel grows it back
    const ri = Math.min(r0, rho * 0.5)
    outer.push([-Math.sin(t) * rho, -Math.cos(t) * rho]); inner.push([-Math.sin(t) * ri, -Math.cos(t) * ri])
  }
  const sh = new THREE.Shape(outer.map(([x, z]) => new THREE.Vector2(x, -z)).concat(inner.reverse().map(([x, z]) => new THREE.Vector2(x, -z))))
  // ends: a small rounded cap 0.8 mm inside the frame's top and bottom faces (y = +-(H/2 + EO))
  const L = H + 2 * EO - 0.0016, b = 0.0008
  const g = new THREE.ExtrudeGeometry(sh, { depth: L - 2 * b, bevelEnabled: true, bevelThickness: b, bevelSize: BS, bevelSegments: 4, curveSegments: 4 })
  g.rotateX(-Math.PI / 2); g.translate(0, -(L - 2 * b) / 2, 0); return smooth(g)
}
/** Extrusions come with faceted normals; weld and recompute so rounded parts shade smoothly like the frame. */
function smooth(g: THREE.BufferGeometry) {
  g.deleteAttribute('normal'); g.deleteAttribute('uv')
  const m = mergeVertices(g, 1e-6); m.computeVertexNormals(); g.dispose(); return m
}
/** Hinge-side rails: RB back-corner radius, k slab inset, c how far the closed spine panel is pulled in from each back. */
const RAIL = { RB: 0.02, k: 0.021, c: 0.033 }
/** One half's rail along y, side +1 right half (x >= 0), -1 left. Profile in (x, z), back at z = -T/2: a fully rounded
 *  back corner reaching x = -EO (flush with the other frame edges), rolling back in to the hinge face at x = 0, which runs
 *  flat to a 0.5 mm screen-side corner; overlaps the slab by 4 mm. */
function railGeo(side: number) {
  const { RB, k } = RAIL, bv = 0.0012, xo = -EO + bv, rb = RB - bv   // the extrude bevel grows the profile by bv
  const xc = xo + rb, zc = -T / 2 + bv + rb, th = Math.acos(Math.min(1, xc / rb))
  const pts: [number, number][] = [[k + 0.004, -T / 2 + bv]]
  for (let i = 0; i <= 32; i++) { const al = -Math.PI / 2 - (Math.PI / 2 + th) * i / 32; pts.push([xc + rb * Math.cos(al), zc + rb * Math.sin(al)]) }
  pts.push([0.0005, T / 2 - bv - 0.0005], [0.0012, T / 2 - bv], [k + 0.004, T / 2 - bv])
  const sh = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(side * x, -z)))
  const L = H + 2 * EO
  const g = new THREE.ExtrudeGeometry(sh, { depth: L - 2 * bv, bevelEnabled: true, bevelThickness: bv, bevelSize: bv, bevelSegments: 4, curveSegments: 4 })
  g.rotateX(-Math.PI / 2); g.translate(0, -(L - 2 * bv) / 2, 0); return smooth(g)
}

// Inline JSX shapes cached by parameters so re-renders don't rebuild geometry.
const shapeCache = new Map<string, THREE.Shape>()
function rrC(w: number, h: number, r: number[], cx = 0) {
  const k = [w, h, ...r, cx].join('|'); let s = shapeCache.get(k)
  if (!s) shapeCache.set(k, s = rrect(w, h, r, cx)); return s
}
const USB_SHAPE = pill(0.09, 0.028)
export default memo(Duo)
