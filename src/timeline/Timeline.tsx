// Keyframe timeline strip (under the viewport) and its frame-loop driver.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { foldLive } from '../devices/Duo'
import { Track, viewSpan } from './Track'
import { ScreenLane } from './ScreenLane'
import { loadClips, saveClips, screenLive, sortClips, updateScreens, type ScreenClip } from './screenTrack'
import { EASES, fmt, loadKeys, quatPose, sample, saveKeys, starts, tlLive, total, type Ease, type Frame, type KfState, type Keyframe } from './tlCore'

/** Applies the timeline to the scene every frame while it owns it: device rotation (slerp) and position, camera zoom
 *  and lens, the Duo hinge (which drives the screen dissolve), and the discrete values at segment midpoints. */
export function TimelineDriver({ group, onCommit, onSide }: { group: React.RefObject<THREE.Group | null>; onCommit: (f: Frame) => void; onSide: (inner: boolean) => void }) {
  const { camera } = useThree()
  const side = useRef<boolean | null>(null)
  const handQueued = useRef(false)
  useFrame(() => {
    const L = tlLive
    updateScreens(L.t, L.playing)
    if (!L.active) return
    const now = performance.now(), T = total(L.keys)
    if (L.playing) {
      L.t += Math.min(0.1, (now - L.last) / 1000); L.last = now
      if (L.t >= T) { if (L.loop && T > 0) L.t %= T; else { L.t = T; L.playing = false; L.pending = true; L.onEnd?.() } }
    }
    const f = sample(L.keys, L.t), g = group.current; if (!f || !g) return
    g.quaternion.copy(f.q); g.position.set(f.pan[0], f.pan[1], 0)
    const cam = camera as THREE.PerspectiveCamera
    if (cam.fov !== f.fov) { cam.fov = f.fov; cam.updateProjectionMatrix() }
    cam.position.set(0, 0, 4.2 / f.zoom * Math.tan(THREE.MathUtils.degToRad(15)) / Math.tan(THREE.MathUtils.degToRad(f.fov / 2))); cam.lookAt(0, 0, 0)
    foldLive.tl = f.fold
    // the Duo shows the inner content when open past 90 degrees, the outer when closed (both are dissolved at 90)
    if (f.fold != null) { const s = f.fold >= 90; if (s !== side.current) { side.current = s; onSide(s) } }
    if (f.disc !== L.disc) { L.disc = f.disc; L.onDisc?.(f.disc) }
    // hand updates go through React state; posting them out of the frame loop (one pending at a time, newest frame wins)
    // keeps React from counting 60 synchronous updates a second as an update loop
    if (L.onHand && !handQueued.current) { handQueued.current = true; setTimeout(() => { handQueued.current = false; const g = sample(tlLive.keys, tlLive.t); if (g) tlLive.onHand?.(g) }, 0) }
    const u = L.ui, p = T > 0 ? L.t / T : 0
    if (u.scrub) u.scrub.value = String(p * 1000)
    if (u.time) u.time.textContent = `${fmt(L.t)} / ${fmt(T)}`
    if (u.head) u.head.style.left = `${(Math.min(L.t, T) - L.view0) / (L.view || T || 1) * 100}%`
    L.log?.push(now)
    // paused or scrubbed: hand the frame back to the sliders once, then let the user drive again
    if (!L.playing && L.pending) { L.pending = false; L.active = false; foldLive.tl = null; side.current = null; onCommit(f) }
  })
  return null
}

const Ico = ({ d, title }: { d: string; title?: string }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden={!title} role={title ? 'img' : undefined} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{title && <title>{title}</title>}<path d={d} /></svg>)
const I = {
  play: 'M5 3.5v9l7-4.5z', pause: 'M5.5 3.5v9M10.5 3.5v9', loop: 'M3 7a4 4 0 0 1 4-4h5M10 1l2 2-2 2M13 9a4 4 0 0 1-4 4H4M6 15l-2-2 2-2',
  add: 'M8 3v10M3 8h10', del: 'M3.5 4.5h9M6.5 4.5V3h3v1.5M5 4.5l.6 8.5h4.8l.6-8.5', upd: 'M13 8a5 5 0 1 1-1.5-3.5M13 2.5V5h-2.5',
  left: 'M10 3.5L5.5 8l4.5 4.5', right: 'M6 3.5L10.5 8 6 12.5', rec: 'M8 8m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0', chev: 'M4 6l4 4 4-4',
  down: 'M8 2.5v8M4.5 7L8 10.5 11.5 7M3 13.5h10', up: 'M8 10.5v-8M4.5 6L8 2.5 11.5 6M3 13.5h10', start: 'M4 3.5v9M12 3.5v9l-6-4.5z',
}

const uid = () => Math.random().toString(36).slice(2, 9)

export function Timeline({ snapshot, apply, canvas, transparent, flash, duo, duoScreen, current }: {
  snapshot: () => KfState; apply: (s: KfState) => void; canvas: () => HTMLCanvasElement | null; transparent: boolean; flash: (t: string, err?: boolean) => void
  duo: boolean; duoScreen: 'inner' | 'outer'; current: (t: 'inner' | 'outer') => { texture: THREE.Texture; kind: 'image' | 'video'; name: string } | null
}) {
  // Screen track (saved separately, so timelines from before it load with an empty one)
  const [clips, setClipsState] = useState<ScreenClip[]>(() => { const c = loadClips(); screenLive.clips = c; return c })
  const setClips = useCallback((c: ScreenClip[]) => { setClipsState(c); screenLive.clips = c; saveClips(c) }, [])
  const [open, setOpen] = useState(true)
  const [keys, setKeysState] = useState<Keyframe[]>(() => loadKeys())
  const [sel, setSel] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [loop, setLoop] = useState(true)
  const [fps, setFps] = useState<30 | 60>(60)
  const [fmtOut, setFmtOut] = useState<'webm' | 'mp4'>('webm')
  const [rec, setRec] = useState(false)
  const scrub = useRef<HTMLInputElement>(null), time = useRef<HTMLSpanElement>(null), head = useRef<HTMLDivElement>(null)
  const setKeys = useCallback((k: Keyframe[]) => { setKeysState(k); tlLive.keys = k; saveKeys(k) }, [])
  useEffect(() => { tlLive.keys = keys }, [keys])
  useEffect(() => { tlLive.loop = loop }, [loop])
  useEffect(() => { tlLive.ui = { ...tlLive.ui, scrub: scrub.current, time: time.current } })
  useEffect(() => { tlLive.onEnd = () => setPlaying(false); return () => { tlLive.onEnd = null } }, [])
  const mp4ok = typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('video/mp4')
  const T = total(keys), st = starts(keys)

  const play = () => {
    if (keys.length < 2) { flash('Add at least two keyframes to play.', true); return }
    // from the last keyframe (where Add leaves the playhead) or the end, start again from 0
    if (tlLive.t >= T - 1e-6) tlLive.t = 0
    tlLive.disc = null; tlLive.last = performance.now(); tlLive.active = true; tlLive.playing = true; setPlaying(true)
  }
  const pause = () => { tlLive.playing = false; tlLive.pending = true; setPlaying(false) }
  const seek = (t: number) => { tlLive.t = Math.max(0, Math.min(T, t)); tlLive.disc = null; tlLive.active = true; if (!tlLive.playing) tlLive.pending = true }
  const add = () => {
    const s = snapshot()
    const i = sel ? keys.findIndex(x => x.id === sel) + 1 : keys.length
    // a keyframe identical to its neighbour animates nothing, which reads as Play being broken
    const prev = keys[i - 1]
    if (prev && JSON.stringify(prev.s) === JSON.stringify(s)) { flash(`Nothing has changed since keyframe ${i}. Move the phone, hand or thumb first, then add a keyframe.`, true); return }
    const k: Keyframe = { id: uid(), dur: i ? 1.5 : 0, ease: 'inout', s }
    const next = [...keys.slice(0, i), k, ...keys.slice(i)]; setKeys(next); setSel(k.id)
    // move the playhead to the new keyframe so the ruler shows where it went (the view already matches it)
    const at = starts(next)[i], T2 = total(next); tlLive.t = at
    const u = tlLive.ui; if (u.scrub) u.scrub.value = String(T2 ? at / T2 * 1000 : 0); if (u.head) u.head.style.left = `${(at - tlLive.view0) / (tlLive.view || viewSpan(T2)) * 100}%`; if (u.time) u.time.textContent = `${fmt(at)} / ${fmt(T2)}`
    flash(next.length < 2 ? 'Keyframe 1 added. Now change the phone, hand or thumb and add another.' : `Keyframe ${i + 1} added at ${fmt(at)}. Press Play to animate.`)
  }
  const upd = (id: string, p: Partial<Keyframe>) => setKeys(keys.map(k => k.id === id ? { ...k, ...p } : k))
  const move = (i: number, d: number) => { const j = i + d; if (j < 0 || j >= keys.length) return; const n = [...keys]; [n[i], n[j]] = [n[j], n[i]]; setKeys(n) }
  const jump = (i: number) => { setSel(keys[i].id); if (playing) pause(); apply(keys[i].s); tlLive.t = st[i]; seek(st[i]) }

  const exportJson = () => {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify({ openmockTimeline: 1, keys, screen: clips.filter(c => c.src).map(({ thumb: _t, ...c }) => c) }, null, 2)], { type: 'application/json' }))
    a.download = 'openmock-timeline.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }
  const importJson = (f: File) => f.text().then(t => {
    const v = JSON.parse(t), k = Array.isArray(v) ? v : v.keys
    if (!Array.isArray(k) || !k.every((x: Keyframe) => x && x.s && x.s.pose)) throw new Error('bad')
    setKeys(k.map((x: Keyframe) => ({ ...x, id: x.id || uid() })))
    if (!Array.isArray(v)) { const sc: ScreenClip[] = Array.isArray(v.screen) ? v.screen : []; saveClips(sc); setClips(sortClips(loadClips())) }
    flash(`Imported ${k.length} keyframes.`)
  }).catch(() => flash('That file is not an Openmock timeline.', true))

  /** Plays the timeline once from the start and records the canvas in real time. */
  const record = () => {
    const cv = canvas(); if (!cv || keys.length < 2) { flash('Add at least two keyframes to export a video.', true); return }
    const types = fmtOut === 'mp4' ? ['video/mp4;codecs=avc1', 'video/mp4'] : transparent ? ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'] : ['video/webm;codecs=vp9', 'video/webm']
    const mime = types.find(t => MediaRecorder.isTypeSupported(t)); if (!mime) { flash('This browser cannot record that format.', true); return }
    const stream = cv.captureStream(fps), chunks: Blob[] = []
    const r = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: fps === 60 ? 16e6 : 10e6 })
    r.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }
    r.onstop = () => {
      stream.getTracks().forEach(t => t.stop()); tlLive.loop = loop; setRec(false)
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(chunks, { type: mime.split(';')[0] }))
      a.download = `openmock-timeline.${mime.includes('mp4') ? 'mp4' : 'webm'}`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000)
      flash('Video saved.')
    }
    tlLive.loop = false; tlLive.t = 0; setRec(true)
    const end = tlLive.onEnd
    tlLive.onEnd = () => { setPlaying(false); setTimeout(() => r.stop(), 150); tlLive.onEnd = end }
    r.start(250); tlLive.disc = null; tlLive.last = performance.now(); tlLive.active = true; tlLive.playing = true; setPlaying(true)
  }
  if (import.meta.env.DEV) (window as unknown as { __omTl: unknown }).__omTl = { add, play, pause, seek, record, setKeys, tlLive, setFps, setFmtOut, jump }

  const k = sel ? keys.find(x => x.id === sel) : null, ki = k ? keys.indexOf(k) : -1
  return (
    <section className={`timeline ${open ? '' : 'shut'}`} aria-label="Keyframe timeline">
      <div className="tl-bar">
        <button className="ghost icon" onClick={() => setOpen(!open)} aria-expanded={open} title={open ? 'Hide timeline' : 'Show timeline'}><span style={{ display: 'inline-flex', transform: open ? '' : 'rotate(-90deg)' }}><Ico d={I.chev} /></span></button>
        <strong>Timeline</strong>
        <button onClick={add} title="Add a keyframe from the current view"><Ico d={I.add} /> Add keyframe</button>
        <button className="icon" onClick={() => seek(0)} title="Go to start" aria-label="Go to start"><Ico d={I.start} /></button>
        <button className="icon" onClick={playing ? pause : play} title={playing ? 'Pause' : 'Play'} aria-label={playing ? 'Pause' : 'Play'} disabled={rec}><Ico d={playing ? I.pause : I.play} /></button>
        <button className={`icon ${loop ? 'on' : ''}`} onClick={() => setLoop(!loop)} title="Loop" aria-pressed={loop} aria-label="Loop"><Ico d={I.loop} /></button>
        <input ref={scrub} className="tl-scrub" type="range" min={0} max={1000} defaultValue={0} aria-label="Scrub" onInput={e => seek(+(e.target as HTMLInputElement).value / 1000 * T)} />
        <span ref={time} className="tl-time">{fmt(0)} / {fmt(T)}</span>
        <span className="tl-sp" />
        <select value={fps} onChange={e => setFps(+e.target.value as 30 | 60)} aria-label="Frame rate"><option value={30}>30 fps</option><option value={60}>60 fps</option></select>
        <select value={fmtOut} onChange={e => setFmtOut(e.target.value as 'webm' | 'mp4')} aria-label="Video format"><option value="webm">WebM</option>{mp4ok && <option value="mp4">MP4</option>}</select>
        <button onClick={record} disabled={rec} title="Play once from the start and save a video"><Ico d={I.rec} /> {rec ? 'Recording' : 'Export video'}</button>
        <button className="ghost icon" onClick={exportJson} title="Save the keyframes as JSON" aria-label="Save keyframes as JSON"><Ico d={I.down} /></button>
        <label className="ghost icon btnlike" title="Load keyframes from JSON" aria-label="Load keyframes from JSON"><Ico d={I.up} /><input type="file" accept="application/json,.json" hidden onChange={e => { const f = e.target.files?.[0]; if (f) importJson(f); e.target.value = '' }} /></label>
      </div>
      {open && <>
        <Track keys={keys} sel={sel} setKeys={setKeys} seek={seek} onSelect={i => { setSel(keys[i].id); if (playing) pause() }}
          below={(span, pct) => <ScreenLane clips={clips} setClips={setClips} span={span} T={T} duo={duo} defTarget={duoScreen} current={current} flash={flash} pct={pct} />} />
        <div className="tl-cards">
          {keys.length === 0 && <p className="hint">Set up the phone, hand and thumb, then press Add keyframe. Change them, add another keyframe, then press Play to animate between them.</p>}
          {keys.map((x, i) => (
            <div key={x.id} className={`tl-card ${x.id === sel ? 'sel' : ''}`} onClick={() => jump(i)}>
              <div className="tl-card-h"><b>{i + 1}</b><span>{fmt(st[i])}</span></div>
              {i > 0 ? <div className="tl-card-f" onClick={e => e.stopPropagation()}>
                <label title="How long it takes to get here from the keyframe before">Length <input type="number" min={0.05} max={60} step={0.05} value={x.dur} onChange={e => upd(x.id, { dur: Math.max(0.05, +e.target.value || 0.05) })} /> s</label>
                <select value={x.ease} onChange={e => upd(x.id, { ease: e.target.value as Ease })} aria-label="Easing">{EASES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
              </div> : <div className="tl-card-f hint">Start</div>}
            </div>))}
        </div>
        {k && <div className="tl-act">
          <span>Keyframe {ki + 1}</span>
          <button onClick={() => upd(k.id, { s: snapshot() })} title="Replace this keyframe with the current view"><Ico d={I.upd} /> Update from view</button>
          <button className="icon" onClick={() => move(ki, -1)} disabled={ki === 0} aria-label="Move earlier" title="Move earlier"><Ico d={I.left} /></button>
          <button className="icon" onClick={() => move(ki, 1)} disabled={ki === keys.length - 1} aria-label="Move later" title="Move later"><Ico d={I.right} /></button>
          <button className="ghost" onClick={() => { setKeys(keys.filter(y => y.id !== k.id)); setSel(null) }}><Ico d={I.del} /> Delete</button>
        </div>}
      </>}
    </section>
  )
}
