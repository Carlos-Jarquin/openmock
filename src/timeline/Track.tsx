// After Effects style track: a time ruler, one bar per segment (width = its duration), keyframe diamonds at their
// times, a draggable playhead and an end handle for the total duration. All drags snap to 0.1 s.
import { useRef, useState } from 'react'
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

type Drag = { kind: 'key' | 'edge' | 'end' | 'head'; i: number; x0: number; keys: Keyframe[]; span: number; px: number; left: number }

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
  // frozen while dragging so the track doesn't rescale under the pointer
  const span = drag ? drag.span : viewSpan(T)
  tlLive.view = span
  const pct = (t: number) => `${t / span * 100}%`
  const w = box.current?.clientWidth ?? 800, s = step(span, w)
  const ticks: number[] = []; for (let t = 0; t <= span + 1e-6; t += s) ticks.push(r1(t))

  const begin = (e: React.PointerEvent, kind: Drag['kind'], i: number) => {
    e.stopPropagation(); e.preventDefault()
    const r = box.current!.getBoundingClientRect()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    setDrag({ kind, i, x0: e.clientX, keys, span, px: r.width, left: r.left })
    if (kind === 'head') moveHead(e.clientX, r.left, r.width, span)
  }
  const moveHead = (x: number, left: number, px: number, sp: number) => {
    const t = Math.max(0, Math.min(T, (x - left) / px * sp)); seek(t); setTip({ x: Math.min(t, T) / sp * px, text: fmt(t) })
  }
  const move = (e: React.PointerEvent) => {
    const d = drag; if (!d) return
    if (d.kind === 'head') { moveHead(e.clientX, d.left, d.px, d.span); return }
    const dt = (e.clientX - d.x0) / d.px * d.span, k = d.keys.map(x => ({ ...x })), s0 = starts(d.keys), T0 = total(d.keys)
    let at = 0
    if (d.kind === 'key') {
      // retime one keyframe between its neighbours; the ones after it stay where they are
      const lo = s0[d.i - 1] + MIN, hi = d.i < k.length - 1 ? s0[d.i + 1] - MIN : MAX_T
      at = Math.min(hi, Math.max(lo, snap(s0[d.i] + dt)))
      k[d.i].dur = r1(at - s0[d.i - 1]); if (d.i < k.length - 1) k[d.i + 1].dur = r1(s0[d.i + 1] - at)
      setTip({ x: at / d.span * d.px, text: `${fmt(at)}  (${k[d.i].dur.toFixed(1)} s)` })
    } else if (d.kind === 'edge') {
      // change this segment's length; everything after it moves along
      k[d.i].dur = Math.max(MIN, snap(d.keys[d.i].dur + dt)); at = s0[d.i - 1] + k[d.i].dur
      setTip({ x: at / d.span * d.px, text: `${k[d.i].dur.toFixed(1)} s` })
    } else {
      // total duration: every segment scales by the same factor
      const T1 = Math.min(MAX_T, Math.max(MIN * (k.length - 1), snap(T0 + dt))), f = T1 / T0
      for (let i = 1; i < k.length; i++) k[i].dur = Math.max(MIN, r1(d.keys[i].dur * f))
      at = total(k); setTip({ x: at / d.span * d.px, text: `Total ${at.toFixed(1)} s` })
    }
    setKeys(k)
  }
  const end = () => { setDrag(null); setTip(null) }

  return (
    <div className="tl-track" ref={box} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
      <div className="tl-rule" onPointerDown={e => begin(e, 'head', 0)} title="Drag to scrub">
        {ticks.map(t => <span key={t} className="tl-tick lab" style={{ left: pct(t) }}>{t > span - s * 0.6 ? '' : t < 60 ? `${+t.toFixed(1)}s` : fmt(t)}</span>)}
      </div>
      <div className="tl-lane" onPointerDown={e => begin(e, 'head', 0)}>
        {T > 0 && <div className="tl-out" style={{ left: pct(T) }} />}
        {keys.slice(1).map((x, j) => { const i = j + 1; return (
          <div key={x.id} className={`tl-seg ${keys[i].id === sel || keys[i - 1].id === sel ? 'sel' : ''}`} style={{ left: pct(st[i - 1]), width: pct(x.dur) }}
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
