import { useCallback, useEffect, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { ContactShadows } from '@react-three/drei'
import { EffectComposer, DepthOfField, Bloom, Noise, N8AO } from '@react-three/postprocessing'
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js'
RectAreaLightUniformsLib.init()
import * as THREE from 'three'
import { DEVICES } from './devices'
import type { DeviceId, DeviceOptions } from './types'
import { INNER_PX, OUTER_PX } from './devices/Duo'
import { sceneHit } from './devices/shared'
import { ErrorBoundary } from './ErrorBoundary'
import { loadLogo, loadLocalLogo } from './localLogo'
import { Env, retryEnvironment } from './Env'
import { renderPasses, runComfy, composite, downloadPasses, comfyReachable, type Guide } from './hands/aiHands'
import { HandRig, HAND_POSES, SKIN_TONES, type HandFit, type HandPose } from './hands/Hands'
import { IPHONE_18_PRO, IPHONE_18_PRO_MAX } from './devices/iphoneSpecs'
import { SketchStyle, SKETCH_DEFAULTS, SKETCH_PAPER } from './sketch/Sketch'

type Media = { texture: THREE.Texture; aspect: number; kind: 'image' | 'video'; name: string; video?: HTMLVideoElement }
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
const wrap = (v: number) => ((v + 540) % 360) - 180
const POSE = { tiltX: -10, tiltY: -30, rotZ: 0, zoom: 1, panX: 0, panY: 0, fov: 30 }
/** Apple hero: back three-quarter view fitted to Apple's iPhone 18 Pro colour shots. */
const APPLE_HERO = { tiltX: -18.438, tiltY: 230.375, rotZ: -3.125, zoom: 1.937, panX: 0.347, panY: -0.307, fov: 21.375 }
type LightPreset = 'soft' | 'apple' | 'violet'
type BgMode = 'solid' | 'gradient' | 'streaks'
const LIGHT = { preset: 'soft' as LightPreset, intensity: 1.6, azimuth: 35, elevation: 45, shadow: 0.45, env: 0.6 }
// Device bodies the hands can grip, in model units (1 = 100 mm).
const fitOf = (s: typeof IPHONE_18_PRO): HandFit => ({ W: s.body.w / 100, H: s.body.h / 100, T: s.body.t / 100, R: s.body.cornerR / 100, E: s.body.edge / 100 })
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

const FX = { dof: false, focus: 0, blur: 2, bloom: false, grain: false }

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
function Centred({ deps, children }: { deps: unknown[]; children: React.ReactNode }) {
  const inner = useRef<THREE.Group>(null)
  const dirty = useRef(true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { dirty.current = true }, deps)
  useFrame(() => {
    const g = inner.current; if (!g || !dirty.current) return
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
  const [device, setDevice] = useState<DeviceId>('ip18')
  const [opts, setOpts] = useState<DeviceOptions>({ fold: 130, screen: 'inner', finish: 'silver', logo: null, logoSize: 0.16, logoTint: '#8a8f99', simTray: true })
  const [media, setMedia] = useState<Media | null>(null)
  const [pose, setPose] = useState(POSE)
  const [light, setLight] = useState(LIGHT)
  const [fx, setFx] = useState(FX)
  const [style, setStyle] = useState<'photo' | 'sketch'>('photo')
  const [sk, setSk] = useState(SKETCH_DEFAULTS)
  const sketch = style === 'sketch'
  const [hands, setHands] = useState<{ pose: HandPose; tone: string }>({ pose: 'off', tone: 'fair' })
  // AI hands: the finished picture (object URL) sits over the canvas until anything in the scene changes.
  const [ai, setAi] = useState<{ guide: Guide; shadows: boolean; busy: boolean; url: string | null }>({ guide: 'depth', shadows: false, busy: false, url: null })
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1e9))
  const [seedLock, setSeedLock] = useState(false)
  const aiAbort = useRef<AbortController | null>(null)
  const [bgMode, setBgMode] = useState<BgMode>('gradient')
  const [bg1, setBg1] = useState('#dfe7ff')
  const [bg2, setBg2] = useState('#f7d9e8')
  const [angle, setAngle] = useState(135)
  const [transparent, setTransparent] = useState(false)
  const [scale, setScale] = useState(2)
  const [dragging, setDragging] = useState(false)
  const [status, setStatus] = useState('Drop, paste or choose an image or video to start.')
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

  const loadFile = useCallback((file: File) => {
    const url = URL.createObjectURL(file)
    if (file.type.startsWith('video/')) {
      const v = document.createElement('video')
      v.src = url; v.loop = true; v.muted = true; v.playsInline = true; v.crossOrigin = 'anonymous'
      v.onloadeddata = () => {
        const t = new THREE.VideoTexture(v); t.colorSpace = THREE.SRGBColorSpace
        v.play().catch(() => {})
        setMedia(m => { m?.video?.pause(); m?.texture.dispose(); return { texture: t, aspect: v.videoWidth / v.videoHeight, kind: 'video', name: file.name, video: v } })
        setStatus(`Loaded video: ${file.name}`)
      }
    } else if (file.type.startsWith('image/')) {
      new THREE.TextureLoader().load(url, t => {
        t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8
        const img = t.image as HTMLImageElement
        setMedia(m => { m?.video?.pause(); m?.texture.dispose(); return { texture: t, aspect: img.width / img.height, kind: 'image', name: file.name } })
        setStatus(`Loaded image: ${file.name}`)
      })
    } else setStatus('That file type is not supported. Use an image or a video.')
  }, [])

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const f = Array.from(e.clipboardData?.files ?? [])[0]
      if (f) { e.preventDefault(); loadFile(f) }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [loadFile])

  const bgCss = transparent ? undefined : bgMode === 'solid' ? bg1 : `linear-gradient(${angle}deg, ${bg1}, ${bg2})`

  // Any change to the scene makes the AI picture stale, so drop it.
  useEffect(() => { setAi(a => { if (a.url) URL.revokeObjectURL(a.url); return a.url ? { ...a, url: null } : a }) },
    [device, opts, media, pose, light, fx, hands, bgMode, bg1, bg2, angle, transparent, style, sk])
  const makePhotoreal = async () => {
    const t = three.current; if (!t || ai.busy) return
    if (!(await comfyReachable())) { setStatus('ComfyUI is not running. Start it on port 8188, then try again.'); return }
    const ctl = new AbortController(); aiAbort.current = ctl
    const runSeed = seedLock ? seed : Math.floor(Math.random() * 1e9)
    setSeed(runSeed)
    setAi(a => ({ ...a, busy: true }))
    try {
      await new Promise(r => requestAnimationFrame(r))
      const passes = await renderPasses(t, hands.tone)
      const res = await runComfy(passes, { guide: ai.guide, seed: runSeed, onStatus: setStatus, signal: ctl.signal })
      const out = composite(passes, res, { shadows: ai.shadows, silhouette: hands.tone === 'silhouette' })
      const url = URL.createObjectURL(await new Promise<Blob>(r => out.toBlob(b => r(b!), 'image/png')))
      setAi(a => { if (a.url) URL.revokeObjectURL(a.url); return { ...a, busy: false, url } })
      setStatus(`Photoreal hands ready at ${passes.w} × ${passes.h}. Export PNG saves this picture. Change anything to go back to 3D.`)
    } catch (e) {
      setAi(a => ({ ...a, busy: false })); setStatus(e instanceof Error ? e.message : 'Something went wrong with ComfyUI.')
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
  if (import.meta.env.DEV) (window as unknown as { __omSet: unknown }).__omSet = { setPose, setLight, setBg1, setBgMode, violetScene, setStyle, setSk, setOpts, setDevice }
  const lx = Math.cos(light.elevation * Math.PI / 180) * Math.sin(light.azimuth * Math.PI / 180) * 5
  const ly = Math.sin(light.elevation * Math.PI / 180) * 5
  const lz = Math.cos(light.elevation * Math.PI / 180) * Math.cos(light.azimuth * Math.PI / 180) * 5
  const D = def.Component
  const deg = THREE.MathUtils.degToRad

  const slider = (label: string, v: number, min: number, max: number, step: number, set: (n: number) => void, unit = '') => (
    <label className="row"><span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={v} onChange={e => set(+e.target.value)} />
      <output>{Number.isInteger(step) ? v : v.toFixed(2)}{unit}</output></label>)

  return (
    <div className="app">
      <aside className="panel">
        <h1>Openmock</h1>
        <section><h2>Media</h2>
          <button onClick={() => fileInput.current?.click()}>Choose image or video</button>
          <input ref={fileInput} type="file" accept="image/*,video/*" hidden onChange={e => e.target.files?.[0] && loadFile(e.target.files[0])} />
          <p className="hint">{media ? media.name : 'You can also drag a file in or paste with Cmd+V.'}</p>
        </section>
        <section><h2>Scenes</h2>
          <button onClick={violetScene}>Violet silhouette</button>
          <p className="hint">A dark hand holds the phone up against a violet backdrop with light streaks. Change the colours under Background.</p>
        </section>
        <section><h2>Style</h2>
          <div className="seg"><button className={!sketch ? 'on' : ''} onClick={() => setStyle('photo')}>Photo</button>
            <button className={sketch ? 'on' : ''} onClick={() => { setStyle('sketch'); setBgMode('solid'); setBg1(SKETCH_PAPER); setTransparent(false) }}>Sketch</button></div>
          {sketch && <>
            <label className="row"><span>Line colour</span><input type="color" value={sk.line} onChange={e => setSk({ ...sk, line: e.target.value })} /><input className="hex" value={sk.line} onChange={e => setSk({ ...sk, line: e.target.value })} /></label>
            <label className="row"><span>Body colour</span><input type="color" value={sk.fill} onChange={e => setSk({ ...sk, fill: e.target.value })} /><input className="hex" value={sk.fill} onChange={e => setSk({ ...sk, fill: e.target.value })} /></label>
            {slider('Outer lines', sk.outer, 0, 8, 0.1, n => setSk({ ...sk, outer: n }), ' px')}
            {slider('Inner lines', sk.inner, 0, 4, 0.1, n => setSk({ ...sk, inner: n }), ' px')}
            <button className="ghost" onClick={() => setSk(SKETCH_DEFAULTS)}>Reset sketch</button>
            <p className="hint">A flat illustration: cream body, soft grey shading and grey outlines. Reflections are off. Choosing Sketch sets a warm paper background, which you can change under Background.</p>
          </>}
        </section>
        <section><h2>Device</h2>
          <div className="seg">{DEVICES.map(d => <button key={d.id} className={d.id === device ? 'on' : ''} onClick={() => { setDevice(d.id); if (d.defaultFinish && !(d.finishes && opts.finish in d.finishes)) setOpts(o => ({ ...o, finish: d.defaultFinish! })) }}>{d.label}</button>)}</div>
        </section>
        {def.finishes && <section><h2>Finish</h2>
          <div className="seg">{Object.entries(def.finishes!).map(([k, v]) => <button key={k} className={opts.finish === k ? 'on' : ''} onClick={() => setOpts({ ...opts, finish: k })}>{v.label}</button>)}</div>
          <label className="row"><span>Logo</span>
            <input type="file" accept="image/svg+xml,image/png" style={{ gridColumn: 'span 2', fontSize: 11 }} onChange={async e => { const fl = e.target.files?.[0]; if (fl) setOpts({ ...opts, logo: await loadLogo(fl) }) }} /></label>
          {opts.logo && <>
            {slider('Logo size', opts.logoSize, 0.05, 0.4, 0.01, n => setOpts({ ...opts, logoSize: n }))}
            <label className="row"><span>Logo tint</span><input type="color" value={opts.logoTint} onChange={e => setOpts({ ...opts, logoTint: e.target.value })} /><button className="ghost" onClick={() => setOpts({ ...opts, logo: null })}>Clear</button></label>
          </>}
          <p className="hint">The logo sits centred on the back. Use your own SVG or PNG.</p>
          {(device === 'ip18' || device === 'ip18max') && <>
            <label className="check"><input type="checkbox" checked={opts.simTray} onChange={e => setOpts({ ...opts, simTray: e.target.checked })} /> SIM tray</label>
            <p className="hint">Click a button to press it. Click the SIM tray or its pinhole to eject it, and again to put it back.</p>
          </>}
          {def.nativePx && <p className="hint">Native size: {def.nativePx.w} × {def.nativePx.h} px. Screenshots at this size fit exactly.</p>}
        </section>}
        {def.foldable && <section><h2>iPhone Duo</h2>
          {slider('Fold', opts.fold, 0, 180, 1, n => setOpts({ ...opts, fold: n }), '°')}
          <p className="hint">180 is open flat, 0 is closed.</p>
          <div className="seg"><button className={opts.screen === 'inner' ? 'on' : ''} onClick={() => setOpts({ ...opts, screen: 'inner', fold: opts.fold < 60 ? 120 : opts.fold })}>Inner screen</button><button className={opts.screen === 'outer' ? 'on' : ''} onClick={() => setOpts({ ...opts, screen: 'outer', fold: 0 })}>Outer screen</button></div>
          <p className="hint">Native size: {opts.screen === 'inner' ? `${INNER_PX.w} × ${INNER_PX.h}` : `${OUTER_PX.w} × ${OUTER_PX.h}`} px. Screenshots at this size fit exactly.</p>
        </section>}
        <section><h2>Hands</h2>
          {HAND_FITS[device] ? <>
            <div className="seg wrap">{HAND_POSES.map(([k, l]) => <button key={k} className={hands.pose === k ? 'on' : ''} onClick={() => setHands({ ...hands, pose: k })}>{l}</button>)}</div>
            {hands.pose !== 'off' && <>
              <div className="seg wrap">{Object.entries(SKIN_TONES).map(([k, t]) => <button key={k} className={hands.tone === k ? 'on' : ''} title={t.label} onClick={() => setHands({ ...hands, tone: k })}>
                <span className="swatch" style={{ background: t.color }} />{t.label}</button>)}</div>
              <p className="hint">The hands move with the phone, so set any camera angle. Two hands turns the phone sideways.</p>
              <h3>Photoreal hands</h3>
              <div className="seg"><button className={ai.guide === 'depth' ? 'on' : ''} onClick={() => setAi({ ...ai, guide: 'depth' })}>Guide by depth</button>
                <button className={ai.guide === 'pose' ? 'on' : ''} onClick={() => setAi({ ...ai, guide: 'pose' })}>Guide by pose</button></div>
              <label className="check"><input type="checkbox" checked={ai.shadows} onChange={e => setAi({ ...ai, shadows: e.target.checked })} /> Contact shadows (darkens the phone slightly)</label>
              <div className="row"><label>Seed <input type="number" min={0} value={seed} onChange={e => setSeed(Math.max(0, Math.floor(Number(e.target.value) || 0)))} style={{ width: 110 }} /></label>
                <button className="ghost" title="Pick a new random seed" onClick={() => setSeed(Math.floor(Math.random() * 1e9))}>Randomise</button></div>
              <label className="check"><input type="checkbox" checked={seedLock} onChange={e => setSeedLock(e.target.checked)} /> Lock seed (repeat the same result)</label>
              {ai.busy ? <button onClick={() => aiAbort.current?.abort()}>Cancel</button> : <button onClick={makePhotoreal}>Make hands photoreal</button>}
              {ai.url && <button className="ghost" onClick={() => setAi(a => { URL.revokeObjectURL(a.url!); return { ...a, url: null } })}>Back to 3D hands</button>}
              <button className="ghost" onClick={exportAiPasses}>Export for AI hands</button>
              <p className="hint">Uses ComfyUI on this Mac to repaint only the hands. The phone stays exactly as rendered.</p>
            </>}
          </> : <p className="hint">Hands are available for the iPhone 18 Pro and 18 Pro Max.</p>}
        </section>
        <section><h2>Camera</h2>
          {slider('Tilt X', pose.tiltX, -90, 90, 1, n => setPose({ ...pose, tiltX: n }), '°')}
          {slider('Tilt Y', pose.tiltY, -180, 180, 1, n => setPose({ ...pose, tiltY: n }), '°')}
          {slider('Rotate', pose.rotZ, -45, 45, 1, n => setPose({ ...pose, rotZ: n }), '°')}
          {slider('Zoom', pose.zoom, 0.5, 2.5, 0.01, n => setPose({ ...pose, zoom: n }))}
          {slider('Field of view', pose.fov, 8, 60, 1, n => setPose({ ...pose, fov: n }), '°')}
          {slider('Pan X', pose.panX, -1.5, 1.5, 0.01, n => setPose({ ...pose, panX: n }))}
          {slider('Pan Y', pose.panY, -1.5, 1.5, 0.01, n => setPose({ ...pose, panY: n }))}
          <button className="ghost" onClick={() => setPose(POSE)}>Reset camera</button>
          <button className="ghost" onClick={() => setPose(APPLE_HERO)}>Apple hero angle</button>
        </section>
        <section><h2>Background</h2>
          <label className="check"><input type="checkbox" checked={transparent} onChange={e => setTransparent(e.target.checked)} /> Transparent</label>
          {!transparent && <>
            <div className="seg"><button className={bgMode === 'solid' ? 'on' : ''} onClick={() => setBgMode('solid')}>Solid</button><button className={bgMode === 'gradient' ? 'on' : ''} onClick={() => setBgMode('gradient')}>Gradient</button><button className={bgMode === 'streaks' ? 'on' : ''} onClick={() => setBgMode('streaks')}>Streaks</button></div>
            <label className="row"><span>Colour 1</span><input type="color" value={bg1} onChange={e => setBg1(e.target.value)} /><input className="hex" value={bg1} onChange={e => setBg1(e.target.value)} /></label>
            {bgMode !== 'solid' && <>
              <label className="row"><span>Colour 2</span><input type="color" value={bg2} onChange={e => setBg2(e.target.value)} /><input className="hex" value={bg2} onChange={e => setBg2(e.target.value)} /></label>
              {slider('Angle', angle, 0, 360, 1, setAngle, '°')}
            </>}
          </>}
        </section>
        <section><h2>Lighting</h2>
          <div className="seg">{([['soft', 'Soft studio'], ['apple', 'Apple studio'], ['violet', 'Violet rim']] as const).map(([k, l]) =>
            <button key={k} className={light.preset === k ? 'on' : ''} onClick={() => setLight({ ...light, preset: k })}>{l}</button>)}</div>
          {apple && <p className="hint">Dark room with a few strip lights, like Apple's product shots. Looks best on a dark background.</p>}
          {violet && <p className="hint">Low violet fill with lavender rim lights behind, so hands read as silhouettes and the screen stays bright.</p>}
          {slider('Intensity', light.intensity, 0, 4, 0.05, n => setLight({ ...light, intensity: n }))}
          {slider('Direction', light.azimuth, -180, 180, 1, n => setLight({ ...light, azimuth: n }), '°')}
          {slider('Height', light.elevation, 5, 90, 1, n => setLight({ ...light, elevation: n }), '°')}
          {slider('Shadow', light.shadow, 0, 1, 0.01, n => setLight({ ...light, shadow: n }))}
          {slider('Reflections', light.env, 0, 2, 0.05, n => setLight({ ...light, env: n }))}
        </section>
        <section><h2>Effects</h2>
          <label className="check"><input type="checkbox" checked={fx.dof} onChange={e => setFx({ ...fx, dof: e.target.checked })} /> Depth of field</label>
          {fx.dof && <>
            {slider('Focus', fx.focus, -1.5, 1.5, 0.01, n => setFx({ ...fx, focus: n }))}
            {slider('Blur', fx.blur, 0, 10, 0.1, n => setFx({ ...fx, blur: n }))}
            <button className="ghost" onClick={() => setFx({ ...fx, focus: 0 })}>Focus on device</button>
          </>}
          <label className="check"><input type="checkbox" checked={fx.bloom} onChange={e => setFx({ ...fx, bloom: e.target.checked })} /> Soft bloom</label>
          {transparent && (fx.dof || fx.bloom || fx.grain) && <p className="hint">Effects may not keep a transparent background. Turn them off for a clean cut-out.</p>}
          <label className="check"><input type="checkbox" checked={fx.grain} onChange={e => setFx({ ...fx, grain: e.target.checked })} /> Film grain</label>
        </section>
        <section><h2>Export</h2>
          <div className="seg">{[1, 2, 4].map(s => <button key={s} className={s === scale ? 'on' : ''} onClick={() => setScale(s)}>{s}x</button>)}</div>
          <button onClick={exportPng}>Export PNG</button>
          <p className="hint">Longest edge is capped at 4096 px.</p>
        </section>
        <p className="status">{status}</p>
      </aside>
      <main className={`stage ${transparent ? 'checker' : ''} ${dragging ? 'drag' : ''}`} style={{ background: bgCss }}
        onDragOver={e => { e.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) loadFile(f) }}
        onContextMenu={e => e.preventDefault()}
        onPointerDown={e => {
          if (sceneHit.current) { sceneHit.current = false; return }
          if (e.button !== 0 && e.button !== 2) return
          ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
          drag.current = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey }
        }}
        onPointerMove={e => {
          const d = drag.current; if (!d) return
          const dx = e.clientX - d.x, dy = e.clientY - d.y; d.x = e.clientX; d.y = e.clientY
          setPose(p => d.pan
            ? { ...p, panX: clamp(p.panX + dx * 0.004 / p.zoom, -1.5, 1.5), panY: clamp(p.panY - dy * 0.004 / p.zoom, -1.5, 1.5) }
            : { ...p, tiltY: wrap(p.tiltY + dx * 0.4), tiltX: clamp(p.tiltX + dy * 0.4, -90, 90) })
        }}
        onPointerUp={e => { drag.current = null; (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId) }}
        onWheel={e => { const k = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)); setPose(p => ({ ...p, zoom: clamp(p.zoom * k, 0.5, 2.5) })) }}>
        <ErrorBoundary label="3D preview" onRetry={retryEnvironment}>
        <Canvas shadows gl={{ alpha: true, preserveDrawingBuffer: true, antialias: true, toneMapping: THREE.NeutralToneMapping, toneMappingExposure: 1 }} camera={{ fov: 30, position: [0, 0, 4.2] }}
          onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}>
          <GLGrab onReady={useCallback(s => { three.current = s }, [])} />
          <Rig zoom={pose.zoom} fov={pose.fov} />
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
          <group position={[pose.panX, pose.panY, 0]} rotation={[deg(pose.tiltX), deg(pose.tiltY), deg(pose.rotZ)]}>
            <Centred deps={[device, opts.fold, opts.screen, media?.texture, hands.pose]}>
              <HandRig pose={hands.pose} tone={hands.tone} fit={HAND_FITS[device] ?? null}>
                <SketchStyle on={sketch} o={sk}><D texture={media?.texture ?? null} mediaAspect={media?.aspect ?? screenAspect} opts={opts} /></SketchStyle>
              </HandRig>
            </Centred>
          </group>
          {light.shadow > 0 && <ContactShadows position={[pose.panX, pose.panY - 0.95, 0]} opacity={light.shadow} scale={6} blur={2.6} far={2.5} resolution={1024} frames={Infinity} />}
          {!transparent && <SceneBg mode={bgMode} c1={bg1} c2={bg2} angle={angle} />}
          {(fx.dof || fx.bloom || fx.grain || !transparent) && (
            <EffectComposer multisampling={4}>
              {/* Ambient occlusion at part junctions (lens rings, buttons, plateau). Radius in scene units, 0.025 = 2.5 mm. */}
              <>{!transparent && !sketch && <N8AO halfRes aoRadius={0.025} distanceFalloff={0.3} intensity={2.2} color="#000" />}</>
              <>{fx.dof && <DepthOfField target={[pose.panX, pose.panY, fx.focus]} focalLength={0.12} bokehScale={fx.blur} />}</>
              <>{fx.bloom && <Bloom intensity={0.2} luminanceThreshold={0.95} mipmapBlur />}</>
              <>{fx.grain && <Noise opacity={0.06} premultiply />}</>
            </EffectComposer>)}
        </Canvas>
        </ErrorBoundary>
        {ai.url && <img className="ai-overlay" src={ai.url} alt="" />}
        {dragging && <div className="dropnote">Drop to use as the screen</div>}
      </main>
    </div>
  )
}
