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

function Duo({ texture, mediaAspect, opts }: DeviceProps) {
  const f = FINISHES[opts.finish as keyof typeof FINISHES] ?? FINISHES.night
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
    const udc = new THREE.CircleGeometry(0.014, 24)
    return { rightBody, leftBody, bezelR, bezelL, scrR, scrL, outer, island, udc }
  }, [])
  useEffect(() => () => Object.values(g).forEach(x => x.dispose()), [g])
  const swing = THREE.MathUtils.degToRad(180 - opts.fold)
  const spine = useMemo(() => hingeSpine(swing), [swing])
  useEffect(() => () => spine?.g.dispose(), [spine])
  const shiftX = (W / 2) * (1 - opts.fold / 180)
  const frameMat = <meshPhysicalMaterial color={f.frame} metalness={0.9} roughness={0.28} clearcoat={0.3} />
  const glassBack = <meshPhysicalMaterial color={f.back} metalness={0.1} roughness={0.55} clearcoat={0.6} clearcoatRoughness={0.4} />
  // Which content each screen shows. At rest only the selected screen lights up, sharp. During a fold transition both
  // show the media, with the dissolve on the moving half: strength follows the fold angle (full by 90 degrees away
  // from the screen's own resting angle), then a lag clears it on the incoming screen after the hinge settles.
  const S = (opts.foldBlur ?? 0.6) * 0.09, tr = opts.trans, root = useRef<THREE.Group>(null)
  const sm = (a: number, b: number, x: number) => THREE.MathUtils.smoothstep(x, a, b)
  // outgoing: grows with the angle away from its resting fold; incoming: the measured dissolve-in curve
  const [bi, di] = tr ? dissolveIn(tr.p) : [0, 0]
  const away = (w: 'inner' | 'outer') => sm(0, 1, (w === 'inner' ? 180 - opts.fold : opts.fold) / 90)
  const ml = (w: 'inner' | 'outer'): [number, number] => !tr ? [0, 0] : tr.to === w ? [Math.max(bi, away(w)), Math.max(di, away(w))] : [away(w), away(w)]
  const [mi, mdi] = ml('inner'), [mo, mdo] = ml('outer')
  const on = (w: 'inner' | 'outer') => tr || opts.screen === w ? 1 : 0
  const fixedL: Look = { on: on('inner'), m: 0, md: 0, proj: 0 }, movingL: Look = { on: on('inner'), m: mi, md: mdi, proj: tr ? sm(70, 160, opts.fold) : 0 }, outerL: Look = { on: on('outer'), m: mo, md: mdo, proj: 0 }
  const screenMat = (l: Look, aspect: number) => <ScreenMaterial tex={texture} media={mediaAspect} aspect={aspect} blur={S} look={l} root={root} />
  const zf = T / 2 + E          // front face layers
  // Free edge buttons (right half, x = W, viewed with the outer screen facing you they sit on the right).
  const btn = (y: number, len: number, key: string, extra = 0) => (
    <mesh key={key} position={[W + 0.0015 + extra / 2, y, 0]} castShadow>
      <boxGeometry args={[0.006 + extra, len, T * 0.42]} />{frameMat}
    </mesh>)
  const logo = opts.logo
  return (
    <group position={[-shiftX, 0, 0]}>
      <group ref={root} />
      {/* ---------- right half (fixed) ---------- */}
      <mesh geometry={g.rightBody} castShadow>{frameMat}</mesh>
      <mesh geometry={g.bezelR} position={[0, 0, zf]}><meshPhysicalMaterial color="#050506" roughness={0.12} clearcoat={1} /></mesh>
      <mesh geometry={g.scrR} position={[0, 0, zf + E]}>{screenMat(fixedL, INNER_ASPECT)}</mesh>
      {/* inner under-display FaceTime camera (Dynamic Island area): 34 mm from hinge, 12.7 mm from top */}
      <mesh geometry={g.udc} position={[0.34, H / 2 - 0.127, zf + E * 3]} renderOrder={2}>
        <meshBasicMaterial color="#000" transparent opacity={0.45} polygonOffset polygonOffsetFactor={-2} /></mesh>
      {/* back glass */}
      <mesh position={[0, 0, -T / 2 - E]} rotation={[0, Math.PI, 0]}>
        <shapeGeometry args={[rrC(W - 0.004, H - 0.004, [CR - 0.004, HR, HR, CR - 0.004], -W / 2), 24]} />{glassBack}
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
      {spine && <group matrixAutoUpdate={false} matrix={spine.m}>
        <mesh geometry={spine.g}><meshPhysicalMaterial color={f.frame} metalness={1} roughness={0.14} clearcoat={0.4} /></mesh>
        {[1, -1].map(k => <mesh key={k} position={[0, k * (H / 2 - 0.1), SPINE_TH + 0.0002]}><planeGeometry args={[spine.w * 0.98, 0.0035]} /><meshStandardMaterial color="#5c6068" metalness={0.3} roughness={0.6} /></mesh>)}
      </group>}
      {/* ---------- left half (swings) ---------- */}
      <group position={[0, 0, T / 2 + GAP]} rotation={[0, swing, 0]}>
        <group position={[0, 0, -T / 2 - GAP]}>
          <mesh geometry={g.leftBody} castShadow>{frameMat}</mesh>
          {/* USB-C on the bottom edge, about 43 mm from the hinge */}
          <mesh position={[-0.43, -H / 2 - 0.0005, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <shapeGeometry args={[USB_SHAPE]} /><meshBasicMaterial color="#050506" side={THREE.DoubleSide} /></mesh>
          {/* top edge speaker grille, 36 to 51 mm from the hinge */}
          {[0, 1, 2, 3, 4, 5].map(i => (
            <mesh key={i} position={[-0.365 - i * 0.028, H / 2 + 0.0005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <circleGeometry args={[0.007, 12]} /><meshBasicMaterial color="#050506" side={THREE.DoubleSide} /></mesh>))}
          <mesh geometry={g.bezelL} position={[0, 0, zf]}><meshPhysicalMaterial color="#050506" roughness={0.12} clearcoat={1} /></mesh>
          <mesh geometry={g.scrL} position={[0, 0, zf + E]}>{screenMat(movingL, INNER_ASPECT)}</mesh>
          {/* outer display on the back, cover glass then screen */}
          <group position={[-W / 2, 0, -T / 2]} rotation={[0, Math.PI, 0]}>
            <mesh position={[0, 0, E]}><shapeGeometry args={[rrC(W - 0.03, H - 0.03, [HR, CR - 0.012, CR - 0.012, HR]), 24]} />
              <meshPhysicalMaterial color="#050506" roughness={0.12} clearcoat={1} /></mesh>
            <mesh geometry={g.outer} position={[0, 0, E * 2]}>{screenMat(outerL, OUTER_ASPECT)}</mesh>
            <group position={[W / 2 - 0.105, H / 2 - 0.103, 0]}><Overlay geo={g.island} z={E * 4} /></group>
          </group>
        </group>
      </group>
    </group>
  )
}
/** Fold angle at time t (0 to 1) of a transition, timed on Apple's hero film (apple.com/ca/iphone-duo, 30 fps):
 * the hinge swings in the first 28% (about 0.28 s) with an ease-in-out, rebounds about 2 degrees and settles by 40%;
 * the rest is the dissolve clearing on the incoming screen. Stays in 0..180. */
export function foldCurve(from: number, to: number, t: number) {
  const k = Math.min(1, t / 0.28), main = 0.5 - Math.cos(Math.PI * k) / 2
  const u = THREE.MathUtils.clamp((t - 0.28) / 0.12, 0, 1), rebound = 2 * Math.sin(Math.PI * u) * (1 - u)
  return Math.min(180, Math.max(0, from + (to - from) * main - Math.sign(to - from) * rebound))
}
export const FOLD_MS = 1000
/** Incoming screen's dissolve over the transition, measured from the hero film: full blur and darkening on the
 * moving half as it arrives, the darkening easing off a little while the blur holds, then both clear together
 * between about 0.7 and 0.95 s (the blur snapping back last). Returns [blur, dark] strengths 0 to 1. */
export function dissolveIn(t: number): [number, number] {
  const sm = (a: number, b: number, x: number) => THREE.MathUtils.smoothstep(x, a, b)
  return [1 - sm(0.72, 0.95, t), t < 0.7 ? 1 - 0.15 * sm(0.28, 0.7, t) : 0.85 * (1 - sm(0.7, 0.98, t))]
}

/** The "dissolve" (Apple's fold transition): the moving half's content stays put in space, as if seen through the
 * panel, and frosts over. m is the strength 0 to 1 (from the fold angle while moving, then a short lag that
 * clears it); the blur covers the half (ramping in over the 30% nearest the hinge) and the darkening runs from 35% at the hinge to 80% at the free edge. Blur radius is in screen heights. */
interface Look { on: number; m: number; md: number; proj: number }
const SCREEN_VS = `uniform mat4 toRoot; varying vec2 vUv; varying vec3 vRoot;
void main() { vUv = uv; vRoot = (toRoot * modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`
const SCREEN_FS = `uniform sampler2D map; uniform float has, blur, m, md, proj, aspect, plane, sw, sh; uniform vec2 rep, off; uniform vec3 eye;
varying vec2 vUv; varying vec3 vRoot;
void main() {
  vec3 idle = vec3(0.0024, 0.0027, 0.0037), c = idle;
  if (has > 0.5) {
    vec2 st = vUv; float e = vUv.x;
    if (proj > 0.001) {
      // fixed front-view projection onto the open inner-screen plane: the image holds still while the half turns.
      // Blended in from 70 to 160 degrees; nearer edge-on the projection would smear, so it uses the panel's own uv.
      float d = (plane - eye.z) / (vRoot.z - eye.z); vec2 p = eye.xy + (vRoot.xy - eye.xy) * d;
      st = mix(vUv, vec2(p.x / (2.0 * sw) + 0.5, p.y / sh + 0.5), proj); e = clamp(1.0 - 2.0 * vUv.x, 0.0, 1.0);
    }
    float r = blur * m * smoothstep(0.0, 0.3, e);
    float dark = min(0.8, md * (0.35 + 0.6 * smoothstep(0.0, 1.0, e)));
    vec2 uv = st * rep + off;
    if (r < 0.0004) c = texture2D(map, clamp(uv, off, off + rep)).rgb;
    else {
      float bias = clamp(log2(r * 1400.0) - 1.0, 0.0, 7.0); c = vec3(0.0);
      for (int i = 0; i < 32; i++) {
        float a = float(i) * 2.39996, q = sqrt((float(i) + 0.5) / 32.0) * r;
        c += texture2D(map, clamp(uv + vec2(cos(a) / aspect, sin(a)) * q * rep, off, off + rep), bias).rgb;
      }
      c /= 32.0;
    }
    c = mix(c, idle, dark);
  }
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`
const _inv = new THREE.Matrix4()
function ScreenMaterial({ tex, media, aspect, blur, look, root }: { tex: THREE.Texture | null; media: number; aspect: number; blur: number; look: Look; root: React.RefObject<THREE.Group | null> }) {
  const m = useMemo(() => new THREE.ShaderMaterial({ vertexShader: SCREEN_VS, fragmentShader: SCREEN_FS, toneMapped: false, uniforms: {
    map: { value: null }, has: { value: 0 }, blur: { value: 0 }, m: { value: 0 }, md: { value: 0 }, proj: { value: 0 }, aspect: { value: 1 }, rep: { value: new THREE.Vector2(1, 1) }, off: { value: new THREE.Vector2() },
    toRoot: { value: new THREE.Matrix4() }, eye: { value: new THREE.Vector3(0, 0, 4) }, plane: { value: T / 2 + E * 2 }, sw: { value: SW }, sh: { value: SH } } }), [])
  useEffect(() => () => m.dispose(), [m])
  useFrame(() => { if (root.current) m.uniforms.toRoot.value.copy(_inv.copy(root.current.matrixWorld).invert()) })
  const u = m.uniforms
  u.map.value = look.on ? tex : null; u.has.value = look.on && tex ? 1 : 0; u.blur.value = blur; u.m.value = look.m; u.md.value = look.md; u.proj.value = look.proj; u.aspect.value = aspect
  // cover fit, as fitTexture does: crop the sides of wide media, keep the top of tall media
  if (media > aspect) { const k = aspect / media; u.rep.value.set(k, 1); u.off.value.set((1 - k) / 2, 0) }
  else { const k = media / aspect; u.rep.value.set(1, k); u.off.value.set(0, 1 - k) }
  if (tex) { tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; if (tex.minFilter !== THREE.LinearMipmapLinearFilter) { tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true; tex.needsUpdate = true } }
  return <primitive object={m} attach="material" />
}

const SPINE_TH = 0.012   // 1.2 mm thick strip
/** Spine strip for a swing angle: on the bisector of the two halves, its inner face on the chord between their back
 * corners (both at radius T + GAP from the hinge axis), so its width is that chord. Returns the geometry, its width
 * and the placement matrix (x across the strip, y along the hinge, z outward). */
function hingeSpine(swing: number) {
  const R = T + GAP, a = swing / 2, w = 2 * R * Math.sin(a)
  if (w < 0.006) return null
  const rEnd = Math.min(w / 2, 0.035), shape = rrect(w, H - 0.002, [rEnd, rEnd, rEnd, rEnd])
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
