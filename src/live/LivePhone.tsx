// /live: the 3D iPhone with a real, interactive web page on its screen.
// The page is an <iframe> placed with drei's <Html transform>, sized to the drawing's active area and corner radius.
// Drag outside the screen to spin; on release the phone eases back to face-on and the screen becomes interactive again.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import IPhonePro from '../devices/IPhonePro'
import { IPHONE_18_PRO, IPHONE_18_PRO_MAX, type IPhoneSpec } from '../devices/iphoneSpecs'
import { Env } from '../Env'
import type { DeviceOptions, LogoArt } from '../types'
import { loadLocalLogo } from '../localLogo'
import { SketchStyle, SKETCH_PAPER } from '../sketch/Sketch'

const mm = (v: number) => v / 100 // same unit as IPhonePro
const PX_PER_UNIT = 40 // drei <Html transform> maps 40 CSS px to 1 world unit (distanceFactor 10)

const params = new URLSearchParams(location.search)
const SPEC: IPhoneSpec = params.get('device') === 'max' ? IPHONE_18_PRO_MAX : IPHONE_18_PRO
const MAX = params.get('device') === 'max'
// Viewport in iPhone points, matching Figma's frames: Pro 402x874, Pro Max 440x956
const CSS_W = MAX ? 440 : 402, CSS_H = MAX ? 956 : 874
const SRC = params.get('src') || '/live-demo/index.html'
const FINISH = params.get('finish') || 'black'
const START_YAW = Number(params.get('yaw') ?? 0) * Math.PI / 180, START_PITCH = Number(params.get('pitch') ?? 0) * Math.PI / 180
const HOLD = params.has('hold') // keep the starting angle (for tilted screenshots)
const SB = (params.get('statusbar') ?? 'auto') as 'auto' | 'dark' | 'light' | 'off'
// iOS 18+ on 402x874 and 440x956 (16 Pro class onward): status bar 54 pt, top safe area 62 pt.
// The software Dynamic Island is drawn larger than the glass cut-out: 126 x 37 pt, 14 pt from the top (Apple UI Kit / simulator).
const STATUS_H = 54, TOP_SAFE = 62
const ISL = { w: 126, h: 37, top: 14 }
const SKETCH = params.get('style') === 'sketch' // ?style=sketch: flat illustration look
const stay = { on: params.has('stay') } // stay at angle: no ease back, screen usable while tilted

// Measured from two native iPhone 16 Pro screenshots (1206x2622 at 3x), compact-island layout, in pt:
// time + glyph group centred at x 73.8, right cluster (signal, Wi-Fi, battery) centred at x 327.3, centre line y 32.3.
// Signal 19x13.3 (bars 3.33 wide on 5.33 pitch), Wi-Fi 16x12, battery body 24.7x13.3 with a 1x3.3 cap, 8 pt gaps.
const SB_PCT = params.get('battery') !== 'plain' // iOS 18 battery with the percentage inside (default on)
const SB_LEVEL = Math.max(0, Math.min(100, Number(params.get('level') ?? 88)))
const SB_CY = 32.3, SB_LEFT_CX = 65, SB_RIGHT_CX_FROM_RIGHT = 402 - 327.3 // time alone sits where the device draws it (43.3 to 86.7 pt)

/** iOS status bar: time centred in the left ear, signal, Wi-Fi and battery centred in the right, on the island centre line. */
function StatusBar({ tone }: { islandCy: number; islandW: number; tone: 'dark' | 'light' }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const i = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(i) }, [])
  const time = `${now.getHours() % 12 || 12}:${String(now.getMinutes()).padStart(2, '0')}`
  const c = tone === 'dark' ? '#000' : '#fff'
  const lvl = SB_LEVEL / 100
  const W = 78 // right cluster width: 19 + 8 + 16 + 8 + 24.7 + 1.3 + 1
  return (
    <div style={{ position: 'absolute', left: 0, top: 0, width: CSS_W, height: STATUS_H, pointerEvents: 'none', color: c }}>
      <div style={{ position: 'absolute', left: SB_LEFT_CX - 60, width: 120, top: SB_CY - 11, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
        font: '600 17px/22px -apple-system, system-ui, "SF Pro Text", "Helvetica Neue", sans-serif', letterSpacing: -0.3 }}>{time}</div>
      <svg width={W} height="14" viewBox={`0 0 ${W} 14`} aria-hidden style={{ position: 'absolute', left: CSS_W - SB_RIGHT_CX_FROM_RIGHT - W / 2, top: SB_CY - 7 }}>
        <defs><mask id="sb-pct" maskUnits="userSpaceOnUse">
          <rect x="0" y="0" width={W} height="14" fill="#fff" />
          {SB_PCT && <text x={51 + 12.35} y="10.9" textAnchor="middle" fill="#000" style={{ font: '700 11px -apple-system, system-ui, "SF Pro Text", sans-serif', letterSpacing: -0.2 }}>{SB_LEVEL}</text>}
        </mask></defs>
        {/* signal: bottoms at 13.4, tops measured */}
        {[4.3, 3.3, 1.6, 0].map((t, i) => <rect key={i} x={i * 5.33} y={t + 0.4} width="3.33" height={13 - t} rx="1" fill={c} />)}
        {/* Wi-Fi 16 x 12 */}
        <g transform="translate(27 1)" fill={c}>
          <path d="M8 0C11.1 0 13.9 1.2 16 3.2L14.6 4.6C12.9 2.9 10.6 2 8 2S3.1 2.9 1.4 4.6L0 3.2C2.1 1.2 4.9 0 8 0z" />
          <path d="M8 4.1c2 0 3.8.8 5.1 2L11.7 7.5C10.7 6.6 9.4 6 8 6S5.3 6.6 4.3 7.5L2.9 6.1C4.2 4.9 6 4.1 8 4.1z" />
          <path d="M8 8.2c1 0 1.9.4 2.6 1L8 12 5.4 9.2C6.1 8.6 7 8.2 8 8.2z" /></g>
        {/* battery: body 24.7 x 13.3, cap 1 x 3.3 */}
        {SB_PCT ? <g mask="url(#sb-pct)">
          <rect x="51" y="0.35" width="24.7" height="13.3" rx="4.2" fill={c} fillOpacity="0.4" />
          <clipPath id="sb-lvl"><rect x="51" y="0" width={24.7 * lvl} height="14" /></clipPath>
          <rect x="51" y="0.35" width="24.7" height="13.3" rx="4.2" fill={c} clipPath="url(#sb-lvl)" />
        </g> : <g>
          <rect x="51.5" y="0.85" width="23.7" height="12.3" rx="3.8" fill="none" stroke={c} strokeOpacity="0.35" />
          <rect x="53" y="2.35" width={20.7 * lvl} height="9.3" rx="2.4" fill={c} /></g>}
        <path d="M77 5.35v3.3c.6-.2 1-.9 1-1.65s-.4-1.45-1-1.65z" fill={c} fillOpacity="0.4" />
      </svg>
    </div>
  )
}

/** Light or dark status bar for 'auto': reads the app's top background when it is same-origin, otherwise dark text. */
function useTone(frame: React.RefObject<HTMLIFrameElement | null>): 'dark' | 'light' {
  const [tone, setTone] = useState<'dark' | 'light'>(SB === 'light' ? 'light' : 'dark')
  useEffect(() => {
    if (SB !== 'auto') return
    const i = setInterval(() => {
      try {
        const d = frame.current?.contentDocument; if (!d?.body) return
        const el = d.elementFromPoint(CSS_W / 2, 20) ?? d.body
        let n: Element | null = el, bg = ''
        while (n) { bg = getComputedStyle(n).backgroundColor; if (bg && !bg.endsWith(', 0)') && bg !== 'transparent') break; n = n.parentElement }
        const m = bg.match(/\d+(\.\d+)?/g)?.map(Number)
        if (m) setTone(m[0] * 0.3 + m[1] * 0.59 + m[2] * 0.11 > 140 ? 'dark' : 'light')
      } catch { /* cross-origin: keep dark */ }
    }, 500)
    return () => clearInterval(i)
  }, [frame])
  return tone
}

const drag = { active: false, x: 0, y: 0, yaw: START_YAW, pitch: START_PITCH, vYaw: 0 }

function Screen({ s, interactive }: { s: IPhoneSpec; interactive: boolean }) {
  const pxPerMm = CSS_W / s.active.w
  const cssH = CSS_H
  const radius = (s.body.cornerR - s.active.inset) * pxPerMm
  void s.island // the glass cut-out is smaller; iOS draws a 126 x 37 pt island over it
  const isl = { w: ISL.w, h: ISL.h, top: ISL.top + ISL.h / 2 }
  const scale = mm(s.active.w) / (CSS_W / PX_PER_UNIT)
  const z = mm(s.body.t) / 2 + 0.0003 * 6
  // drei's Html can lose its first portal root under React 19; remount once after the canvas settles.
  const [k, setK] = useState(0)
  const frame = useRef<HTMLIFrameElement>(null)
  const tone = useTone(frame)
  useEffect(() => { const t = setTimeout(() => setK(1), 50); return () => clearTimeout(t) }, [])
  return (
    <group position={[0, 0, z]} scale={scale}>
      <Html key={k} transform occlude zIndexRange={[10, 0]} pointerEvents={interactive ? 'auto' : 'none'}>
        <div style={{ width: CSS_W, height: cssH, borderRadius: radius, overflow: 'hidden', position: 'relative', background: '#000',
          backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}>
          <iframe ref={frame} src={SRC} title="Live app" style={{ width: '100%', height: '100%', border: 0, display: 'block', pointerEvents: interactive ? 'auto' : 'none' }} />
          {/* Dynamic Island, drawn over the page */}
          <div style={{ position: 'absolute', left: (CSS_W - isl.w) / 2, top: isl.top - isl.h / 2, width: isl.w, height: isl.h,
            borderRadius: isl.h / 2, background: '#000', pointerEvents: 'none' }} />
          {SB !== 'off' && <StatusBar islandCy={isl.top} islandW={isl.w} tone={tone} />}
          {/* faint cover-glass sheen */}
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: 'linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0) 40%)' }} />
        </div>
      </Html>
    </group>
  )
}

function Rig({ onFaceOn, faceOn }: { onFaceOn: (v: boolean) => void; faceOn: boolean; stayOn: boolean }) {
  const [logo, setLogo] = useState<LogoArt | null>(null)
  useEffect(() => { let live = true; loadLocalLogo().then(l => { if (live) setLogo(l) }); return () => { live = false } }, [])
  const ref = useRef<THREE.Group>(null)
  const last = useRef(true)
  useFrame((_, dt) => {
    if (!drag.active && !HOLD && !stay.on) {
      drag.yaw += drag.vYaw * dt; drag.vYaw *= Math.exp(-6 * dt)
      // ease back to the nearest whole turn, face-on
      const target = Math.round(drag.yaw / (Math.PI * 2)) * Math.PI * 2
      const k = 1 - Math.exp(-5 * dt)
      drag.yaw += (target - drag.yaw) * k; drag.pitch += (0 - drag.pitch) * k
    }
    if (ref.current) ref.current.rotation.set(drag.pitch, drag.yaw, 0)
    const d = Math.abs(drag.yaw - Math.round(drag.yaw / (Math.PI * 2)) * Math.PI * 2) + Math.abs(drag.pitch)
    // stay mode: usable at any angle unless the screen faces away (past about 80 degrees)
    const n = new THREE.Vector3(0, 0, 1).applyEuler(new THREE.Euler(drag.pitch, drag.yaw, 0))
    const face = stay.on ? !drag.active && n.z > Math.cos(80 * Math.PI / 180) : !drag.active && d < 0.02
    if (face !== last.current) { last.current = face; onFaceOn(face) }
  })
  const opts: DeviceOptions = useMemo(() => ({ fold: 0, screen: 'inner', finish: FINISH, logo, logoSize: 0.2, logoTint: '#8a8f99', simTray: false }), [logo])
  return (
    <group ref={ref}>
      <SketchStyle on={SKETCH}><IPhonePro spec={SPEC} texture={null} mediaAspect={1} opts={opts} /></SketchStyle>
      <Screen s={SPEC} interactive={faceOn} />
    </group>
  )
}

export default function LivePhone() {
  // ?sbtest: flat 1:1 status bar with the compact island, for pixel checks against device screenshots
  if (params.has('sbtest')) return (
    <div style={{ position: 'relative', width: CSS_W, height: 60, background: params.get('sbtest') || '#333', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', left: (CSS_W - ISL.w) / 2, top: ISL.top, width: ISL.w, height: ISL.h, borderRadius: ISL.h / 2, background: '#000' }} />
      <StatusBar islandCy={ISL.top + ISL.h / 2} islandW={ISL.w} tone={SB === 'dark' ? 'dark' : 'light'} />
    </div>)
  const [faceOn, setFaceOn] = useState(!HOLD || stay.on || (START_YAW === 0 && START_PITCH === 0))
  const [stayOn, setStayOn] = useState(stay.on)
  useEffect(() => { stay.on = stayOn }, [stayOn])
  useEffect(() => {
    const up = () => { drag.active = false }
    const move = (e: PointerEvent) => {
      if (!drag.active) return
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y
      drag.x = e.clientX; drag.y = e.clientY
      drag.yaw += dx * 0.01; drag.vYaw = dx * 0.6
      drag.pitch = THREE.MathUtils.clamp(drag.pitch + dy * 0.006, -0.6, 0.6)
    }
    addEventListener('pointerup', up); addEventListener('pointermove', move)
    return () => { removeEventListener('pointerup', up); removeEventListener('pointermove', move) }
  }, [])
  return (
    <div style={{ position: 'fixed', inset: 0, background: SKETCH ? SKETCH_PAPER : 'radial-gradient(circle at 50% 40%, #f5f5f7, #d9dae0)', touchAction: 'none', userSelect: 'none' }}
      onPointerDown={e => { drag.active = true; drag.x = e.clientX; drag.y = e.clientY; drag.vYaw = 0; setFaceOn(false) }}>
      <Canvas gl={{ antialias: true, alpha: true, toneMapping: THREE.NeutralToneMapping }} camera={{ fov: 30, position: [0, 0, 4.2] }} data-face-on={faceOn ? '1' : '0'}>
        {!SKETCH && <Env intensity={1} />}
        <ambientLight intensity={0.4} />
        <directionalLight position={[2, 3, 4]} intensity={1.2} />
        <Rig onFaceOn={setFaceOn} faceOn={faceOn} stayOn={stayOn} />
      </Canvas>
      <p style={{ position: 'absolute', bottom: 16, width: '100%', textAlign: 'center', margin: 0, color: '#6e6e73', pointerEvents: 'none' }}>
        {stayOn ? 'Drag around the phone to spin it. It stays where you leave it, and the app works at any angle.' : 'Drag around the phone to spin it. Let go and it turns back so you can use the app.'}
      </p>
      <label onPointerDown={e => e.stopPropagation()} style={{ position: 'absolute', top: 16, right: 16, display: 'flex', gap: 6, alignItems: 'center',
        font: '13px -apple-system, system-ui, sans-serif', color: '#1d1d1f', background: 'rgba(255,255,255,0.8)', padding: '6px 10px', borderRadius: 8 }}>
        <input id="stay-toggle" type="checkbox" checked={stayOn} onChange={e => setStayOn(e.target.checked)} /> Stay at angle
      </label>
      <span id="face-state" data-face-on={faceOn ? '1' : '0'} hidden />
    </div>
  )
}
