// Procedurally posed hands that hold the device. The hand models are the WebXR "generic-hand" assets
// (MIT, Amazon, github.com/immersive-web/webxr-input-profiles), see CREDITS.md. Each pose places the wrist
// relative to the device, seats the palm on it, then closes each finger joint by joint until its skin touches
// the device body (a rounded-box distance field built from the device's own measurements), so the grip fits
// the 18 Pro and the 18 Pro Max at their real sizes. The hands sit inside the device group, so they follow
// any camera angle.
import { Suspense, useEffect, useMemo, useRef } from 'react'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'

export type HandPose = 'off' | 'right' | 'left' | 'landscape' | 'pinch'
export const HAND_POSES: [HandPose, string][] = [['off', 'Off'], ['right', 'Right hand'], ['left', 'Left hand'], ['landscape', 'Two hands'], ['pinch', 'Present']]
export const SKIN_TONES: Record<string, { label: string; color: string; sheen: string }> = {
  light: { label: 'Light', color: '#f0c8ae', sheen: '#ffd9cf' },
  fair: { label: 'Fair', color: '#dfa98a', sheen: '#ffcbb8' },
  medium: { label: 'Medium', color: '#c08562', sheen: '#f2b498' },
  olive: { label: 'Olive', color: '#9f714f', sheen: '#d9a07c' },
  brown: { label: 'Brown', color: '#77503a', sheen: '#b9806a' },
  deep: { label: 'Deep', color: '#4a2f22', sheen: '#8a5a4a' },
}
/** Device body in model units (1 = 100 mm): width, height, thickness, corner radius, edge fillet. */
export interface HandFit { W: number; H: number; T: number; R: number; E: number }

const URL_R = '/hands/right.glb', URL_L = '/hands/left.glb'
const HAND_SCALE = 10 * 1.05   // asset is in metres; 1.05 gives an average adult hand, about 180 mm wrist to fingertip
const FINGERS = ['index-finger', 'middle-finger', 'ring-finger', 'pinky-finger'] as const
const JOINTS = ['metacarpal', 'phalanx-proximal', 'phalanx-intermediate', 'phalanx-distal', 'tip']
const THUMB = ['thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip']
const deg = THREE.MathUtils.degToRad
const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)

/** Signed distance from p to the device body (rounded rectangle slab with filleted edges). */
function sdf(p: THREE.Vector3, f: HandFit) {
  const qx = Math.abs(p.x) - (f.W / 2 - f.R), qy = Math.abs(p.y) - (f.H / 2 - f.R)
  const d2 = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - (f.R - f.E)
  const dz = Math.abs(p.z) - (f.T / 2 - f.E)
  return Math.hypot(Math.max(d2, 0), Math.max(dz, 0)) + Math.min(Math.max(d2, dz), 0) - f.E
}

/** Finger joint plan: fixed angles in degrees for [metacarpal, proximal, intermediate, distal], and whether the
 * proximal to distal joints keep closing past those angles until contact (up to max). spread turns the finger about the palm normal. */
interface FingerPlan { curl: [number, number, number, number]; close?: boolean; max?: [number, number, number]; spread?: number }
interface ThumbPlan { oppose: number; abduct: number; curl: [number, number, number]; close?: boolean; max?: [number, number] }
/** knuckle: where the middle finger's knuckle (MCP joint) goes. F: palm direction, wrist to knuckles. N: out of the palm. */
interface HandPlan { side: 'right' | 'left'; knuckle: THREE.Vector3; F: THREE.Vector3; N: THREE.Vector3; roll?: number; seat?: number; fingers: FingerPlan[]; thumb: ThumbPlan }

const mirror = (p: HandPlan): HandPlan => ({ ...p, side: p.side === 'right' ? 'left' : 'right', knuckle: v3(-p.knuckle.x, p.knuckle.y, p.knuckle.z), F: v3(-p.F.x, p.F.y, p.F.z), N: v3(-p.N.x, p.N.y, p.N.z) })

/** Poses in device space: x right and y up seen from the front, z out of the screen. Sizes scale with the device. */
function plans(pose: HandPose, f: HandFit): HandPlan[] {
  // Dev only: a test harness can override the plan to tune poses.
  const dbg = import.meta.env.DEV ? (globalThis as { __handPlan?: (f: HandFit, v: typeof v3) => HandPlan[] | undefined }).__handPlan?.(f, v3) : undefined
  if (dbg) return dbg
  const hw = f.W / 2, hh = f.H / 2, ht = f.T / 2
  // [spread, starting knuckle bend] for index, middle, ring, little finger. The index and little finger start bent
  // so they wrap the back with the others; every finger then closes until it touches.
  const wrap = (k: [number, number][]): FingerPlan[] => k.map(([spread, c]) => ({ curl: [0, c, 6, 4], close: true, max: [95, 95, 70], spread }))
  const grip: HandPlan = {
    // The right edge rests in the palm, the fingers wrap the back and reach the left edge, the thumb rests on the screen.
    side: 'right', knuckle: v3(hw - 0.02, -f.H * 0.14, -ht - 0.09), F: v3(-0.1, 0.9, -0.42), N: v3(-1, 0, 0), seat: 0.004,
    fingers: wrap([[2, 60], [0, 20], [-2, 20], [-5, 55]]),
    thumb: { oppose: 0, abduct: 40, curl: [0, 0, 0], close: true, max: [40, 40] },
  }
  if (pose === 'right') return [grip]
  if (pose === 'left') return [mirror(grip)]
  if (pose === 'landscape') {
    // The rig turns the device 90 degrees, so its bottom end is on the right. Each hand cups one end from below,
    // the end resting in the palm, fingers across the back and the thumb on the screen.
    const r: HandPlan = {
      side: 'right', knuckle: v3(-hw * 0.1, -hh + 0.02, -ht - 0.09), F: v3(0.9, -0.1, -0.42), N: v3(0, 1, 0), seat: 0.004,
      fingers: wrap([[2, 60], [0, 20], [-2, 20], [-5, 55]]),
      thumb: { oppose: 0, abduct: 40, curl: [0, 0, 0], close: true, max: [40, 40] },
    }
    const flipY = (v: THREE.Vector3) => v3(v.x, -v.y, v.z)
    return [r, { ...r, side: 'left', knuckle: flipY(r.knuckle), F: flipY(r.F), N: flipY(r.N) }]
  }
  if (pose === 'pinch') return [{
    // Presenting: the lower right corner held in the fingertips, thumb on the screen edge, ring and little finger tucked.
    side: 'right', knuckle: v3(hw + 0.14, -hh * 0.6, -ht - 0.1), F: v3(-0.25, 0.85, -0.45), N: v3(-1, 0, 0.1), seat: 0.03,
    fingers: [{ curl: [0, 35, 6, 4], close: true, max: [95, 95, 70], spread: 3 }, { curl: [0, 30, 6, 4], close: true, max: [95, 95, 70] },
      { curl: [0, 70, 75, 40], spread: -3 }, { curl: [0, 75, 80, 45], spread: -7 }],
    thumb: { oppose: 0, abduct: 30, curl: [0, 0, 0], close: true, max: [45, 45] },
  }]
  return []
}

// ---------- skin material, shared and cached ----------
let poreTex: THREE.DataTexture | null = null
function pores() {
  if (poreTex) return poreTex
  const n = 256, d = new Uint8Array(n * n * 4)
  for (let i = 0; i < n * n; i++) {
    const r = Math.random(), v = 150 + (r > 0.93 ? 70 : r * 40)   // mostly satin, sparse rougher pores
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255
  }
  poreTex = new THREE.DataTexture(d, n, n); poreTex.wrapS = poreTex.wrapT = THREE.RepeatWrapping; poreTex.repeat.set(6, 6)
  poreTex.magFilter = THREE.LinearFilter; poreTex.generateMipmaps = true; poreTex.minFilter = THREE.LinearMipmapLinearFilter; poreTex.needsUpdate = true
  return poreTex
}
function skinMaterial(tone: string) {
  const t = SKIN_TONES[tone] ?? SKIN_TONES.fair
  // Physically based skin: satin roughness with pores, a warm sheen for the soft rim glow, a touch of transmission
  // with a red attenuation for light passing through thin edges (fingertips, webbing).
  return new THREE.MeshPhysicalMaterial({
    color: t.color, roughness: 0.58, roughnessMap: pores(), metalness: 0, specularIntensity: 0.45, ior: 1.4,
    sheen: 0.7, sheenColor: new THREE.Color(t.sheen), sheenRoughness: 0.5, clearcoat: 0.06, clearcoatRoughness: 0.6,
    transmission: 0.04, thickness: 0.12, attenuationColor: new THREE.Color('#b8322a'), attenuationDistance: 0.25,
  })
}

// ---------- rest data and posing ----------
interface Rig { root: THREE.Object3D; mesh: THREE.SkinnedMesh; bones: Record<string, THREE.Bone>; rest: Record<string, { p: THREE.Vector3; q: THREE.Quaternion }>; owner: string[] }
function makeRig(src: THREE.Object3D): Rig {
  const root = cloneSkinned(src)
  let mesh: THREE.SkinnedMesh | null = null
  const bones: Rig['bones'] = {}, rest: Rig['rest'] = {}
  root.traverse(o => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) mesh = o as THREE.SkinnedMesh
    if ((o as THREE.Bone).isBone) { bones[o.name] = o as THREE.Bone; rest[o.name] = { p: o.position.clone(), q: o.quaternion.clone() } }
  })
  const m = mesh! as THREE.SkinnedMesh
  m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false
  // owner[v] = name of the bone with the largest weight on vertex v
  const si = m.geometry.getAttribute('skinIndex'), sw = m.geometry.getAttribute('skinWeight'), owner: string[] = []
  for (let v = 0; v < si.count; v++) {
    let best = 0, bi = 0
    for (let k = 0; k < 4; k++) { const w = sw.getComponent(v, k); if (w > best) { best = w; bi = si.getComponent(v, k) } }
    owner.push(m.skeleton.bones[bi].name)
  }
  return { root, mesh: m, bones, rest, owner }
}

const _m = new THREE.Matrix4(), _t = new THREE.Matrix4(), _r = new THREE.Matrix4(), _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3()
/** Rotation by ang about an axis through pivot, appended to M. */
function hinge(M: THREE.Matrix4, pivot: THREE.Vector3, axis: THREE.Vector3, ang: number) {
  _t.makeTranslation(pivot.x, pivot.y, pivot.z); _r.makeRotationAxis(axis, ang)
  M.multiply(_t).multiply(_r).multiply(_m.makeTranslation(-pivot.x, -pivot.y, -pivot.z))
}
function setBone(rig: Rig, name: string, M: THREE.Matrix4) {
  const r = rig.rest[name], b = rig.bones[name]
  _m.compose(r.p, r.q, _s.set(1, 1, 1)).premultiply(M).decompose(b.position, b.quaternion, _s)
}

function solve(rig: Rig, plan: HandPlan, fit: HandFit) {
  const R = rig.rest, P = (n: string) => R[n].p
  const h = plan.side === 'right' ? 1 : -1
  // Rest frame: F along the palm to the middle knuckle, N out of the palm.
  const wrist = P('wrist'), F0 = P('middle-finger-phalanx-proximal').clone().sub(wrist).normalize()
  const across = P('index-finger-phalanx-proximal').clone().sub(P('pinky-finger-phalanx-proximal'))
  const N0 = F0.clone().cross(across).multiplyScalar(-h).normalize()
  N0.sub(F0.clone().multiplyScalar(N0.dot(F0))).normalize()
  // Target frame.
  const F1 = plan.F.clone().normalize(), N1 = plan.N.clone().sub(F1.clone().multiplyScalar(plan.N.dot(F1))).normalize()
  const B0 = F0.clone().cross(N0), B1 = F1.clone().cross(N1)
  const A = new THREE.Matrix4().makeBasis(F0, N0, B0), Bm = new THREE.Matrix4().makeBasis(F1, N1, B1)
  const rot = Bm.multiply(A.transpose())
  rig.root.quaternion.setFromRotationMatrix(rot)
  rig.root.scale.setScalar(HAND_SCALE)
  rig.root.position.copy(plan.knuckle).sub(P('middle-finger-phalanx-proximal').clone().multiplyScalar(HAND_SCALE).applyQuaternion(rig.root.quaternion))

  // Reset bones.
  for (const n in rig.bones) { rig.bones[n].position.copy(R[n].p); rig.bones[n].quaternion.copy(R[n].q) }
  const pos = rig.mesh.geometry.getAttribute('position')
  const update = () => rig.root.updateMatrixWorld(true)
  const distAt = (i: number) => { _v.fromBufferAttribute(pos, i); rig.mesh.applyBoneTransform(i, _v); return sdf(_v.applyMatrix4(rig.mesh.matrixWorld), fit) }
  const minDist = (filter: (b: string) => boolean) => {
    let d = Infinity
    for (let i = 0; i < pos.count; i++) {
      if (!filter(rig.owner[i])) continue
      _v.fromBufferAttribute(pos, i); rig.mesh.applyBoneTransform(i, _v); _v.applyMatrix4(rig.mesh.matrixWorld)
      const s = sdf(_v, fit); if (s < d) d = s
    }
    return d
  }
  // Seat the palm on the device: move along the palm normal until the palm just touches (plus a hair of gap).
  update()
  if (plan.seat !== undefined) {
    const palm = (b: string) => b === 'wrist' || b.endsWith('metacarpal') && !b.startsWith('thumb')
    for (let it = 0; it < 6; it++) {
      const d = minDist(palm)
      if (!isFinite(d) || Math.abs(d - plan.seat) < 0.0005) break
      rig.root.position.addScaledVector(N1, d - plan.seat); update()
    }
  }

  // Fingers: forward kinematics down each chain, closing joints until contact.
  const curlAxis = (a: string, b: string) => { const d = P(b).clone().sub(P(a)).normalize(); return d.cross(N0).normalize() }
  const chainPose = (names: string[], axes: THREE.Vector3[], angles: number[], pre?: (M: THREE.Matrix4) => void) => {
    const M = new THREE.Matrix4()
    if (pre) pre(M)
    names.forEach((n, i) => { if (i < angles.length) hinge(M, P(n), axes[i], angles[i]); setBone(rig, n, M) })
  }
  const close = (names: string[], axes: THREE.Vector3[], angles: number[], from: number, max: number[], pre?: (M: THREE.Matrix4) => void) => {
    const set = new Set(names)
    for (let j = from; j < names.length - 1; j++) {
      const below = new Set(names.slice(j))
      const limit = deg(max[j - from] ?? 60), part = (b: string) => below.has(b) && set.has(b)
      // Skin already resting on the device at the start (the knuckle by a seated palm) does not count as new contact.
      const free: number[] = []
      for (let i = 0; i < pos.count; i++) if (part(rig.owner[i]) && distAt(i) > 0.0008) free.push(i)
      while (angles[j] < limit) {
        angles[j] += deg(2)
        chainPose(names, axes, angles, pre); update()
        if (free.some(i => distAt(i) < 0.0008)) { angles[j] -= deg(2); break }
      }
      chainPose(names, axes, angles, pre); update()
    }
  }
  FINGERS.forEach((fn, i) => {
    const fp = plan.fingers[i], names = JOINTS.map(j => `${fn}-${j}`)
    const axes = names.slice(0, 4).map((n, k) => curlAxis(n, names[k + 1]))
    const angles = fp.curl.map(deg)
    const pre = fp.spread ? (M: THREE.Matrix4) => hinge(M, P(names[1]), N0, deg(fp.spread!) * h) : undefined
    chainPose(names, axes, angles, pre); update()
    if (fp.close) close(names, axes, angles, 1, fp.max ?? [80, 90, 70], pre)
  })
  // Thumb: opposition turns it about the palm's long axis, abduction swings it out from the index; then it closes.
  const tp = plan.thumb, axesT = THUMB.slice(0, 3).map((n, k) => curlAxis(n, THUMB[k + 1]))
  const preT = (M: THREE.Matrix4) => { hinge(M, P(THUMB[0]), F0, deg(tp.oppose) * -h); hinge(M, P(THUMB[0]), N0, deg(tp.abduct) * h) }
  const angT = tp.curl.map(deg)
  chainPose(THUMB, axesT, angT, preT); update()
  if (tp.close) close(THUMB, axesT, angT, 1, tp.max ?? [50, 45], preT)
  update()
}

/** Wraps the device: turns it for landscape and adds the posed hands, which Centred leaves out of its bounds. */
export function HandRig({ pose, tone, fit, children }: { pose: HandPose; tone: string; fit: HandFit | null; children: React.ReactNode }) {
  const on = pose !== 'off' && !!fit
  return (
    <group rotation={[0, 0, on && pose === 'landscape' ? Math.PI / 2 : 0]}>
      {children}
      {on && <Suspense fallback={null}><Hands pose={pose} tone={tone} fit={fit!} /></Suspense>}
    </group>)
}

function Hands({ pose, tone, fit }: { pose: HandPose; tone: string; fit: HandFit }) {
  const right = useGLTF(URL_R), left = useGLTF(URL_L)
  const group = useRef<THREE.Group>(null)
  const rigs = useMemo(() => ({ right: makeRig(right.scene), left: makeRig(left.scene) }), [right.scene, left.scene])
  const mat = useMemo(() => skinMaterial(tone), [tone])
  useEffect(() => () => mat.dispose(), [mat])
  useEffect(() => { rigs.right.mesh.material = mat; rigs.left.mesh.material = mat }, [rigs, mat])
  useEffect(() => {
    const g = group.current; if (!g) return
    const list = plans(pose, fit)
    for (const pl of list) { const r = rigs[pl.side]; solve(r, pl, fit); g.add(r.root) }
    return () => { for (const r of [rigs.right, rigs.left]) g.remove(r.root) }
  }, [pose, fit, rigs])
  return <group ref={group} userData={{ noBounds: true }} />
}
useGLTF.preload(URL_R); useGLTF.preload(URL_L)

if (import.meta.hot) import.meta.hot.dispose(() => { poreTex?.dispose(); poreTex = null })
