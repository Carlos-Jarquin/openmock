// After Effects style track: a time ruler, one bar per segment (width = its duration), keyframe diamonds at their
// times, a draggable playhead and an end handle for the total duration. All drags snap to 0.1 s.
import { useEffect, useRef, useState } from 'react'
import { fmt, starts, tlLive, total, type Keyframe } from './tlCore'

const SNAP = 0.1, MIN = 0.1, MAX_T = 120
const snap = (t: number) => Math.round(t / SNAP) * SNAP
const r1 = (t: number) => Math.round(t * 10) / 10
const r2 = (t: number) => Math.round(t * 100) / 100
/** Typed times: "1.6", "1.5s", "1.5 s" or "0:01.5" (minutes and seconds). null when it isn't a time. */
export function parseTime(v: string): number | null {
  const t = v.trim().toLowerCase()
  let m = t.match(/^(\d+):(\d+(?:\.\d*)?)$/); if (m) return +m[1] * 60 + +m[2]
  m = t.match(/^(\d*\.?\d+)\s*(?:s|sec|secs|seconds?)?$/); return m ? +m[1] : null
}
/** Seconds the track shows: the timeline plus room to drag it longer. */
export const viewSpan = (T: number) => Math.max(2, Math.ceil(T * 1.25 + 0.5))
/** Tick step that gives labels roughly every 60 px. */
function step(span: number, px: number) { const want = span * 60 / Math.max(1, px); return [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60].find(s => s >= want) ?? 60 }

type Drag = { kind: 'key' | 'edge' | 'end' | 'head'; i: number; x0: number; keys: Keyframe[]; span: number; v0: number; px: number; left: number }
const MIN_VIEW = 1
// Our own line icons on a 24 grid (1.75 stroke, round caps and joins, currentColor)
const ChgIco = ({ d }: { d: string }) => <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
const CHG = {
  phone: { d: 'M8 2.75h8A1.75 1.75 0 0 1 17.75 4.5v15A1.75 1.75 0 0 1 16 21.25H8A1.75 1.75 0 0 1 6.25 19.5v-15A1.75 1.75 0 0 1 8 2.75ZM10.5 18h3', tip: 'Phone moved' },
  hand: { d: 'M8.5 12.5V5.25a1.25 1.25 0 0 1 2.5 0V11m0-1.5V3.75a1.25 1.25 0 0 1 2.5 0V11m0-6a1.25 1.25 0 0 1 2.5 0V11m0-3.5a1.25 1.25 0 0 1 2.5 0v6.5c0 4-2.6 7-6.5 7-2.6 0-4.2-1.2-5.6-3.3L5 14.2a1.4 1.4 0 0 1 2.3-1.6l1.2 1.4', tip: 'Hand changed' },
  camera: { d: 'M3 8.5A1.75 1.75 0 0 1 4.75 6.75h2l1.5-2.25h7.5l1.5 2.25h2A1.75 1.75 0 0 1 21 8.5v9.25a1.75 1.75 0 0 1-1.75 1.75H4.75A1.75 1.75 0 0 1 3 17.75ZM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z', tip: 'Camera changed' },
} as const
const ne = (a: unknown, b: unknown) => JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)
const changesOf = (a: Keyframe['s'], b: Keyframe['s']) => {
  const out: (keyof typeof CHG)[] = []
  const p = (k: keyof typeof a.pose) => Math.abs(a.pose[k] - b.pose[k]) > 1e-4
  if (p('tiltX') || p('tiltY') || p('rotZ') || p('panX') || p('panY') || ne(a.fold, b.fold)) out.push('phone')
  if (ne(a.hands, b.hands) || ne(a.handRot, b.handRot) || ne(a.tap, b.tap) || ne(a.ges, b.ges)) out.push('hand')
  if (p('zoom') || p('fov')) out.push('camera')
  return out
}

export function Track({ keys, sel, setKeys, onSelect, seek, below }: {
  below?: (span: number, pct: (t: number) => string) => React.ReactNode
  keys: Keyframe[]; sel: string | null; setKeys: (k: Keyframe[]) => void; onSelect: (i: number) => void; seek: (t: number) => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [tip, setTip] = useState<{ x: number; text: string } | null>(null)
  // inline editor: a segment's length, or a keyframe's time
  const [edit, setEdit] = useState<{ kind: 'seg' | 'key'; i: number; text: string; err: string } | null>(null)
  const commit = () => {
    const e = edit; if (!e) return
    const v = parseTime(e.text)
    if (v == null) { setEdit({ ...e, err: 'Type a time, like 1.5, 1.5s or 0:01.5' }); return }
    const k = keys.map(x => ({ ...x })), s0 = starts(keys)
    if (e.kind === 'seg') {
      if (v < MIN) { setEdit({ ...e, err: 'The shortest length is 0.1 s' }); return }
      k[e.i].dur = Math.min(MAX_T, r2(v))   // later keyframes move along, like dragging the edge
    } else {
      const lo = s0[e.i - 1] + MIN, hi = e.i < k.length - 1 ? s0[e.i + 1] - MIN : MAX_T
      if (v < lo - 1e-9 || v > hi + 1e-9) { setEdit({ ...e, err: `Pick a time between ${lo.toFixed(2)} and ${hi.toFixed(2)} s` }); return }
      const at = r2(v); k[e.i].dur = r2(at - s0[e.i - 1]); if (e.i < k.length - 1) k[e.i + 1].dur = r2(s0[e.i + 1] - at)
    }
    setKeys(k); setEdit(null)
  }
  const T = total(keys), st = starts(keys)
  // View window [v0, v0 + span] in seconds. Fit (zoom null) shows the whole timeline plus room to drag it longer;
  // pinch or Cmd/Ctrl + scroll zooms about the pointer between 1 s and the duration + 10 s, sideways scroll pans.
  const [zoom, setZoom] = useState<{ v0: number; vs: number } | null>(null)
  const maxView = Math.max(MIN_VIEW * 2, T + 10), fit = viewSpan(T)
  const clampView = (v0: number, vs: number) => { vs = Math.min(maxView, Math.max(MIN_VIEW, vs)); const range = Math.max(fit, vs, T + 10); return { v0: Math.min(Math.max(0, v0), Math.max(0, range - vs)), vs } }
  const cur = zoom ? clampView(zoom.v0, zoom.vs) : { v0: 0, vs: fit }
  // frozen while dragging so the track doesn't rescale under the pointer
  const span = drag ? drag.span : cur.vs, v0 = drag ? drag.v0 : cur.v0
  tlLive.view = span; tlLive.view0 = v0
  const pct = (t: number) => `${(t - v0) / span * 100}%`
  const w = box.current?.clientWidth ?? 800, s = step(span, w)
  const ticks: number[] = []; for (let t = Math.floor(v0 / s) * s; t <= v0 + span + 1e-6; t += s) if (t >= -1e-9) ticks.push(Math.round(t * 100) / 100)
  const view = useRef(cur); view.current = cur
  useEffect(() => {
    const el = box.current; if (!el) return
    const zoomAt = (x: number, f: number, base = view.current) => {
      const r = el.getBoundingClientRect(), u = Math.min(1, Math.max(0, (x - r.left) / r.width)), tc = base.v0 + u * base.vs
      const vs = Math.min(maxView, Math.max(MIN_VIEW, base.vs * f)); setZoom(clampView(tc - u * vs, vs))
    }
    const wheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoomAt(e.clientX, Math.exp(e.deltaY * (e.ctrlKey && !e.metaKey ? 0.01 : 0.002))); return }
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey) { e.preventDefault(); const r = el.getBoundingClientRect(), d = e.deltaX || e.deltaY, c = view.current; setZoom(clampView(c.v0 + d / r.width * c.vs, c.vs)) }
    }
    // Safari: trackpad pinch as gesture events (scale is cumulative from the start of the pinch)
    let g0: { v0: number; vs: number } | null = null
    const gs = (e: Event) => { e.preventDefault(); g0 = view.current }
    const gc = (e: Event) => { e.preventDefault(); const ge = e as Event & { scale: number; clientX: number }; if (g0 && ge.scale) zoomAt(ge.clientX, 1 / ge.scale, g0) }
    el.addEventListener('wheel', wheel, { passive: false }); el.addEventListener('gesturestart', gs); el.addEventListener('gesturechange', gc)
    return () => { el.removeEventListener('wheel', wheel); el.removeEventListener('gesturestart', gs); el.removeEventListener('gesturechange', gc) }
  }, [maxView, fit, T])
  if (import.meta.env.DEV) (globalThis as { __tlView?: unknown }).__tlView = cur

  const begin = (e: React.PointerEvent, kind: Drag['kind'], i: number) => {
    e.stopPropagation(); e.preventDefault()
    const r = box.current!.getBoundingClientRect()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    setDrag({ kind, i, x0: e.clientX, keys, span, v0, px: r.width, left: r.left })
    if (kind === 'head') moveHead(e.clientX, r.left, r.width, span, v0)
  }
  const moveHead = (x: number, left: number, px: number, sp: number, o: number) => {
    const t = Math.max(0, Math.min(T, o + (x - left) / px * sp)); seek(t); setTip({ x: (Math.min(t, T) - o) / sp * px, text: fmt(t) })
  }
  const move = (e: React.PointerEvent) => {
    const d = drag; if (!d) return
    if (d.kind === 'head') { moveHead(e.clientX, d.left, d.px, d.span, d.v0); return }
    const dt = (e.clientX - d.x0) / d.px * d.span, k = d.keys.map(x => ({ ...x })), s0 = starts(d.keys), T0 = total(d.keys)
    let at = 0
    if (d.kind === 'key') {
      // retime one keyframe between its neighbours; the ones after it stay where they are
      const lo = s0[d.i - 1] + MIN, hi = d.i < k.length - 1 ? s0[d.i + 1] - MIN : MAX_T
      at = Math.min(hi, Math.max(lo, snap(s0[d.i] + dt)))
      k[d.i].dur = r1(at - s0[d.i - 1]); if (d.i < k.length - 1) k[d.i + 1].dur = r1(s0[d.i + 1] - at)
      setTip({ x: (at - d.v0) / d.span * d.px, text: `${fmt(at)}  (${k[d.i].dur.toFixed(1)} s)` })
    } else if (d.kind === 'edge') {
      // change this segment's length; everything after it moves along
      k[d.i].dur = Math.max(MIN, snap(d.keys[d.i].dur + dt)); at = s0[d.i - 1] + k[d.i].dur
      setTip({ x: (at - d.v0) / d.span * d.px, text: `${k[d.i].dur.toFixed(1)} s` })
    } else {
      // total duration: every segment scales by the same factor
      const T1 = Math.min(MAX_T, Math.max(MIN * (k.length - 1), snap(T0 + dt))), f = T1 / T0
      for (let i = 1; i < k.length; i++) k[i].dur = Math.max(MIN, r1(d.keys[i].dur * f))
      at = total(k); setTip({ x: (at - d.v0) / d.span * d.px, text: `Total ${at.toFixed(1)} s` })
    }
    setKeys(k)
  }
  const end = () => { setDrag(null); setTip(null) }

  return (
    <div className="tl-track" ref={box} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
      <div className="tl-rule" onPointerDown={e => begin(e, 'head', 0)} title="Drag to scrub">
        {ticks.map(t => <span key={t} className="tl-tick lab" style={{ left: pct(t) }}>{t > v0 + span - s * 0.6 ? '' : t < 60 ? `${+t.toFixed(s < 0.1 ? 2 : 1)}s` : fmt(t)}</span>)}
      </div>
      <div className="tl-chg" aria-label="What changes at each keyframe">
        {keys.slice(1).map((x, j) => { const c = changesOf(keys[j].s, x.s); return c.length ? (
          <span key={x.id} className="tl-chg-k" style={{ left: pct(st[j + 1]) }}>
            {c.map(k => <span key={k} className={`tl-chg-i ${k}`} title={`${CHG[k].tip} at keyframe ${j + 2}`} aria-label={CHG[k].tip}><ChgIco d={CHG[k].d} /></span>)}
          </span>) : null })}
      </div>
      <div className="tl-lane" onPointerDown={e => begin(e, 'head', 0)}>
        {T > 0 && <div className="tl-out" style={{ left: pct(T) }} />}
        {keys.slice(1).map((x, j) => { const i = j + 1; return (
          <div key={x.id} className={`tl-seg ${keys[i].id === sel || keys[i - 1].id === sel ? 'sel' : ''}`} style={{ left: pct(st[i - 1]), width: `${x.dur / span * 100}%` }}
            onPointerDown={e => { e.stopPropagation(); onSelect(i) }} onDoubleClick={e => { e.stopPropagation(); setDrag(null); setTip(null); setEdit({ kind: 'seg', i, text: String(r2(x.dur)), err: '' }) }}
            title={`Keyframe ${i} to ${i + 1}: ${x.dur.toFixed(2)} s. Double-click to type a length.`}>
            <span>{+x.dur.toFixed(2)} s</span>
            <i className="tl-edge" onPointerDown={e => begin(e, 'edge', i)} title="Drag to change this part's length" />
          </div>) })}
        {keys.map((x, i) => <button key={x.id} className={`tl-dia ${x.id === sel ? 'sel' : ''}`} style={{ left: pct(st[i]) }} aria-label={`Keyframe ${i + 1} at ${fmt(st[i])}`}
          title={i ? `Keyframe ${i + 1} at ${fmt(st[i])}. Drag to retime, or double-click to type a time.` : 'Keyframe 1 at the start'}
          onDoubleClick={e => { e.stopPropagation(); setDrag(null); setTip(null); if (i) setEdit({ kind: 'key', i, text: String(r2(st[i])), err: '' }) }}
          onPointerDown={e => { onSelect(i); if (i) begin(e, 'key', i); else e.stopPropagation() }} />)}
        {keys.length > 1 && <button className="tl-end" style={{ left: pct(T) }} aria-label="Total duration" title={`Total ${T.toFixed(1)} s. Drag to make the whole timeline longer or shorter.`} onPointerDown={e => begin(e, 'end', 0)} />}
      </div>
      {below?.(span, pct)}
      {zoom && (() => { const range = Math.max(fit, v0 + span, T + 10); return (
        <div className="tl-scroll" onPointerDown={e => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(), c = view.current
          const at = (x: number) => clampView((x - r.left) / r.width * range - c.vs / 2, c.vs); setZoom(at(e.clientX))
          const mv = (ev: PointerEvent) => setZoom(at(ev.clientX)), up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up) }
          window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up) }}>
          <i style={{ left: `${v0 / range * 100}%`, width: `${span / range * 100}%` }} />
        </div>) })()}
      {zoom && <button className="tl-fit" onPointerDown={e => e.stopPropagation()} onClick={() => setZoom(null)} title="Show the whole timeline">Fit</button>}
      <div ref={el => { tlLive.ui.head = el }} className="tl-head" style={{ left: pct(Math.min(tlLive.t, T)) }} />
      {edit && (() => { const a = edit.kind === 'seg' ? st[edit.i - 1] + keys[edit.i].dur / 2 : st[edit.i]; return (
        <div className="tl-edit" style={{ left: pct(a) }} onPointerDown={e => e.stopPropagation()}>
          <input autoFocus value={edit.text} aria-label={edit.kind === 'seg' ? `Length of part ${edit.i} in seconds` : `Time of keyframe ${edit.i + 1} in seconds`} aria-invalid={!!edit.err}
            onFocus={e => e.currentTarget.select()} onChange={e => setEdit({ ...edit, text: e.target.value, err: '' })}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit() } else if (e.key === 'Escape') { e.preventDefault(); setEdit(null) } }}
            onBlur={() => { if (edit.err) setEdit(null); else commit() }} />
          <span>s</span>
          {edit.err && <div className="tl-edit-err" role="status">{edit.err}</div>}
        </div>) })()}
      {tip && <div className="tl-tip" style={{ left: tip.x }}>{tip.text}</div>}
    </div>
  )
}
