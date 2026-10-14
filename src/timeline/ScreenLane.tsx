// The Screen track under the motion keyframes: one bar per screen clip, from its start time to the next clip.
import { useRef, useState } from 'react'
import * as THREE from 'three'
import { fmt, tlLive } from './tlCore'
import { parseTime } from './Track'
import { FADES, sortClips, sourceOf, sources, toDataUrl, type ScreenClip, type ScreenTarget, type Source } from './screenTrack'

const uid = () => Math.random().toString(36).slice(2, 10)
const r2 = (t: number) => Math.round(t * 100) / 100
const TARGETS: [ScreenTarget, string][] = [['inner', 'Inner'], ['outer', 'Outer'], ['both', 'Both']]

export function ScreenLane({ clips, setClips, span, T, duo, defTarget, current, flash, pct }: {
  clips: ScreenClip[]; setClips: (c: ScreenClip[]) => void; span: number; T: number; duo: boolean; defTarget: 'inner' | 'outer'
  current: (t: 'inner' | 'outer') => { texture: THREE.Texture; kind: 'image' | 'video'; name: string } | null
  flash: (t: string, err?: boolean) => void; pct: (t: number) => string
}) {
  const lane = useRef<HTMLDivElement>(null), file = useRef<HTMLInputElement>(null)
  const [sel, setSel] = useState<string | null>(null)
  const [target, setTarget] = useState<ScreenTarget | null>(null)
  const [drag, setDrag] = useState<{ id: string; x0: number; at0: number; px: number } | null>(null)
  const [tip, setTip] = useState<{ at: number } | null>(null)
  const [edit, setEdit] = useState<{ id: string; text: string; err: string } | null>(null)
  const tgt: ScreenTarget = duo ? target ?? defTarget : 'inner'
  const at = () => r2(Math.max(0, Math.min(T || 0, tlLive.t)))

  const addSource = (s: Source, name: string) => {
    const id = uid()
    sources.set(id, s)
    const c: ScreenClip = { id, at: at(), target: tgt, name, kind: s.kind, fade: 0, thumb: toDataUrl(s, 64), ...(s.kind === 'image' ? { src: toDataUrl(s, 1320) } : {}) }
    setClips(sortClips([...clips, c])); setSel(id)
    flash(`Screen clip added at ${fmt(c.at)}.`)
  }
  const addCurrent = () => {
    const m = current(tgt === 'outer' ? 'outer' : 'inner'); const s = m && sourceOf(m.texture, m.kind)
    if (!m || !s) { flash('There is no screen media to add yet. Load an image or video first, or add a file.', true); return }
    // a video clip gets its own element so it can follow the playhead without touching the live screen
    if (m.kind === 'video') { const v0 = s.el as HTMLVideoElement, v = document.createElement('video'); v.src = v0.src; v.muted = true; v.loop = true; v.playsInline = true
      v.onloadeddata = () => addSource({ el: v, w: v.videoWidth, h: v.videoHeight, kind: 'video' }, m.name) }
    else addSource(s, m.name)
  }
  const addFile = (f: File) => {
    const url = URL.createObjectURL(f)
    if (f.type.startsWith('video/')) { const v = document.createElement('video'); v.src = url; v.muted = true; v.loop = true; v.playsInline = true
      v.onloadeddata = () => addSource({ el: v, w: v.videoWidth, h: v.videoHeight, kind: 'video' }, f.name); v.onerror = () => flash('That video could not be read.', true) }
    else if (f.type.startsWith('image/') || /\.svg$/i.test(f.name)) { const im = new Image(); im.onload = () => addSource({ el: im, w: im.naturalWidth || 1320, h: im.naturalHeight || 2868, kind: 'image' }, f.name); im.onerror = () => flash('That image could not be read.', true); im.src = url }
    else flash('Use an image (PNG, JPEG, WebP, SVG) or a video.', true)
  }
  const upd = (id: string, p: Partial<ScreenClip>) => setClips(sortClips(clips.map(c => c.id === id ? { ...c, ...p } : c)))
  const commit = () => {
    const e = edit; if (!e) return
    const v = parseTime(e.text)
    if (v == null) { setEdit({ ...e, err: 'Type a time, like 1.5, 1.5s or 0:01.5' }); return }
    if (v < 0 || v > Math.max(T, 0) + 1e-9) { setEdit({ ...e, err: `Pick a time between 0 and ${T.toFixed(2)} s` }); return }
    upd(e.id, { at: r2(v) }); setEdit(null)
  }
  const s = sel ? clips.find(c => c.id === sel) : null

  return (<>
    <div className="tl-screen-h">
      <span className="tl-lab">Screen</span>
      <button onClick={addCurrent} title="Add the media on the screen now, starting at the playhead"><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M8 3v10M3 8h10" /></svg> Current screen</button>
      <button onClick={() => file.current?.click()} title="Pick an image or video to show from the playhead">Add file</button>
      <input ref={file} type="file" accept="image/*,video/*,.svg" hidden onChange={e => { const f = e.target.files?.[0]; if (f) addFile(f); e.target.value = '' }} />
      {duo && <select value={tgt} onChange={e => setTarget(e.target.value as ScreenTarget)} aria-label="Screen for new clips">{TARGETS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>}
      {!clips.length && <span className="hint">Changes the screen content at set times. Move the playhead, then add.</span>}
    </div>
    <div className="tl-lane tl-screen" ref={lane}>
      {clips.map((c, i) => { const end = Math.max(c.at + 0.05, clips.slice(i + 1).find(d => d.target === c.target || d.target === 'both' || c.target === 'both')?.at ?? Math.max(T, c.at + 0.5)); const miss = !sources.has(c.id)
        return (
        <div key={c.id} className={`tl-clip ${c.id === sel ? 'sel' : ''} ${miss ? 'miss' : ''}`} style={{ left: pct(c.at), width: pct(end - c.at) }}
          title={`${c.name} from ${fmt(c.at)}${duo ? `, ${c.target} screen` : ''}${c.fade ? `, fades in over ${c.fade} s` : ''}${miss ? '. The video needs adding again after a reload.' : ''}. Drag to retime, double-click to type a time.`}
          onPointerDown={e => { e.stopPropagation(); setSel(c.id); const r = lane.current!.getBoundingClientRect(); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); setDrag({ id: c.id, x0: e.clientX, at0: c.at, px: r.width }) }}
          onPointerMove={e => { const d = drag; if (!d || d.id !== c.id) return; const t = Math.max(0, Math.min(T, Math.round((d.at0 + (e.clientX - d.x0) / d.px * span) * 10) / 10)); if (t !== c.at) upd(c.id, { at: t }); setTip({ at: t }) }}
          onPointerUp={() => { setDrag(null); setTip(null) }}
          onDoubleClick={e => { e.stopPropagation(); setDrag(null); setTip(null); setEdit({ id: c.id, text: String(c.at), err: '' }) }}>
          {c.fade > 0 && <i className="tl-fade" style={{ width: `${Math.min(1, c.fade / (end - c.at)) * 100}%` }} />}
          {c.thumb && <img src={c.thumb} alt="" />}
          <span>{c.name}{duo && c.target !== 'inner' ? ` (${c.target})` : ''}</span>
        </div>) })}
      {tip && <div className="tl-tip" style={{ left: pct(tip.at), top: -20 }}>{fmt(tip.at)}</div>}
      {edit && (() => { const c = clips.find(x => x.id === edit.id); if (!c) return null; return (
        <div className="tl-edit" style={{ left: pct(c.at), top: 22 }} onPointerDown={e => e.stopPropagation()}>
          <input autoFocus value={edit.text} aria-label="Clip start time in seconds" aria-invalid={!!edit.err} onFocus={e => e.currentTarget.select()}
            onChange={e => setEdit({ ...edit, text: e.target.value, err: '' })}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit() } else if (e.key === 'Escape') { e.preventDefault(); setEdit(null) } }}
            onBlur={() => { if (edit.err) setEdit(null); else commit() }} />
          <span>s</span>{edit.err && <div className="tl-edit-err" role="status">{edit.err}</div>}
        </div>) })()}
    </div>
    {s && <div className="tl-act tl-screen-act">
      <span>{s.name}</span>
      <select value={s.fade} onChange={e => upd(s.id, { fade: +e.target.value })} aria-label="Transition into this clip">{FADES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      {duo && <select value={s.target} onChange={e => upd(s.id, { target: e.target.value as ScreenTarget })} aria-label="Screen">{TARGETS.map(([v, l]) => <option key={v} value={v}>{l} screen</option>)}</select>}
      <button className="ghost" onClick={() => { setClips(clips.filter(c => c.id !== s.id)); sources.delete(s.id); setSel(null) }}>Delete clip</button>
    </div>}
  </>)
}
