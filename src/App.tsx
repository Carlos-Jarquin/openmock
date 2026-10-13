import { useCallback, useEffect, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { ContactShadows, Environment } from '@react-three/drei'
import { EffectComposer, DepthOfField, Bloom, Noise } from '@react-three/postprocessing'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { DEVICES } from './devices'
import type { DeviceId, DeviceOptions } from './types'
import { INNER_PX, OUTER_PX } from './devices/Duo'
import { sceneHit } from './devices/shared'

type Media = { texture: THREE.Texture; aspect: number; kind: 'image' | 'video'; name: string; video?: HTMLVideoElement }
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
const wrap = (v: number) => ((v + 540) % 360) - 180
const POSE = { tiltX: -10, tiltY: -30, rotZ: 0, zoom: 1, panX: 0, panY: 0 }
const LIGHT = { intensity: 1.6, azimuth: 35, elevation: 45, shadow: 0.45, env: 0.6 }
const FX = { dof: false, focus: 0, blur: 2, bloom: false, grain: false }

type Grab = { gl: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.Camera; setDpr: (n: number) => void; dpr: number }
function GLGrab({ onReady }: { onReady: (s: Grab) => void }) {
  const { gl, scene, camera, setDpr, viewport } = useThree()
  useEffect(() => onReady({ gl, scene, camera, setDpr, dpr: viewport.dpr }), [gl, scene, camera, setDpr, viewport.dpr, onReady])
  return null
}

/** Studio HDRI (Poly Haven, CC0) for reflections only; the background stays our own. */
function Env({ intensity }: { intensity: number }) {
  return <Environment files="/hdri/studio_small_08_1k.hdr" environmentIntensity={intensity} />
}
void RoomEnvironment

/** Paints the background into the scene so post effects (which drop canvas transparency) keep it. */
function SceneBg({ mode, c1, c2, angle }: { mode: 'solid' | 'gradient'; c1: string; c2: string; angle: number }) {
  const { scene, size } = useThree()
  useEffect(() => {
    const w = 512, h = Math.max(1, Math.round(512 * size.height / size.width))
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h
    const ctx = cv.getContext('2d')!
    if (mode === 'solid') ctx.fillStyle = c1
    else {
      const a = (angle - 90) * Math.PI / 180, cx = w / 2, cy = h / 2
      const len = Math.abs(w * Math.cos(a)) / 2 + Math.abs(h * Math.sin(a)) / 2
      const g = ctx.createLinearGradient(cx - Math.cos(a) * len, cy - Math.sin(a) * len, cx + Math.cos(a) * len, cy + Math.sin(a) * len)
      g.addColorStop(0, c1); g.addColorStop(1, c2); ctx.fillStyle = g
    }
    ctx.fillRect(0, 0, w, h)
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace
    scene.background = t
    return () => { scene.background = null; t.dispose() }
  }, [scene, size.width, size.height, mode, c1, c2, angle])
  return null
}

/** Turn an uploaded SVG or PNG into a greyscale mask (white = artwork) for the embossed logo. */
function loadLogo(file: File): Promise<{ mask: THREE.Texture; aspect: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const iw = img.naturalWidth || 512, ih = img.naturalHeight || 512
      const k = 1024 / Math.max(iw, ih), w = Math.round(iw * k), h = Math.round(ih * k)
      const c = document.createElement('canvas'); c.width = w; c.height = h
      const ctx = c.getContext('2d')!; ctx.drawImage(img, 0, 0, w, h)
      const d = ctx.getImageData(0, 0, w, h)
      let opaque = 0
      for (let i = 3; i < d.data.length; i += 4) if (d.data[i] > 250) opaque++
      const hasAlpha = opaque < (w * h) * 0.98
      for (let i = 0; i < d.data.length; i += 4) {
        const lum = (d.data[i] * 0.3 + d.data[i + 1] * 0.59 + d.data[i + 2] * 0.11)
        const v = hasAlpha ? d.data[i + 3] : 255 - lum   // no alpha: dark art on light background
        d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255
      }
      ctx.putImageData(d, 0, 0)
      const t = new THREE.CanvasTexture(c); t.anisotropy = 8
      resolve({ mask: t, aspect: w / h })
    }
    img.onerror = reject
    img.src = URL.createObjectURL(file)
  })
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
    const box = new THREE.Box3().setFromObject(g, true)
    parent.matrixWorld.copy(saved)
    if (!box.isEmpty()) { const c = box.getCenter(new THREE.Vector3()); g.position.set(-c.x, -c.y, -c.z) }
    dirty.current = false
  })
  return <group ref={inner}>{children}</group>
}

function Rig({ zoom }: { zoom: number }) {
  const { camera } = useThree()
  useEffect(() => { camera.position.set(0, 0, 4.2 / zoom); camera.lookAt(0, 0, 0) }, [zoom, camera])
  return null
}

export default function App() {
  const [device, setDevice] = useState<DeviceId>('ip18')
  const [opts, setOpts] = useState<DeviceOptions>({ fold: 130, screen: 'inner', finish: 'silver', logo: null, logoSize: 0.15, logoTint: '#8a8f99', simTray: true })
  const [media, setMedia] = useState<Media | null>(null)
  const [pose, setPose] = useState(POSE)
  const [light, setLight] = useState(LIGHT)
  const [fx, setFx] = useState(FX)
  const [bgMode, setBgMode] = useState<'solid' | 'gradient'>('gradient')
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
    ;(async () => {
      for (const name of ['logo.svg', 'logo.png']) {
        try {
          const r = await fetch(`/local/${name}`)
          const type = r.headers.get('content-type') ?? ''
          if (!r.ok || !type.startsWith('image/')) continue // Vite serves index.html for missing files
          const logo = await loadLogo(new File([await r.blob()], name, { type }))
          if (live) setOpts(o => (o.logo ? o : { ...o, logo }))
          return
        } catch { /* try the next one */ }
      }
    })()
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

  const exportPng = async () => {
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
    if (!transparent) {
      if (bgMode === 'solid') ctx.fillStyle = bg1
      else {
        const a = (angle - 90) * Math.PI / 180, cx = w / 2, cy = h / 2
        const len = Math.abs(w * Math.cos(a)) / 2 + Math.abs(h * Math.sin(a)) / 2
        const g = ctx.createLinearGradient(cx - Math.cos(a) * len, cy - Math.sin(a) * len, cx + Math.cos(a) * len, cy + Math.sin(a) * len)
        g.addColorStop(0, bg1); g.addColorStop(1, bg2); ctx.fillStyle = g
      }
      ctx.fillRect(0, 0, w, h)
    }
    ctx.drawImage(gl.domElement, 0, 0)
    t.setDpr(prev)
    const a = document.createElement('a'); a.download = `openmock-${w}x${h}.png`; a.href = out.toDataURL('image/png'); a.click()
    setStatus(`Exported ${w} × ${h} PNG.`)
  }

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
          {device === 'ip18' && <>
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
        <section><h2>Camera</h2>
          {slider('Tilt X', pose.tiltX, -90, 90, 1, n => setPose({ ...pose, tiltX: n }), '°')}
          {slider('Tilt Y', pose.tiltY, -180, 180, 1, n => setPose({ ...pose, tiltY: n }), '°')}
          {slider('Rotate', pose.rotZ, -45, 45, 1, n => setPose({ ...pose, rotZ: n }), '°')}
          {slider('Zoom', pose.zoom, 0.5, 2.5, 0.01, n => setPose({ ...pose, zoom: n }))}
          {slider('Pan X', pose.panX, -1.5, 1.5, 0.01, n => setPose({ ...pose, panX: n }))}
          {slider('Pan Y', pose.panY, -1.5, 1.5, 0.01, n => setPose({ ...pose, panY: n }))}
          <button className="ghost" onClick={() => setPose(POSE)}>Reset camera</button>
        </section>
        <section><h2>Background</h2>
          <label className="check"><input type="checkbox" checked={transparent} onChange={e => setTransparent(e.target.checked)} /> Transparent</label>
          {!transparent && <>
            <div className="seg"><button className={bgMode === 'solid' ? 'on' : ''} onClick={() => setBgMode('solid')}>Solid</button><button className={bgMode === 'gradient' ? 'on' : ''} onClick={() => setBgMode('gradient')}>Gradient</button></div>
            <label className="row"><span>Colour 1</span><input type="color" value={bg1} onChange={e => setBg1(e.target.value)} /><input className="hex" value={bg1} onChange={e => setBg1(e.target.value)} /></label>
            {bgMode === 'gradient' && <>
              <label className="row"><span>Colour 2</span><input type="color" value={bg2} onChange={e => setBg2(e.target.value)} /><input className="hex" value={bg2} onChange={e => setBg2(e.target.value)} /></label>
              {slider('Angle', angle, 0, 360, 1, setAngle, '°')}
            </>}
          </>}
        </section>
        <section><h2>Lighting</h2>
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
        <Canvas shadows gl={{ alpha: true, preserveDrawingBuffer: true, antialias: true }} camera={{ fov: 30, position: [0, 0, 4.2] }}
          onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}>
          <GLGrab onReady={useCallback(s => { three.current = s }, [])} />
          <Rig zoom={pose.zoom} />
          <Env intensity={light.env} />
          <ambientLight intensity={0.35 + light.intensity * 0.15} />
          <directionalLight position={[lx, ly, lz]} intensity={light.intensity} castShadow />
          <group position={[pose.panX, pose.panY, 0]} rotation={[deg(pose.tiltX), deg(pose.tiltY), deg(pose.rotZ)]}>
            <Centred deps={[device, opts.fold, opts.screen, media?.texture]}>
              <D texture={media?.texture ?? null} mediaAspect={media?.aspect ?? screenAspect} opts={opts} />
            </Centred>
          </group>
          {light.shadow > 0 && <ContactShadows position={[pose.panX, pose.panY - 0.95, 0]} opacity={light.shadow} scale={6} blur={2.6} far={2.5} resolution={1024} frames={Infinity} />}
          {(fx.dof || fx.bloom || fx.grain) && !transparent && <SceneBg mode={bgMode} c1={bg1} c2={bg2} angle={angle} />}
          {(fx.dof || fx.bloom || fx.grain) && (
            <EffectComposer multisampling={4}>
              <>{fx.dof && <DepthOfField target={[pose.panX, pose.panY, fx.focus]} focalLength={0.12} bokehScale={fx.blur} />}</>
              <>{fx.bloom && <Bloom intensity={0.2} luminanceThreshold={0.95} mipmapBlur />}</>
              <>{fx.grain && <Noise opacity={0.06} premultiply />}</>
            </EffectComposer>)}
        </Canvas>
        {dragging && <div className="dropnote">Drop to use as the screen</div>}
      </main>
    </div>
  )
}
