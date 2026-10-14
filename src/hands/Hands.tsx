// Procedurally posed hands that hold the device. The hand models are the WebXR "generic-hand" assets
// (MIT, Amazon, github.com/immersive-web/webxr-input-profiles), see CREDITS.md. Each pose places the wrist
// relative to the device, seats the palm on it, then closes each finger joint by joint until its skin touches
// the device body (a rounded-box distance field built from the device's own measurements), so the grip fits
// the 18 Pro and the 18 Pro Max at their real sizes. The hands sit inside the device group, so they follow
// any camera angle.
import { Suspense, useEffect, useMemo, useRef } from 'react'
import { useGLTF } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { spectralMaterials, buildSpectral, reskinSpectral, updateSpectral, addHull, removeHull, SPECTRAL_DEFAULTS, type SpectralOptions, type SpectralMats } from './spectral'
import { LINE_LAYER } from '../sketch/Sketch'
import * as THREE from 'three'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { HandMotion, type IdleLevel } from './motion'
import { ptToDevice, screenOf, swipeAt, isGesture, ScreenTarget, GESTURE_DEFAULT, HAND_ROT0, REACH_EVENT, type Gesture, type HandRot } from './gestures'

export type HandPose = 'off' | 'right' | 'left' | 'landscape' | 'pinch' | 'hold' | 'tap' | 'swipe' | 'zoom' | 'thumb' | 'thumbswipe' | 'type' | 'hover' | 'holdtap' | 'flat' | 'twohand' | 'rest'
export const HAND_POSES: [HandPose, string][] = [['off', 'Off'], ['right', 'Right hand'], ['left', 'Left hand'], ['landscape', 'Two hands'], ['pinch', 'Present'], ['hold', 'Hold up'],
  ['tap', 'Tap'], ['swipe', 'Swipe'], ['zoom', 'Pinch to zoom'], ['thumb', 'Thumb tap'], ['thumbswipe', 'Thumb scroll'], ['type', 'Two-thumb typing'], ['hover', 'Point / hover'], ['holdtap', 'Hold and tap'], ['flat', 'Flat in palm'], ['twohand', 'Two hands upright'], ['rest', 'On a surface']]
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
/** kind: tablets (and the open Duo) get their own grips; cx, cz: where the body's centre sits in the device's frame
 *  when the model is not centred on it (the closed Duo with the fold camera off). */
export interface HandFit { W: number; H: number; T: number; R: number; E: number; SW?: number; SH?: number; PW?: number; PH?: number; kind?: 'phone' | 'tablet'; cx?: number; cz?: number }
const PHONE_ONLY: HandPose[] = ['right', 'left', 'hold', 'pinch', 'thumb', 'thumbswipe', 'type']
/** The grips and gestures that make sense for a device: a tablet is too wide for one-handed wraps and thumb reaches,
 *  and a phone does not need the upright two-handed hold. */
export const posesFor = (f: HandFit | null | undefined): [HandPose, string][] => !f ? [] : HAND_POSES.filter(([k]) => f.kind === 'tablet' ? !PHONE_ONLY.includes(k) : k !== 'twohand')
export const poseOk = (f: HandFit | null | undefined, p: HandPose) => p === 'off' || posesFor(f).some(([k]) => k === p)

import { HAND_LOOK0, nailGeometry, nailMaterial, type HandLook, type NailFit } from './nails'
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
interface HandPlan { side: 'right' | 'left'; knuckle: THREE.Vector3; F: THREE.Vector3; N: THREE.Vector3; roll?: number; seat?: number; follow?: boolean | 'y'; thumbFace?: number; fingers: FingerPlan[]; thumb: ThumbPlan }

const mx = (v: THREE.Vector3) => v3(-v.x, v.y, v.z)
const mt = <T extends { tip?: THREE.Vector3 }>(o: T): T => ({ ...o, tip: o.tip && mx(o.tip) })
const mirror = (p: HandPlan): HandPlan => ({ ...p, side: p.side === 'right' ? 'left' : 'right', knuckle: mx(p.knuckle), F: mx(p.F), N: mx(p.N), fingers: p.fingers.map(mt), thumb: mt(p.thumb) })

/** Poses in device space: x right and y up seen from the front, z out of the screen. Sizes scale with the device. */
function plans(pose: HandPose, f: HandFit, ges: Gesture = GESTURE_DEFAULT, nail = 0, flat = nail, size = 1): HandPlan[] {
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
  // Tablets: each hand holds one side about its middle, palm behind the edge, fingers spread on the back a hand's
  // reach in from the edge and the thumb resting on the front bezel. Sizes are a real hand's, not the device's.
  const tablet = f.kind === 'tablet'
  const tabHold = (ex: number, y0: number, et: number): HandPlan => {
    const b = (x: number, y: number, spread: number): FingerPlan => ({ curl: [0, 20, 6, 4], spread, tip: v3(x, y, -et - 0.05) })
    const k = Math.min(0.47, ex * 0.55)   // how far in from the edge the fingertips reach; on a narrow body the two hands don't cross
    return { side: 'right', knuckle: v3(ex + 0.12, y0 - 0.22, -et - 0.1), F: v3(-0.25, 0.9, -0.4), N: v3(-0.85, 0.05, 0.5), seat: 0.006,
      fingers: [b(ex - 0.9 * k, y0 + 0.2, 2), b(ex - k, y0 + 0.04, 0), b(ex - 0.96 * k, y0 - 0.11, -3), b(ex - 0.81 * k, y0 - 0.25, -6)],
      thumb: { oppose: 0, abduct: 10, curl: [0, 0, 0], tip: v3(ex - 0.045, y0 + 0.1, et + 0.004) } } }
  if (tablet && pose === 'twohand') { const r = tabHold(hw, -hh * 0.1, ht); return [r, mirror(r)] }
  if (pose === 'right') return [grip]
  if (isGesture(pose)) {
    const P = (x: number, y: number) => ptToDevice(f, x, y), u = screenOf(f).unit
    // Middle, ring and little finger loosely closed into the palm, clear of the glass.
    const fist: FingerPlan[] = [{ curl: [0, 62, 80, 45], spread: -1 }, { curl: [0, 70, 85, 45], spread: -4 }, { curl: [0, 76, 85, 45], spread: -8 }]
    // Pointing: the right hand comes in from the lower right, palm towards the glass, index angled down onto the
    // point and the thumb resting against the side of the middle finger. The wrist sits a fixed reach behind the point.
    // long nails: the finger comes in flatter, so it lands on its pad with the nail tip clear of the glass
    // The approach is set by two elevations: the knuckle above the point (47 degrees normally) and the palm's dip
    // toward the glass (35 degrees); both drop as flat grows, down to 10 and 3 degrees.
    const approach = (hx: number, hy: number, len: number, e0: number, fx: number, fy: number, d0: number) => {
      const e = deg(Math.max(10, e0 - 28 * flat)), d = deg(Math.max(3, d0 - 24 * flat)), hl = Math.hypot(hx, hy), fl = Math.hypot(fx, fy)
      return { off: v3(hx / hl * Math.cos(e) * len, hy / hl * Math.cos(e) * len, Math.sin(e) * len), F: v3(fx / fl * Math.cos(d), fy / fl * Math.cos(d), -Math.sin(d)) } }
    // the knuckle's reach back from the point scales with the hand
    const ap = approach(0.35, -0.55, 0.9596 * size, 46.85, -0.3, 0.72, 35.2), apZ = approach(0.3, -0.75, 0.9772 * size, 34.25, -0.35, 0.7, 35.1)
    const pointer = (t: THREE.Vector3): HandPlan => ({ side: 'right', knuckle: t.clone().add(ap.off), F: ap.F, N: v3(0.15, 0.5, -1), follow: true,
      fingers: [{ curl: [0, 18, 22, 12], tip: t, touch: true }, ...fist], thumb: { oppose: -20, abduct: -10, curl: [10, 30, 30] } })
    const tw = import.meta.env.DEV ? (globalThis as { __gestTweak?: (p: HandPlan[], v: typeof v3) => HandPlan[] }).__gestTweak : undefined
    if (tw) return tw(gesturePlans(), v3)
    return gesturePlans()
    function gesturePlans(): HandPlan[] {
    if (pose === 'tap') return [pointer(P(ges.x, ges.y))]
    if (pose === 'swipe') { const a = swipeAt(ges); return [pointer(P(a.x, a.y))] }
    if (pose === 'holdtap') return [mirror(tablet ? tabHold(hw, -hh * 0.1, ht) : grip), pointer(P(ges.x, ges.y))]
    // on a surface: the device lies on a table (HandRig tips it back) and the hand comes in from the near side to tap
    if (pose === 'rest') { const pl = pointer(P(ges.x, ges.y)); return [{ ...pl, thumb: { oppose: 40, abduct: -15, curl: [20, 55, 45] } }] }   // thumb tucked, clear of the table
    if (pose === 'zoom') {
      // Thumb and index spread on the glass about the centre, along the pinch axis (the thumb on the lower left end).
      const a = deg(ges.angle), dx = Math.cos(a) * ges.spread / 2, dy = -Math.sin(a) * ges.spread / 2
      const ti = P(ges.x + dx, ges.y + dy), tt = P(ges.x - dx, ges.y - dy), c = ti.clone().add(tt).multiplyScalar(0.5)
      return [{ side: 'right', knuckle: c.clone().add(apZ.off), F: apZ.F, N: v3(0.1, 0.45, -1), follow: true,
        fingers: [{ curl: [0, 20, 20, 10], spread: 4, tip: ti, touch: true }, ...fist],
        thumb: { oppose: 20, abduct: 40, curl: [0, 10, 10], tip: tt, touch: true } }]
    }
    if (pose === 'hover') {
      // Point / hover: the tap hand, with the index pad about 8 mm above the glass and nothing touching.
      const t = P(ges.x, ges.y), pl = pointer(t)
      return [{ ...pl, follow: false, knuckle: pl.knuckle.clone().add(v3(0, 0, 0.08)), fingers: [{ curl: [0, 18, 22, 12], spread: 0, tip: t.clone().add(v3(0, 0, 0.08)) }, ...fist] }]
    }
    if (pose === 'type') {
      // Two-thumb typing: each hand cradles its lower corner, fingers on its own half of the back, little finger under
      // the bottom edge, and the thumb reaches its key. The left hand is the mirror of the right.
      const side = (t: THREE.Vector3): HandPlan => ({ side: 'right', knuckle: v3(hw + 0.12, -hh * 0.3, -ht - 0.1), F: v3(-0.2, 0.9, -0.4), N: v3(-0.85, 0.05, 0.5), seat: 0.006, follow: 'y',
        fingers: [back(hw * 0.25, hh * 0.15, 2), back(hw * 0.2, -hh * 0.02, 0), back(hw * 0.25, -hh * 0.2, -3), back(hw * 0.35, -hh * 0.38, -6)],
        thumb: { oppose: 0, abduct: 10, curl: [0, 0, 0], tip: t, touch: true } })
      return [side(P(ges.kx, ges.ky)), mirror(side(mx(P(ges.kx2, ges.ky2))))]
    }
    // Thumb tap and thumb scroll: the one-handed grip slides up or down the frame to follow the point, and the thumb
    // reaches across. Beyond the thumb's reach it rests as close as it can and the panel says how far short it is.
    const a = pose === 'thumbswipe' ? swipeAt(ges) : ges
    const t = P(a.x, a.y), dy = Math.min(hh * 0.5, Math.max(-hh * 0.5, t.y + hh * 0.05 + 0.35 * (hw - t.x))) - (-hh * 0.05), sh = (v?: THREE.Vector3) => v && v.clone().setY(v.y + dy)
    // The little finger supports the bottom edge only while the hand is low enough to reach it; as the grip slides up it
    // moves onto the back below the ring finger (shifting its under-the-edge point up left it reaching for empty space
    // behind the phone, so it swung about whenever the thumb moved).
    const up = Math.min(1, Math.max(0, (dy + 0.02) / 0.14)), su = up * up * (3 - 2 * up)
    const pinky = (fp: FingerPlan): FingerPlan => ({ ...fp, tip: v3(hw * 0.2 * (1 - su) + hw * 0.1 * su, Math.max(-hh + 0.06, -hh - 0.05 + su * (dy + 0.05 + hh * 0.08)), -ht * 0.3 * (1 - su) + (-ht - 0.05) * su) })
    return [{ ...grip, knuckle: sh(grip.knuckle)!, follow: 'y', fingers: grip.fingers.map((fp, i) => i === 3 ? pinky(fp) : { ...fp, tip: sh(fp.tip) }),
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
  if (pose === 'flat') {
    // a tablet rests on the palm the same way; the hand keeps its own size, so offsets are capped at a hand's span
    const fw = Math.min(hw, 0.36), fh = Math.min(hh, 0.75)
    // Flat in the palm: the phone lies face up on an open right hand, palm under the lower back, fingers relaxed
    // along the back and the thumb curled in against the right frame. Best seen from above.
    const under = (x: number, y: number, spread: number): FingerPlan => ({ curl: [0, 8, 6, 4], spread, tip: v3(x, y, -ht - 0.04) })
    return [{ side: 'right', knuckle: v3(-hw * 0.1, -hh * 0.05, -ht - 0.1), F: v3(0.05, 1, 0), N: v3(0.3, 0, 1), seat: 0.004,
      fingers: [under(fw * 0.32, fh * 0.3, 2), under(fw * 0.02, fh * 0.38, 0), under(-fw * 0.28, fh * 0.32, -2), under(-fw * 0.55, fh * 0.18, -5)],
      thumb: { oppose: 10, abduct: -5, curl: [0, 15, 15] } }]
  }
  if (pose === 'landscape' && tablet) {
    // Turned 90 degrees by the rig, the bottom end is on the right: hold that end like an upright side (built with the
    // width and height swapped, then turned a quarter about z) and mirror it onto the top end for the left hand.
    const q = new THREE.Quaternion().setFromAxisAngle(v3(0, 0, 1), -Math.PI / 2), rz = (v: THREE.Vector3) => v.clone().applyQuaternion(q)
    const rt = <T extends { tip?: THREE.Vector3 }>(o: T): T => ({ ...o, tip: o.tip && rz(o.tip) })
    const h0 = tabHold(hh, 0, ht), r: HandPlan = { ...h0, knuckle: rz(h0.knuckle), F: rz(h0.F), N: rz(h0.N), fingers: h0.fingers.map(rt), thumb: rt(h0.thumb) }
    const fy = (v: THREE.Vector3) => v3(v.x, -v.y, v.z), ft = <T extends { tip?: THREE.Vector3 }>(o: T): T => ({ ...o, tip: o.tip && fy(o.tip) })
    return [r, { ...r, side: 'left', knuckle: fy(r.knuckle), F: fy(r.F), N: fy(r.N), fingers: r.fingers.map(ft), thumb: ft(r.thumb) }]
  }
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

/** Turns a plan by the user's hand rotation about its pivot: the touching point (or hovering tip), else the grip
 * (the middle knuckle). Contact targets stay put, so the palm re-seats and the digits re-reach them. */
function rotatePlan(pl: HandPlan, r: HandRot): HandPlan {
  if (!r.tilt && !r.spin && !r.roll) return pl
  const F = pl.F.clone().normalize()
  const q = new THREE.Quaternion().setFromAxisAngle(v3(0, 0, 1), deg(r.spin))
    .multiply(new THREE.Quaternion().setFromAxisAngle(v3(1, 0, 0), deg(r.tilt)))
    .multiply(new THREE.Quaternion().setFromAxisAngle(F, deg(r.roll)))
  const touch = pl.thumb.touch ? pl.thumb.tip : pl.fingers.find(f => f.touch)?.tip ?? (pl.fingers[0].tip && !pl.seat ? pl.fingers[0].tip : undefined)
  const pivot = touch ?? pl.knuckle
  const knuckle = pl.knuckle.clone().sub(pivot).applyQuaternion(q).add(pivot)
  return { ...pl, knuckle, F: pl.F.clone().applyQuaternion(q), N: pl.N.clone().applyQuaternion(q) }
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

// ---------- nails ----------
/** Each digit's nail, measured once per rig at rest: the distal bone it rides on, its skin fit and the nail frame in that bone's space. */
interface NailSpot { bone: string; fit: NailFit; frame: THREE.Matrix4 }
function measureNails(rig: Rig, side: 'right' | 'left'): NailSpot[] {
  const R = rig.rest, P = (n: string) => R[n].p, h = side === 'right' ? 1 : -1
  const wrist = P('wrist'), F0 = P('middle-finger-phalanx-proximal').clone().sub(wrist).normalize()
  const across = P('index-finger-phalanx-proximal').clone().sub(P('pinky-finger-phalanx-proximal'))
  const N0 = F0.clone().cross(across).multiplyScalar(-h).normalize()
  const pn = P('index-finger-metacarpal').clone().sub(wrist).cross(P('pinky-finger-metacarpal').clone().sub(wrist)).normalize()
  if (P('thumb-tip').clone().sub(wrist).dot(pn) < 0) pn.negate()   // towards the palm, as spectral.ts does
  // measure in the rest pose; the rig may already be posed, so put it back afterwards
  const saved = Object.entries(rig.bones).map(([n, b]) => { const k = [b, b.position.clone(), b.quaternion.clone()] as const; if (R[n]) { b.position.copy(R[n].p); b.quaternion.copy(R[n].q) } return k })
  rig.root.updateMatrixWorld(true)
  const pos = rig.mesh.geometry.getAttribute('position'), out: NailSpot[] = []
  const digits: [string, string][] = [...FINGERS.map(f => [`${f}-phalanx-distal`, `${f}-tip`] as [string, string]), ['thumb-phalanx-distal', 'thumb-tip']]
  for (const [dn, tn] of digits) {
    const bone = rig.bones[dn], parent = bone.parent!
    const toP = new THREE.Matrix4().copy(parent.matrixWorld).invert()
    const Pd = R[dn].p.clone(), Pt = R[tn].p.clone()   // rest data only: the rig may already be posed when this runs
    const u = Pt.clone().sub(Pd).normalize()
    const pts: THREE.Vector3[] = [], toLocal = toP.clone().multiply(rig.mesh.matrixWorld)
    for (let i = 0; i < pos.count; i++) if (rig.owner[i] === dn) { _v.fromBufferAttribute(pos, i); rig.mesh.applyBoneTransform(i, _v); pts.push(_v.clone().applyMatrix4(toLocal).sub(Pd)) }
    if (pts.length < 6) continue
    // The same nail bed the Spectral outline draws on (spectral.ts, prepare): facing away from the palm plane, the plate
    // spanning 45% to 90% of the skin's reach past the distal joint, three quarters of the finger's half-width either
    // side, recentred by half the cross-section's sideways offset. Anchoring on it puts the cuticle where the built-in
    // nail starts.
    const side = u.clone().cross(pn).normalize(), nrm = side.clone().cross(u).normalize(), d = nrm.clone().negate(), v = d.clone().cross(u)
    const seg = Pt.distanceTo(Pd)
    let hwF = 1e-4, Lmax = seg; for (const p of pts) { hwF = Math.max(hwF, Math.abs(p.dot(side))); Lmax = Math.max(Lmax, p.dot(u)) }
    const n0 = Lmax * 0.45, n1 = Lmax * 0.9
    let cs = 0, cn = 0; for (const p of pts) { const a = p.dot(u); if (a > n0 && a < n1) { cs += p.dot(side); cn++ } }
    const bc = (cn > 4 ? cs / cn * 0.5 : 0) * side.dot(v)
    const width = Math.max(0.006, 2 * hwF * 0.75)
    // the back's height along the bed: highest skin near the centre line, per slice, so the plate follows the finger
    const slice = (a: number) => { let best = -Infinity; for (const p of pts) if (Math.abs(p.dot(u) - a) < Lmax * 0.12 && Math.abs(p.dot(v) - bc) < hwF * 0.45) best = Math.max(best, p.dot(d)); return best }
    const h0 = slice(n0 + (n1 - n0) * 0.3), h1 = slice(n1)
    const hTop = isFinite(h0) ? h0 : Math.max(...pts.map(p => p.dot(d))), drop = isFinite(h1) && isFinite(h0) ? Math.max(0, h0 - h1) : 0
    const bed = n1 - n0, a0 = n0
    const fit: NailFit = { bed, width, tipW: width, skinZ: x => hTop + 0.0002 - drop * Math.max(0, (x - bed * 0.3) / (bed * 0.7)) ** 2 }
    const frame = new THREE.Matrix4().makeBasis(u, v, d).setPosition(Pd.clone().addScaledVector(u, a0).addScaledVector(v, bc))
    frame.premultiply(new THREE.Matrix4().compose(R[dn].p, R[dn].q, new THREE.Vector3(1, 1, 1)).invert())
    out.push({ bone: dn, fit, frame })
  }
  for (const [b, p, q] of saved) { b.position.copy(p); b.quaternion.copy(q) }
  rig.root.updateMatrixWorld(true)
  return out
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

/** Hand build: scales the skin's girth about each bone's own segment (fingers, thumb and the palm round its
 *  metacarpals) without moving any joint, so lengths, the rig and the solver's frames are unchanged. Rebuilds the mesh's
 *  geometry from the asset's original positions, so caches keyed on the geometry (Spectral lines, edges) start fresh. */
const NEXT: Record<string, string> = { wrist: 'middle-finger-phalanx-proximal', 'thumb-metacarpal': 'thumb-phalanx-proximal', 'thumb-phalanx-proximal': 'thumb-phalanx-distal', 'thumb-phalanx-distal': 'thumb-tip' }
for (const f of FINGERS) for (let i = 0; i < 4; i++) NEXT[`${f}-${JOINTS[i]}`] = `${f}-${JOINTS[i + 1]}`
function applyBuild(rig: Rig, build: number) {
  const m = rig.mesh, base = (m.userData.baseGeo ??= m.geometry) as THREE.BufferGeometry
  if ((m.userData.build ?? 1) === build && m.geometry !== base || build === 1 && m.geometry === base) return
  const geo = build === 1 ? base : base.clone()
  if (build !== 1) {
    const pos = geo.getAttribute('position') as THREE.BufferAttribute, bones = m.skeleton.bones
    const J = (n: string) => { const k = bones.findIndex(b => b.name === n); return new THREE.Vector3().setFromMatrixPosition(m.skeleton.boneInverses[k].clone().invert()) }
    const seg: Record<string, [THREE.Vector3, THREE.Vector3]> = {}
    for (const n of Object.keys(NEXT)) if (rig.bones[n] && rig.bones[NEXT[n]]) seg[n] = [J(n), J(NEXT[n])]
    for (const f of [...FINGERS, 'thumb']) seg[`${f}-tip`] = seg[`${f}-phalanx-distal`]
    const inv = m.bindMatrix.clone().invert(), v = new THREE.Vector3(), c = new THREE.Vector3(), ab = new THREE.Vector3()
    for (let i = 0; i < pos.count; i++) { const s = seg[rig.owner[i]]; if (!s) continue
      v.fromBufferAttribute(pos, i).applyMatrix4(m.bindMatrix)
      ab.subVectors(s[1], s[0]); const t = Math.max(0, Math.min(1, v.clone().sub(s[0]).dot(ab) / Math.max(1e-9, ab.lengthSq())))
      c.copy(s[0]).addScaledVector(ab, t); v.sub(c).multiplyScalar(build).add(c).applyMatrix4(inv); pos.setXYZ(i, v.x, v.y, v.z) }
    pos.needsUpdate = true; geo.computeBoundingSphere()   // keep the asset normals: a radial scale barely turns them, and a recompute split the UV seams into hard creases
  }
  if (m.geometry !== base) m.geometry.dispose()
  m.geometry = geo; m.userData.build = build
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

// Thumb pad: which side of the distal phalanx is the pad (+1 or -1 along curl axis x bone), how far it should face into
// the glass (1 = straight down, 0.85 leans back so the nail shows from above and behind), and how hard to ask.
// Finger anatomy: the outer joint (DIP) bends about two thirds of the middle one (PIP); sideways spread per finger
// (index widest); knuckle (MCP) a touch of hyperextension at most, middle joint none.
const DIP_K = 2 / 3, SPREAD = [15, 10, 10, 14], MCP_LO = [-8, 0], MCP_HI = [92, 105]
const PAD_SIGN = 1, PAD_FACE = 0.85, PAD_W = 2e-2
function solve(rig: Rig, plan: HandPlan, fit: HandFit, size = 1, nail = 0) {
  const R = rig.rest, P = (n: string) => R[n].p
  const h = plan.side === 'right' ? 1 : -1
  // Rest frame: F along the palm to the middle knuckle, N out of the palm.
  const wrist = P('wrist'), F0 = P('middle-finger-phalanx-proximal').clone().sub(wrist).normalize()
  const across = P('index-finger-phalanx-proximal').clone().sub(P('pinky-finger-phalanx-proximal'))
  const N0 = F0.clone().cross(across).multiplyScalar(-h).normalize()
  const pn = P('index-finger-metacarpal').clone().sub(wrist).cross(P('pinky-finger-metacarpal').clone().sub(wrist)).normalize()
  if (P('thumb-tip').clone().sub(wrist).dot(pn) < 0) pn.negate()   // towards the palm, as spectral.ts does
  N0.sub(F0.clone().multiplyScalar(N0.dot(F0))).normalize()
  // Target frame.
  const F1 = plan.F.clone().normalize(), N1 = plan.N.clone().sub(F1.clone().multiplyScalar(plan.N.dot(F1))).normalize()
  const B0 = F0.clone().cross(N0), B1 = F1.clone().cross(N1)
  const A = new THREE.Matrix4().makeBasis(F0, N0, B0), Bm = new THREE.Matrix4().makeBasis(F1, N1, B1)
  const rot = Bm.multiply(A.transpose())
  rig.root.quaternion.setFromRotationMatrix(rot)
  rig.root.scale.setScalar(HAND_SCALE * size)
  rig.root.position.copy(plan.knuckle).sub(P('middle-finger-phalanx-proximal').clone().multiplyScalar(HAND_SCALE * size).applyQuaternion(rig.root.quaternion))

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
    names.forEach((n, i) => { if (i < angles.length) hinge(M, P(n), axes[i], angles[i]); setBone(rig, n, M); boneM[n] = M.clone() })
  }
  const boneM: Record<string, THREE.Matrix4> = {}
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
  // Nails stay out of the phone: their free edge points (bone space) may not come within 0.1 mm of the body.
  const nailEdge = (rig.root.userData.nailEdge ?? {}) as Record<string, THREE.Vector3[]>
  const nailPen = (names: string[]) => { if (import.meta.env.DEV && (globalThis as { __noNailPen?: boolean }).__noNailPen) return 0; const e = nailEdge[names.find(n => n.endsWith('phalanx-distal')) ?? '']; if (!e) return 0
    const bm = rig.bones[names.find(n => n.endsWith('phalanx-distal'))!].matrixWorld; let c = 0
    // relative to the fingertip: a touching pad sits on the glass, so only the part of the nail that goes deeper than the pad counts
    const tipD = Math.min(0, sdf(rig.bones[names[names.length - 1]].getWorldPosition(_v), fit))
    for (const p of e) { const pen = tipD + 0.001 - sdf(_v.copy(p).applyMatrix4(bm), fit); if (pen > 0) c += 40 * pen * pen }
    return c }
  const reach = (names: string[], target: THREE.Vector3, x0: number[], lo: number[], hi: number[], apply: (x: number[]) => void, radius: number, free = false, extra0?: () => number) => {
    // a touching digit gets its nail clearance from the flatter plan instead, so the pen never pulls the pad off its target
    const extra = () => (extra0?.() ?? 0) + (free ? 0 : nailPen(names))
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
      if (extra) c += extra()
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
  const mcpOf: number[] = []; let lastMcp = 0
  FINGERS.forEach((fn, i) => {
    const fp = plan.fingers[i], names = JOINTS.map(j => `${fn}-${j}`)
    // ring and little finger share tendons: keep the little finger's knuckle bend near the ring finger's
    const couple = i === 3 && mcpOf[2] !== undefined ? () => { const d = Math.max(0, Math.abs(lastMcp - mcpOf[2]) - 20); return 4e-6 * d * d } : undefined
    const axes = names.slice(0, 4).map((n, k) => curlAxis(n, names[k + 1]))
    const angles = fp.curl.map(deg)
    const pre0 = fp.spread ? (M: THREE.Matrix4) => hinge(M, P(names[1]), N0, deg(fp.spread!) * h) : undefined
    if (fp.tip && fp.touch) {
      chainPose(names, axes, angles, pre0); update()
      touches.push({ owners: new Set([names[3], names[4]]), surf: fp.tip.clone(), aim: fp.tip.clone(), run: aim => {
        const apply = (x: number[]) => { lastMcp = x[1]; chainPose(names, axes, [0, x[1], x[2], x[2] * DIP_K].map(deg), M => hinge(M, P(names[1]), N0, deg(x[0]) * h)) }
        reach(names.slice(1), aim, [fp.spread ?? 0, ...fp.curl.slice(1, 3)], [-SPREAD[i], ...MCP_LO], [SPREAD[i], ...MCP_HI], apply, 0.07, true, couple)
      } })
      return
    }
    if (fp.tip) {
      // Start from a contact wrap (so the finger begins outside the phone), then reach for the target.
      chainPose(names, axes, angles, pre0); update(); close(names, axes, angles, 1, fp.max ?? [95, 95, 70], pre0)
      const apply = (x: number[]) => { lastMcp = x[1]; chainPose(names, axes, [0, x[1], x[2], x[2] * DIP_K].map(deg), M => hinge(M, P(names[1]), N0, deg(x[0]) * h)) }
      const x0 = [fp.spread ?? 0, ...angles.slice(1, 3).map(a => Math.min(MCP_HI[1], a * 180 / Math.PI))]
      reach(names.slice(1), fp.tip, [Math.max(-SPREAD[i], Math.min(SPREAD[i], x0[0])), Math.max(MCP_LO[0], x0[1]), x0[2]], [-SPREAD[i], ...MCP_LO], [SPREAD[i], ...MCP_HI], apply, 0.07, false, couple)
      mcpOf[i] = lastMcp
      return
    }
    const pre = fp.spread ? (M: THREE.Matrix4) => hinge(M, P(names[1]), N0, deg(fp.spread!) * h) : undefined
    // free fingers: the outer joint follows the middle one (about two thirds), clamped to natural ranges
    angles[3] = Math.max(angles[3], angles[2] * DIP_K * 0.8)
    chainPose(names, axes, angles, pre); update()
    if (fp.close) { close(names, axes, angles, 1, fp.max ?? [80, 90, 70], pre); const dk = angles[2] * DIP_K; if (Math.abs(angles[3] - dk) > deg(15)) { angles[3] = dk; chainPose(names, axes, angles, pre); update() } }
    mcpOf[i] = angles[1] * 180 / Math.PI
  })
  // Thumb: opposition turns it about the palm's long axis, abduction swings it out from the index; then it closes.
  const tp = plan.thumb, axesT = THUMB.slice(0, 3).map((n, k) => curlAxis(n, THUMB[k + 1]))
  const preT = (M: THREE.Matrix4) => { hinge(M, P(THUMB[0]), F0, deg(tp.oppose) * -h); hinge(M, P(THUMB[0]), N0, deg(tp.abduct) * h) }
  const angT = tp.curl.map(deg)
  if (tp.tip && tp.touch) {
    // A sixth angle rolls the thumb's two phalanges about their own long axis at the proximal joint (the tip stays
    // near that axis, so the contact barely moves), so the pad, not the side of the thumb, faces the glass. The reach
    // cost asks for the pad to face into the glass (nail up and away), leaning back a little the way a real thumb taps.
    const rollAxis = P(THUMB[3]).clone().sub(P(THUMB[1])).normalize()
    const dDist = P(THUMB[3]).clone().sub(P(THUMB[2])).normalize(), padRest = axesT[2].clone().cross(dDist).multiplyScalar(PAD_SIGN).normalize()
    const apply = (x: number[]) => {
      const M = new THREE.Matrix4(); hinge(M, P(THUMB[0]), F0, deg(x[0]) * -h); hinge(M, P(THUMB[0]), N0, deg(x[1]) * h)
      const a = [x[2], x[3], x[4]].map(deg)
      THUMB.forEach((n, i) => { if (i < 3) hinge(M, P(n), axesT[i], a[i]); if (i === 1) hinge(M, P(n), rollAxis, deg(x[5]) * h); setBone(rig, n, M); boneM[n] = M.clone() })
    }
    const pad = () => padRest.clone().transformDirection(boneM[THUMB[2]]).transformDirection(rig.root.matrixWorld)
    if (import.meta.env.DEV) (globalThis as { __thumbPad?: () => THREE.Vector3 }).__thumbPad = pad
    const face = PAD_FACE + 0.05 * nail + (plan.thumbFace ?? 0), padW = PAD_W, tn = nailEdge[THUMB[2]]
    // a touching thumb with long nails also keeps its nail's free edge out of the glass (gently, so the pad still lands)
    const thumbNail = () => { if (!tn || nail <= 0) return 0; const m = rig.bones[THUMB[2]].matrixWorld; let c = 0
      for (const p of tn) { const pen = 0.001 - sdf(_v.copy(p).applyMatrix4(m), fit); if (pen > 0) c += 20 * pen * pen } return c }
    const padCost = () => { const z = pad().z + face; return (z > 0 ? padW * z * z : 0) + thumbNail() }
    touches.push({ owners: new Set([THUMB[2], THUMB[3]]), surf: tp.tip.clone(), aim: tp.tip.clone(), run: aim =>
      reach(THUMB, aim, [tp.oppose, tp.abduct, ...tp.curl, 0], [-60, -60, -30, -30, -20, -75], [100, 80, 70, 80, 90, 75], apply, 0.08, true, padCost) })
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
    if (plan.follow === true) {
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
    } else if (plan.follow === 'y') { rig.root.position.y += Math.max(-0.05, Math.min(0.05, mean.y)); update() }
  }
  rig.root.userData.touchError = worst   // model units; 0.001 is 0.1 mm
  // How far the touching digits' nail free edges sit above the glass (model units); the caller flattens the approach
  // and re-solves while it is too small
  let clear = Infinity
  for (const t of touches) for (const o of t.owners) { const e = nailEdge[o]; if (!e) continue; const m = rig.bones[o].matrixWorld
    let c1 = Infinity; for (const p of e) c1 = Math.min(c1, sdf(_v.copy(p).applyMatrix4(m), fit)); clear = Math.min(clear, c1); if (import.meta.env.DEV) ((globalThis as { __nailBy?: Record<string, number> }).__nailBy ??= {})[o] = c1 }
  rig.root.userData.nailClear = clear
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
export function HandRig({ pose, tone, fit, gesture, onGesture, spectral = SPECTRAL_DEFAULTS, rot = HAND_ROT0, idle = 'low', look = HAND_LOOK0, children }: { look?: HandLook; idle?: IdleLevel; pose: HandPose; tone: string; rot?: HandRot; fit: HandFit | null; spectral?: SpectralOptions; gesture?: Gesture; onGesture?: (g: Gesture) => void; children: React.ReactNode }) {
  const on = pose !== 'off' && !!fit && poseOk(fit, pose)
  // On a surface: tipped back 72 degrees, as if lying on a desk seen from the near side.
  return (
    <group rotation={[on && pose === 'rest' ? -deg(72) : 0, 0, on && pose === 'landscape' ? Math.PI / 2 : 0]} userData={{ handRig: true }}>
      {children}
      <group position={[fit?.cx ?? 0, 0, fit?.cz ?? 0]}>
        {on && <Suspense fallback={null}><Hands pose={pose} tone={tone} fit={fit!} gesture={gesture} sp={spectral} rot={rot} idle={idle} look={look} /></Suspense>}
        {on && isGesture(pose) && gesture && onGesture && <ScreenTarget pose={pose} fit={fit!} g={gesture} onChange={onGesture} />}
      </group>
    </group>)
}

function Hands({ pose, tone, fit, gesture, sp, rot, idle, look }: { pose: HandPose; tone: string; fit: HandFit; gesture?: Gesture; sp: SpectralOptions; rot: HandRot; idle: IdleLevel; look: HandLook }) {
  const motion = useMemo(() => ({ right: new HandMotion(), left: new HandMotion() }), [])
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
    spm.tint.set(sp.tint); spm.setLine(sp.line ?? sp.tint); spm.setBlur(sp.seeBlur ?? 0.85)
    const u = spm.body.uniforms; u.uAlpha.value = 1 - sp.transparency; u.uGlimmer.value = sp.glimmer ? 1 : 0; u.uShimmer.value = sp.shimmer ? 1 : 0; u.uStars.value = sp.stars ? 1 : 0
  }, [spm, sp.tint, sp.line, sp.seeBlur, sp.transparency, sp.glimmer, sp.shimmer, sp.stars])
  const { size, gl } = useThree()
  useFrame(({ clock }, dt) => {
    for (const side of ['right', 'left'] as const) if (motion[side].step(dt, clock.elapsedTime, idle) && spm && rigs[side].root.parent) reskinSpectral(rigs[side].mesh)
  })
  useFrame(({ clock, camera }) => { if (!spm) return
    spm.frame(size.width, size.height, gl.getPixelRatio(), clock.elapsedTime)
    for (const side of ['right', 'left'] as const) if (rigs[side].root.parent) updateSpectral(rigs[side].mesh, camera) })
  useEffect(() => { rigs.right.mesh.material = mat; rigs.left.mesh.material = mat }, [rigs, mat])
  // Only the gesture fields the pose uses, so moving a marker re-solves just the touching hand.
  const ges = isGesture(pose) ? gesture : undefined
  // Nails: measured on each hand at rest (before any solve), rebuilt when length or shape change, riding on the distal bones
  const build = Math.max(0.75, Math.min(1.3, look.build ?? 1))
  const spots = useMemo(() => { applyBuild(rigs.right, build); applyBuild(rigs.left, build)
    return { right: measureNails(rigs.right, 'right'), left: measureNails(rigs.left, 'left') } }, [rigs, build])
  const nailMat = useMemo(() => spm ? spm.body : nailMaterial(SKIN_TONES[tone]?.color ?? SKIN_TONES.fair.color, look.nailColor ?? (tone === 'silhouette' ? SKIN_TONES.silhouette?.color ?? null : null)), [spm, tone, look.nailColor])
  useEffect(() => () => { if (!spm) nailMat.dispose() }, [nailMat, spm])
  const nails = useMemo(() => {
    const out = { right: [] as { m: THREE.Mesh; bone: string; edge: THREE.Vector3[]; outline: number[] }[], left: [] as { m: THREE.Mesh; bone: string; edge: THREE.Vector3[]; outline: number[] }[] }
    for (const side of ['right', 'left'] as const) for (const sp of spots[side]) {
      const b = nailGeometry(sp.fit, look.nailLen, look.nailShape), m = new THREE.Mesh(b.geo)
      sp.frame.decompose(m.position, m.quaternion, m.scale); m.frustumCulled = false
      m.userData = { hand: true, nail: true }
      out[side].push({ m, bone: sp.bone, edge: b.edge.map(p => p.clone().applyMatrix4(sp.frame)), outline: b.outline })
    }
    return out
  }, [spots, look.nailLen, look.nailShape])
  useEffect(() => {
    for (const side of ['right', 'left'] as const) {
      const r = rigs[side]; r.root.userData.nailEdge = Object.fromEntries(nails[side].map(n => [n.bone, n.edge]))
      for (const n of nails[side]) r.bones[n.bone].add(n.m)
    }
    return () => { for (const side of ['right', 'left'] as const) for (const n of nails[side]) { n.m.removeFromParent(); n.m.geometry.dispose() } }
  }, [nails, rigs])
  const solved = useRef<Record<string, string>>({})
  const lastRep = useRef('')
  const arms = useMemo(() => ({ right: new THREE.Mesh(forearmGeometry()), left: new THREE.Mesh(forearmGeometry()) }), [])
  useEffect(() => { for (const m of [arms.right, arms.left]) { m.material = mat; m.castShadow = m.receiveShadow = true; m.userData.hand = true } }, [arms, mat])
  useEffect(() => {
    const g = group.current; if (!g) return
    const mk = (flat: number) => plans(pose, fit, ges, look.nailLen, flat, look.size).map(pl => rotatePlan(pl, rot))
    const list = mk(look.nailLen)
    const used = new Set<THREE.Object3D>()
    for (let li = 0; li < list.length; li++) { let pl = list[li]
      const r = rigs[pl.side], key = JSON.stringify([pl, fit, look.size, look.nailLen, look.nailShape, build])
      if (solved.current[pl.side] !== key || r.root.parent !== g) {
        // spring from the pose on screen to the new solve, unless the hand is just appearing
        const m = motion[pl.side], animate = r.root.parent === g
        if (animate) m.snapshot()
        g.remove(r.root); solve(r, pl, fit, look.size, look.nailLen)
        // long nails: while a touching nail's free edge is within 1 mm of the glass, come in flatter (and turn the thumb's
        // pad further into the glass) and solve again
        // and solve again. Each try is scored on touch error plus any clearance shortfall; the best one is kept.
        const score = () => (r.root.userData.touchError ?? 0) + Math.max(0, 0.01 - (r.root.userData.nailClear ?? 1)) * 0.5
        let best = { s: score(), pl }
        for (let k = 1, flat = look.nailLen; look.nailLen > 0 && k <= 4 && (r.root.userData.nailClear ?? 1) < 0.01; k++) {
          flat += 0.3; pl = { ...mk(flat)[li], thumbFace: 0.08 * k }; solve(r, pl, fit, look.size, look.nailLen); const sc = score(); if (sc < best.s) best = { s: sc, pl } }
        if (best.pl !== pl) { pl = best.pl; solve(r, pl, fit, look.size, look.nailLen) }
        solved.current[pl.side] = key; g.add(r.root); placeArm(arms[pl.side], r); arms[pl.side].scale.set(build, 1, build); g.add(arms[pl.side])
        const touching = new Set<string>([...(pl.thumb.touch ? ['thumb'] : []), ...pl.fingers.flatMap((f, i) => f.touch ? [FINGERS[i]] : [])])
        m.capture(r.root, r.bones, r.rest, touching, arms[pl.side], animate)
      }
      used.add(r.root)
      if (import.meta.env.DEV) (globalThis as { __touchErr?: Record<string, number> }).__touchErr = { ...(globalThis as { __touchErr?: Record<string, number> }).__touchErr, [pl.side]: r.root.userData.touchError ?? 0, [pl.side + 'Nail']: r.root.userData.nailClear ?? 0 }
    }
    // Reach report for the panel, in mm (model unit is 100 mm), only for digits that touch.
    const rep: Record<string, number> = { right: 0, left: 0 }
    for (const pl of list) if (rigs[pl.side].root.userData.touchError !== undefined && isFinite(rigs[pl.side].root.userData.touchError)) rep[pl.side] = rigs[pl.side].root.userData.touchError * 100
    // only when the report changes: during timeline playback the hand re-solves every frame
    for (const k in rep) rep[k] = Math.round(rep[k] * 10) / 10
    // posted after the effect, so the panel's update is not a state change inside this effect (which React flags every frame)
    const repKey = JSON.stringify(rep); if (lastRep.current !== repKey) { lastRep.current = repKey; setTimeout(() => window.dispatchEvent(new CustomEvent(REACH_EVENT, { detail: rep })), 0) }
    for (const side of ['right', 'left'] as const) if (!used.has(rigs[side].root)) { g.remove(rigs[side].root, arms[side]); delete solved.current[side] }
  }, [pose, fit, rigs, ges, arms, rot, look.size, nails])
  // Spectral: outlines, inner lines and stars follow each re-solve; the hands leave the shadow pass (line layer) and cast none.
  useEffect(() => {
    for (const side of ['right', 'left'] as const) {
      const r = rigs[side], arm = arms[side]
      // renderOrder 10: the clear body draws after the phone's glass and the floor shadow, so its depth (which the outline
      // needs) doesn't cut holes in them
      for (const m of [r.mesh, arm, ...nails[side].map(n => n.m)] as THREE.Mesh[]) { m.layers.set(spm ? LINE_LAYER : 0); m.castShadow = !spm; m.renderOrder = spm ? 10 : 0; if (!spm) removeHull(m) }
      for (const n of nails[side]) n.m.material = nailMat
      if (!spm) continue
      addHull(r.mesh, spm); addHull(arm, spm)
      // nails: a thin plate's inflated hull read as a solid patch, so each nail gets its own outline line instead
      for (const n of nails[side]) { const g = new LineSegmentsGeometry(); g.setPositions(n.outline)
        const l = new LineSegments2(g, spm.line); l.renderOrder = 12; l.layers.set(LINE_LAYER); l.frustumCulled = false; l.userData = { spectral: true, noBounds: true }; n.m.add(l) }
      if (r.root.parent) buildSpectral(r.mesh, r.owner, spm, nails[side].length > 0)
    }
    if (import.meta.env.DEV) (globalThis as { __omHands?: unknown }).__omHands = { rigs, arms }
  }, [spm, rigs, arms, pose, fit, ges, rot, nails, nailMat])
  useEffect(() => () => { const g = group.current; for (const side of ['right', 'left'] as const) g?.remove(rigs[side].root, arms[side]); solved.current = {} }, [rigs, arms])
  return <group ref={group} userData={{ noBounds: true }} />
}
useGLTF.preload(URL_R); useGLTF.preload(URL_L)

if (import.meta.hot) import.meta.hot.dispose(() => { poreTex?.dispose(); poreTex = null; armGeo?.dispose(); armGeo = null })
