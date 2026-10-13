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
import type { DeviceOptions } from '../types'

const mm = (v: number) => v / 100 // same unit as IPhonePro
const CSS_W = 402 // CSS px across the screen (iPhone points)
const PX_PER_UNIT = 40 // drei <Html transform> maps 40 CSS px to 1 world unit (distanceFactor 10)

const params = new URLSearchParams(location.search)
const SPEC: IPhoneSpec = params.get('device') === 'max' ? IPHONE_18_PRO_MAX : IPHONE_18_PRO
const SRC = params.get('src') || '/live-demo/index.html'
const FINISH = params.get('finish') || 'black'
const START_YAW = Number(params.get('yaw') ?? 0) * Math.PI / 180, START_PITCH = Number(params.get('pitch') ?? 0) * Math.PI / 180
const HOLD = params.has('hold') // keep the starting angle (for tilted screenshots)

const drag = { active: false, x: 0, y: 0, yaw: START_YAW, pitch: START_PITCH, vYaw: 0 }

function Screen({ s, interactive }: { s: IPhoneSpec; interactive: boolean }) {
  const pxPerMm = CSS_W / s.active.w
  const cssH = Math.round(s.active.h * pxPerMm)
  const radius = (s.body.cornerR - s.active.inset) * pxPerMm
  const isl = { w: s.island.w * pxPerMm, h: s.island.h * pxPerMm, top: (s.island.cy - (s.body.h - s.active.h) / 2) * pxPerMm }
  const scale = mm(s.active.w) / (CSS_W / PX_PER_UNIT)
  const z = mm(s.body.t) / 2 + 0.0003 * 6
  // drei's Html can lose its first portal root under React 19; remount once after the canvas settles.
  const [k, setK] = useState(0)
  useEffect(() => { const t = setTimeout(() => setK(1), 50); return () => clearTimeout(t) }, [])
  return (
    <group position={[0, 0, z]} scale={scale}>
      <Html key={k} transform occlude zIndexRange={[10, 0]} pointerEvents={interactive ? 'auto' : 'none'}>
        <div style={{ width: CSS_W, height: cssH, borderRadius: radius, overflow: 'hidden', position: 'relative', background: '#000',
          backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}>
          <iframe src={SRC} title="Live app" style={{ width: '100%', height: '100%', border: 0, display: 'block', pointerEvents: interactive ? 'auto' : 'none' }} />
          {/* Dynamic Island, drawn over the page */}
          <div style={{ position: 'absolute', left: (CSS_W - isl.w) / 2, top: isl.top - isl.h / 2, width: isl.w, height: isl.h,
            borderRadius: isl.h / 2, background: '#000', pointerEvents: 'none' }} />
          {/* faint cover-glass sheen */}
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: 'linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0) 40%)' }} />
        </div>
      </Html>
    </group>
  )
}

function Rig({ onFaceOn, faceOn }: { onFaceOn: (v: boolean) => void; faceOn: boolean }) {
  const ref = useRef<THREE.Group>(null)
  const last = useRef(true)
  useFrame((_, dt) => {
    if (!drag.active && !HOLD) {
      drag.yaw += drag.vYaw * dt; drag.vYaw *= Math.exp(-6 * dt)
      // ease back to the nearest whole turn, face-on
      const target = Math.round(drag.yaw / (Math.PI * 2)) * Math.PI * 2
      const k = 1 - Math.exp(-5 * dt)
      drag.yaw += (target - drag.yaw) * k; drag.pitch += (0 - drag.pitch) * k
    }
    if (ref.current) ref.current.rotation.set(drag.pitch, drag.yaw, 0)
    const d = Math.abs(drag.yaw - Math.round(drag.yaw / (Math.PI * 2)) * Math.PI * 2) + Math.abs(drag.pitch)
    const face = !drag.active && d < 0.02
    if (face !== last.current) { last.current = face; onFaceOn(face) }
  })
  const opts: DeviceOptions = useMemo(() => ({ fold: 0, screen: 'inner', finish: FINISH, logo: null, logoSize: 0.2, logoTint: '#8a8f99', simTray: false }), [])
  return (
    <group ref={ref}>
      <IPhonePro spec={SPEC} texture={null} mediaAspect={1} opts={opts} />
      <Screen s={SPEC} interactive={faceOn} />
    </group>
  )
}

export default function LivePhone() {
  const [faceOn, setFaceOn] = useState(!HOLD || (START_YAW === 0 && START_PITCH === 0))
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
    <div style={{ position: 'fixed', inset: 0, background: 'radial-gradient(circle at 50% 40%, #f5f5f7, #d9dae0)', touchAction: 'none', userSelect: 'none' }}
      onPointerDown={e => { drag.active = true; drag.x = e.clientX; drag.y = e.clientY; drag.vYaw = 0; setFaceOn(false) }}>
      <Canvas gl={{ antialias: true, alpha: true, toneMapping: THREE.NeutralToneMapping }} camera={{ fov: 30, position: [0, 0, 4.2] }} data-face-on={faceOn ? '1' : '0'}>
        <Env intensity={1} />
        <ambientLight intensity={0.4} />
        <directionalLight position={[2, 3, 4]} intensity={1.2} />
        <Rig onFaceOn={setFaceOn} faceOn={faceOn} />
      </Canvas>
      <p style={{ position: 'absolute', bottom: 16, width: '100%', textAlign: 'center', margin: 0, color: '#6e6e73', pointerEvents: 'none' }}>
        Drag around the phone to spin it. Let go and it turns back so you can use the app.
      </p>
      <span id="face-state" data-face-on={faceOn ? '1' : '0'} hidden />
    </div>
  )
}
