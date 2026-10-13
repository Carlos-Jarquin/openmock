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
const TOP_SAFE = 54 // iOS status bar / top safe area on Dynamic Island iPhones, in points
const SKETCH = params.get('style') === 'sketch' // ?style=sketch: flat illustration look
const stay = { on: params.has('stay') } // stay at angle: no ease back, screen usable while tilted

/** iOS status bar: time in the left ear, signal, Wi-Fi and battery in the right, centred on the island. */
function StatusBar({ islandCy, islandW, tone }: { islandCy: number; islandW: number; tone: 'dark' | 'light' }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const i = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(i) }, [])
  const time = `${now.getHours() % 12 || 12}:${String(now.getMinutes()).padStart(2, '0')}`
  const c = tone === 'dark' ? '#000' : '#fff'
  const ear = (CSS_W - islandW) / 2
  const box = { position: 'absolute' as const, top: islandCy - 11, height: 22, width: ear, display: 'flex', alignItems: 'center', justifyContent: 'center' }
  return (
    <div style={{ position: 'absolute', left: 0, top: 0, width: CSS_W, height: TOP_SAFE, pointerEvents: 'none', color: c,
      font: '600 17px/22px -apple-system, system-ui, "SF Pro Text", "Helvetica Neue", sans-serif', letterSpacing: -0.4 }}>
      <div style={{ ...box, left: 6 }}>{time}</div>
      <div style={{ ...box, right: 6, gap: 6 }}>
        <svg width="19" height="12" viewBox="0 0 19 12" fill={c} aria-hidden>
          <rect x="0" y="8" width="3.2" height="4" rx="0.8" /><rect x="5" y="5.5" width="3.2" height="6.5" rx="0.8" />
          <rect x="10" y="3" width="3.2" height="9" rx="0.8" /><rect x="15" y="0" width="3.2" height="12" rx="0.8" /></svg>
        <svg width="17" height="12" viewBox="0 0 17 12" fill={c} aria-hidden>
          <path d="M8.5 2.3c2.4 0 4.6.9 6.3 2.5l1.2-1.2C14 1.6 11.4.6 8.5.6S3 1.6 1 3.6l1.2 1.2c1.7-1.6 3.9-2.5 6.3-2.5z" />
          <path d="M8.5 5.6c1.5 0 2.9.6 4 1.6l1.2-1.2c-1.4-1.3-3.2-2.1-5.2-2.1S4.7 4.7 3.3 6l1.2 1.2c1.1-1 2.5-1.6 4-1.6z" />
          <path d="M8.5 8.9c.7 0 1.3.3 1.8.7L8.5 11.5 6.7 9.6c.5-.4 1.1-.7 1.8-.7z" /></svg>
        <svg width="27" height="13" viewBox="0 0 27 13" aria-hidden>
          <rect x="0.5" y="0.5" width="23" height="12" rx="3.8" fill="none" stroke={c} strokeOpacity="0.35" />
          <rect x="2" y="2" width="20" height="9" rx="2.5" fill={c} />
          <path d="M25 4.5v4c.8-.3 1.3-1.1 1.3-2s-.5-1.7-1.3-2z" fill={c} fillOpacity="0.4" /></svg>
      </div>
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
  const isl = { w: s.island.w * pxPerMm, h: s.island.h * pxPerMm, top: (s.island.cy - (s.body.h - s.active.h) / 2) * pxPerMm }
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
