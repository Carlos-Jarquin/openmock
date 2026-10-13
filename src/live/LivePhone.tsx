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

// Status bar, measured from eight native iPhone 16 Pro screenshots (1206x2622 at 3x), in pt. URL params (all optional):
//   statusbar=auto|dark|light|off   text colour (UIStatusBarStyle); auto reads the app's top background
//   time=h:mm                       fixed clock (default: live clock)
//   carrier=<text>                  carrier name in place of the time (lock screen style, e.g. ROGERS)
//   focus=dnd|none                  Do Not Disturb moon after the time      location=on   location arrow after the time
//   network=wifi|lte|5g|none        Wi-Fi glyph, or LTE / 5G text, or nothing      wifi=0-3   Wi-Fi strength (default 3)
//   signal=0-4|none                 cellular bars (default 4); none hides them      sim=dual   two-row dual-SIM glyph, signal2=0-4
//   level=0-100                     battery level (default 88)      battery=pct|plain   percentage inside the battery (default pct)
//   island=compact|activity         activity: expanded island with a timer ring and trailing text (activity=<text>, default 23m;
//                                   ring=0-1 progress, default 0.9)      bubble=on   separate round minimal activity right of the island
// Layout findings: with the compact island the time is always centred at x 65 and a moon or arrow hangs 5 pt to its right
// (the time does not move). With an expanded island (activity or bubble) the time, plus any glyph, is centred in the left ear
// between x 12 and the island's left edge; the right cluster is centred between the island's (or bubble's) right edge and x 386.7, with 6 pt gaps (8, or 9.7 before LTE, in the compact layout).
// iOS also tightens the time when the island is expanded (12:23 is 40 pt wide instead of 42.6). Compact: right cluster centred at 327.3. Centre line y 32.3; island 37 pt tall at y 14.
const q = (k: string) => params.get(k)
const clampN = (v: string | null, d: number, lo: number, hi: number) => { const n = Number(v ?? d); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d }
const SB_PCT = q('battery') !== 'plain'
const SB_LEVEL = Math.round(clampN(q('level'), 88, 0, 100))
const SB_TIME = q('time'), SB_CARRIER = q('carrier')
const SB_GLYPH: 'moon' | 'arrow' | null = q('focus') === 'dnd' ? 'moon' : q('location') === 'on' ? 'arrow' : null
const SB_NET = (q('network') ?? 'wifi') as 'wifi' | 'lte' | '5g' | 'none'
const SB_WIFI = Math.round(clampN(q('wifi'), 3, 0, 3))
const SB_SIG = q('signal') === 'none' ? -1 : Math.round(clampN(q('signal'), 4, 0, 4))
const SB_DUAL = q('sim') === 'dual', SB_SIG2 = Math.round(clampN(q('signal2'), 3, 0, 4))
const SB_BUBBLE = q('bubble') === 'on'
const SB_ACTIVITY = q('island') === 'activity' || SB_BUBBLE
const SB_ACT_TEXT = q('activity') ?? '23m', SB_RING = clampN(q('ring'), 0.9, 0, 1)
const SB_CY = 32.3, DIM = 0.35, DIM2 = 0.27, ORANGE = '#ff9f0a'
const SB_FONT = '-apple-system, system-ui, "SF Pro Text", "Helvetica Neue", sans-serif'
/** Island layout in pt, Pro width (Pro Max shifts by half the extra width). */
function islandLayout() {
  const dx = (CSS_W - 402) / 2
  const main = !SB_ACTIVITY ? { l: 138, r: 264 } : SB_BUBBLE ? { l: 108.3, r: 263.7 } : SB_ACT_TEXT ? { l: 107.3, r: 304.7 } : { l: 109.7, r: 285.3 }
  return { l: main.l + dx, r: main.r + dx, top: ISL.top, h: ISL.h, bubble: SB_BUBBLE ? { l: 271.7 + dx, d: 36.7 } : null, dx }
}

/** The Dynamic Island with an optional timer-style live activity and a minimal bubble. */
function Island() {
  const L = islandLayout(), cy = L.top + L.h / 2, R = 9.2, C = 2 * Math.PI * R
  return <>
    <div style={{ position: 'absolute', left: L.l, top: L.top, width: L.r - L.l, height: L.h, borderRadius: L.h / 2, background: '#000', pointerEvents: 'none' }}>
      {SB_ACTIVITY && <svg width="22" height="22" viewBox="0 0 22 22" style={{ position: 'absolute', left: 8.05, top: 7.2 }}>
        <circle cx="11" cy="11" r={R} fill="none" stroke={ORANGE} strokeOpacity="0.3" strokeWidth="2.3" />
        <circle cx="11" cy="11" r={R} fill="none" stroke={ORANGE} strokeWidth="2.3" strokeLinecap="round" strokeDasharray={`${C * SB_RING} ${C}`} transform="rotate(-90 11 11)" />
      </svg>}
      {SB_ACTIVITY && !SB_BUBBLE && <div style={{ position: 'absolute', right: 9, top: 0, height: L.h, display: 'flex', alignItems: 'center', color: ORANGE,
        font: `500 15.5px/1 ${SB_FONT}`, letterSpacing: -0.2, fontVariantNumeric: 'tabular-nums' }}>{SB_ACT_TEXT}</div>}
    </div>
    {L.bubble && <div style={{ position: 'absolute', left: L.bubble.l, top: L.top, width: L.bubble.d, height: L.bubble.d, borderRadius: '50%', background: '#000', pointerEvents: 'none' }}>
      <svg width="13" height="14" viewBox="0 0 13 14" style={{ position: 'absolute', left: (L.bubble.d - 12.3) / 2, top: (L.bubble.d - 13.3) / 2 - 0.4 }}>
        <path d="M6.5 0.3L12.6 13.4 6.5 10.2 0.4 13.4z" fill="#3e8bff" /></svg>
    </div>}
  </>
}

const Moon = ({ c }: { c: string }) => <svg width="13.3" height="13.3" viewBox="0.4 0.4 19.2 19.2" aria-hidden style={{ marginTop: -0.8 }}><path fill={c} d="M7.6 0.6A9.6 9.6 0 1 0 19.4 12.4 8 8 0 0 1 7.6 0.6z" /></svg>
const Arrow = ({ c }: { c: string }) => <svg width="12.3" height="12.3" viewBox="0.4 0.4 11.2 11.2" aria-hidden style={{ marginTop: 0.4 }}><path fill={c} d="M11.6 0.4L0.4 5.3 5.6 6.4 6.7 11.6z" /></svg>

/** iOS status bar: time (or carrier) on the left, signal, network and battery on the right, on the island centre line. */
function StatusBar({ tone }: { islandCy?: number; islandW?: number; tone: 'dark' | 'light' }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { if (SB_TIME) return; const i = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(i) }, [])
  const time = SB_TIME ?? `${now.getHours() % 12 || 12}:${String(now.getMinutes()).padStart(2, '0')}`
  const c = tone === 'dark' ? '#000' : '#fff'
  const L = islandLayout(), lvl = SB_LEVEL / 100
  // left: compact -> time centred at 65 with the glyph hanging right; expanded -> time + glyph centred in [12, island left]
  const GW = SB_GLYPH === 'moon' ? 13.3 : SB_GLYPH === 'arrow' ? 12.3 : 0, GAP = 4.8
  const timeRef = useRef<HTMLSpanElement>(null)
  const [tw, setTw] = useState(40)
  useEffect(() => { const el = timeRef.current; if (el) setTw(el.offsetWidth) }, [time])
  const groupW = tw + (GW ? GAP + GW : 0)
  const timeL = SB_CARRIER ? 37.8 : !SB_ACTIVITY ? 65 - tw / 2 : (12 + L.l) / 2 - groupW / 2
  // right cluster pieces (x in a local svg, y relative to top = SB_CY - 8)
  const items: { w: number; gap: number; el: (x: number) => React.ReactNode }[] = []
  if (SB_SIG >= 0) items.push(SB_DUAL ? { w: 18.33, gap: 0, el: x => <g key="sig" fill={c}>
      {[4, 5, 6, 6.67].map((h, i) => <rect key={i} x={x + i * 5.33} y={9.7 - h} width="3.33" height={h} rx="0.9" fillOpacity={i < SB_SIG ? 1 : DIM2} />)}
      {[0, 1, 2, 3].map(i => <rect key={'b' + i} x={x + i * 5.33} y={11.37} width="3.33" height="3.67" rx="0.9" fillOpacity={i < SB_SIG2 ? 1 : DIM2} />)}</g> }
    : { w: 19, gap: 0, el: x => <g key="sig" fill={c}>{[4.3, 3.3, 1.6, 0].map((t, i) => <rect key={i} x={x + i * 5.33} y={t + 1.4} width="3.33" height={13 - t} rx="1" fillOpacity={i < SB_SIG ? 1 : DIM} />)}</g> })
  if (SB_NET === 'wifi') items.push({ w: 16, gap: SB_ACTIVITY ? 6 : 8, el: x => <g key="wifi" transform={`translate(${x} 2)`} fill={c}>
      <path fillOpacity={SB_WIFI >= 3 ? 1 : DIM} d="M8 0C11.1 0 13.9 1.2 16 3.2L14.6 4.6C12.9 2.9 10.6 2 8 2S3.1 2.9 1.4 4.6L0 3.2C2.1 1.2 4.9 0 8 0z" />
      <path fillOpacity={SB_WIFI >= 2 ? 1 : DIM} d="M8 4.1c2 0 3.8.8 5.1 2L11.7 7.5C10.7 6.6 9.4 6 8 6S5.3 6.6 4.3 7.5L2.9 6.1C4.2 4.9 6 4.1 8 4.1z" />
      <path fillOpacity={SB_WIFI >= 1 ? 1 : DIM} d="M8 8.2c1 0 1.9.4 2.6 1L8 12 5.4 9.2C6.1 8.6 7 8.2 8 8.2z" /></g> })
  if (SB_NET === 'lte' || SB_NET === '5g') { const t = SB_NET === 'lte' ? 'LTE' : '5G', w = SB_NET === 'lte' ? 18.7 : 13.5
    items.push({ w, gap: SB_ACTIVITY ? 6 : 9.67, el: x => <text key="net" x={x + w / 2} y={13.7} textAnchor="middle" textLength={w} lengthAdjust="spacingAndGlyphs" fill={c} style={{ font: `600 13.7px ${SB_FONT}` }}>{t}</text> }) }
  items.push({ w: 27.0, gap: SB_ACTIVITY ? 6 : 8, el: x => <g key="bat">
      <defs><mask id="sb-pct" maskUnits="userSpaceOnUse"><rect x={x} y="0" width="28" height="16" fill="#fff" />
        {SB_PCT && <text x={x + 12.35} y="11.9" textAnchor="middle" fill="#000" style={{ font: `700 11px ${SB_FONT}`, letterSpacing: -0.2 }}>{SB_LEVEL}</text>}</mask>
        <clipPath id="sb-lvl"><rect x={x} y="0" width={24.7 * lvl} height="16" /></clipPath></defs>
      {SB_PCT ? <g mask="url(#sb-pct)">
        <rect x={x} y="1.35" width="24.7" height="13.3" rx="4.2" fill={c} fillOpacity="0.4" />
        <rect x={x} y="1.35" width="24.7" height="13.3" rx="4.2" fill={c} clipPath="url(#sb-lvl)" /></g>
      : <g><rect x={x + 0.5} y="1.85" width="23.7" height="12.3" rx="3.8" fill="none" stroke={c} strokeOpacity="0.35" />
        <rect x={x + 2} y="3.35" width={20.7 * lvl} height="9.3" rx="2.4" fill={c} /></g>}
      <path d={`M${x + 26} 6.35v3.3c.6-.2 1-.9 1-1.65s-.4-1.45-1-1.65z`} fill={c} fillOpacity="0.4" /></g> })
  items[0].gap = 0
  const W = items.reduce((s, it) => s + it.gap + it.w, 0)
  const rightEdge = L.bubble ? L.bubble.l + L.bubble.d : L.r
  const rcx = SB_ACTIVITY ? (rightEdge + 386.7 + 2 * L.dx) / 2 : CSS_W - (402 - 327.3)
  let x = 0
  const els = items.map(it => { x += it.gap; const e = it.el(x); x += it.w; return e })
  return (
    <div style={{ position: 'absolute', left: 0, top: 0, width: CSS_W, height: STATUS_H, pointerEvents: 'none', color: c }}>
      <div style={{ position: 'absolute', left: timeL, top: SB_CY - 11 + (SB_CARRIER ? 0.3 : 0.8), height: 22, display: 'flex', alignItems: 'center', gap: GAP, whiteSpace: 'nowrap',
        font: SB_CARRIER ? `400 15px/22px ${SB_FONT}` : `600 17px/22px ${SB_FONT}`, letterSpacing: SB_CARRIER ? 0.2 : SB_ACTIVITY ? -0.8 : -0.3 }}>
        <span ref={timeRef}>{SB_CARRIER ?? time}</span>
        {!SB_CARRIER && SB_GLYPH === 'moon' && <Moon c={c} />}{!SB_CARRIER && SB_GLYPH === 'arrow' && <Arrow c={c} />}
      </div>
      <svg width={W} height="16" viewBox={`0 0 ${W} 16`} aria-hidden style={{ position: 'absolute', left: rcx - W / 2, top: SB_CY - 8, overflow: 'visible' }}>{els}</svg>
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
          <Island />
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
      <Island />
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
