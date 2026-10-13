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
import { type SbCfg, parseSb, writeSb } from '../statusbar/config'
import { StatusPanel } from '../statusbar/Panel'
import { Island, StatusBar, useClock, ISL, islandSketch } from '../statusbar/StatusBar'
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
const START_YAW = Number(params.get('yaw') ?? 0) * Math.PI / 180, START_PITCH = Number(params.get('pitch') ?? 0) * Math.PI / 180
const HOLD = params.has('hold') // keep the starting angle (for tilted screenshots)
// iOS 18+ on 402x874 and 440x956 (16 Pro class onward): status bar 54 pt, top safe area 62 pt.
// The software Dynamic Island is drawn larger than the glass cut-out: 126 x 37 pt, 14 pt from the top (Apple UI Kit / simulator).
const TOP_SAFE = 62
const SKETCH = params.get('style') === 'sketch' // ?style=sketch: flat illustration look
const ISLAND_LOOK = islandSketch(SKETCH_DEFAULTS.line)
const stay = { on: params.has('stay') } // stay at angle: no ease back, screen usable while tilted

/** Light or dark status bar for 'auto': reads the app's top background when it is same-origin, otherwise dark text. */
function useTone(frame: React.RefObject<HTMLIFrameElement | null>, mode: SbCfg['mode']): 'dark' | 'light' {
  const [tone, setTone] = useState<'dark' | 'light'>('dark')
  useEffect(() => {
    if (mode !== 'auto') return
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
  }, [frame, mode])
  return mode === 'light' ? 'light' : mode === 'dark' ? 'dark' : tone
}

const drag = { active: false, x: 0, y: 0, yaw: START_YAW, pitch: START_PITCH, vYaw: 0 }

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
          {/* faint cover-glass sheen */}
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: 'linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0) 40%)' }} />
        </div>
      </Html>
    </group>
  )
}

function Rig({ onFaceOn, faceOn, sb }: { onFaceOn: (v: boolean) => void; faceOn: boolean; stayOn: boolean; sb: SbCfg }) {
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

export default function LivePhone() {
  // ?sbtest: flat 1:1 status bar with the compact island, for pixel checks against device screenshots
  if (params.has('sbtest')) return (
    <div style={{ position: 'relative', width: CSS_W, height: 60, background: params.get('sbtest') || '#333', overflow: 'hidden' }}>
      <Island sb={SB0} w={CSS_W} />
      <SbTest />
    </div>)
  const [faceOn, setFaceOn] = useState(!HOLD || stay.on || (START_YAW === 0 && START_PITCH === 0))
  const [stayOn, setStayOn] = useState(stay.on)
  const [sb, setSb] = useState<SbCfg>(SB0)
  useEffect(() => { writeSb(sb) }, [sb])
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
        <Rig onFaceOn={setFaceOn} faceOn={faceOn} stayOn={stayOn} sb={sb} />
      </Canvas>
      <p style={{ position: 'absolute', bottom: 16, width: '100%', textAlign: 'center', margin: 0, color: '#6e6e73', pointerEvents: 'none' }}>
        {stayOn ? 'Drag around the phone to spin it. It stays where you leave it, and the app works at any angle.' : 'Drag around the phone to spin it. Let go and it turns back so you can use the app.'}
      </p>
      <label onPointerDown={e => e.stopPropagation()} style={{ position: 'absolute', top: 16, right: 16, display: 'flex', gap: 6, alignItems: 'center',
        font: '13px -apple-system, system-ui, sans-serif', color: '#1d1d1f', background: 'rgba(255,255,255,0.8)', padding: '6px 10px', borderRadius: 8 }}>
        <input id="stay-toggle" type="checkbox" checked={stayOn} onChange={e => setStayOn(e.target.checked)} /> Stay at angle
      </label>
      <StatusPanel sb={sb} onChange={setSb} />
      <span id="face-state" data-face-on={faceOn ? '1' : '0'} hidden />
    </div>
  )
}
