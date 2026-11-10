// /live: a 3D iPhone or MacBook Pro with a real, interactive web page on its screen.
// The page is an <iframe> placed with drei's <Html transform>. Drag the device to spin it; on release it
// eases back to face-on and the screen takes clicks again. An uploaded HTML file replaces the page.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js'
import IPhonePro, { IP18_FINISHES } from '../devices/IPhonePro'
import { IPHONE_18_PRO, IPHONE_18_PRO_MAX, type IPhoneSpec } from '../devices/iphoneSpecs'
import MacBookPro, { MBP, MBP_FINISHES, mbpScreenAnchor } from '../devices/MacBookPro'
import { Env } from '../Env'
import type { DeviceOptions, LogoArt } from '../types'
import { loadLocalLogo, builtinLogo } from '../localLogo'
import { type SbCfg, parseSb, writeSb } from '../statusbar/config'
import { StatusPanel } from '../statusbar/Panel'
import { Island, StatusBar, HomeBar, useClock, islandSketch } from '../statusbar/StatusBar'
import { SketchStyle, SKETCH_PAPER, SKETCH_DEFAULTS } from '../sketch/Sketch'

RectAreaLightUniformsLib.init()

const mm = (v: number) => v / 100 // same unit as the device models
const PX_PER_UNIT = 40 // drei <Html transform> maps 40 CSS px to 1 world unit (distanceFactor 10)

type Kind = 'pro' | 'max' | 'mbp'
const params = new URLSearchParams(location.search)
function kindOf(v: string | null): Kind {
  if (v === 'mbp' || v === 'macbook') return 'mbp'
  if (v === 'max') return 'max'
  return 'pro'
}
const KIND0 = kindOf(params.get('device'))
const phoneFinishes = IP18_FINISHES
const macFinishes = MBP_FINISHES
const finishesOf = (k: Kind) => (k === 'mbp' ? macFinishes : phoneFinishes)
const fallbackFinish = (k: Kind) => (k === 'mbp' ? 'spacegrey' : 'black')
const FINISH0 = params.get('finish')
const START_FINISH = FINISH0 && FINISH0 in finishesOf(KIND0) ? FINISH0 : fallbackFinish(KIND0)
const lidParam = Number(params.get('lid'))
const LID0_LIVE = lidParam >= 70 && lidParam <= 130 ? lidParam : 90
const DEMO_SRC = params.get('src') || '/live-demo/index.html'
const START_YAW = Number(params.get('yaw') ?? 0) * Math.PI / 180, START_PITCH = Number(params.get('pitch') ?? 0) * Math.PI / 180
const HOLD = params.has('hold') // keep the starting angle (for tilted screenshots)
const SKETCH = params.get('style') === 'sketch' // ?style=sketch: flat illustration look
const ISLAND_LOOK = islandSketch(SKETCH_DEFAULTS.line)
const stay = { on: params.has('stay') } // stay at angle: no ease back, screen usable while tilted
const SB_W = params.get('device') === 'max' ? 440 : 402

function phoneCss(s: IPhoneSpec) {
  const max = s === IPHONE_18_PRO_MAX
  return { w: max ? 440 : 402, h: max ? 956 : 874 }
}
const MBP_CSS_W = 1512
const MBP_CSS_H = MBP_CSS_W * MBP.disp.h / MBP.disp.w
// drei maps (400 / distanceFactor) CSS px to one world unit. Match the display with no mesh scale,
// so a spin stays a rigid page instead of a scaled matrix that spills over the body.
const MBP_DISTANCE = 400 * mm(MBP.disp.w) / MBP_CSS_W

/** Light or dark status bar for 'auto': reads the app's top background when it is same-origin, otherwise dark text. */
function useTone(frame: React.RefObject<HTMLIFrameElement | null>, mode: SbCfg['mode'], width: number, y = 20): 'dark' | 'light' {
  const [tone, setTone] = useState<'dark' | 'light'>('dark')
  useEffect(() => {
    if (mode !== 'auto') return
    const i = setInterval(() => {
      try {
        const d = frame.current?.contentDocument; if (!d?.body) return
        const el = d.elementFromPoint(width / 2, y) ?? d.body
        let n: Element | null = el, bg = ''
        while (n) { bg = getComputedStyle(n).backgroundColor; if (bg && !bg.endsWith(', 0)') && bg !== 'transparent') break; n = n.parentElement }
        const m = bg.match(/\d+(\.\d+)?/g)?.map(Number)
        if (m) setTone(m[0] * 0.3 + m[1] * 0.59 + m[2] * 0.11 > 140 ? 'dark' : 'light')
      } catch { /* cross-origin: keep dark */ }
    }, 500)
    return () => clearInterval(i)
  }, [frame, mode, width, y])
  return mode === 'light' ? 'light' : mode === 'dark' ? 'dark' : tone
}

const drag = { active: false, x: 0, y: 0, yaw: START_YAW, pitch: START_PITCH, vYaw: 0 }

/** A stable DOM node for the screen. drei otherwise retargets its portal while the canvas connects and the page never appears. */
function useLivePortal(): React.RefObject<HTMLElement> {
  const ref = useRef<HTMLElement>(null)
  if (!ref.current) {
    const el = document.createElement('div')
    el.style.cssText = 'position:fixed;inset:0;overflow:hidden;pointer-events:none;z-index:1'
    document.body.appendChild(el)
    ref.current = el
  }
  useEffect(() => () => { ref.current?.remove() }, [])
  return ref as React.RefObject<HTMLElement>
}

function easeDrag(dt: number) {
  if (drag.active || HOLD || stay.on) return
  drag.yaw += drag.vYaw * dt; drag.vYaw *= Math.exp(-6 * dt)
  // ease back to the nearest whole turn, face-on
  const target = Math.round(drag.yaw / (Math.PI * 2)) * Math.PI * 2
  const k = 1 - Math.exp(-5 * dt)
  drag.yaw += (target - drag.yaw) * k; drag.pitch += (0 - drag.pitch) * k
}

function settled() {
  return Math.abs(drag.yaw - Math.round(drag.yaw / (Math.PI * 2)) * Math.PI * 2) + Math.abs(drag.pitch)
}

const _p = new THREE.Vector3(), _n = new THREE.Vector3(), _q = new THREE.Quaternion(), _dir = new THREE.Vector3()
const _ray = new THREE.Raycaster()

/** The page is a DOM layer, so it would paint over the chassis and through the back.
 *  Show it only when this group's +Z faces the camera and nothing (the frame, the back glass) sits in front.
 *  A private raycaster: useThree's is shared with the canvas and would be aimed elsewhere. */
function glassClear(group: THREE.Object3D, camera: THREE.Camera, scene: THREE.Object3D) {
  group.updateWorldMatrix(true, false)
  group.getWorldPosition(_p)
  _n.set(0, 0, 1).applyQuaternion(group.getWorldQuaternion(_q))
  _dir.copy(camera.position).sub(_p)
  const dist = _dir.length()
  if (!(dist > 0.001 && _n.dot(_dir) / dist > 0.12)) return false
  _ray.set(camera.position, _dir.multiplyScalar(1 / dist))
  return !_ray.intersectObject(scene, true).some(h => h.distance < dist - 0.03)
}

function PhoneScreen({ s, src, interactive, sb, portal }: { s: IPhoneSpec; src: string; interactive: boolean; sb: SbCfg; portal: React.RefObject<HTMLElement> }) {
  const css = phoneCss(s)
  const pxPerMm = css.w / s.active.w
  const radius = (s.body.cornerR - s.active.inset) * pxPerMm
  const scale = mm(s.active.w) / (css.w / PX_PER_UNIT)
  // Front face is +Z. The group is scaled to the active area and sits a hair in front of the glass.
  const z = mm(s.body.t) / 2 + 0.0003 * 6
  const group = useRef<THREE.Group>(null)
  const shell = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLIFrameElement>(null)
  const { camera, scene } = useThree()
  const tone = useTone(frame, sb.mode, css.w)
  const homeTone = useTone(frame, sb.mode, css.w, css.h - 10)
  const clock = useClock(sb.time)
  useFrame(() => {
    const g = group.current, el = shell.current
    if (!g || !el) return
    // visibility keeps the iframe loaded. display:none (drei occlude) would tear it down.
    el.style.visibility = glassClear(g, camera, scene) ? 'visible' : 'hidden'
  })
  return (
    <group ref={group} position={[0, 0, z]} scale={scale}>
      <Html transform portal={portal} zIndexRange={[10, 0]} pointerEvents={interactive ? 'auto' : 'none'}>
        <div ref={shell} style={{ width: css.w + 16, height: css.h + 16, padding: 8, boxSizing: 'border-box', background: '#000', borderRadius: radius + 8,
          position: 'relative', backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}>
          <div style={{ position: 'relative', width: css.w, height: css.h, borderRadius: radius, overflow: 'hidden', background: '#000' }}>
          <iframe ref={frame} src={src} title="Live app" style={{ width: '100%', height: '100%', border: 0, display: 'block', background: '#000', pointerEvents: interactive ? 'auto' : 'none' }} />
          <Island sb={sb} w={css.w} look={SKETCH ? ISLAND_LOOK : undefined} />
          {sb.mode !== 'off' && <StatusBar tone={tone} sb={sb} w={css.w} time={clock} />}
          {sb.homeBar && <HomeBar tone={homeTone} w={css.w} h={css.h} />}
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: 'linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0) 40%)' }} />
          </div>
        </div>
      </Html>
    </group>
  )
}

function PhoneRig({ spec, finish, src, faceOn, onFaceOn, sb, logo, portal }: { spec: IPhoneSpec; finish: string; src: string; faceOn: boolean; onFaceOn: (v: boolean) => void; sb: SbCfg; logo: LogoArt | null; portal: React.RefObject<HTMLElement> }) {
  const ref = useRef<THREE.Group>(null)
  const last = useRef(true)
  useFrame((_, dt) => {
    easeDrag(dt)
    if (ref.current) ref.current.rotation.set(drag.pitch, drag.yaw, 0)
    const n = new THREE.Vector3(0, 0, 1).applyEuler(new THREE.Euler(drag.pitch, drag.yaw, 0))
    const face = stay.on ? !drag.active && n.z > Math.cos(80 * Math.PI / 180) : !drag.active && settled() < 0.02
    if (face !== last.current) { last.current = face; onFaceOn(face) }
  })
  const opts: DeviceOptions = useMemo(() => ({ fold: 0, screen: 'inner', finish, logo, logoSize: 0.2, logoTint: '#8a8f99', simTray: false, hideIsland: true }), [logo, finish])
  return (
    <group ref={ref}>
      <SketchStyle on={SKETCH}><IPhonePro spec={spec} texture={null} mediaAspect={1} opts={opts} /></SketchStyle>
      <PhoneScreen s={spec} src={src} interactive={faceOn} sb={sb} portal={portal} />
    </group>
  )
}

function MacScreen({ src, interactive, portal }: { src: string; interactive: boolean; portal: React.RefObject<HTMLElement> }) {
  const pxPerMm = MBP_CSS_W / MBP.disp.w
  const radius = MBP.disp.r * pxPerMm
  const notchW = MBP.notch.w * pxPerMm, notchH = MBP.notch.h * pxPerMm
  const group = useRef<THREE.Group>(null)
  const shell = useRef<HTMLDivElement>(null)
  const { camera, scene } = useThree()
  // Same rule as the phone: the page stays loaded, and hides when the lid's back or the base is in front.
  useFrame(() => {
    const g = group.current, el = shell.current
    if (!g || !el) return
    el.style.visibility = glassClear(g, camera, scene) ? 'visible' : 'hidden'
  })
  return (
    <group ref={group}>
      <mesh position={[0, -mm(1.2), -0.002]}><planeGeometry args={[mm(MBP.disp.w) + mm(6), mm(MBP.disp.h) + mm(4)]} /><meshBasicMaterial color="#000" /></mesh>
      <Html transform portal={portal} distanceFactor={MBP_DISTANCE} zIndexRange={[10, 0]} pointerEvents={interactive ? 'auto' : 'none'}>
        <div ref={shell} style={{ width: MBP_CSS_W + 20, height: MBP_CSS_H + 14, padding: '10px 10px 4px', boxSizing: 'border-box', background: '#000',
          borderRadius: `${radius + 10}px ${radius + 10}px 0 0`, position: 'relative', backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}>
          <div style={{ position: 'relative', width: MBP_CSS_W, height: MBP_CSS_H, borderRadius: `${radius}px ${radius}px 0 0`, overflow: 'hidden', background: '#000' }}>
          <iframe src={src} title="Live app" style={{ width: '100%', height: '100%', border: 0, display: 'block', background: '#000', pointerEvents: interactive ? 'auto' : 'none' }} />
          {/* camera housing, so the page does not draw through the notch */}
          <div style={{ position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)', width: notchW, height: notchH, background: '#050506',
            borderBottomLeftRadius: notchH / 2, borderBottomRightRadius: notchH / 2, pointerEvents: 'auto' }} />
          </div>
        </div>
      </Html>
    </group>
  )
}

function MacRig({ finish, src, lid, faceOn, onFaceOn, logo, portal }: { finish: string; src: string; lid: number; faceOn: boolean; onFaceOn: (v: boolean) => void; logo: LogoArt | null; portal: React.RefObject<HTMLElement> }) {
  const ref = useRef<THREE.Group>(null)
  const last = useRef(true)
  const anchor = mbpScreenAnchor(lid)
  useFrame((_, dt) => {
    easeDrag(dt)
    if (ref.current) ref.current.rotation.set(drag.pitch, drag.yaw, 0)
    // The display's normal in the lid, then the spin. The lid's own tilt still faces the camera.
    const a = (90 - lid) * Math.PI / 180
    const n = new THREE.Vector3(0, -Math.sin(a), Math.cos(a))
    if (ref.current) n.applyQuaternion(ref.current.quaternion)
    const facing = n.z > Math.cos(80 * Math.PI / 180)
    const face = !drag.active && facing && (stay.on || settled() < 0.02)
    if (face !== last.current) { last.current = face; onFaceOn(face) }
  })
  const opts: DeviceOptions = useMemo(() => ({ fold: 0, screen: 'inner', finish, lid, logo, logoSize: 0.16, logoTint: '#8a8f99', simTray: false }), [finish, lid, logo])
  return (
    <group ref={ref} position={[-anchor[0], -anchor[1], -anchor[2]]}>
      <SketchStyle on={SKETCH}>
        <MacBookPro texture={null} mediaAspect={1} opts={opts} liveScreen={<MacScreen src={src} interactive={faceOn} portal={portal} />} />
      </SketchStyle>
    </group>
  )
}

/** Keeps the camera square to the screen: the phone from the front, the MacBook along the lid's normal. */
function Cam({ mbp, lid }: { mbp: boolean; lid: number }) {
  const camera = useThree(s => s.camera) as THREE.PerspectiveCamera
  useEffect(() => {
    if (!mbp) camera.position.set(0, 0, 4.2)
    else {
      const a = (90 - lid) * Math.PI / 180
      const n = new THREE.Vector3(0, -Math.sin(a), Math.cos(a))
      camera.position.copy(n.multiplyScalar(9.2))
    }
    camera.lookAt(0, 0, 0)
    camera.updateProjectionMatrix()
  }, [camera, mbp, lid])
  return null
}

const SB0 = parseSb(params)
function SbTest() { const t = useClock(SB0.time); return <StatusBar tone={SB0.mode === 'dark' ? 'dark' : 'light'} sb={SB0} w={SB_W} time={t} /> }

const chip: React.CSSProperties = { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap',
  background: 'rgba(255,255,255,0.8)', padding: '6px 10px', borderRadius: 8, backdropFilter: 'blur(8px)' }
const textBtn: React.CSSProperties = { font: 'inherit', fontSize: 12, border: '1px solid #c7c7cc', borderRadius: 5, background: '#fff', color: '#1d1d1f', cursor: 'pointer', padding: '2px 8px' }

export default function LivePhone() {
  // ?sbtest: flat 1:1 status bar with the compact island, for pixel checks against device screenshots
  if (params.has('sbtest')) return (
    <div style={{ position: 'relative', width: SB_W, height: 60, background: params.get('sbtest') || '#333', overflow: 'hidden' }}>
      <Island sb={SB0} w={SB_W} />
      <SbTest />
    </div>)
  const [device, setDevice] = useState<Kind>(KIND0)
  const [finish, setFinish] = useState(START_FINISH)
  const [lid, setLid] = useState(LID0_LIVE)
  const [page, setPage] = useState<{ url: string; name: string } | null>(null)
  const [faceOn, setFaceOn] = useState(!HOLD || stay.on || (START_YAW === 0 && START_PITCH === 0))
  const [stayOn, setStayOn] = useState(stay.on)
  const [sb, setSb] = useState<SbCfg>(SB0)
  const [logo, setLogo] = useState<LogoArt | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const portal = useLivePortal()
  const firstKind = useRef(true)
  const src = page?.url ?? DEMO_SRC
  const spec = device === 'max' ? IPHONE_18_PRO_MAX : IPHONE_18_PRO
  const mbp = device === 'mbp'
  useEffect(() => { let live = true; (async () => { const l = (await loadLocalLogo()) ?? (await builtinLogo()); if (live) setLogo(l) })(); return () => { live = false } }, [])
  useEffect(() => { writeSb(sb) }, [sb])
  useEffect(() => { stay.on = stayOn }, [stayOn])
  useEffect(() => {
    if (firstKind.current) { firstKind.current = false; return }
    drag.yaw = 0; drag.pitch = 0; drag.vYaw = 0
  }, [device])
  useEffect(() => () => { if (page?.url.startsWith('blob:')) URL.revokeObjectURL(page.url) }, [page])
  useEffect(() => {
    const u = new URL(location.href)
    if (device === 'pro') u.searchParams.delete('device'); else u.searchParams.set('device', device)
    if (finish === fallbackFinish(device)) u.searchParams.delete('finish'); else u.searchParams.set('finish', finish)
    if (mbp) u.searchParams.set('lid', String(Math.round(lid))); else u.searchParams.delete('lid')
    const next = u.pathname + u.search + u.hash
    if (next !== location.pathname + location.search + location.hash) history.replaceState(null, '', next)
  }, [device, finish, lid, mbp])
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
  function frontPose() {
    setLid(90)
    drag.yaw = 0; drag.pitch = 0; drag.vYaw = 0
  }
  function pickDevice(k: Kind) {
    setDevice(k)
    setFinish(f => (f in finishesOf(k) ? f : fallbackFinish(k)))
  }
  function loadFile(f: File) {
    if (!/\.html?$/i.test(f.name) && f.type !== 'text/html') return
    f.text().then(text => {
      const url = URL.createObjectURL(new Blob([text], { type: 'text/html' }))
      setPage({ url, name: f.name })
    }).catch(() => {})
  }
  const finishes = finishesOf(device)
  const swatch = (key: string) => (mbp ? macFinishes[key]?.body : phoneFinishes[key]?.frame) ?? '#888'
  return (
    <div data-live={device} style={{ position: 'fixed', inset: 0, background: SKETCH ? SKETCH_PAPER : 'radial-gradient(circle at 50% 40%, #f5f5f7, #d9dae0)', touchAction: 'none', userSelect: 'none' }}
      onPointerDown={e => { drag.active = true; drag.x = e.clientX; drag.y = e.clientY; drag.vYaw = 0; setFaceOn(false) }}>
      <Canvas gl={{ antialias: true, alpha: true, toneMapping: THREE.NeutralToneMapping }} camera={{ fov: 30, position: [0, 0, mbp ? 9.2 : 4.2] }} data-face-on={faceOn ? '1' : '0'}>
        {!SKETCH && <Env intensity={mbp ? 0.55 : 1} mode="soft" />}
        {mbp ? (
          <>
            {/* Same idea as the studio softboxes: a wide key over the deck, strips on the edges. */}
            <ambientLight intensity={0.36} />
            <directionalLight position={[1.5, 4.5, 5]} intensity={0.55} color="#ffffff" />
            <rectAreaLight args={['#ffffff', 6, 5, 2.6]} position={[0, 3.4, 1.6]} onUpdate={l => l.lookAt(0, -0.8, 0.4)} />
            <rectAreaLight args={['#f7f8fa', 3, 0.45, 3.4]} position={[3.4, 0.4, 0.8]} onUpdate={l => l.lookAt(0, -0.5, 0)} />
            <rectAreaLight args={['#f7f8fa', 3, 0.45, 3.4]} position={[-3.4, 0.4, 0.8]} onUpdate={l => l.lookAt(0, -0.5, 0)} />
          </>
        ) : (
          <>
            <ambientLight intensity={0.4} />
            <directionalLight position={[2, 3, 4]} intensity={1.2} />
          </>
        )}
        <Cam mbp={mbp} lid={lid} />
        {mbp
          ? <MacRig finish={finish} src={src} lid={lid} faceOn={faceOn} onFaceOn={setFaceOn} logo={logo} portal={portal} />
          : <PhoneRig spec={spec} finish={finish} src={src} faceOn={faceOn} onFaceOn={setFaceOn} sb={sb} logo={logo} portal={portal} />}
      </Canvas>
      <div id="live-controls" onPointerDown={e => e.stopPropagation()} onWheel={e => e.stopPropagation()}
        onDragOver={e => { e.preventDefault(); e.stopPropagation() }}
        onDrop={e => { e.preventDefault(); e.stopPropagation(); const f = e.dataTransfer.files[0]; if (f) loadFile(f) }}
        style={{ position: 'absolute', top: 16, left: 16, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start', maxWidth: 280,
          font: '13px -apple-system, system-ui, sans-serif', color: '#1d1d1f', zIndex: 5 }}>
        <div style={chip} role="group" aria-label="Device">
          {([['pro', 'iPhone'], ['max', 'Pro Max'], ['mbp', 'MacBook']] as [Kind, string][]).map(([k, label]) => (
            <button key={k} data-device={k} aria-pressed={device === k} onClick={() => pickDevice(k)} style={{ ...textBtn, fontWeight: 600, border: 0,
              background: device === k ? '#fff' : 'transparent', boxShadow: device === k ? '0 1px 2px rgba(0,0,0,0.15)' : 'none' }}>{label}</button>
          ))}
        </div>
        <div style={chip} role="group" aria-label="Finish">
          {Object.entries(finishes).map(([key, f]) => (
            <button key={key} data-finish={key} title={f.label} aria-label={f.label} aria-pressed={finish === key} onClick={() => setFinish(key)}
              style={{ width: 22, height: 22, borderRadius: 11, padding: 0, cursor: 'pointer', background: swatch(key),
                border: finish === key ? '2px solid #1d1d1f' : '2px solid #fff', boxShadow: '0 0 0 1px rgba(0,0,0,0.28)' }} />
          ))}
          <span style={{ fontSize: 12 }}>{finishes[finish]?.label}</span>
        </div>
        <div style={{ ...chip, flexDirection: 'column', alignItems: 'flex-start' }}>
          <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button id="live-upload" style={textBtn} onClick={() => fileRef.current?.click()}>Upload HTML</button>
            {page && <button id="live-clear" style={textBtn} onClick={() => { setPage(null); if (fileRef.current) fileRef.current.value = '' }}>Clear</button>}
            <span id="live-page" style={{ fontSize: 12, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{page ? page.name : 'Demo page'}</span>
          </span>
          <input id="live-html" ref={fileRef} type="file" accept=".html,.htm,text/html" hidden
            onChange={e => { const f = e.target.files?.[0]; if (f) loadFile(f); e.currentTarget.value = '' }} />
          <span style={{ fontSize: 11, color: '#6e6e73', maxWidth: 240 }}>A self-contained file. Images and scripts beside it will not load.</span>
          {mbp && (
            <span style={{ display: 'flex', gap: 8, alignItems: 'center', width: '100%' }}>
              <button id="live-front" style={textBtn} onClick={frontPose}>Front</button>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', flex: 1 }}>
                Lid
                <input id="live-lid" type="range" min={70} max={130} step={1} value={lid} onChange={e => setLid(Number(e.target.value))} style={{ flex: 1 }} />
                <span style={{ width: 28, textAlign: 'right' }}>{Math.round(lid)}°</span>
              </label>
            </span>
          )}
        </div>
      </div>
      <p style={{ position: 'absolute', bottom: 16, width: '100%', textAlign: 'center', margin: 0, color: '#6e6e73', pointerEvents: 'none' }}>
        {mbp
          ? (stayOn ? 'Drag around the MacBook to spin it. It stays where you leave it. The page stays on the glass, and you can use it when the screen faces you.' : 'Drag around the MacBook to spin it. Let go and it turns back so you can use the page.')
          : (stayOn ? 'Drag around the phone to spin it. It stays where you leave it. The page stays on the glass, and you can use it when the screen faces you.' : 'Drag around the phone to spin it. Let go and it turns back so you can use the app.')}
      </p>
      <label onPointerDown={e => e.stopPropagation()} style={{ position: 'absolute', top: 16, right: 16, display: 'flex', gap: 6, alignItems: 'center', zIndex: 5,
        font: '13px -apple-system, system-ui, sans-serif', color: '#1d1d1f', background: 'rgba(255,255,255,0.8)', padding: '6px 10px', borderRadius: 8 }}>
        <input id="stay-toggle" type="checkbox" checked={stayOn} onChange={e => setStayOn(e.target.checked)} /> Stay at angle
      </label>
      {!mbp && <StatusPanel sb={sb} onChange={setSb} />}
      <span id="face-state" data-face-on={faceOn ? '1' : '0'} hidden />
    </div>
  )
}
