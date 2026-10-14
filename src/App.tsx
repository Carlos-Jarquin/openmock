import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { ContactShadows } from '@react-three/drei'
import { EffectComposer, DepthOfField, Bloom, Noise, N8AO } from '@react-three/postprocessing'
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js'
RectAreaLightUniformsLib.init()
import * as THREE from 'three'
import { DEVICES } from './devices'
import type { DeviceId, DeviceOptions } from './types'
import { INNER_PX, OUTER_PX, foldLive, FOLD_MS } from './devices/Duo'
import { sceneHit } from './devices/shared'
import { ErrorBoundary } from './ErrorBoundary'
import { loadLogo, loadLocalLogo } from './localLogo'
import { Env, retryEnvironment } from './Env'
import { renderPasses, runComfy, composite, downloadPasses, comfyReachable, type Guide } from './hands/aiHands'
import { IDLE_LEVELS } from './hands/motion'
import { HandRig, HAND_POSES, SKIN_TONES, type HandFit, type HandPose } from './hands/Hands'
import { SPECTRAL_DEFAULTS } from './hands/spectral'
import { GestureControls, HAND_ROT0, isGesture, rescale, screenOf } from './hands/gestures'
import { IPHONE_18_PRO, IPHONE_18_PRO_MAX } from './devices/iphoneSpecs'
import { SketchStyle, SKETCH_DEFAULTS, SKETCH_PAPER, SKETCH_SHADOW } from './sketch/Sketch'
import { SB_DEFAULT } from './statusbar/config'
import { StatusBarControls } from './statusbar/Panel'
import { useStatusComposite } from './statusbar/composite'
import { islandSketch } from './statusbar/StatusBar'
import { Timeline, TimelineDriver, type TlApi, type TlInfo } from './timeline/Timeline'
import { Chrome, type ChromeApi, type Cmd, type Section } from './ui/Chrome'
import { Icon } from './ui/icons'
import { mixers, screenLive } from './timeline/screenTrack'
import { useScene, POSE, type Media, type Pose, type BgMode } from './scene/store'
import { GES_KEYS, quatPose, tlLive, type Frame, type KfState } from './timeline/tlCore'

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
const wrap = (v: number) => ((v + 540) % 360) - 180
/** Apple hero: back three-quarter view fitted to Apple's iPhone 18 Pro colour shots. */
/** One-click camera presets (beside Reset camera). Zoom and pan stay at the framed defaults; Flat lay uses a long lens. */
const VIEW_PRESETS: [string, Pose][] = [
  ['Front', { tiltX: 0, tiltY: 0, rotZ: 0, zoom: 1, panX: 0, panY: 0, fov: 30 }],
  ['45° left', { tiltX: -6, tiltY: -45, rotZ: 0, zoom: 1, panX: 0, panY: 0, fov: 30 }],
  ['45° right', { tiltX: -6, tiltY: 45, rotZ: 0, zoom: 1, panX: 0, panY: 0, fov: 30 }],
  ['Side', { tiltX: 0, tiltY: 90, rotZ: 0, zoom: 1, panX: 0, panY: 0, fov: 30 }],
  ['Back', { tiltX: 0, tiltY: 180, rotZ: 0, zoom: 1, panX: 0, panY: 0, fov: 30 }],
  ['Flat lay', { tiltX: 0, tiltY: 0, rotZ: 0, zoom: 1, panX: 0, panY: 0, fov: 12 }],
  ['Hero 3/4', { tiltX: -14, tiltY: -32, rotZ: -9, zoom: 1.08, panX: 0, panY: 0, fov: 24 }],
]
const APPLE_HERO = { tiltX: -18.438, tiltY: 230.375, rotZ: -3.125, zoom: 1.937, panX: 0.347, panY: -0.307, fov: 21.375 }
// Device bodies the hands can grip, in model units (1 = 100 mm).
const fitOf = (s: typeof IPHONE_18_PRO): HandFit => ({ W: s.body.w / 100, H: s.body.h / 100, T: s.body.t / 100, R: s.body.cornerR / 100, E: s.body.edge / 100,
  SW: s.active.w / 100, SH: s.active.h / 100, PW: Math.round(s.px.w / 3), PH: Math.round(s.px.h / 3) })
const HAND_FITS: Partial<Record<DeviceId, HandFit>> = { ip18: fitOf(IPHONE_18_PRO), ip18max: fitOf(IPHONE_18_PRO_MAX) }
/** Violet silhouette scene: a hand held up from the lower right against a violet backdrop with light streaks. */
const VIOLET_CAMERA = { tiltX: 4, tiltY: -16, rotZ: -11, zoom: 1.1, panX: -0.11, panY: 0.1, fov: 26 }
const VIOLET_BG = { c1: '#7c68ea', c2: '#a996ff', angle: 110 }

/** Paints the backdrop. Streaks: the gradient plus soft diagonal light beams, the same every time. */
function paintBg(ctx: CanvasRenderingContext2D, w: number, h: number, mode: BgMode, c1: string, c2: string, angle: number) {
  if (mode === 'solid') ctx.fillStyle = c1
  else {
    const a = (angle - 90) * Math.PI / 180, cx = w / 2, cy = h / 2
    const len = Math.abs(w * Math.cos(a)) / 2 + Math.abs(h * Math.sin(a)) / 2
    const g = ctx.createLinearGradient(cx - Math.cos(a) * len, cy - Math.sin(a) * len, cx + Math.cos(a) * len, cy + Math.sin(a) * len)
    g.addColorStop(0, c1); g.addColorStop(1, c2); ctx.fillStyle = g
  }
  ctx.fillRect(0, 0, w, h)
  if (mode !== 'streaks') return
  // Beams lean like the reference: from lower left up to the right, fanning slightly.
  let seed = 7
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  const S = Math.max(w, h)
  ctx.save(); ctx.globalCompositeOperation = 'screen'
  for (let i = 0; i < 34; i++) {
    const x = (rnd() * 1.6 - 0.3) * w, bw = S * (0.004 + rnd() * rnd() * (i % 5 === 0 ? 0.22 : 0.09)), lean = 0.35 + rnd() * 0.35
    const k = Math.min(0.9, 0.18 + rnd() * rnd() * 0.9)
    ctx.filter = `blur(${Math.round(S * (0.001 + rnd() * 0.006))}px)`
    ctx.globalAlpha = k
    const g = ctx.createLinearGradient(0, h, 0, 0)
    g.addColorStop(0, 'rgba(255,240,255,0.25)'); g.addColorStop(0.5 + rnd() * 0.4, 'rgba(255,245,255,1)'); g.addColorStop(1, 'rgba(255,240,255,0.4)')
    ctx.fillStyle = g
    ctx.beginPath(); ctx.moveTo(x, h); ctx.lineTo(x + bw, h); ctx.lineTo(x + bw + h * lean, 0); ctx.lineTo(x + h * lean, 0); ctx.closePath(); ctx.fill()
  }
  ctx.restore()
  // Soft vignette toward the corners, darker at the edges as in studio streak backdrops.
  const v = ctx.createRadialGradient(w * 0.55, h * 0.45, S * 0.1, w * 0.55, h * 0.45, S * 0.75)
  v.addColorStop(0, 'rgba(255,255,255,0)'); v.addColorStop(1, 'rgba(40,20,90,0.28)')
  ctx.fillStyle = v; ctx.fillRect(0, 0, w, h)
}


type Grab = { gl: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.Camera; setDpr: (n: number) => void; dpr: number }
function GLGrab({ onReady }: { onReady: (s: Grab) => void }) {
  const { gl, scene, camera, setDpr, viewport } = useThree()
  useEffect(() => onReady({ gl, scene, camera, setDpr, dpr: viewport.dpr }), [gl, scene, camera, setDpr, viewport.dpr, onReady])
  // Dev only: lets the leak test read renderer.info.
  useEffect(() => { if (import.meta.env.DEV) (window as unknown as { __om: unknown }).__om = { gl, scene } }, [gl, scene])
  return null
}


/** Paints the background into the scene so post effects (which drop canvas transparency) keep it. */
function SceneBg({ mode, c1, c2, angle }: { mode: BgMode; c1: string; c2: string; angle: number }) {
  const { scene, size } = useThree()
  useEffect(() => {
    const w = mode === 'streaks' ? 1600 : 512, h = Math.max(1, Math.round(w * size.height / size.width))
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h
    const ctx = cv.getContext('2d')!
    paintBg(ctx, w, h, mode, c1, c2, angle)
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace
    scene.background = t
    return () => { scene.background = null; t.dispose() }
  }, [scene, size.width, size.height, mode, c1, c2, angle])
  return null
}

/** Keeps its children centred on their own bounding-box centre (measured unrotated), so the view orbits the device. */
function Centred({ deps, children, off = false }: { deps: unknown[]; children: React.ReactNode; off?: boolean }) {
  const inner = useRef<THREE.Group>(null)
  const dirty = useRef(true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { dirty.current = true }, deps)
  useFrame(() => {
    const g = inner.current; if (!g || !dirty.current) return
    // the Duo positions itself about its hinge (see Duo.tsx), so a bbox re-centre would shift it with the fold
    if (off) { g.position.set(0, 0, 0); dirty.current = false; return }
    const parent = g.parent!
    const saved = parent.matrixWorld.clone()
    parent.matrixWorld.identity()
    g.position.set(0, 0, 0); g.updateMatrixWorld(true)
    for (const c of g.children) c.updateMatrixWorld(true)
    // Leave out anything marked noBounds (the hands), so the view still orbits the device itself.
    const skip: [THREE.Object3D, THREE.Object3D][] = []
    g.traverse(o => { if (o.userData.noBounds && o.parent) skip.push([o, o.parent]) })
    for (const [o] of skip) o.removeFromParent()
    const box = new THREE.Box3().setFromObject(g, true)
    for (const [o, p] of skip) p.add(o)
    parent.matrixWorld.copy(saved)
    if (!box.isEmpty()) { const c = box.getCenter(new THREE.Vector3()); g.position.set(-c.x, -c.y, -c.z) }
    dirty.current = false
  })
  return <group ref={inner}>{children}</group>
}

/** Zoom sets the size on screen; field of view only changes perspective, so the camera backs off as the view narrows. */
function Rig({ zoom, fov }: { zoom: number; fov: number }) {
  const { camera } = useThree()
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera
    cam.fov = fov; cam.updateProjectionMatrix()
    const d = 4.2 / zoom * Math.tan(THREE.MathUtils.degToRad(15)) / Math.tan(THREE.MathUtils.degToRad(fov / 2))
    camera.position.set(0, 0, d); camera.lookAt(0, 0, 0)
  }, [zoom, fov, camera])
  return null
}

export default function App() {
  // Scene store: the selected device's fields and the global settings, each with a stable useState-style setter
  const S = useScene(), D0 = S.selected, G = S.scene.global
  const device = D0.model, setDevice = S.dev.model
  const opts = D0.opts, setOpts = S.dev.opts
  const media = D0.media, setMedia = S.dev.media
  // iPhone Duo: the outer screen has its own media; paste and drop go to the target screen (follows the shown screen)
  const mediaOuter = D0.mediaOuter, setMediaOuter = S.dev.mediaOuter
  const mediaTo = D0.mediaTo, setMediaTo = S.dev.mediaTo
  const sbOn = D0.sbOn, setSbOn = S.dev.sbOn
  const sb = D0.sb, setSb = S.dev.sb
  const sbReset = D0.sbReset, setSbReset = S.dev.sbReset
  const pose = G.pose, setPose = S.glo.pose
  const poseRef = useRef(pose); poseRef.current = pose
  const viewAnim = useRef(0)
  /** Ease to a preset over 0.6 s (shortest way round for the spin); jumps straight there when reduced motion is on. */
  const goView = useCallback((to: Pose) => {
    cancelAnimationFrame(viewAnim.current)
    const from = { ...poseRef.current }, dy = ((to.tiltY - from.tiltY) % 360 + 540) % 360 - 180
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { setPose(to); return }
    const t0 = performance.now(), D = 600
    const step = (t: number) => { const k = Math.min(1, (t - t0) / D), e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2
      const p = {} as Pose; for (const key of Object.keys(to) as (keyof Pose)[]) p[key] = from[key] + (to[key] - from[key]) * e
      p.tiltY = k < 1 ? from.tiltY + dy * e : to.tiltY
      setPose(p); if (k < 1) viewAnim.current = requestAnimationFrame(step) }
    viewAnim.current = requestAnimationFrame(step)
  }, [])
  // iPhone Duo fold transition: animates the hinge to the target screen with the iOS blur hand-off; Play loops it.
  const optsRef = useRef<DeviceOptions | null>(null); optsRef.current = opts
  const foldAnim = useRef({ loop: false, timer: 0 })
  const foldFollow = D0.foldFollow, setFoldFollow = S.dev.foldFollow
  const [foldPlaying, setFoldPlaying] = useState(false)
  const foldSpeed = D0.foldSpeed, setFoldSpeed = S.dev.foldSpeed
  const foldDark = D0.foldDark, setFoldDark = S.dev.foldDark
  foldLive.follow = foldFollow
  // The transition runs in the Duo's frame loop from foldLive (no React state per frame). React only hears about it
  // twice: the screen swap at 30% (both screens are dissolved then, so the content change is hidden) and the end.
  const foldTo = useCallback((to: 'inner' | 'outer', then?: () => void) => {
    const o = optsRef.current!, cur = foldLive.anim, target = to === 'inner' ? 180 : 0
    // start from wherever the hinge is now, even mid-transition
    let from = o.fold
    if (cur) { const h = Math.min(1, (performance.now() - cur.t0) / cur.dur), e = h * h * h * (h * (h * 6 - 15) + 10); from = cur.from + (cur.target - cur.from) * e }
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { foldLive.anim = null; setOpts(x => ({ ...x, screen: to, fold: target, trans: null })); then?.(); return }
    const z0 = poseRef.current.zoom
    foldLive.anim = { from, target, to, t0: performance.now(), dur: FOLD_MS / speedRef.current,
      onSwap: () => setOpts(x => ({ ...x, screen: to })),
      onDone: (fold, k) => { setOpts(x => ({ ...x, screen: to, fold, trans: null })); if (k !== 1) setPose(p => ({ ...p, zoom: z0 * k })); then?.() } }
  }, [])
  const speedRef = useRef(foldSpeed); speedRef.current = foldSpeed
  /** Stops the Play loop; finish also ends a running transition at its target (for the Fold slider). */
  const stopFold = useCallback((finish = true) => {
    clearTimeout(foldAnim.current.timer); foldAnim.current.loop = false; setFoldPlaying(false)
    const a = foldLive.anim; if (a && finish) { foldLive.anim = null; a.onDone?.(a.target, 1) }
  }, [])
  const playFold = useCallback(() => {
    foldAnim.current.loop = true; setFoldPlaying(true)
    const go = () => { if (!foldAnim.current.loop) return
      foldTo(optsRef.current!.screen === 'inner' ? 'outer' : 'inner', () => { foldAnim.current.timer = window.setTimeout(go, 700) }) }
    go()
  }, [foldTo])
  useEffect(() => () => { clearTimeout(foldAnim.current.timer); foldLive.anim = null }, [])
  const light = G.light, setLight = S.glo.light
  const fx = G.fx, setFx = S.glo.fx
  const style = G.style, setStyle = S.glo.style
  const sk = G.sk, setSk = S.glo.sk
  const sketch = style === 'sketch'
  const hands = D0.hands, setHands = S.dev.hands
  const spectral = D0.spectral, setSpectral = S.dev.spectral
  const gesture = D0.gesture, setGesture = S.dev.gesture
  const handRot = D0.handRot, setHandRot = S.dev.handRot
  const idle = D0.idle, setIdle = S.dev.idle
  const gestureFit = useRef(HAND_FITS.ip18!)
  useEffect(() => { const f = HAND_FITS[device]; if (f && f !== gestureFit.current) { setGesture(g => rescale(g, screenOf(gestureFit.current), screenOf(f))); gestureFit.current = f } }, [device])
  // AI hands: the finished picture (object URL) sits over the canvas until anything in the scene changes.
  const [ai, setAi] = useState<{ guide: Guide; shadows: boolean; busy: boolean; url: string | null }>({ guide: 'depth', shadows: false, busy: false, url: null })
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1e9))
  const [seedLock, setSeedLock] = useState(false)
  const aiAbort = useRef<AbortController | null>(null)
  const bgMode = G.bgMode, setBgMode = S.glo.bgMode
  const bg1 = G.bg1, setBg1 = S.glo.bg1
  const bg2 = G.bg2, setBg2 = S.glo.bg2
  const angle = G.angle, setAngle = S.glo.angle
  const transparent = G.transparent, setTransparent = S.glo.transparent
  const scale = G.scale, setScale = S.glo.scale
  const [dragging, setDragging] = useState(false)
  const [status, setStatus] = useState('Drop, paste or choose an image or video to start.')
  // brief toast over the stage for paste and drop
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(null)
  const toastTimer = useRef(0)
  // keyframe timeline: snapshot and apply the animatable state; the driver moves the scene per frame through refs
  const devGroup = useRef<THREE.Group>(null)
  const live = useRef({ pose, opts, hands, handRot, gesture, light, fx, device })
  live.current = { pose, opts, hands, handRot, gesture, light, fx, device }
  // Stable transform props: the timeline moves devGroup directly each frame, and the per-frame hand updates re-render App,
  // so fresh arrays here would snap the phone back to the slider pose on every frame (the hand then looked detached).
  const devPos = useMemo(() => [pose.panX, pose.panY, 0] as [number, number, number], [pose.panX, pose.panY])
  const devRot = useMemo(() => [THREE.MathUtils.degToRad(pose.tiltX), THREE.MathUtils.degToRad(pose.tiltY), THREE.MathUtils.degToRad(pose.rotZ)] as [number, number, number], [pose.tiltX, pose.tiltY, pose.rotZ])
  const tlSnapshot = useCallback((): KfState => { const v = live.current; return {
    pose: { ...v.pose }, fold: v.device === 'duo' ? v.opts.fold : null, hands: { ...v.hands }, handRot: { ...v.handRot }, tap: { x: v.gesture.x, y: v.gesture.y }, ges: Object.fromEntries(GES_KEYS.map(k => [k, v.gesture[k]])),
    light: { intensity: v.light.intensity, azimuth: v.light.azimuth, elevation: v.light.elevation, floor: v.light.floor }, fx: { focus: v.fx.focus, blur: v.fx.blur } } }, [])
  const tlDisc = useCallback((k: KfState) => {
    setHands(h => h.pose === k.hands.pose && h.tone === k.hands.tone ? h : { pose: k.hands.pose as HandPose, tone: k.hands.tone })
    setHandRot(r => r.tilt === k.handRot.tilt && r.spin === k.handRot.spin && r.roll === k.handRot.roll ? r : { ...k.handRot })
    setGesture(g => ({ ...g, ...k.ges, x: k.tap.x, y: k.tap.y }))
    setLight(l => ({ ...l, ...k.light })); setFx(f => ({ ...f, ...k.fx }))
  }, [])
  const tlApply = useCallback((k: KfState) => {
    setPose({ ...k.pose }); if (k.fold != null && live.current.device === 'duo') setOpts(o => ({ ...o, fold: k.fold!, screen: k.fold! >= 90 ? 'inner' : 'outer' }))
    tlDisc(k)
  }, [tlDisc])
  const tlCommit = useCallback((f: Frame) => {
    setPose(p => ({ ...p, ...quatPose(f.q), zoom: f.zoom, fov: f.fov, panX: f.pan[0], panY: f.pan[1] }))
    if (f.fold != null && live.current.device === 'duo') setOpts(o => ({ ...o, fold: f.fold!, screen: f.fold! >= 90 ? 'inner' : 'outer' }))
  }, [])
  const tlSide = useCallback((inner: boolean) => { if (live.current.device === 'duo') setOpts(o => o.screen === (inner ? 'inner' : 'outer') ? o : { ...o, screen: inner ? 'inner' : 'outer' }) }, [])
  // per frame while the timeline runs: the interpolated touch point, hand rotation and gesture, so the hand moves with the thumb
  const tlHand = useCallback((f: Frame) => {
    const r = f.handRot, t = f.tap, gs = f.ges
    setHandRot(o => o.tilt === r.tilt && o.spin === r.spin && o.roll === r.roll ? o : { ...r })
    setGesture(o => o.x === t.x && o.y === t.y && GES_KEYS.every(k => gs[k] == null || o[k] === gs[k]) ? o : { ...o, ...gs, x: t.x, y: t.y })
  }, [])
  useEffect(() => { tlLive.onHand = tlHand; return () => { tlLive.onHand = null } }, [tlHand])
  useEffect(() => { tlLive.onDisc = tlDisc; return () => { tlLive.onDisc = null } }, [tlDisc])
  const flash = useCallback((text: string, error = false) => { setToast({ text, error }); setStatus(text); clearTimeout(toastTimer.current); toastTimer.current = window.setTimeout(() => setToast(null), error ? 4000 : 1800) }, [])
  // Photoreal status sits right under its button (the main status line is at the bottom of the panel, often out of view)
  const [aiMsg, setAiMsg] = useState<{ text: string; kind: 'busy' | 'done' | 'error' } | null>(null)
  const say = (text: string, kind: 'busy' | 'done' | 'error') => { setAiMsg({ text, kind }); setStatus(text) }
  const three = useRef<Grab | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const drag = useRef<{ x: number; y: number; pan: boolean } | null>(null)
  // Optional local logo: public/local/logo.svg or logo.png (git-ignored). Loaded once; the Logo control can override or clear it.
  useEffect(() => {
    let live = true
    loadLocalLogo().then(logo => { if (live && logo) setOpts(o => (o.logo ? o : { ...o, logo })) })
    return () => { live = false }
  }, [])
  const def = DEVICES.find(d => d.id === device)!
  const screenAspect = typeof def.screenAspect === 'function' ? def.screenAspect(opts) : def.screenAspect
  // Screen in iPhone points for the status bar: Pro 402x874, Pro Max 440x956
  const sbSize = device === 'ip18' ? { w: 402, h: 874 } : device === 'ip18max' ? { w: 440, h: 956 } : null
  const islandLook = useMemo(() => sketch ? islandSketch(sk.line) : undefined, [sketch, sk.line])
  // Screen track: while a clip covers a screen, its mixer canvas is that screen's media
  const [screenGen, bumpScreen] = useState(0)
  useEffect(() => { screenLive.onShape = () => bumpScreen(n => n + 1); return () => { screenLive.onShape = null } }, [])
  const mixMedia = (m: typeof mixers.inner): Media | null => m.on ? { texture: m.tex, aspect: m.aspect, kind: 'image', name: 'Screen track', live: true } : null
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const mixIn = useMemo(() => mixMedia(mixers.inner), [screenGen]), mixOut = useMemo(() => mixMedia(mixers.outer), [screenGen])
  const shownInner = mixIn ?? media, shownOuter = mixOut ?? mediaOuter
  const screenTex = useStatusComposite(shownInner, sbOn, sb, sbSize, islandLook)
  // status bar on: its island is the single island, so the 3D island mesh and front lens are hidden
  const devOpts = useMemo(() => sbOn && sbSize ? { ...opts, hideIsland: true } : opts, [opts, sbOn, !!sbSize])

  /** SVG markup: rasterised at 3x the Pro Max screen width (1320 px) for the screen texture; the markup is kept for SVG export. */
  const loadSvg = useCallback((text: string, name: string, done?: string, to: 'inner' | 'outer' = 'inner') => {
    const setM = to === 'outer' ? setMediaOuter : setMedia
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml'), el = doc.documentElement
    if (el.nodeName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) { flash('That SVG could not be read.', true); return }
    const vb = el.getAttribute('viewBox')?.split(/[\s,]+/).map(Number)
    const w0 = parseFloat(el.getAttribute('width') ?? '') || vb?.[2] || 402, h0 = parseFloat(el.getAttribute('height') ?? '') || vb?.[3] || 874
    if (!el.getAttribute('viewBox')) el.setAttribute('viewBox', `0 0 ${w0} ${h0}`)
    const W = 1320, H = Math.round(W * h0 / w0)
    el.setAttribute('width', String(W)); el.setAttribute('height', String(H))
    const src = new XMLSerializer().serializeToString(el)
    const img = new Image()
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = W; c.height = H; c.getContext('2d')!.drawImage(img, 0, 0, W, H)
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8
      setM(m => { m?.video?.pause(); m?.texture.dispose(); return { texture: t, aspect: W / H, kind: 'image', name, svg: text } })
      setStatus(`Loaded SVG: ${name} (rasterised at ${W} × ${H})`); if (done) flash(done)
    }
    img.onerror = () => flash('That SVG could not be drawn (it may use external images or fonts).', true)
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(src)
  }, [flash])
  const loadFile = useCallback((file: File, done?: string, to: 'inner' | 'outer' = 'inner') => {
    const setM = to === 'outer' ? setMediaOuter : setMedia
    const url = URL.createObjectURL(file)
    if (file.type.startsWith('video/')) {
      const v = document.createElement('video')
      v.src = url; v.loop = true; v.muted = true; v.playsInline = true; v.crossOrigin = 'anonymous'
      v.onloadeddata = () => {
        const t = new THREE.VideoTexture(v); t.colorSpace = THREE.SRGBColorSpace
        v.play().catch(() => {})
        setM(m => { m?.video?.pause(); m?.texture.dispose(); return { texture: t, aspect: v.videoWidth / v.videoHeight, kind: 'video', name: file.name, video: v } })
        setStatus(`Loaded video: ${file.name}`); if (done) flash(done)
      }
    } else if (file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)) {
      file.text().then(t => loadSvg(t, file.name, done, to))
    } else if (file.type.startsWith('image/')) {
      new THREE.TextureLoader().load(url, t => {
        t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8
        const img = t.image as HTMLImageElement
        setM(m => { m?.video?.pause(); m?.texture.dispose(); return { texture: t, aspect: img.width / img.height, kind: 'image', name: file.name } })
        setStatus(`Loaded image: ${file.name}`); if (done) flash(done)
      }, undefined, () => flash(`Couldn't read that image (${file.type || 'unknown type'}).`, true))
    } else flash('That file type is not supported. Use an image (PNG, JPEG, WebP) or a video.', true)
  }, [flash, loadSvg])

  // the Duo's paste/drop target follows the screen being shown or selected; the Media selector can change it
  useEffect(() => { setMediaTo(opts.screen) }, [opts.screen])
  const target = device === 'duo' ? mediaTo : 'inner'
  const targetRef = useRef(target); targetRef.current = target
  const onto = (to: 'inner' | 'outer') => device === 'duo' ? `Pasted onto the ${to} screen` : 'Pasted onto screen'
  const ontoRef = useRef(onto); ontoRef.current = onto
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const to = targetRef.current
      // typing or pasting into a field (hex, seed, activity text...) is left alone
      const el = document.activeElement as HTMLElement | null
      if (el && (el.isContentEditable || el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !['checkbox', 'radio', 'range', 'button', 'color', 'file'].includes((el as HTMLInputElement).type)))) return
      const dt = e.clipboardData; if (!dt) return
      // Figma "Copy as PNG" and screenshots arrive as an image item; files cover pasted image files
      const fromItems = Array.from(dt.items).filter(i => i.kind === 'file' && i.type.startsWith('image/')).map(i => i.getAsFile()).filter((f): f is File => !!f)
      const f = fromItems[0] ?? Array.from(dt.files).find(x => x.type.startsWith('image/') || x.type.startsWith('video/'))
      e.preventDefault()
      // Figma "Copy as SVG" puts the markup on the clipboard as text
      const txt = (dt.getData('image/svg+xml') || dt.getData('text/plain') || '').trim()
      if (!f && /^(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(txt)) { loadSvg(txt, 'Pasted SVG', ontoRef.current(to), to); return }
      if (!f) { flash('The clipboard has no image. Copy an image (for example Copy as PNG in Figma), then press Cmd+V.', true); return }
      const named = f.name && f.name !== 'image.png' ? f : new File([f], `Pasted image.${(f.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`, { type: f.type })
      loadFile(named, ontoRef.current(to), to)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [loadFile, loadSvg])

  const bgCss = transparent ? undefined : bgMode === 'solid' ? bg1 : `linear-gradient(${angle}deg, ${bg1}, ${bg2})`

  // Any change to the scene makes the AI picture stale, so drop it.
  // (only when there is one: an unconditional setState here runs every frame during timeline playback)
  const aiHasUrl = !!ai.url
  useEffect(() => { if (!aiHasUrl) return; setAi(a => { if (a.url) URL.revokeObjectURL(a.url); return a.url ? { ...a, url: null } : a }) },
    [device, opts, media, mediaOuter, pose, light, fx, hands, gesture, handRot, bgMode, bg1, bg2, angle, transparent, style, sk])
  const makePhotoreal = async () => {
    const t = three.current
    if (ai.busy) return
    if (!t) { say('The 3D view isn\'t ready yet. Wait a moment, then try again.', 'error'); return }
    say('Checking ComfyUI…', 'busy')
    if (!(await comfyReachable())) { say('ComfyUI isn\'t running. Start it (port 8188), then try again.', 'error'); return }
    const ctl = new AbortController(); aiAbort.current = ctl
    const runSeed = seedLock ? seed : Math.floor(Math.random() * 1e9)
    setSeed(runSeed)
    setAi(a => ({ ...a, busy: true }))
    try {
      await new Promise(r => requestAnimationFrame(r))
      const passes = await renderPasses(t, hands.tone)
      const res = await runComfy(passes, { guide: ai.guide, seed: runSeed, onStatus: s => say(s, 'busy'), signal: ctl.signal })
      const out = composite(passes, res, { shadows: ai.shadows, silhouette: hands.tone === 'silhouette' })
      const url = URL.createObjectURL(await new Promise<Blob>(r => out.toBlob(b => r(b!), 'image/png')))
      setAi(a => { if (a.url) URL.revokeObjectURL(a.url); return { ...a, busy: false, url } })
      say(`Done: photoreal hands at ${passes.w} × ${passes.h}, shown in the view. Download saves this picture; ComfyUI also kept its raw image in ComfyUI-Shared/output/${res.saved ?? 'openmock/'}. Change anything to go back to 3D.`, 'done')
    } catch (e) {
      setAi(a => ({ ...a, busy: false }))
      const m = e instanceof Error ? e.message : String(e)
      say(/Failed to fetch|NetworkError|Load failed/i.test(m) ? 'ComfyUI isn\'t running or stopped responding. Start it (port 8188), then try again.' : m || 'Something went wrong with ComfyUI.', 'error')
    }
  }
  const exportAiPasses = async () => {
    const t = three.current; if (!t) return
    await new Promise(r => requestAnimationFrame(r))
    await downloadPasses(await renderPasses(t, hands.tone))
    setStatus('Saved the AI hands passes and prompt. Load them into comfy/hands.json in ComfyUI.')
  }

  const exportPng = async () => {
    if (ai.url) { const a = document.createElement('a'); a.download = 'openmock-ai-hands.png'; a.href = ai.url; a.click(); setStatus('Exported the photoreal hands picture.'); return }
    const t = three.current; if (!t) return
    const { gl } = t
    const size = gl.getSize(new THREE.Vector2())
    const prev = t.dpr
    const ratio = Math.min(scale, 4096 / Math.max(size.x, size.y))
    // Render through the effects pipeline at export size, then grab the canvas.
    t.setDpr(ratio)
    for (let i = 0; i < 4; i++) await new Promise(r => requestAnimationFrame(r))
    const w = gl.domElement.width, h = gl.domElement.height
    const out = document.createElement('canvas'); out.width = w; out.height = h
    const ctx = out.getContext('2d')!
    if (!transparent) paintBg(ctx, w, h, bgMode, bg1, bg2, angle)
    ctx.drawImage(gl.domElement, 0, 0)
    t.setDpr(prev)
    const a = document.createElement('a'); a.download = `openmock-${w}x${h}.png`; a.href = out.toDataURL('image/png'); a.click()
    setStatus(`Exported ${w} × ${h} PNG.`)
  }
  /** SVG export: the full render as an embedded PNG (not vector: lighting, shading and perspective are raster). When the
   *  screen design came in as SVG, its original markup rides along as a hidden, named layer so it stays editable. */
  const exportSvg = async () => {
    const t = three.current; if (!t) return
    const { gl } = t, size = gl.getSize(new THREE.Vector2()), prev = t.dpr
    t.setDpr(Math.min(scale, 4096 / Math.max(size.x, size.y)))
    for (let i = 0; i < 4; i++) await new Promise(r => requestAnimationFrame(r))
    const w = gl.domElement.width, h = gl.domElement.height
    const out = document.createElement('canvas'); out.width = w; out.height = h
    const ctx = out.getContext('2d')!
    if (!transparent) paintBg(ctx, w, h, bgMode, bg1, bg2, angle)
    ctx.drawImage(ai.url ? await new Promise<HTMLImageElement>(r => { const i = new Image(); i.onload = () => r(i); i.src = ai.url! }) : gl.domElement, 0, 0, w, h)
    t.setDpr(prev)
    const png = out.toDataURL('image/png')
    const design = media?.svg ? `\n  <g id="screen-design-vector" display="none"><!-- the pasted screen design, as vector -->\n${media.svg.replace(/^<\?xml[^>]*>\s*/, '')}\n  </g>` : ''
    const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">\n  <title>Openmock render</title>\n  <image id="render" width="${w}" height="${h}" href="${png}"/>${design}\n</svg>\n`
    const a = document.createElement('a'); a.download = `openmock-${w}x${h}.svg`; a.href = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })); a.click()
    setStatus(`Exported ${w} × ${h} SVG (the render is an embedded PNG${media?.svg ? '; your SVG screen design is included as a hidden vector layer' : ''}).`)
  }

  const apple = light.preset === 'apple', violet = light.preset === 'violet'
  const violetScene = () => {
    setLight(l => ({ ...l, preset: 'violet', intensity: 1.6, shadow: 0 }))
    setBgMode('streaks'); setBg1(VIOLET_BG.c1); setBg2(VIOLET_BG.c2); setAngle(VIOLET_BG.angle); setTransparent(false)
    if (HAND_FITS[device]) setHands({ pose: 'hold', tone: 'silhouette' })
    else { setDevice('ip18'); setHands({ pose: 'hold', tone: 'silhouette' }) }
    setOpts(o => ({ ...o, finish: 'black' })); setPose(VIOLET_CAMERA)
  }
  // Light finishes need more light in the dark preset to read white, as in Apple's shots; dark finishes keep the low level.
  const lift = apple && device.startsWith('ip18') && (opts.finish === 'silver' || opts.finish === 'glacier') ? 1.5 : 1
  if (import.meta.env.DEV) (window as unknown as { __omSet: unknown }).__omSet = { setMediaTo, setPose, setLight, setBg1, setBgMode, violetScene, setStyle, setSk, setOpts, setDevice, setHands, setGesture, setHandRot, foldTo, playFold, stopFold, foldLive, setSbOn, setSb, setSpectral, setIdle }
  const lx = Math.cos(light.elevation * Math.PI / 180) * Math.sin(light.azimuth * Math.PI / 180) * 5
  const ly = Math.sin(light.elevation * Math.PI / 180) * 5
  const lz = Math.cos(light.elevation * Math.PI / 180) * Math.cos(light.azimuth * Math.PI / 180) * 5
  const D = def.Component
  const deg = THREE.MathUtils.degToRad

  const slider = (label: string, v: number, min: number, max: number, step: number, set: (n: number) => void, unit = '') => (
    <label className="row"><span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={v} style={{ ['--p' as string]: `${(v - min) / (max - min) * 100}%` }} onChange={e => set(+e.target.value)} />
      <output>{Number.isInteger(step) ? v : v.toFixed(2)}{unit}</output></label>)

  // ---- reskin chrome: sections for the two rails, palette commands, export menu and the floating timeline ----
  const [insets, setInsets] = useState<[number, number]>([0, 0])
  const onInsets = useCallback((l: number, r: number) => setInsets(p => p[0] === l && p[1] === r ? p : [l, r]), [])
  const chromeApi = useRef<ChromeApi | null>(null)
  const [navMode, setNavMode] = useState<'orbit' | 'pan'>('orbit')
  const tap = useRef<{ x: number; y: number } | null>(null)
  const [tlOpen, setTlOpenState] = useState(() => localStorage.getItem('openmock-tl-open') === '1')
  const setTlOpen = useCallback((o: boolean) => { setTlOpenState(o); localStorage.setItem('openmock-tl-open', o ? '1' : '0') }, [])
  const toggleTimeline = useCallback(() => setTlOpenState(o => { localStorage.setItem('openmock-tl-open', o ? '0' : '1'); return !o }), [])
  const tlApi = useRef<TlApi | null>(null)
  const [tlInfo, setTlInfo] = useState<TlInfo>({ fps: 60, fmtOut: 'webm', mp4ok: false, rec: false, keys: 0 })
  const [dropOver, setDropOver] = useState(false)
  const handOk = !!HAND_FITS[device]
  const tones = Object.entries(SKIN_TONES)
  const finishColour = (v: unknown) => (v as { back?: string; frame?: string }).back ?? (v as { frame?: string }).frame ?? '#c9ccd1'
  const pickFile = (to: 'inner' | 'outer') => { setMediaTo(to); fileInput.current?.click() }
  const dropZone = (to: 'inner' | 'outer', m: Media | null) => <div className={`om-drop ${dropOver ? 'over' : ''}`} role="button" tabIndex={0} aria-label={`Choose image or video for the ${to} screen`}
    onClick={() => pickFile(to)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickFile(to) } }}
    onDragOver={e => { e.preventDefault(); setDropOver(true) }} onDragLeave={() => setDropOver(false)}
    onDrop={e => { e.preventDefault(); setDropOver(false); const f = e.dataTransfer.files[0]; if (f) loadFile(f, device === 'duo' ? `Dropped onto the ${to} screen` : 'Dropped onto screen', to); else flash('That drop had no file. Drag in an image or video file.', true) }}>
    <span>Drop media or ⌘V</span>{m ? <b>{m.name}{m.kind === 'video' ? ' (video)' : ''}{m.svg ? ' (SVG)' : ''}</b> : <span>or click to choose</span>}</div>

  const sections: Section[] = [
    // SCENE rail
    { id: 'devices', side: 'scene', title: 'Devices', icon: 'devices', settings: ['Selected device', 'Add device'], render: () => <>
      <div className="om-devlist">
        <button className="om-devrow on" aria-current="true" onClick={() => S.select(D0.uid)}><Icon name="model" /><span>{def.label}<small>{def.finishes?.[opts.finish]?.label ?? 'Default'}{hands.pose !== 'off' ? ` · ${HAND_POSES.find(([k]) => k === hands.pose)?.[1]}` : ''}</small></span></button>
      </div>
      <button className="ghost" disabled title="Several devices in one scene arrive in the next stage">+ Add device</button>
      <p className="hint">One device for now. Adding and duplicating devices comes next.</p>
    </> },
    { id: 'preset', side: 'scene', title: 'Preset', icon: 'preset', settings: ['Violet silhouette'], render: () => <>
      <button onClick={violetScene}>Violet silhouette</button>
      <p className="hint">A dark hand holds the phone up against a violet backdrop with light streaks. Change the colours under Background.</p>
    </> },
    { id: 'style', side: 'scene', title: 'Style', icon: 'style', settings: ['Photo', 'Sketch', 'Line colour', 'Body colour', 'Outer lines', 'Inner lines', 'Reset sketch'], render: () => <>
      <div className="seg"><button className={!sketch ? 'on' : ''} onClick={() => setStyle('photo')}>Photo</button>
        <button className={sketch ? 'on' : ''} onClick={() => { setStyle('sketch'); setBgMode('solid'); setBg1(SKETCH_PAPER); setTransparent(false) }}>Sketch</button></div>
      {sketch && <>
        <label className="row"><span>Line colour</span><input type="color" value={sk.line} onChange={e => setSk({ ...sk, line: e.target.value })} /><input className="hex" value={sk.line} onChange={e => setSk({ ...sk, line: e.target.value })} /></label>
        <label className="row"><span>Body colour</span><input type="color" value={sk.fill} onChange={e => setSk({ ...sk, fill: e.target.value })} /><input className="hex" value={sk.fill} onChange={e => setSk({ ...sk, fill: e.target.value })} /></label>
        {slider('Outer lines', sk.outer, 0, 8, 0.1, n => setSk({ ...sk, outer: n }), ' px')}
        {slider('Inner lines', sk.inner, 0, 4, 0.1, n => setSk({ ...sk, inner: n }), ' px')}
        <button className="ghost" onClick={() => setSk(SKETCH_DEFAULTS)}>Reset sketch</button>
        <p className="hint">A flat illustration: cream body, soft grey shading and grey outlines. Choosing Sketch sets a warm paper background, which you can change under Background.</p>
      </>}
    </> },
    { id: 'background', side: 'scene', title: 'Background', icon: 'background', settings: ['Transparent', 'Solid', 'Gradient', 'Streaks', 'Colour 1', 'Colour 2', 'Angle'], render: () => <>
      <label className="check"><input type="checkbox" checked={transparent} onChange={e => setTransparent(e.target.checked)} /> Transparent</label>
      {!transparent && <>
        <div className="seg"><button className={bgMode === 'solid' ? 'on' : ''} onClick={() => setBgMode('solid')}>Solid</button><button className={bgMode === 'gradient' ? 'on' : ''} onClick={() => setBgMode('gradient')}>Gradient</button><button className={bgMode === 'streaks' ? 'on' : ''} onClick={() => setBgMode('streaks')}>Streaks</button></div>
        <label className="row"><span>Colour 1</span><input type="color" value={bg1} onChange={e => setBg1(e.target.value)} /><input className="hex" value={bg1} onChange={e => setBg1(e.target.value)} /></label>
        {bgMode !== 'solid' && <>
          <label className="row"><span>Colour 2</span><input type="color" value={bg2} onChange={e => setBg2(e.target.value)} /><input className="hex" value={bg2} onChange={e => setBg2(e.target.value)} /></label>
          {slider('Angle', angle, 0, 360, 1, setAngle, '°')}
        </>}
      </>}
    </> },
    { id: 'camera', side: 'scene', title: 'Camera', icon: 'camera', settings: ['Tilt X', 'Tilt Y', 'Rotate', 'Zoom', 'Field of view', 'Pan X', 'Pan Y', 'Reset camera', 'View presets', 'Apple hero angle'], render: () => <>
      {slider('Tilt X', pose.tiltX, -90, 90, 1, n => setPose({ ...pose, tiltX: n }), '°')}
      {slider('Tilt Y', pose.tiltY, -180, 180, 1, n => setPose({ ...pose, tiltY: n }), '°')}
      {slider('Rotate', pose.rotZ, -45, 45, 1, n => setPose({ ...pose, rotZ: n }), '°')}
      {slider('Zoom', pose.zoom, 0.5, 2.5, 0.01, n => setPose({ ...pose, zoom: n }))}
      {slider('Field of view', pose.fov, 8, 60, 1, n => setPose({ ...pose, fov: n }), '°')}
      {slider('Pan X', pose.panX, -1.5, 1.5, 0.01, n => setPose({ ...pose, panX: n }))}
      {slider('Pan Y', pose.panY, -1.5, 1.5, 0.01, n => setPose({ ...pose, panY: n }))}
      <h3>View presets</h3>
      <div className="seg wrap" aria-label="View presets">{VIEW_PRESETS.map(([n, p]) => <button key={n} onClick={() => goView(p)}>{n}</button>)}</div>
      <div className="om-tiles"><button className="ghost" onClick={() => setPose(APPLE_HERO)}>Apple hero angle</button><button className="ghost" onClick={() => setPose(POSE)}>Reset camera</button></div>
    </> },
    { id: 'lighting', side: 'scene', title: 'Lighting', icon: 'lighting', settings: ['Soft studio', 'Apple studio', 'Violet rim', 'Intensity', 'Direction', 'Height', 'Floor shadow', 'Shadow', 'Distance to floor', 'Reflections'], render: () => <>
      <div className="seg">{([['soft', 'Soft studio'], ['apple', 'Apple studio'], ['violet', 'Violet rim']] as const).map(([k, l]) =>
        <button key={k} className={light.preset === k ? 'on' : ''} onClick={() => setLight({ ...light, preset: k })}>{l}</button>)}</div>
      {apple && <p className="hint">Dark room with a few strip lights, like Apple's product shots. Looks best on a dark background.</p>}
      {violet && <p className="hint">Low violet fill with lavender rim lights behind, so hands read as silhouettes and the screen stays bright.</p>}
      {slider('Intensity', light.intensity, 0, 4, 0.05, n => setLight({ ...light, intensity: n }))}
      {slider('Direction', light.azimuth, -180, 180, 1, n => setLight({ ...light, azimuth: n }), '°')}
      {slider('Height', light.elevation, 5, 90, 1, n => setLight({ ...light, elevation: n }), '°')}
      <label className="check"><input type="checkbox" checked={light.shadowOn} onChange={e => setLight({ ...light, shadowOn: e.target.checked })} /> Floor shadow</label>
      {light.shadowOn && <>
        {slider('Shadow', light.shadow, 0, 1, 0.01, n => setLight({ ...light, shadow: n }))}
        {slider('Distance to floor', light.floor, 0, 20, 0.5, n => setLight({ ...light, floor: n }), ' cm')}
      </>}
      {slider('Reflections', light.env, 0, 2, 0.05, n => setLight({ ...light, env: n }))}
    </> },
    { id: 'effects', side: 'scene', title: 'Effects', icon: 'effects', settings: ['Depth of field', 'Focus', 'Blur', 'Focus on device', 'Soft bloom', 'Film grain'], render: () => <>
      <label className="check"><input type="checkbox" checked={fx.dof} onChange={e => setFx({ ...fx, dof: e.target.checked })} /> Depth of field</label>
      {fx.dof && <>
        {slider('Focus', fx.focus, -1.5, 1.5, 0.01, n => setFx({ ...fx, focus: n }))}
        {slider('Blur', fx.blur, 0, 10, 0.1, n => setFx({ ...fx, blur: n }))}
        <button className="ghost" onClick={() => setFx({ ...fx, focus: 0 })}>Focus on device</button>
      </>}
      <label className="check"><input type="checkbox" checked={fx.bloom} onChange={e => setFx({ ...fx, bloom: e.target.checked })} /> Soft bloom</label>
      <label className="check"><input type="checkbox" checked={fx.grain} onChange={e => setFx({ ...fx, grain: e.target.checked })} /> Film grain</label>
      {transparent && (fx.dof || fx.bloom || fx.grain) && <p className="hint">Effects may not keep a transparent background. Turn them off for a clean cut-out.</p>}
    </> },
    { id: 'photoreal', side: 'scene', title: 'Photoreal hands', icon: 'photoreal', settings: ['Guide by depth', 'Guide by pose', 'Contact shadows', 'Seed', 'Randomise', 'Lock seed', 'Make hands photoreal', 'Export for AI hands'], render: () => handOk && hands.pose !== 'off' ? <>
      <div className="seg"><button className={ai.guide === 'depth' ? 'on' : ''} onClick={() => setAi({ ...ai, guide: 'depth' })}>Guide by depth</button>
        <button className={ai.guide === 'pose' ? 'on' : ''} onClick={() => setAi({ ...ai, guide: 'pose' })}>Guide by pose</button></div>
      <label className="check"><input type="checkbox" checked={ai.shadows} onChange={e => setAi({ ...ai, shadows: e.target.checked })} /> Contact shadows (darkens the phone slightly)</label>
      <label className="row"><span>Seed</span><input type="number" min={0} value={seed} onChange={e => setSeed(Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
        <button className="ghost" title="Pick a new random seed" aria-label="Randomise seed" onClick={() => setSeed(Math.floor(Math.random() * 1e9))}>New</button></label>
      <label className="check"><input type="checkbox" checked={seedLock} onChange={e => setSeedLock(e.target.checked)} /> Lock seed (repeat the same result)</label>
      {hands.tone === 'spectral' && <p className="hint">Spectral hands are painted as Fair skin for the photoreal pass.</p>}
      {ai.busy ? <button onClick={() => aiAbort.current?.abort()}>Cancel</button> : <button onClick={makePhotoreal}>Make hands photoreal</button>}
      {aiMsg && <p className={`ai-msg ${aiMsg.kind}`} role="status" style={{ margin: '4px 0' }}>{aiMsg.kind === 'busy' ? 'Working: ' : ''}{aiMsg.text}</p>}
      {ai.url && <button onClick={() => { const a = document.createElement('a'); a.download = 'openmock-ai-hands.png'; a.href = ai.url!; a.click() }}>Download</button>}
      {ai.url && <button className="ghost" onClick={() => setAi(a => { URL.revokeObjectURL(a.url!); return { ...a, url: null } })}>Back to 3D hands</button>}
      <button className="ghost" onClick={exportAiPasses}>Export for AI hands</button>
      <p className="hint">Uses ComfyUI on this Mac to repaint only the hands. The phone stays exactly as rendered.</p>
    </> : <p className="hint">Turn on a hand under Device › Hand first. {handOk ? '' : 'Hands are available for the iPhone 18 Pro and 18 Pro Max.'}</p> },
    // DEVICE rail
    { id: 'model', side: 'device', title: 'Model', icon: 'model', settings: DEVICES.map(d => d.label), render: () => <>
      <div className="om-tiles">{DEVICES.map(d => <button key={d.id} className={`om-tile ${d.id === device ? 'on' : ''}`} aria-pressed={d.id === device} onClick={() => { setDevice(d.id); if (d.defaultFinish && !(d.finishes && opts.finish in d.finishes)) setOpts(o => ({ ...o, finish: d.defaultFinish! })) }}>{d.label}</button>)}</div>
      {def.nativePx && <p className="hint">Native size: {def.nativePx.w} × {def.nativePx.h} px. Screenshots at this size fit exactly.</p>}
    </> },
    ...(def.finishes ? [{ id: 'finish', side: 'device' as const, title: 'Finish', icon: 'finish', settings: ['Colour', 'Back logo', 'Logo size', 'Logo tint', 'SIM tray', ...Object.values(def.finishes).map(v => v.label)], render: () => <>
      <div className="om-sws" role="radiogroup" aria-label="Finish">{Object.entries(def.finishes!).map(([k, v]) => <button key={k} role="radio" aria-checked={opts.finish === k} className={`om-sw ${opts.finish === k ? 'on' : ''}`} onClick={() => setOpts({ ...opts, finish: k })}>
        <i style={{ background: finishColour(v) }} />{v.label}</button>)}</div>
      <label className="row"><span>Back logo</span>
        <input type="file" accept="image/svg+xml,image/png" style={{ gridColumn: 'span 2' }} onChange={async e => { const fl = e.target.files?.[0]; if (fl) setOpts({ ...opts, logo: await loadLogo(fl) }) }} /></label>
      {opts.logo && <>
        {slider('Logo size', opts.logoSize, 0.05, 0.4, 0.01, n => setOpts({ ...opts, logoSize: n }))}
        <label className="row"><span>Logo tint</span><input type="color" value={opts.logoTint} onChange={e => setOpts({ ...opts, logoTint: e.target.value })} /><button className="ghost" onClick={() => setOpts({ ...opts, logo: null })}>Clear</button></label>
      </>}
      <p className="hint">The logo sits centred on the back. Use your own SVG or PNG.</p>
      {(device === 'ip18' || device === 'ip18max') && <>
        <label className="check"><input type="checkbox" checked={opts.simTray} onChange={e => setOpts({ ...opts, simTray: e.target.checked })} /> SIM tray</label>
        <p className="hint">Click a button to press it. Click the SIM tray or its pinhole to eject it, and again to put it back.</p>
      </>}
    </> }] : []),
    { id: 'screen', side: 'device', title: 'Screen', icon: 'screen', settings: ['Choose image or video', 'Drop zone', 'Fill', 'Fit', 'Clear', 'Inner screen', 'Outer screen'], render: () => <>
      {device === 'duo' ? <>
        <div className="seg" role="group" aria-label="Media target"><button className={mediaTo === 'inner' ? 'on' : ''} onClick={() => setMediaTo('inner')}>Inner screen</button><button className={mediaTo === 'outer' ? 'on' : ''} onClick={() => setMediaTo('outer')}>Outer screen</button></div>
        <p className="hint">Choose, paste (⌘V) and drop go to the {mediaTo} screen. It follows the screen shown.</p>
        {(['inner', 'outer'] as const).filter(k => k === mediaTo).map(k => { const m = k === 'inner' ? media : mediaOuter, fk = k === 'inner' ? 'fitInner' : 'fitOuter'
          return <div key={k} className="duo-src on">
            {dropZone(k, m)}
            {!m && k === 'outer' && <p className="hint">None: the outer screen shows the inner media.</p>}
            <div className="seg"><button className={opts[fk] !== 'fit' ? 'on' : ''} onClick={() => setOpts(o => ({ ...o, [fk]: 'fill' }))}>Fill</button><button className={opts[fk] === 'fit' ? 'on' : ''} onClick={() => setOpts(o => ({ ...o, [fk]: 'fit' }))}>Fit</button></div>
            {m && <button className="ghost" onClick={() => (k === 'inner' ? setMedia : setMediaOuter)(x => { x?.video?.pause(); x?.texture.dispose(); return null })}>Clear {k} screen</button>}
          </div> })}
        <p className="hint">Native size: {opts.screen === 'inner' ? `${INNER_PX.w} × ${INNER_PX.h}` : `${OUTER_PX.w} × ${OUTER_PX.h}`} px.</p>
      </> : <>
        {dropZone('inner', media)}
        {media && <button className="ghost" onClick={() => setMedia(x => { x?.video?.pause(); x?.texture.dispose(); return null })}>Clear</button>}
      </>}
      <p className="om-status" role="status" aria-live="polite">{status}</p>
    </> },
    { id: 'statusbar', side: 'device', title: 'Status bar', icon: 'statusbar', settings: ['On', 'Off', 'Text colour', 'Lock screen', 'Carrier', 'Live time', 'Time', 'Do Not Disturb', 'Location', 'Network', 'Wi-Fi strength', 'Cell signal', 'Dual SIM', 'Battery', 'Show percentage', 'Line under battery', 'Island', 'Activity text', 'Island icon', 'Home indicator', 'Bubble', 'Reset status bar'], render: () => sbSize ? <>
      <div className="seg"><button className={sbOn ? 'on' : ''} onClick={() => setSbOn(true)}>On</button><button className={!sbOn ? 'on' : ''} onClick={() => setSbOn(false)}>Off</button></div>
      {sbOn && <>
        <StatusBarControls sb={sb} onChange={setSb} resetKey={sbReset} studio />
        <button className="ghost" onClick={() => { setSb(SB_DEFAULT); setSbReset(sbReset + 1) }}>Reset status bar</button>
        <p className="hint">Drawn onto the screen in iPhone points, so it shows in renders and exports. Auto picks dark or light text from the top of your image or video.</p>
      </>}
    </> : <p className="hint">Available for the iPhone 18 Pro and Pro Max. iPad status bars are coming later.</p> },
    ...(def.foldable ? [{ id: 'fold', side: 'device' as const, title: 'Fold', icon: 'fold', settings: ['Fold', 'Dissolve while folding', 'Inner screen', 'Outer screen', 'Play open and close', 'Transition blur', 'Speed', 'Darkness', 'Camera follows the fold'], render: () => <>
      {slider('Fold', Math.round(opts.fold), 0, 180, 1, n => { stopFold(); setOpts(x => ({ ...x, fold: n, trans: null, screen: x.foldDissolve === false ? x.screen : n >= 90 ? 'inner' : 'outer' })) }, '°')}
      <p className="hint">180 is open flat, 0 is closed.</p>
      <div className="seg"><button className={opts.screen === 'inner' ? 'on' : ''} onClick={() => { stopFold(false); foldTo('inner') }}>Inner screen</button><button className={opts.screen === 'outer' ? 'on' : ''} onClick={() => { stopFold(false); foldTo('outer') }}>Outer screen</button></div>
      <button className="ghost" onClick={() => foldPlaying ? stopFold(false) : playFold()}>{foldPlaying ? 'Stop' : 'Play open and close'}</button>
      <label className="check"><input type="checkbox" checked={opts.foldDissolve !== false} onChange={e => setOpts({ ...opts, foldDissolve: e.target.checked })} /> Dissolve while folding</label>
      {slider('Transition blur', Math.round((opts.foldBlur ?? 0.15) * 100), 0, 100, 1, n => setOpts({ ...opts, foldBlur: n / 100 }), '%')}
      {slider('Speed', foldSpeed, 0.5, 2, 0.05, n => setFoldSpeed(n), '×')}
      {slider('Darkness', Math.round(foldDark * 100), 0, 150, 1, n => { foldLive.dark = n / 100; setFoldDark(n / 100) }, '%')}
      <label className="check"><input type="checkbox" checked={foldFollow} onChange={e => setFoldFollow(e.target.checked)} /> Camera follows the fold</label>
      <p className="hint">Switching screens swings the hinge in 0.9 s at 1×. Each screen frosts and darkens as it leaves its rest and is clear as the hinge settles. Untick Dissolve while folding for a sharp still at any angle.</p>
    </> }] : []),
    { id: 'hand', side: 'device', title: 'Hand', icon: 'hand', settings: ['Grip', 'Gesture', ...HAND_POSES.map(([, l]) => l), 'Touch target', 'Show marker', 'Skin tone', ...tones.map(([, t]) => t.label), 'Tint', 'Transparency', 'Glimmer', 'Rotation', 'Tilt', 'Spin', 'Roll', 'Idle motion', 'Reset hand', 'Hand size', 'Nail length', 'Nail shape'], render: () => handOk ? <>
      <div className="om-sub"><h3>Grip</h3>
        <div className="seg wrap">{HAND_POSES.filter(([k]) => !isGesture(k)).map(([k, l]) => <button key={k} className={hands.pose === k ? 'on' : ''} aria-pressed={hands.pose === k} onClick={() => setHands({ ...hands, pose: k })}>{l}</button>)}</div></div>
      <div className="om-sub"><h3>Gesture</h3>
        <div className="seg wrap">{HAND_POSES.filter(([k]) => isGesture(k)).map(([k, l]) => <button key={k} className={hands.pose === k ? 'on' : ''} aria-pressed={hands.pose === k} onClick={() => setHands({ ...hands, pose: k })}>{l}</button>)}</div>
        <p className="hint">A gesture replaces the grip. Pick Off under Grip to hide the hand.</p></div>
      {hands.pose !== 'off' && <>
        {isGesture(hands.pose) && <div className="om-sub"><GestureControls pose={hands.pose} fit={HAND_FITS[device]!} g={gesture} set={setGesture} /></div>}
        <div className="om-sub"><h3>Skin tone</h3>
          <div className="seg wrap">{tones.map(([k, t]) => <button key={k} className={hands.tone === k ? 'on' : ''} title={t.label} onClick={() => setHands({ ...hands, tone: k })}>
            <span className="swatch" style={{ background: t.color }} />{t.label}</button>)}</div>
          {hands.tone === 'spectral' && <>
            <label className="row"><span>Tint</span>
              <input type="color" value={spectral.tint.toLowerCase()} onChange={e => setSpectral({ ...spectral, tint: e.target.value })} />
              <input type="text" key={spectral.tint} defaultValue={spectral.tint} maxLength={7} onChange={e => { const v = e.target.value.trim(); if (/^#[0-9a-fA-F]{6}$/.test(v)) setSpectral({ ...spectral, tint: v.toUpperCase() }) }} /></label>
            <label className="row"><span>Line colour</span>
              <input type="color" value={(spectral.line ?? spectral.tint).toLowerCase()} onChange={e => setSpectral({ ...spectral, line: e.target.value.toUpperCase() })} />
              <input type="text" key={'l' + spectral.line} defaultValue={spectral.line} maxLength={7} onChange={e => { const v = e.target.value.trim(); if (/^#[0-9a-fA-F]{6}$/.test(v)) setSpectral({ ...spectral, line: v.toUpperCase() }) }} /></label>
            {slider('See-through blur', Math.round((spectral.seeBlur ?? 0.85) * 100), 0, 100, 1, n => setSpectral({ ...spectral, seeBlur: n / 100 }), '%')}
            {slider('Transparency', Math.round(spectral.transparency * 100), 0, 100, 1, n => setSpectral({ ...spectral, transparency: n / 100 }), '%')}
            <label className="check"><input type="checkbox" checked={spectral.glimmer} onChange={e => setSpectral({ ...spectral, glimmer: e.target.checked })} /> Glimmer</label>
            <label className="check"><input type="checkbox" checked={spectral.stars} onChange={e => setSpectral({ ...spectral, stars: e.target.checked })} /> Stars</label>
            <label className="check"><input type="checkbox" checked={spectral.shimmer} onChange={e => setSpectral({ ...spectral, shimmer: e.target.checked })} /> Shimmer</label>
            <button className="ghost" onClick={() => setSpectral(SPECTRAL_DEFAULTS)}>Reset spectral</button>
          </>}</div>
        <div className="om-sub"><h3>Rotation</h3>
          {slider('Tilt', handRot.tilt, -45, 45, 1, n => setHandRot({ ...handRot, tilt: n }), '°')}
          {slider('Spin', handRot.spin, -60, 60, 1, n => setHandRot({ ...handRot, spin: n }), '°')}
          {slider('Roll', handRot.roll, -45, 45, 1, n => setHandRot({ ...handRot, roll: n }), '°')}
          <p className="hint">Turns the hand about the touching fingertip or the grip, so contacts and targets stay put. The hand moves with the phone, so any camera angle works.</p></div>
        <div className="om-sub"><h3 title="A slight, natural movement of the fingers that are not touching the screen">Idle motion</h3>
          <div className="seg">{IDLE_LEVELS.map(([k, l]) => <button key={k} className={idle === k ? 'on' : ''} onClick={() => setIdle(k)}>{l}</button>)}</div></div>
        <button className="ghost" onClick={() => setHandRot(HAND_ROT0)}>Reset hand</button>
      </>}
      <div className="om-sub om-later" aria-disabled="true"><h3>Appearance <span className="om-badge">Later</span></h3>
        <label className="row"><span>Hand size</span><input type="range" disabled min={0} max={1} defaultValue={0.5} /><output>100%</output></label>
        <label className="row"><span>Nail length</span><input type="range" disabled min={0} max={1} defaultValue={0.3} /><output>Short</output></label>
        <div className="seg wrap" aria-label="Nail shape">{['Round', 'Square', 'Almond', 'Oval', 'Stiletto', 'Coffin'].map(n => <button key={n} disabled>{n}</button>)}</div>
        <p className="hint">Per-hand size and nails are coming in a later update.</p></div>
    </> : <p className="hint">Hands are available for the iPhone 18 Pro and 18 Pro Max.</p> },
  ]

  // Palette commands that apply straight away
  const commands: Cmd[] = [
    ...DEVICES.map(d => ({ id: `model-${d.id}`, group: 'device' as const, section: 'model', label: `Model › ${d.label}`, meta: (d.id === device ? 'CURRENT' : 'APPLY') as Cmd['meta'],
      run: () => { setDevice(d.id); if (d.defaultFinish && !(d.finishes && opts.finish in d.finishes)) setOpts(o => ({ ...o, finish: d.defaultFinish! })) } })),
    ...(def.finishes ? Object.entries(def.finishes).map(([k, v]) => ({ id: `fin-${k}`, group: 'device' as const, section: 'finish', label: `Finish › ${v.label}`, meta: (opts.finish === k ? 'CURRENT' : 'APPLY') as Cmd['meta'], run: () => setOpts(o => ({ ...o, finish: k })) })) : []),
    ...((device === 'ip18' || device === 'ip18max') ? [{ id: 'sim', group: 'device' as const, section: 'finish', label: 'Finish › SIM tray', meta: 'TOGGLE' as const, run: () => setOpts(o => ({ ...o, simTray: !o.simTray })) }] : []),
    ...(sbSize ? [{ id: 'sb', group: 'device' as const, section: 'statusbar', label: 'Status bar › Show status bar', meta: 'TOGGLE' as const, run: () => setSbOn(v => !v) }] : []),
    ...(handOk ? HAND_POSES.map(([k, l]) => ({ id: `pose-${k}`, group: 'device' as const, section: 'hand', label: `Hand › ${isGesture(k) ? 'Gesture' : 'Grip'} › ${l}`, meta: (hands.pose === k ? 'CURRENT' : 'APPLY') as Cmd['meta'], run: () => setHands(h => ({ ...h, pose: k })) })) : []),
    ...(handOk ? tones.map(([k, t]) => ({ id: `tone-${k}`, group: 'device' as const, section: 'hand', label: `Hand › Skin tone › ${t.label}`, meta: 'APPLY' as const, run: () => setHands(h => ({ ...h, tone: k })) })) : []),
    ...(def.foldable ? [{ id: 'fold-in', group: 'device' as const, section: 'fold', label: 'Fold › Open (inner screen)', meta: 'APPLY' as const, run: () => { stopFold(false); foldTo('inner') } },
      { id: 'fold-out', group: 'device' as const, section: 'fold', label: 'Fold › Close (outer screen)', meta: 'APPLY' as const, run: () => { stopFold(false); foldTo('outer') } }] : []),
    { id: 'violet', group: 'scene', section: 'preset', label: 'Preset › Violet silhouette', meta: 'APPLY', run: violetScene },
    { id: 'photo', group: 'scene', section: 'style', label: 'Style › Photo', meta: style === 'photo' ? 'CURRENT' : 'APPLY', run: () => setStyle('photo') },
    { id: 'sketch', group: 'scene', section: 'style', label: 'Style › Sketch', meta: sketch ? 'CURRENT' : 'APPLY', run: () => { setStyle('sketch'); setBgMode('solid'); setBg1(SKETCH_PAPER); setTransparent(false) } },
    { id: 'transp', group: 'scene', section: 'background', label: 'Background › Transparent', meta: 'TOGGLE', run: () => setTransparent(v => !v) },
    ...(['solid', 'gradient', 'streaks'] as const).map(m => ({ id: `bg-${m}`, group: 'scene' as const, section: 'background', label: `Background › ${m[0].toUpperCase() + m.slice(1)}`, meta: 'APPLY' as const, run: () => { setTransparent(false); setBgMode(m) } })),
    ...VIEW_PRESETS.map(([n, p]) => ({ id: `view-${n}`, group: 'scene' as const, section: 'camera', label: `Camera › View › ${n}`, meta: 'APPLY' as const, run: () => goView(p) })),
    { id: 'hero', group: 'scene', section: 'camera', label: 'Camera › Apple hero angle', meta: 'APPLY', run: () => setPose(APPLE_HERO) },
    { id: 'resetcam', group: 'scene', section: 'camera', label: 'Camera › Reset camera', meta: 'APPLY', run: () => setPose(POSE) },
    ...([['soft', 'Soft studio'], ['apple', 'Apple studio'], ['violet', 'Violet rim']] as const).map(([k, l]) => ({ id: `light-${k}`, group: 'scene' as const, section: 'lighting', label: `Lighting › ${l}`, meta: (light.preset === k ? 'CURRENT' : 'APPLY') as Cmd['meta'], run: () => setLight(x => ({ ...x, preset: k })) })),
    { id: 'shadow', group: 'scene', section: 'lighting', label: 'Lighting › Floor shadow', meta: 'TOGGLE', run: () => setLight(x => ({ ...x, shadowOn: !x.shadowOn })) },
    { id: 'dof', group: 'scene', section: 'effects', label: 'Effects › Depth of field', meta: 'TOGGLE', run: () => setFx(x => ({ ...x, dof: !x.dof })) },
    { id: 'bloom', group: 'scene', section: 'effects', label: 'Effects › Soft bloom', meta: 'TOGGLE', run: () => setFx(x => ({ ...x, bloom: !x.bloom })) },
    { id: 'grain', group: 'scene', section: 'effects', label: 'Effects › Film grain', meta: 'TOGGLE', run: () => setFx(x => ({ ...x, grain: !x.grain })) },
    { id: 'png', group: 'view', label: 'Export › PNG', meta: 'APPLY', run: exportPng },
    { id: 'svg', group: 'view', label: 'Export › SVG', meta: 'APPLY', run: exportSvg },
    { id: 'video', group: 'view', label: 'Export › Video', meta: 'APPLY', run: () => tlApi.current?.record() },
    { id: 'kf', group: 'view', label: 'Timeline › Add keyframe', meta: 'APPLY', run: () => tlApi.current?.add() },
    { id: 'tl', group: 'view', label: 'Timeline › Expand or minimise (T)', meta: 'TOGGLE', run: toggleTimeline },
    { id: 'orbit', group: 'view', label: 'View › Orbit tool', meta: 'APPLY', run: () => setNavMode('orbit') },
    { id: 'pan', group: 'view', label: 'View › Pan tool', meta: 'APPLY', run: () => setNavMode('pan') },
    { id: 'resetview', group: 'view', label: 'View › Reset view', meta: 'APPLY', run: () => setPose(POSE) },
  ]

  const tools = <div className="om-tools" role="group" aria-label="View tools">
    <button className={`om-ibtn ${navMode === 'orbit' ? 'on' : ''}`} aria-label="Orbit" aria-pressed={navMode === 'orbit'} title="Orbit: drag to turn the device" onClick={() => setNavMode('orbit')}><Icon name="orbit" size={16} /></button>
    <button className={`om-ibtn ${navMode === 'pan' ? 'on' : ''}`} aria-label="Pan" aria-pressed={navMode === 'pan'} title="Pan: drag to move the device (or right-drag, or Shift-drag)" onClick={() => setNavMode('pan')}><Icon name="pan" size={16} /></button>
    <button className="om-ibtn" aria-label="Reset view" title="Reset view" onClick={() => setPose(POSE)}><Icon name="reset" size={16} /></button>
  </div>
  const exportMenu = (close: () => void) => <>
    <h3>Image</h3>
    <div className="seg" role="group" aria-label="Scale">{[1, 2, 4].map(s => <button key={s} className={s === scale ? 'on' : ''} aria-pressed={s === scale} onClick={() => setScale(s)}>{s}x</button>)}</div>
    <div className="om-tiles"><button className="om-primary" role="menuitem" onClick={() => { close(); exportPng() }}>Export PNG</button><button role="menuitem" onClick={() => { close(); exportSvg() }}>Export SVG</button></div>
    <p className="hint">Longest edge is capped at 4096 px.{ai.url ? ' PNG saves the photoreal picture.' : ''}</p>
    <hr />
    <h3>Video</h3>
    <div className="seg" role="group" aria-label="Frame rate">{([30, 60] as const).map(f => <button key={f} className={tlInfo.fps === f ? 'on' : ''} aria-pressed={tlInfo.fps === f} onClick={() => tlApi.current?.setFps(f)}>{f} fps</button>)}</div>
    <div className="seg" role="group" aria-label="Video format"><button className={tlInfo.fmtOut === 'webm' ? 'on' : ''} onClick={() => tlApi.current?.setFmtOut('webm')}>WebM</button>{tlInfo.mp4ok && <button className={tlInfo.fmtOut === 'mp4' ? 'on' : ''} onClick={() => tlApi.current?.setFmtOut('mp4')}>MP4</button>}</div>
    <button role="menuitem" disabled={tlInfo.rec || tlInfo.keys < 2} onClick={() => { close(); tlApi.current?.record() }}>{tlInfo.rec ? 'Recording…' : 'Export video'}</button>
    {tlInfo.keys < 2 && <p className="hint">Add at least two keyframes on the timeline to export a video.</p>}
    {handOk && hands.pose !== 'off' && <><hr /><h3>Photoreal hands</h3><button role="menuitem" onClick={() => { close(); exportAiPasses() }}>Export for AI hands</button></>}
    <p className="om-status" role="status">{status}</p>
  </>

  return (
    <div className="app om">
      <input ref={fileInput} type="file" accept="image/*,video/*,.svg" hidden onChange={e => { const f = e.target.files?.[0]; if (f) loadFile(f, undefined, target); e.target.value = '' }} />
      <main className={`stage ${transparent ? 'checker' : ''} ${dragging ? 'drag' : ''}`} style={{ background: bgCss, left: insets[0], right: insets[1], cursor: navMode === 'pan' ? 'move' : undefined }}
        onDragOver={e => { e.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) loadFile(f, device === 'duo' ? `Dropped onto the ${target} screen` : 'Dropped onto screen', target); else flash('That drop had no file. Drag in an image or video file.', true) }}
        onContextMenu={e => e.preventDefault()}
        onPointerDown={e => {
          tap.current = null
          if (sceneHit.current) { sceneHit.current = false; return }
          if (e.button !== 0 && e.button !== 2) return
          tap.current = { x: e.clientX, y: e.clientY }
          ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
          drag.current = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey || navMode === 'pan' }
        }}
        onPointerMove={e => {
          const d = drag.current; if (!d) return
          const dx = e.clientX - d.x, dy = e.clientY - d.y; d.x = e.clientX; d.y = e.clientY
          setPose(p => d.pan
            ? { ...p, panX: clamp(p.panX + dx * 0.004 / p.zoom, -1.5, 1.5), panY: clamp(p.panY - dy * 0.004 / p.zoom, -1.5, 1.5) }
            : { ...p, tiltY: wrap(p.tiltY + dx * 0.4), tiltX: clamp(p.tiltX + dy * 0.4, -90, 90) })
        }}
        onPointerUp={e => {
          drag.current = null; (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId)
          // a click on the empty viewport (no drag, not on the device) closes the floating peeks
          const t = tap.current; tap.current = null
          if (t && Math.hypot(e.clientX - t.x, e.clientY - t.y) < 4) chromeApi.current?.closeFloating()
        }}
        onWheel={e => { const k = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)); setPose(p => ({ ...p, zoom: clamp(p.zoom * k, 0.5, 2.5) })) }}>
        <div className="om-floor" aria-hidden="true" />
        <ErrorBoundary label="3D preview" onRetry={retryEnvironment}>
        <Canvas shadows gl={{ alpha: true, preserveDrawingBuffer: true, antialias: true, toneMapping: THREE.NeutralToneMapping, toneMappingExposure: 1 }} camera={{ fov: 30, position: [0, 0, 4.2] }}
          onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}>
          <GLGrab onReady={useCallback(s => { three.current = s }, [])} />
          <Rig zoom={pose.zoom} fov={pose.fov} />
          <TimelineDriver group={devGroup} onCommit={tlCommit} onSide={tlSide} />
          {!sketch && <Env intensity={apple ? 0.75 * lift : violet ? 0.35 : light.env} mode={light.preset === 'violet' ? 'apple' : light.preset} />}
          {violet ? <>
            {/* Violet rim: dim violet fill, a soft key on the screen, two lavender rims behind for the silhouette edge. */}
            <ambientLight color="#6f5bd6" intensity={0.12} />
            <directionalLight position={[lx, ly, lz]} intensity={light.intensity * 0.15} castShadow />
            <rectAreaLight args={['#ffffff', 0.5 * light.intensity, 2, 3]} position={[-1.2, 1.2, 3]} onUpdate={l => l.lookAt(0, 0, 0)} />
            <rectAreaLight args={['#e2d8ff', 4 * light.intensity, 0.4, 4]} position={[2.4, 0.6, -1.8]} onUpdate={l => l.lookAt(0, 0, 0)} />
            <rectAreaLight args={['#b9a6ff', 1.8 * light.intensity, 0.4, 4]} position={[-2.4, 1.2, -1.6]} onUpdate={l => l.lookAt(0, 0, 0)} />
            <rectAreaLight args={['#c8b8ff', 1.2 * light.intensity, 3, 0.5]} position={[0.5, -2.6, -1]} onUpdate={l => l.lookAt(0, 0, 0)} />
          </> : apple ? <>
            {/* Apple studio: almost no fill, two tall rim strips behind and a narrow key, so edges carry the highlights. */}
            <ambientLight intensity={0.04 * lift} />
            <directionalLight position={[lx, ly, lz]} intensity={light.intensity * 0.2} castShadow />
            <rectAreaLight args={['#ffffff', 1.6 * lift * light.intensity, 0.25, 4]} position={[-2.6, 0.4, -1.6]} onUpdate={l => l.lookAt(0, 0, 0)} />
            <rectAreaLight args={['#ffffff', 1.6 * lift * light.intensity, 0.25, 4]} position={[2.6, 0.4, -1.6]} onUpdate={l => l.lookAt(0, 0, 0)} />
            <rectAreaLight args={['#ffffff', 0.8 * lift * light.intensity, 0.4, 3]} position={[-2.2, 1.8, 2.4]} onUpdate={l => l.lookAt(0, 0, 0)} />
          </> : <>
            <ambientLight intensity={0.35 + light.intensity * 0.15} />
            <directionalLight position={[lx, ly, lz]} intensity={light.intensity * 0.6} castShadow />
          {/* Softboxes: a large key above left, a tall strip on each side for the rolling edge highlights, a top fill. */}
            <rectAreaLight args={['#ffffff', 1.3 * light.intensity, 3, 2.2]} position={[-2.4, 2.2, 2.6]} onUpdate={l => l.lookAt(0, 0, 0)} />
            <rectAreaLight args={['#ffffff', 1.0 * light.intensity, 0.6, 3.5]} position={[2.8, 0.3, 0.6]} onUpdate={l => l.lookAt(0, 0, 0)} />
            <rectAreaLight args={['#ffffff', 0.9 * light.intensity, 0.6, 3.5]} position={[-2.8, 0.3, -0.8]} onUpdate={l => l.lookAt(0, 0, 0)} />
            <rectAreaLight args={['#f4f6ff', 0.6 * light.intensity, 3, 1.2]} position={[0, 3, -1.5]} onUpdate={l => l.lookAt(0, 0, 0)} />
          </>}
          <group ref={devGroup} position={devPos} rotation={devRot}>
            <Centred off={device === 'duo'} deps={[device, ...(device === 'duo' ? [] : [opts.fold, opts.screen]), screenTex.texture, hands.pose]}>
              <HandRig pose={hands.pose} tone={hands.tone} spectral={spectral} fit={HAND_FITS[device] ?? null} gesture={gesture} onGesture={setGesture} rot={handRot} idle={idle}>
                <SketchStyle on={sketch} o={sk}><D texture={screenTex.texture} mediaAspect={screenTex.aspect ?? screenAspect} opts={devOpts}
                  {...(device === 'duo' ? { textureOuter: shownOuter?.texture ?? null, mediaAspectOuter: shownOuter?.aspect } : {})} /></SketchStyle>
              </HandRig>
            </Centred>
          </group>
          {light.shadowOn && light.shadow > 0 && (() => {
            // light.floor is the phone's height above the floor in cm (0.1 units per cm, phone about 1.6 units tall).
            // The floor plane stays where it is so it stays in frame at any height; the shadow is shaped as if the
            // phone were that high: softer, larger and fainter as it rises. 1.5 cm gives the original look.
            const d = 0.95, k = (0.8 + light.floor / 10) / 0.95
            const base = sketch ? { color: SKETCH_SHADOW, opacity: light.shadow * 0.6, blur: 3 } : { color: '#000000', opacity: light.shadow, blur: 2.6 }
            return <ContactShadows position={[pose.panX, pose.panY - d, 0]} color={base.color} opacity={base.opacity / k}
              scale={6 * (1 + (k - 1) * 0.6)} blur={base.blur * Math.pow(k, 1.2)} far={2.5} resolution={1024} frames={Infinity} />
          })()}
          {!transparent && <SceneBg mode={bgMode} c1={bg1} c2={bg2} angle={angle} />}
          {(fx.dof || fx.bloom || fx.grain || !transparent) && (
            <EffectComposer multisampling={4}>
              {/* Ambient occlusion at part junctions (lens rings, buttons, plateau). Radius in scene units, 0.025 = 2.5 mm. */}
              <>{/* off with Spectral hands: their depth (needed for the outline) made the AO paint faceted dark patches through the clear hand */}
              {!transparent && !sketch && !(hands.pose !== 'off' && hands.tone === 'spectral') && <N8AO halfRes aoRadius={0.025} distanceFalloff={0.3} intensity={2.2} color="#000" />}</>
              <>{fx.dof && <DepthOfField target={[pose.panX, pose.panY, fx.focus]} focalLength={0.12} bokehScale={fx.blur} />}</>
              <>{fx.bloom && <Bloom intensity={0.2} luminanceThreshold={0.95} mipmapBlur />}</>
              <>{fx.grain && <Noise opacity={0.06} premultiply />}</>
            </EffectComposer>)}
        </Canvas>
        </ErrorBoundary>
        {ai.url && <img className="ai-overlay" src={ai.url} alt="" />}
        {dragging && <div className="dropnote">Drop to use as the screen</div>}
        {toast && <div className="toast" role="status" style={{ position: 'absolute', left: '50%', bottom: 24, transform: 'translateX(-50%)', padding: '8px 14px', borderRadius: 8,
          background: toast.error ? 'rgba(192,57,43,0.92)' : 'rgba(29,29,31,0.85)', color: '#fff', font: '13px -apple-system, system-ui, sans-serif', pointerEvents: 'none', maxWidth: 420, textAlign: 'center' }}>{toast.text}</div>}
      </main>
      <Chrome apiRef={chromeApi} sections={sections} commands={commands} deviceName={def.label} tools={tools} exportMenu={exportMenu} onInsets={onInsets} toggleTimeline={toggleTimeline}
        timeline={<Timeline snapshot={tlSnapshot} apply={tlApply} canvas={() => document.querySelector('.stage canvas')} transparent={transparent} flash={flash}
          duo={device === 'duo'} duoScreen={opts.screen === 'outer' ? 'outer' : 'inner'} current={t => (t === 'outer' ? mediaOuter ?? media : media)}
          open={tlOpen} setOpen={setTlOpen} api={tlApi} onInfo={setTlInfo} />} />
    </div>
  )
}
