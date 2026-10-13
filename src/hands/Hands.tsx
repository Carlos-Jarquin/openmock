// Procedurally posed hands that hold the device. The hand models are the WebXR "generic-hand" assets
// (MIT, Amazon, github.com/immersive-web/webxr-input-profiles), see CREDITS.md. Each pose places the wrist
// relative to the device, seats the palm on it, then closes each finger joint by joint until its skin touches
// the device body (a rounded-box distance field built from the device's own measurements), so the grip fits
// the 18 Pro and the 18 Pro Max at their real sizes. The hands sit inside the device group, so they follow
// any camera angle.
import { Suspense, useEffect, useMemo, useRef } from 'react'
import { useGLTF } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { spectralMaterials, buildSpectral, updateSpectral, addHull, removeHull, SPECTRAL_DEFAULTS, type SpectralOptions, type SpectralMats } from './spectral'
import { LINE_LAYER } from '../sketch/Sketch'
import * as THREE from 'three'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { ptToDevice, screenOf, swipeAt, isGesture, ScreenTarget, GESTURE_DEFAULT, type Gesture } from './gestures'

export type HandPose = 'off' | 'right' | 'left' | 'landscape' | 'pinch' | 'hold' | 'tap' | 'swipe' | 'zoom' | 'thumb' | 'holdtap'
export const HAND_POSES: [HandPose, string][] = [['off', 'Off'], ['right', 'Right hand'], ['left', 'Left hand'], ['landscape', 'Two hands'], ['pinch', 'Present'], ['hold', 'Hold up'],
  ['tap', 'Tap'], ['swipe', 'Swipe'], ['zoom', 'Pinch to zoom'], ['thumb', 'Thumb scroll'], ['holdtap', 'Hold and tap']]
export const SKIN_TONES: Record<string, { label: string; color: string; sheen: string }> = {
  light: { label: 'Light', color: '#f0c8ae', sheen: '#ffd9cf' },
  fair: { label: 'Fair', color: '#dfa98a', sheen: '#ffcbb8' },
  medium: { label: 'Medium', color: '#c08562', sheen: '#f2b498' },
  olive: { label: 'Olive', color: '#9f714f', sheen: '#d9a07c' },
  brown: { label: 'Brown', color: '#77503a', sheen: '#b9806a' },
  deep: { label: 'Deep', color: '#4a2f22', sheen: '#8a5a4a' },
  silhouette: { label: 'Silhouette', color: '#2b2346', sheen: '#a894ff' },
  spectral: { label: 'Spectral', color: '#206DD0', sheen: '#206DD0' },
}
/** Device body in model units (1 = 100 mm): width, height, thickness, corner radius, edge fillet. */
export interface HandFit { W: number; H: number; T: number; R: number; E: number; SW?: number; SH?: number; PW?: number; PH?: number }

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
/** tip: where the fingertip pad should rest (device space). When set, the finger's spread and curls are solved to reach it. */
/** touch: tip is a point on the glass; the solver lands the fingertip pad there, resting on the surface. */
interface FingerPlan { curl: [number, number, number, number]; close?: boolean; max?: [number, number, number]; spread?: number; tip?: THREE.Vector3; touch?: boolean }
interface ThumbPlan { oppose: number; abduct: number; curl: [number, number, number]; close?: boolean; max?: [number, number]; tip?: THREE.Vector3; touch?: boolean }
/** follow: the whole hand (wrist and arm) moves so its touching digits reach their points without strain. */
/** knuckle: where the middle finger's knuckle (MCP joint) goes. F: palm direction, wrist to knuckles. N: out of the palm. */
interface HandPlan { side: 'right' | 'left'; knuckle: THREE.Vector3; F: THREE.Vector3; N: THREE.Vector3; roll?: number; seat?: number; follow?: boolean; fingers: FingerPlan[]; thumb: ThumbPlan }

const mx = (v: THREE.Vector3) => v3(-v.x, v.y, v.z)
const mt = <T extends { tip?: THREE.Vector3 }>(o: T): T => ({ ...o, tip: o.tip && mx(o.tip) })
const mirror = (p: HandPlan): HandPlan => ({ ...p, side: p.side === 'right' ? 'left' : 'right', knuckle: mx(p.knuckle), F: mx(p.F), N: mx(p.N), fingers: p.fingers.map(mt), thumb: mt(p.thumb) })

/** Poses in device space: x right and y up seen from the front, z out of the screen. Sizes scale with the device. */
function plans(pose: HandPose, f: HandFit, ges: Gesture = GESTURE_DEFAULT): HandPlan[] {
  // Dev only: a test harness can override the plan to tune poses.
  const dbg = import.meta.env.DEV ? (globalThis as { __handPlan?: (f: HandFit, v: typeof v3) => HandPlan[] | undefined }).__handPlan?.(f, v3) : undefined
  if (dbg) return dbg
  const hw = f.W / 2, hh = f.H / 2, ht = f.T / 2
  // [spread, starting knuckle bend] for index, middle, ring, little finger. The index and little finger start bent
  // so they wrap the back with the others; every finger then closes until it touches.
  const wrap = (k: [number, number][]): FingerPlan[] => k.map(([spread, c]) => ({ curl: [0, c, 6, 4], close: true, max: [95, 95, 70], spread }))
  // Fingertip targets: the solver bends each chain until its tip reaches the target without entering the phone.
  const back = (x: number, y: number, spread: number): FingerPlan => ({ curl: [0, 20, 6, 4], spread, tip: v3(x, y, -ht - 0.05) })
  const edge = (y: number, spread: number): FingerPlan => ({ curl: [0, 20, 6, 4], spread, tip: v3(-hw - 0.045, y, -ht * 0.25) })
  const grip: HandPlan = {
    // The right edge rests in the palm, the thumb lies along the right frame, the fingertips reach the left edge
    // and the little finger supports the bottom.
    side: 'right', knuckle: v3(hw + 0.12, -hh * 0.42, -ht - 0.1), F: v3(-0.1, 0.9, -0.42), N: v3(-0.85, 0, 0.5), seat: 0.004,
    fingers: [edge(-f.H * 0.02, 2), edge(-f.H * 0.15, 0), edge(-f.H * 0.28, -3),
      { curl: [0, 50, 40, 20], spread: -6, tip: v3(hw * 0.2, -hh - 0.05, -ht * 0.3) }],
    thumb: { oppose: 0, abduct: 0, curl: [0, 0, 0], tip: v3(hw + 0.055, -hh * 0.05, ht * 0.2) },
  }
  if (pose === 'right') return [grip]
  if (isGesture(pose)) {
    const P = (x: number, y: number) => ptToDevice(f, x, y), u = screenOf(f).unit
    // Middle, ring and little finger loosely closed into the palm, clear of the glass.
    const fist: FingerPlan[] = [{ curl: [0, 62, 80, 45], spread: -1 }, { curl: [0, 70, 85, 45], spread: -4 }, { curl: [0, 76, 85, 45], spread: -8 }]
    // Pointing: the right hand comes in from the lower right, palm towards the glass, index angled down onto the
    // point and the thumb resting against the side of the middle finger. The wrist sits a fixed reach behind the point.
    const pointer = (t: THREE.Vector3): HandPlan => ({ side: 'right', knuckle: t.clone().add(v3(0.35, -0.55, 0.7)), F: v3(-0.3, 0.72, -0.55), N: v3(0.15, 0.5, -1), follow: true,
      fingers: [{ curl: [0, 18, 22, 12], tip: t, touch: true }, ...fist], thumb: { oppose: -20, abduct: -10, curl: [10, 30, 30] } })
    const tw = import.meta.env.DEV ? (globalThis as { __gestTweak?: (p: HandPlan[], v: typeof v3) => HandPlan[] }).__gestTweak : undefined
    if (tw) return tw(gesturePlans(), v3)
    return gesturePlans()
    function gesturePlans(): HandPlan[] {
    if (pose === 'tap') return [pointer(P(ges.x, ges.y))]
    if (pose === 'swipe') { const a = swipeAt(ges); return [pointer(P(a.x, a.y))] }
    if (pose === 'holdtap') return [mirror(grip), pointer(P(ges.x, ges.y))]
    if (pose === 'zoom') {
      // Thumb and index spread on the glass about the centre, along the pinch axis (the thumb on the lower left end).
      const a = deg(ges.angle), dx = Math.cos(a) * ges.spread / 2, dy = -Math.sin(a) * ges.spread / 2
      const ti = P(ges.x + dx, ges.y + dy), tt = P(ges.x - dx, ges.y - dy), c = ti.clone().add(tt).multiplyScalar(0.5)
      return [{ side: 'right', knuckle: c.clone().add(v3(0.3, -0.75, 0.55)), F: v3(-0.35, 0.7, -0.55), N: v3(0.1, 0.45, -1), follow: true,
        fingers: [{ curl: [0, 20, 20, 10], spread: 4, tip: ti, touch: true }, ...fist],
        thumb: { oppose: 20, abduct: 40, curl: [0, 10, 10], tip: tt, touch: true } }]
    }
    // Thumb scroll: the one-handed grip slides up or down the frame to follow the point, and the thumb reaches across.
    const t = P(ges.x, ges.y), dy = Math.min(hh * 0.5, Math.max(-hh * 0.5, t.y + hh * 0.05 + 0.35 * (hw - t.x))) - (-hh * 0.05), sh = (v?: THREE.Vector3) => v && v.clone().setY(v.y + dy)
    return [{ ...grip, knuckle: sh(grip.knuckle)!, fingers: grip.fingers.map(fp => ({ ...fp, tip: sh(fp.tip) })),
      thumb: { oppose: 0, abduct: 10, curl: [0, 0, 0], tip: t, touch: true } }]
    }
  }
  if (pose === 'hold') {
    const hold = (y: number, spread: number): FingerPlan => ({ curl: [0, 20, 6, 4], spread, tip: v3(-hw - 0.075, y, ht * 0.1) })
    // Held up from the lower right: palm behind the lower right of the phone, the wrist dropping out of frame,
    // fingertips curling round the left edge and the thumb on the right frame.
    const g = (globalThis as { __holdTweak?: Partial<HandPlan> }).__holdTweak
    return [{ ...grip, knuckle: v3(hw + 0.08, -hh * 0.3, -ht - 0.12), F: v3(-0.25, 0.9, -0.38), N: v3(-0.8, 0.05, 0.55), seat: 0.006,
      fingers: [hold(hh * 0.05, 3), hold(-hh * 0.15, 0), hold(-hh * 0.35, -3), hold(-hh * 0.55, -6)],
      thumb: { oppose: 0, abduct: 0, curl: [0, 0, 0], tip: v3(hw + 0.05, hh * 0.18, ht * 0.25) }, ...(import.meta.env.DEV ? g : {}) }]
  }
  if (pose === 'left') return [mirror(grip)]
  if (pose === 'landscape') {
    // The rig turns the device 90 degrees, so its bottom end is on the right. Each hand cups one end from below:
    // thumb on the end frame, fingers spread across its own half of the back, little finger under the long edge.
    const r: HandPlan = {
      side: 'right', knuckle: v3(-hw * 0.1, -hh + 0.02, -ht - 0.09), F: v3(0.9, -0.1, -0.42), N: v3(0, 1, 0), seat: 0.004,
      fingers: [back(hw * 0.7, -hh + 0.48, 2), back(hw * 0.25, -hh + 0.5, 0), back(-hw * 0.25, -hh + 0.44, -3),
        { curl: [0, 40, 30, 20], spread: -6, tip: v3(-hw - 0.05, -hh + 0.17, -ht * 0.3) }],
      thumb: { oppose: 0, abduct: 30, curl: [0, 0, 0], tip: v3(hw * 0.3, -hh - 0.055, ht * 0.2) },
    }
    const fy = (v: THREE.Vector3) => v3(v.x, -v.y, v.z)
    const ft = <T extends { tip?: THREE.Vector3 }>(o: T): T => ({ ...o, tip: o.tip && fy(o.tip) })
    return [r, { ...r, side: 'left', knuckle: fy(r.knuckle), F: fy(r.F), N: fy(r.N), fingers: r.fingers.map(ft), thumb: ft(r.thumb) }]
  }
  if (pose === 'pinch') return [{
    // Presenting: held low on the right edge, thumb on the frame, two fingertips on the back, the ring finger
    // under the bottom edge and the little finger tucked. The screen stays clear.
    side: 'right', knuckle: v3(hw + 0.2, -hh * 0.7, -ht - 0.2), F: v3(-0.25, 0.85, -0.45), N: v3(-0.9, 0, 0.4), seat: 0.03,
    fingers: [{ curl: [0, 20, 6, 4], spread: 3, tip: v3(hw * 0.3, -hh * 0.4, -ht - 0.04) }, { curl: [0, 20, 6, 4], tip: v3(hw * 0.15, -hh * 0.62, -ht - 0.04) },
      { curl: [0, 40, 30, 20], spread: -3, tip: v3(hw * 0.45, -hh - 0.05, -ht * 0.3) }, { curl: [0, 75, 80, 45], spread: -7 }],
    thumb: { oppose: 0, abduct: 20, curl: [0, 0, 0], tip: v3(hw + 0.06, -hh * 0.5, -ht * 0.2) },
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
  // Silhouette: near-black violet skin that only lights at grazing angles, so it reads as a rim-lit shape.
  if (tone === 'silhouette') return new THREE.MeshPhysicalMaterial({
    color: t.color, roughness: 0.7, roughnessMap: pores(), metalness: 0, specularIntensity: 0.25,
    sheen: 1, sheenColor: new THREE.Color(t.sheen), sheenRoughness: 0.35,
  })
  // Physically based skin: satin roughness with pores and a warm sheen for the soft rim glow. No transmission:
  // its screen-space refraction drew dark lines along the fingers where they sit close to the phone.
  return new THREE.MeshPhysicalMaterial({
    color: t.color, roughness: 0.58, roughnessMap: pores(), metalness: 0, specularIntensity: 0.45, ior: 1.4,
    sheen: 0.7, sheenColor: new THREE.Color(t.sheen), sheenRoughness: 0.5, clearcoat: 0.06, clearcoatRoughness: 0.6,
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
  m.userData.hand = true   // the AI hands pass finds hand meshes by this
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
  /** Reach: coordinate descent on a digit's angles (degrees) so its tip lands on a target, while keeping the
   * finger out of the device (spheres along the bones) and staying near the starting pose. */
  const reach = (names: string[], target: THREE.Vector3, x0: number[], lo: number[], hi: number[], apply: (x: number[]) => void, radius: number, free = false) => {
    const tipB = rig.bones[names[names.length - 1]], wp = new THREE.Vector3(), wq = new THREE.Vector3()
    const cost = (x: number[]) => {
      apply(x); update()
      let c = tipB.getWorldPosition(wp).distanceToSquared(target)
      for (let k = 1; k < names.length; k++) {
        if (free && k === names.length - 1) continue   // a touching pad is placed on the glass by the contact pass below
        rig.bones[names[k]].getWorldPosition(wp); rig.bones[names[k - 1]].getWorldPosition(wq)
        for (const t of [0, 0.33, 0.66]) {
          if (k === 1 && t > 0.5) continue   // the knuckle itself may rest on the edge
          const q = wp.clone().lerp(wq, t), r = radius * (k === names.length - 1 ? 0.8 : 1), pen = r - sdf(q, fit)
          if (pen > 0) c += 200 * pen * pen
        }
      }
      for (let k = 0; k < x.length; k++) c += 2e-7 * (x[k] - x0[k]) ** 2
      return c
    }
    const x = x0.slice(); let best = cost(x)
    for (let step = 8; step >= 0.5; step /= 2) {
      for (let it = 0, moved = true; moved && it < 40; it++) {
        moved = false
        for (let k = 0; k < x.length; k++) for (const sgn of [1, -1]) {
          const v = x[k]; x[k] = Math.min(hi[k], Math.max(lo[k], v + sgn * step))
          const c = cost(x); if (c < best - 1e-9) { best = c; moved = true } else x[k] = v
        }
      }
    }
    apply(x); update()
  }
  // Touching digits, placed after the rest of the hand by the contact pass.
  const touches: { owners: Set<string>; surf: THREE.Vector3; aim: THREE.Vector3; run: (aim: THREE.Vector3) => void }[] = []
  FINGERS.forEach((fn, i) => {
    const fp = plan.fingers[i], names = JOINTS.map(j => `${fn}-${j}`)
    const axes = names.slice(0, 4).map((n, k) => curlAxis(n, names[k + 1]))
    const angles = fp.curl.map(deg)
    const pre0 = fp.spread ? (M: THREE.Matrix4) => hinge(M, P(names[1]), N0, deg(fp.spread!) * h) : undefined
    if (fp.tip && fp.touch) {
      chainPose(names, axes, angles, pre0); update()
      touches.push({ owners: new Set([names[3], names[4]]), surf: fp.tip.clone(), aim: fp.tip.clone(), run: aim => {
        const apply = (x: number[]) => chainPose(names, axes, [0, x[1], x[2], x[3]].map(deg), M => hinge(M, P(names[1]), N0, deg(x[0]) * h))
        reach(names.slice(1), aim, [fp.spread ?? 0, ...fp.curl.slice(1)], [-25, -15, 0, 0], [25, 95, 105, 80], apply, 0.07, true)
      } })
      return
    }
    if (fp.tip) {
      // Start from a contact wrap (so the finger begins outside the phone), then reach for the target.
      chainPose(names, axes, angles, pre0); update(); close(names, axes, angles, 1, fp.max ?? [95, 95, 70], pre0)
      const apply = (x: number[]) => chainPose(names, axes, [0, x[1], x[2], x[3]].map(deg), M => hinge(M, P(names[1]), N0, deg(x[0]) * h))
      reach(names.slice(1), fp.tip, [fp.spread ?? 0, ...angles.slice(1).map(a => a * 180 / Math.PI)], [-25, -15, 0, 0], [25, 95, 105, 80], apply, 0.07)
      return
    }
    const pre = fp.spread ? (M: THREE.Matrix4) => hinge(M, P(names[1]), N0, deg(fp.spread!) * h) : undefined
    chainPose(names, axes, angles, pre); update()
    if (fp.close) close(names, axes, angles, 1, fp.max ?? [80, 90, 70], pre)
  })
  // Thumb: opposition turns it about the palm's long axis, abduction swings it out from the index; then it closes.
  const tp = plan.thumb, axesT = THUMB.slice(0, 3).map((n, k) => curlAxis(n, THUMB[k + 1]))
  const preT = (M: THREE.Matrix4) => { hinge(M, P(THUMB[0]), F0, deg(tp.oppose) * -h); hinge(M, P(THUMB[0]), N0, deg(tp.abduct) * h) }
  const angT = tp.curl.map(deg)
  if (tp.tip && tp.touch) {
    const apply = (x: number[]) => chainPose(THUMB, axesT, [x[2], x[3], x[4]].map(deg), M => { hinge(M, P(THUMB[0]), F0, deg(x[0]) * -h); hinge(M, P(THUMB[0]), N0, deg(x[1]) * h) })
    touches.push({ owners: new Set([THUMB[2], THUMB[3]]), surf: tp.tip.clone(), aim: tp.tip.clone(), run: aim =>
      reach(THUMB, aim, [tp.oppose, tp.abduct, ...tp.curl], [-60, -60, -30, -30, -20], [100, 80, 70, 80, 90], apply, 0.08, true) })
  } else if (tp.tip) {
    const apply = (x: number[]) => chainPose(THUMB, axesT, [x[2], x[3], x[4]].map(deg), M => { hinge(M, P(THUMB[0]), F0, deg(x[0]) * -h); hinge(M, P(THUMB[0]), N0, deg(x[1]) * h) })
    reach(THUMB, tp.tip, [tp.oppose, tp.abduct, ...tp.curl], [-60, -60, -20, -20, -10], [90, 70, 60, 70, 80], apply, 0.08)
    update()
  } else {
    chainPose(THUMB, axesT, angT, preT); update()
    if (tp.close) close(THUMB, axesT, angT, 1, tp.max ?? [50, 45], preT)
    update()
  }
  // Contact pass: reach each touching digit, find the skin point of its pad nearest the phone, and correct the aim
  // (and, with follow, the whole hand) until that point sits on the glass at the target, just touching.
  if (!touches.length) { armFrame(rig, F1, N1); return }
  const GAP = 0.0003   // 0.03 mm
  // The glass is the plane z = T / 2, so the contact is the pad's lowest skin point.
  const contact = (owners: Set<string>, glass: number) => {
    let best = Infinity; const c = new THREE.Vector3()
    for (let i = 0; i < pos.count; i++) {
      if (!owners.has(rig.owner[i])) continue
      _v.fromBufferAttribute(pos, i); rig.mesh.applyBoneTransform(i, _v); _v.applyMatrix4(rig.mesh.matrixWorld)
      if (_v.z < best) { best = _v.z; c.copy(_v) }
    }
    return { c, d: best - glass }
  }
  let worst = Infinity
  const iters = import.meta.env.DEV ? (globalThis as { __touchIters?: number }).__touchIters ?? 10 : 10
  for (let it = 0; it < iters; it++) {
    const errs = touches.map(t => { t.run(t.aim); update(); const { c, d } = contact(t.owners, t.surf.z); return v3(t.surf.x - c.x, t.surf.y - c.y, GAP - d) })
    worst = Math.max(...errs.map(e => e.length()))
    if (worst < 0.0005) break
    const mean = errs.reduce((a, e) => a.add(e), v3(0, 0, 0)).multiplyScalar(1 / errs.length)
    // Damped, and kept within 15 mm of the point, so a digit that cannot reach does not wander off.
    touches.forEach((t, k) => { t.aim.addScaledVector(errs[k], 0.7); const off = t.aim.clone().sub(t.surf); if (off.length() > 0.15) t.aim.copy(t.surf).add(off.setLength(0.15)) })
    if (plan.follow) {
      // Lift the hand if any skin other than the touching pads dips below the glass, else just slide it across.
      const pads = new Set(touches.flatMap(t => [...t.owners])), hw = fit.W / 2, hh = fit.H / 2
      let low = Infinity
      for (let i = 0; i < pos.count; i += 2) {
        if (pads.has(rig.owner[i])) continue
        _v.fromBufferAttribute(pos, i); rig.mesh.applyBoneTransform(i, _v); _v.applyMatrix4(rig.mesh.matrixWorld)
        if (Math.abs(_v.x) < hw && Math.abs(_v.y) < hh && _v.z < low) low = _v.z
      }
      const lift = Math.max(0, fit.T / 2 + 0.03 - low)
      rig.root.position.add(v3(mean.x, mean.y, lift).clampLength(0, 0.3)); update()
    }
  }
  rig.root.userData.touchError = worst   // model units; 0.001 is 0.1 mm
  armFrame(rig, F1, N1)
}

/** Where the forearm joins: the wrist joint, the arm's direction (back from the palm) and the palm normal. */
function armFrame(rig: Rig, F: THREE.Vector3, N: THREE.Vector3) {
  rig.root.updateMatrixWorld(true)
  rig.root.userData.arm = { at: rig.bones.wrist.getWorldPosition(new THREE.Vector3()), dir: F.clone().negate(), n: N.clone() }
}

// ---------- forearm ----------
// The hand models stop at the wrist, which shows as a flat cut whenever the arm points at the camera. A tapered,
// slightly flattened tube continues the wrist back along the arm, out of frame. It shares the skin material and is
// tagged as hand, so the AI hands mask covers it too.
let armGeo: THREE.BufferGeometry | null = null
function forearmGeometry() {
  if (armGeo) return armGeo
  // Along +y from the wrist: 26 cm long, 2.1 cm radius inside the wrist widening to 3.2 cm, rounded at the wrist end.
  const pts: THREE.Vector2[] = []
  for (let i = 0; i <= 6; i++) { const a = (i / 6) * Math.PI / 2; pts.push(new THREE.Vector2(0.21 * Math.sin(a), 0.1 - 0.12 * Math.cos(a))) }
  for (let i = 1; i <= 12; i++) { const t = i / 12; pts.push(new THREE.Vector2(0.21 + 0.13 * Math.min(1, t * 2.5) - 0.02 * t, 0.1 + 2.5 * t)) }
  armGeo = new THREE.LatheGeometry(pts, 32)
  armGeo.scale(1, 1, 0.78)   // flatter front to back, like a wrist
  return armGeo
}
const _ax = new THREE.Vector3(), _ay = new THREE.Vector3(), _az = new THREE.Vector3(), _mb = new THREE.Matrix4()
function placeArm(mesh: THREE.Mesh, rig: Rig) {
  const a = rig.root.userData.arm as { at: THREE.Vector3; dir: THREE.Vector3; n: THREE.Vector3 } | undefined
  if (!a) { mesh.visible = false; return }
  _ay.copy(a.dir).normalize(); _az.copy(a.n).addScaledVector(_ay, -a.n.dot(_ay)).normalize(); _ax.crossVectors(_ay, _az)
  _mb.makeBasis(_ax, _ay, _az); mesh.quaternion.setFromRotationMatrix(_mb); mesh.position.copy(a.at); mesh.visible = true
}

/** Wraps the device: turns it for landscape and adds the posed hands, which Centred leaves out of its bounds. */
export function HandRig({ pose, tone, fit, gesture, onGesture, spectral = SPECTRAL_DEFAULTS, children }: { pose: HandPose; tone: string; fit: HandFit | null; spectral?: SpectralOptions; gesture?: Gesture; onGesture?: (g: Gesture) => void; children: React.ReactNode }) {
  const on = pose !== 'off' && !!fit
  return (
    <group rotation={[0, 0, on && pose === 'landscape' ? Math.PI / 2 : 0]} userData={{ handRig: true }}>
      {children}
      {on && <Suspense fallback={null}><Hands pose={pose} tone={tone} fit={fit!} gesture={gesture} sp={spectral} /></Suspense>}
      {on && isGesture(pose) && gesture && onGesture && <ScreenTarget pose={pose} fit={fit!} g={gesture} onChange={onGesture} />}
    </group>)
}

function Hands({ pose, tone, fit, gesture, sp }: { pose: HandPose; tone: string; fit: HandFit; gesture?: Gesture; sp: SpectralOptions }) {
  const right = useGLTF(URL_R), left = useGLTF(URL_L)
  const group = useRef<THREE.Group>(null)
  const rigs = useMemo(() => ({ right: makeRig(right.scene), left: makeRig(left.scene) }), [right.scene, left.scene])
  const spectral = tone === 'spectral'
  const spm = useMemo<SpectralMats | null>(() => spectral ? spectralMaterials(SPECTRAL_DEFAULTS) : null, [spectral])
  useEffect(() => () => spm?.dispose(), [spm])
  const mat = useMemo(() => spm ? spm.body : skinMaterial(tone), [tone, spm])
  useEffect(() => () => { if (!spm) mat.dispose() }, [mat, spm])
  // live uniforms: tint, transparency and the three effects
  useEffect(() => { if (!spm) return
    spm.tint.set(sp.tint); spm.line.color.set(sp.tint)
    const u = spm.body.uniforms; u.uAlpha.value = 1 - sp.transparency; u.uGlimmer.value = sp.glimmer ? 1 : 0; u.uShimmer.value = sp.shimmer ? 1 : 0; u.uStars.value = sp.stars ? 1 : 0
  }, [spm, sp.tint, sp.transparency, sp.glimmer, sp.shimmer, sp.stars])
  const { size, gl } = useThree()
  useFrame(({ clock, camera }) => { if (!spm) return
    spm.frame(size.width, size.height, gl.getPixelRatio(), clock.elapsedTime)
    for (const side of ['right', 'left'] as const) if (rigs[side].root.parent) updateSpectral(rigs[side].mesh, camera) })
  useEffect(() => { rigs.right.mesh.material = mat; rigs.left.mesh.material = mat }, [rigs, mat])
  // Only the gesture fields the pose uses, so moving a marker re-solves just the touching hand.
  const ges = isGesture(pose) ? gesture : undefined
  const solved = useRef<Record<string, string>>({})
  const arms = useMemo(() => ({ right: new THREE.Mesh(forearmGeometry()), left: new THREE.Mesh(forearmGeometry()) }), [])
  useEffect(() => { for (const m of [arms.right, arms.left]) { m.material = mat; m.castShadow = m.receiveShadow = true; m.userData.hand = true } }, [arms, mat])
  useEffect(() => {
    const g = group.current; if (!g) return
    const list = plans(pose, fit, ges)
    const used = new Set<THREE.Object3D>()
    for (const pl of list) {
      const r = rigs[pl.side], key = JSON.stringify([pl, fit])
      if (solved.current[pl.side] !== key || r.root.parent !== g) { g.remove(r.root); solve(r, pl, fit); solved.current[pl.side] = key; g.add(r.root); placeArm(arms[pl.side], r); g.add(arms[pl.side]) }
      used.add(r.root)
      if (import.meta.env.DEV) (globalThis as { __touchErr?: Record<string, number> }).__touchErr = { ...(globalThis as { __touchErr?: Record<string, number> }).__touchErr, [pl.side]: r.root.userData.touchError ?? 0 }
    }
    for (const side of ['right', 'left'] as const) if (!used.has(rigs[side].root)) { g.remove(rigs[side].root, arms[side]); delete solved.current[side] }
  }, [pose, fit, rigs, ges, arms])
  // Spectral: outlines, inner lines and stars follow each re-solve; the hands leave the shadow pass (line layer) and cast none.
  useEffect(() => {
    for (const side of ['right', 'left'] as const) {
      const r = rigs[side], arm = arms[side]
      // renderOrder 10: the clear body draws after the phone's glass and the floor shadow, so its depth (which the outline
      // needs) doesn't cut holes in them
      for (const m of [r.mesh, arm] as THREE.Mesh[]) { m.layers.set(spm ? LINE_LAYER : 0); m.castShadow = !spm; m.renderOrder = spm ? 10 : 0; if (!spm) removeHull(m) }
      if (!spm) continue
      addHull(r.mesh, spm); addHull(arm, spm)
      if (r.root.parent) buildSpectral(r.mesh, r.owner, spm)
    }
    if (import.meta.env.DEV) (globalThis as { __omHands?: unknown }).__omHands = { rigs, arms }
  }, [spm, rigs, arms, pose, fit, ges])
  useEffect(() => () => { const g = group.current; for (const side of ['right', 'left'] as const) g?.remove(rigs[side].root, arms[side]); solved.current = {} }, [rigs, arms])
  return <group ref={group} userData={{ noBounds: true }} />
}
useGLTF.preload(URL_R); useGLTF.preload(URL_L)

if (import.meta.hot) import.meta.hot.dispose(() => { poreTex?.dispose(); poreTex = null; armGeo?.dispose(); armGeo = null })
