// Keyframe timeline: data, easing, interpolation and the live playback state (read by TimelineDriver every frame).
import * as THREE from 'three'

export type Ease = 'linear' | 'in' | 'out' | 'inout' | 'spring'
export const EASES: [Ease, string][] = [['linear', 'Linear'], ['in', 'Ease in'], ['out', 'Ease out'], ['inout', 'Ease in-out'], ['spring', 'Spring']]
export interface TlPose { tiltX: number; tiltY: number; rotZ: number; zoom: number; panX: number; panY: number; fov: number }
/** Everything a keyframe stores. Continuous values are smart-animated per frame; the rest switch at a segment's midpoint. */
export interface KfState {
  pose: TlPose
  fold: number | null                     // iPhone Duo hinge angle (null on other devices)
  hands: { pose: string; tone: string }
  handRot: { tilt: number; spin: number; roll: number }
  tap: { x: number; y: number }
  /** the rest of the gesture (swipe path, progress, pinch spread and angle, typing keys); missing on keyframes saved before it was added */
  ges?: Partial<Record<GesKey, number>>
  light: { intensity: number; azimuth: number; elevation: number; floor: number }
  fx: { focus: number; blur: number }
}
export const GES_KEYS = ['sx', 'sy', 'ex', 'ey', 'progress', 'spread', 'angle', 'kx', 'ky', 'kx2', 'ky2'] as const
export type GesKey = typeof GES_KEYS[number]
export interface Keyframe { id: string; dur: number; ease: Ease; s: KfState }

export const ease = (e: Ease, t: number) => {
  t = Math.min(1, Math.max(0, t))
  switch (e) {
    case 'in': return t * t * t
    case 'out': return 1 - Math.pow(1 - t, 3)
    case 'inout': return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
    // springy settle: a little overshoot that dies away, exactly 1 at the end
    case 'spring': return t >= 1 ? 1 : 1 - Math.exp(-6 * t) * Math.cos(t * Math.PI * 2.5)
    default: return t
  }
}

export const total = (k: Keyframe[]) => k.slice(1).reduce((s, f) => s + f.dur, 0)
/** Start time of each keyframe (the first sits at 0; each later one dur after the previous). */
export const starts = (k: Keyframe[]) => { let t = 0; return k.map((f, i) => (i ? (t += f.dur) : 0)) }

const qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), eu = new THREE.Euler()
const d2r = THREE.MathUtils.degToRad
export const poseQuat = (p: TlPose, q: THREE.Quaternion) => q.setFromEuler(eu.set(d2r(p.tiltX), d2r(p.tiltY), d2r(p.rotZ)))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** Interpolated frame at time t: rotation as a quaternion (slerp, the shortest way, never flips), the rest lerped.
 *  seg/half say which segment and which half of it we are in, for the discrete values. */
export interface Frame { handRot: { tilt: number; spin: number; roll: number }; tap: { x: number; y: number }; ges: Partial<Record<GesKey, number>>; q: THREE.Quaternion; pan: [number, number]; zoom: number; fov: number; fold: number | null; seg: number; disc: KfState; k: number }
const out: Frame = { handRot: { tilt: 0, spin: 0, roll: 0 }, tap: { x: 0, y: 0 }, ges: {}, q: new THREE.Quaternion(), pan: [0, 0], zoom: 1, fov: 30, fold: null, seg: 0, disc: null as unknown as KfState, k: 0 }
export function sample(k: Keyframe[], t: number): Frame | null {
  if (!k.length) return null
  const st = starts(k)
  let i = 1; while (i < k.length - 1 && t > st[i]) i++
  if (k.length === 1 || t <= 0) { fill(k[0].s, k[0].s, 0); out.seg = 0; out.disc = k[0].s; out.k = 0; return out }
  const a = k[i - 1], b = k[i], u = b.dur > 0 ? (t - st[i - 1]) / b.dur : 1, e = ease(b.ease, u)
  fill(a.s, b.s, e); out.seg = i; out.k = Math.min(1, u); out.disc = u < 0.5 ? a.s : b.s
  return out
}
function fill(a: KfState, b: KfState, e: number) {
  poseQuat(a.pose, qa); poseQuat(b.pose, qb); out.q.slerpQuaternions(qa, qb, e)
  out.pan[0] = lerp(a.pose.panX, b.pose.panX, e); out.pan[1] = lerp(a.pose.panY, b.pose.panY, e)
  // zoom in log space so equal times give equal apparent scale changes
  out.zoom = Math.exp(lerp(Math.log(a.pose.zoom), Math.log(b.pose.zoom), e)); out.fov = lerp(a.pose.fov, b.pose.fov, e)
  // the hand smart-animates too: touch point, hand rotation and the rest of the gesture, so the whole hand travels with the thumb
  out.tap.x = lerp(a.tap.x, b.tap.x, e); out.tap.y = lerp(a.tap.y, b.tap.y, e)
  out.handRot.tilt = lerp(a.handRot.tilt, b.handRot.tilt, e); out.handRot.spin = lerp(a.handRot.spin, b.handRot.spin, e); out.handRot.roll = lerp(a.handRot.roll, b.handRot.roll, e)
  const g: Partial<Record<GesKey, number>> = {}
  for (const k of GES_KEYS) { const x = a.ges?.[k], y = b.ges?.[k]; if (x != null || y != null) g[k] = x == null ? y! : y == null ? x : lerp(x, y, e) }
  out.ges = g
  out.fold = a.fold == null || b.fold == null ? (b.fold ?? a.fold) : lerp(a.fold, b.fold, e)
}
/** The pose sliders' angles for a quaternion (for handing the final frame back to the UI). */
export function quatPose(q: THREE.Quaternion) {
  eu.setFromQuaternion(q, 'XYZ'); const r = THREE.MathUtils.radToDeg
  return { tiltX: r(eu.x), tiltY: r(eu.y), rotZ: r(eu.z) }
}

/** Live playback state: written by the UI, read by the frame loop (no React state per frame). */
export const tlLive = {
  keys: [] as Keyframe[],
  /** seconds shown across the track (the playhead's scale) */
  view: 0,
  playing: false, loop: true, t: 0, last: 0,
  /** true while the timeline owns the scene (playing or scrubbing), so the driver applies frames */
  active: false,
  /** apply one frame, then hand it back to the sliders (after a pause, scrub or the end) */
  pending: false,
  onEnd: null as null | (() => void),
  /** DOM nodes the driver updates directly: the scrubber and the time label */
  ui: { scrub: null as HTMLInputElement | null, time: null as HTMLElement | null, head: null as HTMLElement | null },
  /** called when the discrete part (hand pose, rotation, tap, light, effects) changes keyframe, i.e. at midpoints */
  onDisc: null as null | ((s: KfState) => void),
  disc: null as KfState | null,
  /** called every frame with the interpolated hand (touch point, rotation, gesture) */
  onHand: null as null | ((f: Frame) => void),
  /** frame timing log for checks: performance.now() of each applied frame */
  log: null as number[] | null,
}

const KEY = 'om-timeline-v1'
export function loadKeys(): Keyframe[] { try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : [] } catch { return [] } }
export function saveKeys(k: Keyframe[]) { try { localStorage.setItem(KEY, JSON.stringify(k)) } catch { /* storage full or off */ } }
export const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, '0')}`
