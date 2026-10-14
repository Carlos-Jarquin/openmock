// Studio chrome: top pill with the command palette, symmetric Scene and Device rails with floating or pinned peeks,
// and the slot the timeline floats in. Pure layout: every control inside comes from App's existing state and handlers.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Icon } from './icons'

export type Side = 'scene' | 'device'
export interface Section { id: string; side: Side; title: string; icon: string; settings: string[]; render: () => ReactNode }
export interface Cmd { id: string; group: Side | 'view'; section?: string; label: string; meta: 'APPLY' | 'TOGGLE' | 'PEEK' | 'CURRENT'; run?: () => void }
export interface ChromeApi { closeFloating: () => void }
type UiState = { pinned: Record<Side, boolean>; railHidden: Record<Side, boolean>; pillHidden: boolean; pinSec: Record<Side, string | null> }
const UI0: UiState = { pinned: { scene: false, device: false }, railHidden: { scene: false, device: false }, pillHidden: false, pinSec: { scene: null, device: null } }
const KEY = 'openmock-ui-v1'
const loadUi = (): UiState => { try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); return v ? { ...UI0, ...v } : UI0 } catch { return UI0 } }
const RAIL = 60, PIN_W = 320, PILL_GAP = 76
const SIDES: Side[] = ['scene', 'device']
/** Single-key shortcuts stay out of the way while typing or adjusting a field. */
const inField = (el: Element | null) => !!el && ((el as HTMLElement).isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches

export function Chrome({ sections, commands, deviceName, tools, exportMenu, timeline, toggleTimeline, onInsets, apiRef }: {
  sections: Section[]; commands: Cmd[]; deviceName: string; tools: ReactNode; exportMenu: (close: () => void) => ReactNode
  timeline: ReactNode; toggleTimeline: () => void; onInsets: (l: number, r: number) => void; apiRef: React.MutableRefObject<ChromeApi | null>
}) {
  const [ui, setUi] = useState<UiState>(loadUi)
  useEffect(() => { localStorage.setItem(KEY, JSON.stringify(ui)) }, [ui])
  const [open, setOpen] = useState<Record<Side, string | null>>({ scene: null, device: null })
  const [focus, setFocus] = useState(false)
  const [exp, setExp] = useState(false)
  const bySide = useMemo(() => ({ scene: sections.filter(s => s.side === 'scene'), device: sections.filter(s => s.side === 'device') }), [sections])
  const num = (s: Section) => String(bySide[s.side].indexOf(s) + 1).padStart(2, '0')
  const btn = useRef<Record<string, HTMLButtonElement | null>>({})
  const peekEl = useRef<Record<Side, HTMLDivElement | null>>({ scene: null, device: null })
  const pill = useRef<HTMLDivElement>(null)

  // Insets for the viewport: a pinned side pushes the device's centre over by its panel
  const showPinned = (s: Side) => ui.pinned[s] && !focus
  useEffect(() => { onInsets(showPinned('scene') ? RAIL + PIN_W : 0, showPinned('device') ? RAIL + PIN_W : 0) })

  const flashCtl = (side: Side, setting?: string) => {
    if (!setting) return
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const root = peekEl.current[side]; if (!root) return
      const want = setting.toLowerCase()
      const els = Array.from(root.querySelectorAll<HTMLElement>('label, button, h3, .om-row-label, .row > span, legend'))
      const hit = els.find(e => (e.textContent || '').trim().toLowerCase().startsWith(want)) ?? els.find(e => (e.textContent || '').toLowerCase().includes(want))
      const box = hit?.closest<HTMLElement>('.row, .check, .seg, .om-sub, label') ?? hit
      if (!box) return
      box.scrollIntoView({ block: 'nearest' }); box.classList.remove('om-flash'); void box.offsetWidth; box.classList.add('om-flash')
      setTimeout(() => box.classList.remove('om-flash'), 1300)
    }))
  }
  const openPeek = useCallback((side: Side, id: string, setting?: string) => {
    setUi(u => ({ ...u, railHidden: { ...u.railHidden, [side]: false }, pinSec: { ...u.pinSec, [side]: id } }))
    setOpen(o => ({ ...o, [side]: id }))
    if (ui.pinned[side]) requestAnimationFrame(() => document.getElementById(`om-sec-${id}`)?.scrollIntoView({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' }))
    flashCtl(side, setting)
  }, [ui.pinned])
  const closePeek = useCallback((side: Side, refocus = true) => {
    setOpen(o => { const id = o[side]; if (id && refocus) setTimeout(() => btn.current[id]?.focus(), 0); return { ...o, [side]: null } })
  }, [])
  const togglePin = (side: Side) => setUi(u => {
    const p = !u.pinned[side]
    if (!p) setOpen(o => ({ ...o, [side]: null }))
    return { ...u, pinned: { ...u.pinned, [side]: p }, pinSec: { ...u.pinSec, [side]: open[side] ?? u.pinSec[side] } }
  })
  useEffect(() => { if (ui.pinned.scene || ui.pinned.device) for (const s of SIDES) if (ui.pinned[s] && open[s]) requestAnimationFrame(() => document.getElementById(`om-sec-${open[s]}`)?.scrollIntoView({ block: 'start' })) },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ui.pinned.scene, ui.pinned.device])
  apiRef.current = { closeFloating: () => setOpen(o => ({ scene: ui.pinned.scene ? o.scene : null, device: ui.pinned.device ? o.device : null })) }

  // Focus moves into a floating peek when it opens
  const lastOpen = useRef(open)
  useEffect(() => {
    for (const s of SIDES) if (open[s] && open[s] !== lastOpen.current[s] && !ui.pinned[s]) {
      // the dialog itself takes focus (Tab reaches its controls), so P and the other shortcuts work straight away
      peekEl.current[s]?.focus({ preventScroll: true })
    }
    lastOpen.current = open
  }, [open, ui.pinned])

  // Slider fill for range inputs that do not set their own --p (status bar battery, gesture progress and others)
  useEffect(() => {
    const fill = (el: HTMLInputElement) => { if (el.style.getPropertyValue('--p') && !el.dataset.pAuto) return; el.dataset.pAuto = '1'
      const min = +el.min || 0, max = el.max === '' ? 100 : +el.max; el.style.setProperty('--p', `${((+el.value - min) / ((max - min) || 1)) * 100}%`) }
    document.querySelectorAll<HTMLInputElement>('.om-chrome input[type=range]').forEach(fill)
    const on = (e: Event) => { const t = e.target as HTMLInputElement; if (t?.type === 'range' && t.closest('.om-chrome')) fill(t) }
    document.addEventListener('input', on); return () => document.removeEventListener('input', on)
  })
  // ---- command palette ----
  const [q, setQ] = useState('')
  const [pal, setPal] = useState(false)
  const [hi, setHi] = useState(0)
  const search = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const secById = useMemo(() => Object.fromEntries(sections.map(s => [s.id, s])), [sections])
  const all = useMemo(() => {
    const peeks: Cmd[] = sections.flatMap(s => [{ id: `peek-${s.id}`, group: s.side, section: s.id, label: s.title, meta: 'PEEK' as const },
      ...s.settings.map(t => ({ id: `peek-${s.id}-${t}`, group: s.side, section: s.id, label: `${s.title} › ${t}`, meta: 'PEEK' as const }))])
    return [...commands.filter(c => !c.section || secById[c.section]), ...peeks]
  }, [commands, sections, secById])
  const results = useMemo(() => {
    const t = q.trim().toLowerCase(); if (!t) return []
    const scored = all.map(c => { const l = c.label.toLowerCase(), i = l.indexOf(t); if (i < 0) return null
      const word = i === 0 || /[\s›/(]/.test(l[i - 1]); return { c, i, s: (word ? 0 : 50) + (c.meta === 'PEEK' ? 10 : 0) + i / 100 } }).filter(Boolean) as { c: Cmd; i: number; s: number }[]
    scored.sort((a, b) => a.s - b.s)
    const out: { c: Cmd; i: number }[] = [], seen = new Set<string>()
    for (const g of ['scene', 'device', 'view'] as const) for (const r of scored) if (r.c.group === g && !seen.has(r.c.label) && out.filter(x => x.c.group === g).length < 6) { seen.add(r.c.label); out.push(r) }
    return out
  }, [q, all])
  useEffect(() => { setHi(0) }, [q])
  const cur = results[hi]?.c
  const lit = useMemo(() => new Set(results.map(r => r.c.section).filter(Boolean) as string[]), [results])
  const closePal = () => { setPal(false); setQ(''); search.current?.blur() }
  const toPeek = (c: Cmd) => {
    if (!c.section) { c.run?.(); return }
    const s = secById[c.section]; const setting = c.label.includes('›') ? c.label.split('›').pop()!.trim() : undefined
    closePal(); openPeek(s.side, s.id, setting)
  }
  const applyCmd = (c: Cmd) => { if (c.run) c.run(); else toPeek(c) }

  // connector from the highlighted row to its rail button
  const [wire, setWire] = useState<string | null>(null)
  useLayoutEffect(() => {
    if (!pal || !cur?.section) { setWire(null); return }
    const row = document.getElementById(`om-opt-${hi}`), b = btn.current[cur.section]
    if (!row || !b || ui.railHidden[secById[cur.section].side]) { setWire(null); return }
    const r = row.getBoundingClientRect(), k = b.getBoundingClientRect(), dev = secById[cur.section].side === 'device'
    const x1 = dev ? r.right : r.left, y1 = r.top + r.height / 2, x2 = dev ? k.left : k.right, y2 = k.top + k.height / 2, dx = (x2 - x1) * 0.5
    setWire(`M${x1} ${y1} C${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}`)
  }, [pal, cur, hi, q, ui.railHidden, secById])

  // ---- keyboard map ----
  const st = useRef({ open, ui, pal, focus, exp }); st.current = { open, ui, pal, focus, exp }
  const saved = useRef<{ ui: UiState; open: typeof open } | null>(null)
  const sideKey = (s: Side) => {
    const { open: o, ui: u } = st.current
    if (u.pinned[s]) { setUi(x => ({ ...x, pinned: { ...x.pinned, [s]: false } })); setOpen(p => ({ ...p, [s]: null })); return }
    if (o[s]) { closePeek(s); return }
    setUi(x => ({ ...x, railHidden: { ...x.railHidden, [s]: !x.railHidden[s] } }))
  }
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); if (st.current.focus) setFocus(false); setUi(u => ({ ...u, pillHidden: false })); setPal(true); if (search.current) search.current.focus(); else setTimeout(() => search.current?.focus(), 0); return }
      if (e.key === 'Escape') {
        const s = st.current
        if (s.pal) { closePal(); return }
        if (s.exp) { setExp(false); return }
        const fl = SIDES.filter(x => s.open[x] && !s.ui.pinned[x]); if (fl.length) { fl.forEach(x => closePeek(x)); return }
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey || inField(document.activeElement)) return
      const k = e.key
      if (k === '[') sideKey('scene')
      else if (k === ']') sideKey('device')
      else if (k === '\\') setUi(u => ({ ...u, pillHidden: !u.pillHidden }))
      else if (k === 't' || k === 'T') toggleTimeline()
      else if (k === 'p' || k === 'P') {
        const a = document.activeElement, s = SIDES.find(x => peekEl.current[x]?.contains(a))
        if (s) togglePin(s); else return
      } else if (k === 'f' || k === 'F') {
        if (!st.current.focus) { saved.current = { ui: st.current.ui, open: st.current.open }; setFocus(true); setPal(false) }
        else { setFocus(false); if (saved.current) { setUi(saved.current.ui); setOpen(saved.current.open) } }
      } else return
      e.preventDefault()
    }
    window.addEventListener('keydown', on); return () => window.removeEventListener('keydown', on)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toggleTimeline])

  const palKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => Math.min(results.length - 1, h + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(0, h - 1)) }
    else if (e.key === 'Enter' && cur) { e.preventDefault(); applyCmd(cur) }
    else if (e.key === 'ArrowRight' && cur?.section && (e.currentTarget as HTMLInputElement).selectionStart === q.length) { e.preventDefault(); toPeek(cur) }
  }
  useEffect(() => { document.getElementById(`om-opt-${hi}`)?.scrollIntoView({ block: 'nearest' }) }, [hi])

  // ---- render helpers ----
  const pillBox = () => pill.current?.getBoundingClientRect()
  const pinTop = (s: Side) => { const r = pillBox(); if (!r || ui.pillHidden) return 16; const x0 = s === 'scene' ? RAIL : innerWidth - RAIL - PIN_W, x1 = x0 + PIN_W; return x1 > r.left && x0 < r.right ? PILL_GAP : 16 }
  const [, bump] = useState(0)
  useEffect(() => { const r = () => bump(n => n + 1); addEventListener('resize', r); return () => removeEventListener('resize', r) }, [])

  const rail = (s: Side) => {
    const secs = bySide[s], label = s === 'scene' ? 'Scene' : deviceName
    return <div className={`om-railwrap ${s} ${ui.railHidden[s] && !open[s] && !ui.pinned[s] ? 'hidden' : ''}`} key={s}>
      <nav className={`om-rail ${s}`} aria-label={s === 'scene' ? 'Scene sections' : 'Device sections'}>
        <span className="om-rail-label" title={label}>{label}</span>
        {secs.map(x => {
          const active = open[x.side] === x.id || (pal && cur?.section === x.id)
          const cls = ['om-rbtn', active ? 'on' : '', pal && q.trim() ? (lit.has(x.id) ? 'match' : 'dim') : ''].join(' ')
          return <button key={x.id} ref={el => { btn.current[x.id] = el }} className={cls} aria-label={x.title} aria-expanded={open[x.side] === x.id}
            aria-controls={open[x.side] === x.id ? `om-peek-${s}` : undefined}
            onClick={() => open[x.side] === x.id && !ui.pinned[s] ? closePeek(s) : openPeek(s, x.id)}>
            <Icon name={x.icon} /><span className="om-tip" role="tooltip">{x.title} · Click to peek</span></button>
        })}
        <kbd className="om-kbd">{s === 'scene' ? '[' : ']'}</kbd>
      </nav>
      <span className="om-grab" aria-hidden="true" />
    </div>
  }
  const header = (s: Side, x: Section, pinned: boolean) => <div className="om-peek-h">
    {!pinned && <span className="om-num">{num(x)}</span>}
    <h2 id={`om-peek-title-${s}`}>{pinned ? (s === 'scene' ? 'Scene' : deviceName) : x.title}</h2>
    <span className="om-badge">{pinned ? 'Pinned' : 'Peek'}</span>
    <span className="om-sp" />
    <button className={`om-ibtn ${pinned ? 'on' : ''}`} aria-label={pinned ? 'Unpin' : 'Pin open'} aria-pressed={pinned} title={pinned ? 'Unpin' : 'Pin open (P)'} onClick={() => togglePin(s)}><Icon name="pin" size={16} /></button>
    <button className="om-ibtn" aria-label="Close" title="Close" onClick={() => { if (pinned) togglePin(s); else closePeek(s) }}><Icon name="close" size={16} /></button>
  </div>
  const footer = (pinned: boolean) => <div className="om-peek-f"><span>{pinned ? `${'['} or ${']'} to collapse` : 'Esc to close'}</span><span>P to {pinned ? 'unpin' : 'pin'}</span></div>

  const [peekTop, setPeekTop] = useState<Record<Side, { top: number; arrow: number; max?: number }>>({ scene: { top: 0, arrow: 0 }, device: { top: 0, arrow: 0 } })
  useLayoutEffect(() => {
    const next = { ...peekTop }; let ch = false
    for (const s of SIDES) { const id = open[s], el = peekEl.current[s]; if (!id || ui.pinned[s] || !el) continue
      const b = btn.current[id]?.getBoundingClientRect(); if (!b) continue
      // stay below the top pill where they overlap, so the peek header is never hidden under it
      const r = el.getBoundingClientRect(), pr = pillBox(), minTop = pr && !ui.pillHidden && r.right > pr.left && r.left < pr.right ? pr.bottom + 12 : 16
      const max = innerHeight - minTop - 16, h = Math.min(el.offsetHeight, max), cy = b.top + b.height / 2, top = Math.max(minTop, Math.min(innerHeight - h - 16, b.top - 8)), arrow = Math.max(14, Math.min(h - 14, cy - top))
      const far = (a: number | undefined, b2: number) => a == null || Math.abs(a - b2) > 1
      if (far(next[s].top, top) || far(next[s].arrow, arrow) || far(next[s].max, max)) { next[s] = { top, arrow, max }; ch = true } }
    if (ch) setPeekTop(next)
  })
  const panel = (s: Side) => {
    const pinned = ui.pinned[s]
    if (pinned) {
      const secs = bySide[s], first = secs.find(x => x.id === (open[s] ?? ui.pinSec[s])) ?? secs[0], top = pinTop(s)
      return <div key={s} id={`om-peek-${s}`} ref={el => { peekEl.current[s] = el }} className={`om-peek pinned ${s}`} role="dialog" aria-labelledby={`om-peek-title-${s}`} style={{ top, bottom: 16 }} tabIndex={-1}>
        {header(s, first, true)}
        <div className="om-peek-body om-scroll">
          {secs.map(x => <section key={x.id} id={`om-sec-${x.id}`} className="om-sec" aria-labelledby={`om-h-${x.id}`}>
            <h3 className="om-sec-h" id={`om-h-${x.id}`}><span className="om-num">{num(x)}</span>{x.title}</h3>{x.render()}</section>)}
        </div>
        {footer(true)}
      </div>
    }
    const id = open[s]; if (!id) return null
    const x = secById[id]; if (!x) return null
    return <div key={s} id={`om-peek-${s}`} ref={el => { peekEl.current[s] = el }} className={`om-peek float ${s}`} role="dialog" aria-labelledby={`om-peek-title-${s}`} tabIndex={-1}
      style={{ top: peekTop[s].top, maxHeight: peekTop[s].max, ['--arrow' as string]: `${peekTop[s].arrow}px` }}>
      {header(s, x, false)}
      <div className="om-peek-body om-scroll"><section className="om-sec solo">{x.render()}</section></div>
      {footer(false)}
    </div>
  }

  const L = showPinned('scene') ? RAIL + PIN_W + 16 : RAIL + 16, R = showPinned('device') ? RAIL + PIN_W + 16 : RAIL + 16
  const groups = (['scene', 'device', 'view'] as const).filter(g => results.some(r => r.c.group === g))
  const bold = (l: string, i: number) => { const n = q.trim().length; return <>{l.slice(0, i)}<b>{l.slice(i, i + n)}</b>{l.slice(i + n)}</> }
  return <div className={`om-chrome ${focus ? 'focus' : ''}`}>
    <div className="om-tlslot" style={{ left: L, right: R }}>{timeline}</div>
    {!focus && SIDES.map(rail)}
    {!focus && SIDES.map(panel)}
    {!focus && (ui.pillHidden
      ? <button className="om-pilltab" onClick={() => setUi(u => ({ ...u, pillHidden: false }))}><Icon name="down" size={14} /> Show toolbar <kbd>\</kbd></button>
      : <div className="om-pill" ref={pill}>
        <span className="om-word">Openmock</span><span className="om-div" aria-hidden="true" />
        <div className={`om-search ${pal ? 'on' : ''}`}>
          <Icon name="search" size={15} />
          <input ref={search} role="combobox" aria-expanded={pal && results.length > 0} aria-controls="om-pal-list" aria-autocomplete="list"
            aria-activedescendant={pal && cur ? `om-opt-${hi}` : undefined} aria-label="Search settings" placeholder="Search settings…" value={q}
            onFocus={() => setPal(true)} onChange={e => { setQ(e.target.value); setPal(true) }} onKeyDown={palKey}
            onBlur={e => { if (!listRef.current?.contains(e.relatedTarget as Node)) setTimeout(() => { if (!listRef.current?.matches(':hover')) { setPal(false) } }, 120) }} />
          <kbd>{pal ? 'Esc' : '⌘K'}</kbd>
        </div>
        {tools}
        <div className="om-expwrap">
          <button className="om-primary" aria-haspopup="menu" aria-expanded={exp} onClick={() => setExp(!exp)}>Export</button>
          {exp && <div className="om-menu" role="menu" aria-label="Export">{exportMenu(() => setExp(false))}</div>}
        </div>
        <button className="om-ibtn" aria-label="Hide toolbar" title="Hide toolbar (\)" onClick={() => setUi(u => ({ ...u, pillHidden: true }))}><Icon name="up" size={16} /></button>
        {pal && q.trim() && <div className="om-pal" ref={listRef} onMouseDown={e => e.preventDefault()}>
          <div id="om-pal-list" role="listbox" aria-label="Results">
            {results.length === 0 && <p className="om-empty">No settings match “{q.trim()}”.</p>}
            {groups.map(g => <div key={g} role="group" aria-label={g}>
              <div className="om-pal-g"><span>{g === 'scene' ? 'Scene' : g === 'device' ? 'Device' : 'View'}</span><i aria-hidden="true" /><span>{g === 'scene' ? '← Left rail' : g === 'device' ? 'Right rail →' : ''}</span></div>
              {results.map((r, i) => r.c.group !== g ? null : <div key={r.c.id} id={`om-opt-${i}`} role="option" aria-selected={i === hi} className={`om-opt ${i === hi ? 'on' : ''}`}
                onMouseMove={() => setHi(i)} onClick={() => applyCmd(r.c)}>
                <span className="om-opt-l">{bold(r.c.label, r.i)}</span>
                <button tabIndex={-1} className="om-opt-m" onClick={e => { e.stopPropagation(); if (r.c.meta === 'PEEK' || r.c.section) toPeek(r.c); else applyCmd(r.c) }}>{r.c.meta === 'PEEK' && i === hi ? '→ Peek' : r.c.meta === 'APPLY' && i === hi ? 'Apply ↵' : r.c.meta}</button>
              </div>)}
            </div>)}
          </div>
          <div className="om-pal-f"><span>↑↓ Move</span><span>↵ Apply</span><span>→ Open in rail</span><span className="om-sp" /><span>{results.length} results</span></div>
        </div>}
      </div>)}
    {pal && wire && <svg className="om-wire" aria-hidden="true"><path d={wire} /><circle r="3.5" cx={wire.split(' ')[0].slice(1)} cy={wire.split(' ')[1]} /></svg>}
  </div>
}
