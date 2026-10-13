// Touch gestures for the hands: a target point on the screen in iPhone points (0 to 402 by 0 to 874 on the 18 Pro,
// 440 by 956 on the Pro Max, origin top left like Figma), plus swipe start, end and progress and pinch spread.
// The hand solver in Hands.tsx re-poses the wrist and fingers so the fingertip pad rests on the glass at that point.
// ScreenTarget is the draggable marker drawn over the screen in the studio; GestureControls is the sidebar panel.
import { useRef } from 'react'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { sceneHit } from '../devices/shared'
import type { HandFit, HandPose } from './Hands'

export type GesturePose = 'tap' | 'swipe' | 'zoom' | 'thumb' | 'holdtap'
export const GESTURE_POSES: GesturePose[] = ['tap', 'swipe', 'zoom', 'thumb', 'holdtap']
export const isGesture = (p: HandPose): p is GesturePose => (GESTURE_POSES as string[]).includes(p)

/** All positions in screen points from the top left. x, y: tap target, pinch centre or thumb point. sx, sy to ex, ey:
 * swipe path, progress 0 to 1 along it. spread: distance between thumb and index in points. angle: pinch axis in degrees. */
export interface Gesture { x: number; y: number; sx: number; sy: number; ex: number; ey: number; progress: number; spread: number; angle: number; marker: boolean }
export const GESTURE_DEFAULT: Gesture = { x: 201, y: 520, sx: 300, sy: 600, ex: 100, ey: 600, progress: 0.5, spread: 150, angle: 65, marker: true }

/** Screen size in model units and points, with the glass plane. Falls back to the 18 Pro proportions. */
export function screenOf(f: HandFit) {
  const sw = f.SW ?? f.W * 0.9265, sh = f.SH ?? f.H * 0.9648, pw = f.PW ?? 402, ph = f.PH ?? 874
  return { sw, sh, pw, ph, z: f.T / 2, unit: sw / pw }
}
/** Screen points to device space (x right, y up, z out of the screen), on the glass. */
export function ptToDevice(f: HandFit, x: number, y: number) {
  const s = screenOf(f)
  return new THREE.Vector3((x / s.pw - 0.5) * s.sw, (0.5 - y / s.ph) * s.sh, s.z)
}
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
/** Scales a gesture from one screen size to another, so switching between the Pro and Pro Max keeps the same spot. */
export function rescale(g: Gesture, from: { pw: number; ph: number }, to: { pw: number; ph: number }): Gesture {
  const kx = to.pw / from.pw, ky = to.ph / from.ph
  return { ...g, x: g.x * kx, y: g.y * ky, sx: g.sx * kx, sy: g.sy * ky, ex: g.ex * kx, ey: g.ey * ky }
}
/** The point the swipe is at now. */
export const swipeAt = (g: Gesture) => ({ x: g.sx + (g.ex - g.sx) * g.progress, y: g.sy + (g.ey - g.sy) * g.progress })

type Handle = 'target' | 'start' | 'end'
const ringGeo = new THREE.RingGeometry(0.018, 0.026, 40), dotGeo = new THREE.CircleGeometry(0.006, 20)
const markMat = (c: string) => new THREE.MeshBasicMaterial({ color: c, depthTest: false, transparent: true, opacity: 0.9, toneMapped: false })
const MAT = { target: markMat('#ff3b6b'), start: markMat('#2fa8ff'), end: markMat('#34c759') }
const lineMat = new THREE.LineBasicMaterial({ color: '#2fa8ff', depthTest: false, transparent: true, opacity: 0.8, toneMapped: false })

function Mark({ p, kind }: { p: THREE.Vector3; kind: Handle }) {
  return <group position={[p.x, p.y, p.z + 0.001]} renderOrder={20}>
    <mesh geometry={ringGeo} material={MAT[kind]} renderOrder={20} userData={{ gizmo: true }} />
    <mesh geometry={dotGeo} material={MAT[kind]} renderOrder={20} userData={{ gizmo: true }} />
  </group>
}

/** Invisible pad over the screen that places the target where you click and follows a drag. Marker rings show
 * through the hand so you can see the fingertip land on them. Hidden from the AI hands passes (userData.gizmo). */
export function ScreenTarget({ pose, fit, g, onChange }: { pose: GesturePose; fit: HandFit; g: Gesture; onChange: (g: Gesture) => void }) {
  const s = screenOf(fit), pad = useRef<THREE.Mesh>(null), grab = useRef<Handle | null>(null)
  const controls = useThree(st => st.controls) as { enabled?: boolean } | null
  const toPt = (e: ThreeEvent<PointerEvent>) => {
    const l = pad.current!.worldToLocal(e.point.clone())
    return { x: clamp((l.x / s.sw + 0.5) * s.pw, 0, s.pw), y: clamp((0.5 - l.y / s.sh) * s.ph, 0, s.ph) }
  }
  const move = (h: Handle, p: { x: number; y: number }) => {
    const r = (v: number) => Math.round(v)
    if (h === 'start') onChange({ ...g, sx: r(p.x), sy: r(p.y) })
    else if (h === 'end') onChange({ ...g, ex: r(p.x), ey: r(p.y) })
    else onChange({ ...g, x: r(p.x), y: r(p.y) })
  }
  const down = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return
    e.stopPropagation(); sceneHit.current = true
    const p = toPt(e)
    let h: Handle = 'target'
    if (pose === 'swipe') h = Math.hypot(p.x - g.sx, p.y - g.sy) <= Math.hypot(p.x - g.ex, p.y - g.ey) ? 'start' : 'end'
    grab.current = h; (e.target as Element).setPointerCapture?.(e.pointerId)
    if (controls) controls.enabled = false
    move(h, p)
  }
  const drag = (e: ThreeEvent<PointerEvent>) => { if (grab.current) { e.stopPropagation(); move(grab.current, toPt(e)) } }
  const up = (e: ThreeEvent<PointerEvent>) => { grab.current = null; (e.target as Element).releasePointerCapture?.(e.pointerId); if (controls) controls.enabled = true }
  const P = (x: number, y: number) => ptToDevice(fit, x, y)
  const sw = swipeAt(g)
  return <group userData={{ noBounds: true, gizmo: true }}>
    <mesh ref={pad} position={[0, 0, s.z + 0.0005]} onPointerDown={down} onPointerMove={drag} onPointerUp={up} userData={{ gizmo: true }}>
      <planeGeometry args={[s.sw, s.sh]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
    </mesh>
    {g.marker && (pose === 'swipe' ? <>
      <Mark p={P(g.sx, g.sy)} kind="start" /><Mark p={P(g.ex, g.ey)} kind="end" /><Mark p={P(sw.x, sw.y)} kind="target" />
      <lineSegments renderOrder={20} userData={{ gizmo: true }} material={lineMat}
        geometry={new THREE.BufferGeometry().setFromPoints([P(g.sx, g.sy), P(g.ex, g.ey)].map(v => v.setZ(v.z + 0.001)))} />
    </> : pose === 'zoom' ? (() => {
      const a = THREE.MathUtils.degToRad(g.angle), dx = Math.cos(a) * g.spread / 2, dy = -Math.sin(a) * g.spread / 2
      return <><Mark p={P(g.x, g.y)} kind="target" /><Mark p={P(g.x + dx, g.y + dy)} kind="end" /><Mark p={P(g.x - dx, g.y - dy)} kind="start" /></>
    })() : <Mark p={P(g.x, g.y)} kind="target" />)}
  </group>
}

/** Sidebar controls for the active gesture. */
export function GestureControls({ pose, fit, g, set }: { pose: GesturePose; fit: HandFit; g: Gesture; set: (g: Gesture) => void }) {
  const s = screenOf(fit)
  const num = (label: string, v: number, max: number, k: keyof Gesture) => (
    <label>{label} <input type="number" min={0} max={max} value={Math.round(v as number)} style={{ width: 64 }}
      onChange={e => set({ ...g, [k]: clamp(Number(e.target.value) || 0, 0, max) })} /></label>)
  const range = (label: string, v: number, min: number, max: number, step: number, k: keyof Gesture, unit = '') => (
    <label className="row"><span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={v} onChange={e => set({ ...g, [k]: +e.target.value })} />
      <output>{step < 1 ? v.toFixed(2) : Math.round(v)}{unit}</output></label>)
  return <>
    <h3>Touch target</h3>
    {pose === 'swipe' ? <>
      <div className="row">{num('Start X', g.sx, s.pw, 'sx')}{num('Y', g.sy, s.ph, 'sy')}</div>
      <div className="row">{num('End X', g.ex, s.pw, 'ex')}{num('Y', g.ey, s.ph, 'ey')}</div>
      {range('Progress', g.progress, 0, 1, 0.01, 'progress')}
    </> : <div className="row">{num(pose === 'zoom' ? 'Centre X' : 'X', g.x, s.pw, 'x')}{num('Y', g.y, s.ph, 'y')}</div>}
    {pose === 'zoom' && <>{range('Spread', g.spread, 40, 260, 1, 'spread', ' pt')}{range('Angle', g.angle, 20, 110, 1, 'angle', '°')}</>}
    <label className="check"><input type="checkbox" checked={g.marker} onChange={e => set({ ...g, marker: e.target.checked })} /> Show marker</label>
    <p className="hint">{pose === 'swipe' ? 'Click or drag on the screen to move the nearest end of the swipe (blue start, green end).' : 'Click or drag on the screen to move the target.'} Points are {s.pw} × {s.ph}, from the top left like Figma. Untick Show marker before a plain PNG export. Photoreal hands leave it out on their own.</p>
  </>
}
