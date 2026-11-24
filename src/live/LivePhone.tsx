// /live: the 3D iPhone with a real, interactive web page on its screen.
// The page is an <iframe> placed with drei's <Html transform>, sized to the drawing's active area and corner radius.
// Drag outside the screen to spin. With Stay at angle (on whenever an angle is set) it holds; otherwise it eases back to face-on.
// X, Y and Z in the Angle panel set that spin in degrees. The panel follows a drag, and the page opens on the studio's saved angle.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import IPhonePro from '../devices/IPhonePro'
import { IPHONE_18_PRO, IPHONE_18_PRO_MAX, type IPhoneSpec } from '../devices/iphoneSpecs'
import { Env } from '../Env'
import type { DeviceOptions, LogoArt } from '../types'
import { loadLocalLogo } from '../localLogo'
import { type SbCfg, parseSb, writeSb } from '../statusbar/config'
import { StatusPanel } from '../statusbar/Panel'
import { Island, StatusBar, HomeBar, useClock, ISL, islandSketch } from '../statusbar/StatusBar'
import { SketchStyle, SKETCH_PAPER, SKETCH_DEFAULTS } from '../sketch/Sketch'

const mm = (v: number) => v / 100 // same unit as IPhonePro
const PX_PER_UNIT = 40 // drei <Html transform> maps 40 CSS px to 1 world unit (distanceFactor 10)

const params = new URLSearchParams(location.search)
const SPEC: IPhoneSpec = params.get('device') === 'max' ? IPHONE_18_PRO_MAX : IPHONE_18_PRO
const MAX = params.get('device') === 'max'
// Viewport in iPhone points, matching Figma's frames: Pro 402x874, Pro Max 440x956
const CSS_W = MAX ? 440 : 402, CSS_H = MAX ? 956 : 874
const SRC = params.get('src') || '/live-demo/index.html'
const FINISH = params.get('finish') || 'black'
const HOLD = params.has('hold') // keep the starting angle (for tilted screenshots)
// iOS 18+ on 402x874 and 440x956 (16 Pro class onward): status bar 54 pt, top safe area 62 pt.
// The software Dynamic Island is drawn larger than the glass cut-out: 126 x 37 pt, 14 pt from the top (Apple UI Kit / simulator).
const TOP_SAFE = 62
const SKETCH = params.get('style') === 'sketch' // ?style=sketch: flat illustration look
const ISLAND_LOOK = islandSketch(SKETCH_DEFAULTS.line)
const stay = { on: params.has('stay') } // stay at angle: no ease back, screen usable while tilted
/** Any angle into -180..180, to 0.001°. The same wrap the studio uses, so a saved pose lands on the same numbers. */
const wrap = (v: number) => { const w = (((v + 180) % 360) + 360) % 360 - 180; return Math.round(w * 1000) / 1000 }
const D2R = Math.PI / 180, R2D = 180 / Math.PI
const numParam = (k: string): number | null => {
  if (!params.has(k)) return null
  const n = Number(params.get(k))
  return Number.isFinite(n) ? wrap(n) : 0
}
/** Opening angle, in degrees. A yaw, pitch or roll in the URL wins; otherwise the camera pose saved by the studio. */
function readAngles(): { x: number; y: number; z: number } {
  const px = numParam('pitch'), yw = numParam('yaw'), rz = numParam('roll')
  if (px !== null || yw !== null || rz !== null) return { x: px ?? 0, y: yw ?? 0, z: rz ?? 0 }
  try {
    const p = JSON.parse(localStorage.getItem('om-scene-v1') || 'null')?.pose
    if (p && (typeof p.tiltX === 'number' || typeof p.tiltY === 'number' || typeof p.rotZ === 'number'))
      return { x: wrap(+p.tiltX || 0), y: wrap(+p.tiltY || 0), z: wrap(+p.rotZ || 0) }
  } catch { /* no saved scene: face-on */ }
  return { x: 0, y: 0, z: 0 }
}
const START = readAngles()
// A set angle holds. Ease-back only runs from a face-on open, until someone sets an axis or turns Stay at angle on.
if (START.x || START.y || START.z) stay.on = true

/** Light or dark status bar for 'auto': reads the app's top background when it is same-origin, otherwise dark text. */
function useTone(frame: React.RefObject<HTMLIFrameElement | null>, mode: SbCfg['mode'], y = 20): 'dark' | 'light' {
  const [tone, setTone] = useState<'dark' | 'light'>('dark')
  useEffect(() => {
    if (mode !== 'auto') return
    const i = setInterval(() => {
      try {
        const d = frame.current?.contentDocument; if (!d?.body) return
        const el = d.elementFromPoint(CSS_W / 2, y) ?? d.body
        let n: Element | null = el, bg = ''
        while (n) { bg = getComputedStyle(n).backgroundColor; if (bg && !bg.endsWith(', 0)') && bg !== 'transparent') break; n = n.parentElement }
        const m = bg.match(/\d+(\.\d+)?/g)?.map(Number)
        if (m) setTone(m[0] * 0.3 + m[1] * 0.59 + m[2] * 0.11 > 140 ? 'dark' : 'light')
      } catch { /* cross-origin: keep dark */ }
    }, 500)
    return () => clearInterval(i)
  }, [frame, mode, y])
  return mode === 'light' ? 'light' : mode === 'dark' ? 'dark' : tone
}

const drag = { active: false, x: 0, y: 0, yaw: START.y * D2R, pitch: START.x * D2R, roll: START.z * D2R, vYaw: 0 }
if (import.meta.env.DEV) (window as unknown as { __omLive: typeof drag }).__omLive = drag

function Screen({ s, interactive, sb }: { s: IPhoneSpec; interactive: boolean; sb: SbCfg }) {
  const pxPerMm = CSS_W / s.active.w
  const cssH = CSS_H
  const radius = (s.body.cornerR - s.active.inset) * pxPerMm
  void s.island // the glass cut-out is smaller; iOS draws a 126 x 37 pt island over it
  const scale = mm(s.active.w) / (CSS_W / PX_PER_UNIT)
  const z = mm(s.body.t) / 2 + 0.0003 * 6
  // drei's Html can lose its first portal root under React 19; remount once after the canvas settles.
  const [k, setK] = useState(0)
  const frame = useRef<HTMLIFrameElement>(null)
  const tone = useTone(frame, sb.mode)
  const homeTone = useTone(frame, sb.mode, cssH - 10)
  const clock = useClock(sb.time)
  useEffect(() => { const t = setTimeout(() => setK(1), 50); return () => clearTimeout(t) }, [])
  return (
    <group position={[0, 0, z]} scale={scale}>
      <Html key={k} transform occlude zIndexRange={[10, 0]} pointerEvents={interactive ? 'auto' : 'none'}>
        <div style={{ width: CSS_W, height: cssH, borderRadius: radius, overflow: 'hidden', position: 'relative', background: '#000',
          backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}>
          <iframe ref={frame} src={SRC} title="Live app" style={{ width: '100%', height: '100%', border: 0, display: 'block', pointerEvents: interactive ? 'auto' : 'none' }} />
          {/* Dynamic Island, drawn over the page */}
          <Island sb={sb} w={CSS_W} look={SKETCH ? ISLAND_LOOK : undefined} />
          {sb.mode !== 'off' && <StatusBar tone={tone} sb={sb} w={CSS_W} time={clock} />}
          {sb.homeBar && <HomeBar tone={homeTone} w={CSS_W} h={cssH} />}
          {/* faint cover-glass sheen */}
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: 'linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0) 40%)' }} />
        </div>
      </Html>
    </group>
  )
}

function Rig({ onFaceOn, onAngles, faceOn, sb }: { onFaceOn: (v: boolean) => void; onAngles: (a: { x: number; y: number; z: number }) => void; faceOn: boolean; stayOn: boolean; sb: SbCfg }) {
  const [logo, setLogo] = useState<LogoArt | null>(null)
  useEffect(() => { let live = true; loadLocalLogo().then(l => { if (live) setLogo(l) }); return () => { live = false } }, [])
  const ref = useRef<THREE.Group>(null)
  const last = useRef(true)
  const shown = useRef({ x: NaN, y: NaN, z: NaN })
  useFrame((_, dt) => {
    if (!drag.active && !HOLD && !stay.on) {
      drag.yaw += drag.vYaw * dt; drag.vYaw *= Math.exp(-6 * dt)
      // ease back to the nearest whole turn, face-on, on every axis
      const target = Math.round(drag.yaw / (Math.PI * 2)) * Math.PI * 2
      const k = 1 - Math.exp(-5 * dt)
      drag.yaw += (target - drag.yaw) * k; drag.pitch += (0 - drag.pitch) * k; drag.roll += (0 - drag.roll) * k
    }
    drag.pitch = wrap(drag.pitch * R2D) * D2R; drag.yaw = wrap(drag.yaw * R2D) * D2R; drag.roll = wrap(drag.roll * R2D) * D2R
    if (ref.current) { ref.current.rotation.set(drag.pitch, drag.yaw, drag.roll); if (import.meta.env.DEV) (window as unknown as { __omLiveGroup: THREE.Group }).__omLiveGroup = ref.current }
    const x = wrap(drag.pitch * R2D), y = wrap(drag.yaw * R2D), z = wrap(drag.roll * R2D)
    if (x !== shown.current.x || y !== shown.current.y || z !== shown.current.z) { shown.current = { x, y, z }; onAngles(shown.current) }
    const d = Math.abs(drag.yaw - Math.round(drag.yaw / (Math.PI * 2)) * Math.PI * 2) + Math.abs(drag.pitch) + Math.abs(drag.roll)
    // stay mode: usable at any angle unless the screen faces away (past about 80 degrees)
    const n = new THREE.Vector3(0, 0, 1).applyEuler(new THREE.Euler(drag.pitch, drag.yaw, drag.roll))
    const face = stay.on ? !drag.active && n.z > Math.cos(80 * Math.PI / 180) : !drag.active && d < 0.02
    if (face !== last.current) { last.current = face; onFaceOn(face) }
  })
  const opts: DeviceOptions = useMemo(() => ({ fold: 0, screen: 'inner', finish: FINISH, logo, logoSize: 0.2, logoTint: '#8a8f99', simTray: false, hideIsland: true }), [logo]) // the page's status-bar island is the only island
  return (
    <group ref={ref}>
      <SketchStyle on={SKETCH}><IPhonePro spec={SPEC} texture={null} mediaAspect={1} opts={opts} /></SketchStyle>
      <Screen s={SPEC} interactive={faceOn} sb={sb} />
    </group>
  )
}

const SB0 = parseSb(params)
function SbTest() { const t = useClock(SB0.time); return <StatusBar tone={SB0.mode === 'dark' ? 'dark' : 'light'} sb={SB0} w={CSS_W} time={t} /> }

/** One axis, matching the live page's own controls: a drag snaps to whole degrees, the field takes decimals. */
function AxisRow({ axis, label, sub, v, set }: { axis: string; label: string; sub: string; v: number; set: (n: number) => void }) {
  const shown = String(v)
  const [txt, setTxt] = useState<string | null>(null)
  const numRef = useRef<HTMLInputElement>(null)
  const sent = useRef<number | null>(null)
  useEffect(() => {
    if (sent.current != null && Math.abs(sent.current - v) < 1e-9) { sent.current = null; return }
    sent.current = null
    if (document.activeElement === numRef.current) return
    setTxt(null)
  }, [v])
  const apply = (n: number, typing = false) => {
    if (!typing) setTxt(null)
    const next = wrap(n); sent.current = next
    if (next !== v) set(next)
  }
  const name = `${label} ${sub}`
  const field: React.CSSProperties = { font: 'inherit', fontSize: 12, width: 64, textAlign: 'right', padding: '2px 4px', border: '1px solid #c7c7cc', borderRadius: 5, background: '#fff', fontVariantNumeric: 'tabular-nums' }
  return (
    <div data-axis={axis} style={{ display: 'grid', gridTemplateColumns: '46px minmax(0, 1fr) auto', gap: 6, alignItems: 'center' }}>
      <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1, fontSize: 12 }}>
        {label}<small style={{ fontSize: 10, color: '#6e6e73' }}>{sub}</small>
      </span>
      <input type="range" min={-180} max={180} step="any" value={v} aria-label={`${name} slider`} aria-valuetext={`${shown} degrees`}
        onChange={e => apply(Math.round(+e.target.value))}
        onKeyDown={e => { const up = e.key === 'ArrowRight' || e.key === 'ArrowUp', dn = e.key === 'ArrowLeft' || e.key === 'ArrowDown'
          if (!up && !dn) return; e.preventDefault(); apply(v + (up ? 1 : -1) * (e.shiftKey ? 10 : 1)) }} />
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
        <input ref={numRef} type="text" inputMode="decimal" autoComplete="off" spellCheck={false} aria-label={`${name} in degrees`}
          value={txt ?? shown} style={field}
          onFocus={e => e.currentTarget.select()}
          onChange={e => { const raw = e.target.value; if (raw !== '' && !/^-?\d*\.?\d*$/.test(raw)) return; setTxt(raw); const n = parseFloat(raw); if (Number.isFinite(n)) apply(n, true) }}
          onBlur={() => setTxt(null)}
          onKeyDown={e => {
            if (e.key === 'Enter') { setTxt(null); (e.target as HTMLInputElement).blur(); return }
            const up = e.key === 'ArrowUp', dn = e.key === 'ArrowDown'; if (!up && !dn) return
            e.preventDefault()
            const base = txt != null && Number.isFinite(parseFloat(txt)) ? parseFloat(txt) : v
            apply(base + (up ? 1 : -1) * (e.shiftKey ? 10 : 1))
          }} />
        <span aria-hidden="true" style={{ fontSize: 11, color: '#6e6e73' }}>°</span>
        <button type="button" aria-label={`Reset ${name} to 0`} title="Reset to 0" onClick={() => apply(0)}
          style={{ font: 'inherit', fontSize: 11, width: 22, height: 22, padding: 0, border: '1px solid #c7c7cc', borderRadius: 5, background: '#fff', color: '#1d1d1f', cursor: 'pointer' }}>0</button>
      </span>
    </div>
  )
}

export default function LivePhone() {
  // ?sbtest: flat 1:1 status bar with the compact island, for pixel checks against device screenshots
  if (params.has('sbtest')) return (
    <div style={{ position: 'relative', width: CSS_W, height: 60, background: params.get('sbtest') || '#333', overflow: 'hidden' }}>
      <Island sb={SB0} w={CSS_W} />
      <SbTest />
    </div>)
  const [faceOn, setFaceOn] = useState(!HOLD || stay.on || (START.x === 0 && START.y === 0 && START.z === 0))
  const [stayOn, setStayOn] = useState(stay.on)
  const [ang, setAng] = useState(START)
  const [sb, setSb] = useState<SbCfg>(SB0)
  useEffect(() => { writeSb(sb) }, [sb])
  useEffect(() => { stay.on = stayOn }, [stayOn])
  // The address keeps the angle, so a reload of this page opens where it was left.
  useEffect(() => {
    const u = new URL(location.href)
    u.searchParams.set('pitch', String(ang.x)); u.searchParams.set('yaw', String(ang.y)); u.searchParams.set('roll', String(ang.z))
    if (stayOn) u.searchParams.set('stay', ''); else u.searchParams.delete('stay')
    if (u.search !== location.search) history.replaceState(null, '', u)
  }, [ang, stayOn])
  useEffect(() => {
    const up = () => { drag.active = false }
    const move = (e: PointerEvent) => {
      if (!drag.active) return
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y
      drag.x = e.clientX; drag.y = e.clientY
      drag.yaw += dx * 0.01; drag.vYaw = dx * 0.6
      drag.pitch += dy * 0.006
    }
    addEventListener('pointerup', up); addEventListener('pointermove', move)
    return () => { removeEventListener('pointerup', up); removeEventListener('pointermove', move) }
  }, [])
  const hold = () => { stay.on = true; drag.vYaw = 0; setStayOn(true) }
  const setAxis = (k: 'x' | 'y' | 'z', n: number) => {
    const w = wrap(n); hold()
    if (k === 'x') drag.pitch = w * D2R
    else if (k === 'y') drag.yaw = w * D2R
    else drag.roll = w * D2R
    setAng(a => a[k] === w ? a : { ...a, [k]: w })
  }
  const resetAngles = () => { drag.pitch = 0; drag.yaw = 0; drag.roll = 0; drag.vYaw = 0; hold(); setAng({ x: 0, y: 0, z: 0 }) }
  return (
    <div style={{ position: 'fixed', inset: 0, background: SKETCH ? SKETCH_PAPER : 'radial-gradient(circle at 50% 40%, #f5f5f7, #d9dae0)', touchAction: 'none', userSelect: 'none' }}
      onPointerDown={e => { drag.active = true; drag.x = e.clientX; drag.y = e.clientY; drag.vYaw = 0; setFaceOn(false) }}>
      <Canvas gl={{ antialias: true, alpha: true, toneMapping: THREE.NeutralToneMapping }} camera={{ fov: 30, position: [0, 0, 4.2] }} data-face-on={faceOn ? '1' : '0'}>
        {!SKETCH && <Env intensity={1} />}
        <ambientLight intensity={0.4} />
        <directionalLight position={[2, 3, 4]} intensity={1.2} />
        <Rig onFaceOn={setFaceOn} onAngles={setAng} faceOn={faceOn} stayOn={stayOn} sb={sb} />
      </Canvas>
      <div id="live-angle" onPointerDown={e => e.stopPropagation()} onWheel={e => e.stopPropagation()} style={{ position: 'absolute', top: 16, left: 16, zIndex: 5, width: 336,
        display: 'flex', flexDirection: 'column', gap: 6, font: '13px -apple-system, system-ui, sans-serif', color: '#1d1d1f',
        background: 'rgba(255,255,255,0.8)', borderRadius: 8, padding: '8px 10px', backdropFilter: 'blur(8px)' }}>
        <div style={{ fontWeight: 600 }}>Angle</div>
        <AxisRow axis="x" label="X" sub="pitch" v={ang.x} set={n => setAxis('x', n)} />
        <AxisRow axis="y" label="Y" sub="yaw" v={ang.y} set={n => setAxis('y', n)} />
        <AxisRow axis="z" label="Z" sub="roll" v={ang.z} set={n => setAxis('z', n)} />
        <button id="live-reset-angles" type="button" onClick={resetAngles}
          style={{ font: 'inherit', fontSize: 12, border: '1px solid #c7c7cc', borderRadius: 5, background: '#fff', color: '#1d1d1f', cursor: 'pointer', padding: '3px 8px', alignSelf: 'flex-start' }}>Reset angles</button>
      </div>
      <p style={{ position: 'absolute', bottom: 16, width: '100%', textAlign: 'center', margin: 0, color: '#6e6e73', pointerEvents: 'none' }}>
        {stayOn ? 'Drag around the phone to spin it. It stays where you leave it, and the app works at any angle.' : 'Drag around the phone to spin it. Let go and it turns back so you can use the app.'}
      </p>
      <label onPointerDown={e => e.stopPropagation()} style={{ position: 'absolute', top: 16, right: 16, display: 'flex', gap: 6, alignItems: 'center',
        font: '13px -apple-system, system-ui, sans-serif', color: '#1d1d1f', background: 'rgba(255,255,255,0.8)', padding: '6px 10px', borderRadius: 8 }}>
        <input id="stay-toggle" type="checkbox" checked={stayOn} onChange={e => { stay.on = e.target.checked; drag.vYaw = 0; setStayOn(e.target.checked) }} /> Stay at angle
      </label>
      <StatusPanel sb={sb} onChange={setSb} />
      <span id="face-state" data-face-on={faceOn ? '1' : '0'} hidden />
    </div>
  )
}
