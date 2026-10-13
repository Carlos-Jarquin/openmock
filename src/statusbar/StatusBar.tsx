// iOS status bar and Dynamic Island, drawn in iPhone points. Used live as DOM on /live and rasterised onto the screen texture in the studio.
import { useEffect, useState } from 'react'
import { type SbCfg, sbAct, sbGlyph } from './config'

// iOS 18+ on 402x874 and 440x956 (16 Pro class onward): status bar 54 pt.
// The software Dynamic Island is drawn larger than the glass cut-out: 126 x 37 pt, 14 pt from the top (Apple UI Kit / simulator).
export const STATUS_H = 54
export const ISL = { w: 126, h: 37, top: 14 }

let measureCtx: CanvasRenderingContext2D | null = null
/** Text width in CSS px, including letter spacing after each character as the DOM does. */
export function textWidth(t: string, font: string, ls: number) {
  measureCtx ??= document.createElement('canvas').getContext('2d')!
  measureCtx.font = font
  return measureCtx.measureText(t).width + ls * [...t].length
}

/** h:mm, ticking every second, or the fixed time when given. */
export function useClock(fixed: string | null) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { if (fixed) return; const i = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(i) }, [fixed])
  return fixed ?? clockText(now)
}
export const clockText = (d: Date) => `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')}`

// Status bar, measured from eight native iPhone 16 Pro screenshots (1206x2622 at 3x), in pt. URL params (all optional):
//   statusbar=auto|dark|light|off   text colour (UIStatusBarStyle); auto reads the app's top background
//   time=h:mm                       fixed clock (default: live clock)
//   carrier=<text>                  carrier name in place of the time (lock screen style, e.g. ROGERS)
//   focus=dnd|none                  Do Not Disturb moon after the time      location=on   location arrow after the time
//   network=wifi|lte|5g|none        Wi-Fi glyph, or LTE / 5G text, or nothing      wifi=0-3   Wi-Fi strength (default 3)
//   signal=0-4|none                 cellular bars (default 4); none hides them      sim=dual   two-row dual-SIM glyph, signal2=0-4
//   level=0-100                     battery level (default 88)      battery=pct|plain   percentage inside the battery (default pct)
//   island=compact|activity         activity: expanded island with a timer ring and trailing text (activity=<text>, default 23m;
//                                   ring=0-1 progress, default 0.9)      bubble=on   separate round minimal activity right of the island
// Layout findings: with the compact island the time is always centred at x 65 and a moon or arrow hangs 5 pt to its right
// (the time does not move). With an expanded island (activity or bubble) the time, plus any glyph, is centred in the left ear
// between x 12 and the island's left edge; the right cluster is centred between the island's (or bubble's) right edge and x 386.7, with 6 pt gaps (8, or 9.7 before LTE, in the compact layout).
// iOS also tightens the time when the island is expanded (12:23 is 40 pt wide instead of 42.6). Compact: right cluster centred at 327.3. Centre line y 32.3; island 37 pt tall at y 14.
export const SB_CY = 32.3, DIM = 0.35, DIM2 = 0.27, ORANGE = '#ff9f0a'
export const SB_FONT = '-apple-system, system-ui, "SF Pro Text", "Helvetica Neue", sans-serif'
/** Island layout in pt, Pro width (Pro Max shifts by half the extra width). */
export function islandLayout(sb: SbCfg, CSS_W: number) {
  const dx = (CSS_W - 402) / 2
  const main = !sbAct(sb) ? { l: 138, r: 264 } : sb.bubble ? { l: 108.3, r: 263.7 } : sb.act ? { l: 107.3, r: 304.7 } : { l: 109.7, r: 285.3 }
  return { l: main.l + dx, r: main.r + dx, top: ISL.top, h: ISL.h, bubble: sb.bubble ? { l: 271.7 + dx, d: 36.7 } : null, dx }
}

/** The Dynamic Island with an optional timer-style live activity and a minimal bubble. */
export function Island({ sb, w }: { sb: SbCfg; w: number }) {
  const L = islandLayout(sb, w), cy = L.top + L.h / 2, R = 9.2, C = 2 * Math.PI * R
  return <>
    <div style={{ position: 'absolute', left: L.l, top: L.top, width: L.r - L.l, height: L.h, borderRadius: L.h / 2, background: '#000', pointerEvents: 'none' }}>
      {sbAct(sb) && <svg width="22" height="22" viewBox="0 0 22 22" style={{ position: 'absolute', left: 8.05, top: 7.2 }}>
        <circle cx="11" cy="11" r={R} fill="none" stroke={ORANGE} strokeOpacity="0.3" strokeWidth="2.3" />
        <circle cx="11" cy="11" r={R} fill="none" stroke={ORANGE} strokeWidth="2.3" strokeLinecap="round" strokeDasharray={`${C * sb.ring} ${C}`} transform="rotate(-90 11 11)" />
      </svg>}
      {sbAct(sb) && !sb.bubble && <div style={{ position: 'absolute', right: 9, top: 0, height: L.h, display: 'flex', alignItems: 'center', color: ORANGE,
        font: `500 15.5px/1 ${SB_FONT}`, letterSpacing: -0.2, fontVariantNumeric: 'tabular-nums' }}>{sb.act}</div>}
    </div>
    {L.bubble && <div style={{ position: 'absolute', left: L.bubble.l, top: L.top, width: L.bubble.d, height: L.bubble.d, borderRadius: '50%', background: '#000', pointerEvents: 'none' }}>
      <svg width="13" height="14" viewBox="0 0 13 14" style={{ position: 'absolute', left: (L.bubble.d - 12.3) / 2, top: (L.bubble.d - 13.3) / 2 - 0.4 }}>
        <path d="M6.5 0.3L12.6 13.4 6.5 10.2 0.4 13.4z" fill="#3e8bff" /></svg>
    </div>}
  </>
}

const Moon = ({ c }: { c: string }) => <svg width="13.3" height="13.3" viewBox="0.4 0.4 19.2 19.2" aria-hidden style={{ marginTop: -0.8 }}><path fill={c} d="M7.6 0.6A9.6 9.6 0 1 0 19.4 12.4 8 8 0 0 1 7.6 0.6z" /></svg>
const Arrow = ({ c }: { c: string }) => <svg width="12.3" height="12.3" viewBox="0.4 0.4 11.2 11.2" aria-hidden style={{ marginTop: 0.4 }}><path fill={c} d="M11.6 0.4L0.4 5.3 5.6 6.4 6.7 11.6z" /></svg>

/** iOS status bar: time (or carrier) on the left, signal, network and battery on the right, on the island centre line. */
export function StatusBar({ tone, sb, w: CSS_W, time }: { tone: 'dark' | 'light'; sb: SbCfg; w: number; time: string }) {
  const c = tone === 'dark' ? '#000' : '#fff'
  const L = islandLayout(sb, CSS_W), lvl = sb.level / 100
  // left: compact -> time centred at 65 with the glyph hanging right; expanded -> time + glyph centred in [12, island left]
  const GW = sbGlyph(sb) === 'moon' ? 13.3 : sbGlyph(sb) === 'arrow' ? 12.3 : 0, GAP = 4.8
  const tw = textWidth(sb.carrier ?? time, sb.carrier ? `400 15px ${SB_FONT}` : `600 17px ${SB_FONT}`, sb.carrier ? 0.2 : sbAct(sb) ? -0.8 : -0.3)
  const groupW = tw + (GW ? GAP + GW : 0)
  const timeL = sb.carrier ? 37.8 : !sbAct(sb) ? 65 - tw / 2 : (12 + L.l) / 2 - groupW / 2
  // right cluster pieces (x in a local svg, y relative to top = SB_CY - 8)
  const items: { w: number; gap: number; el: (x: number) => React.ReactNode }[] = []
  if (sb.sig >= 0) items.push(sb.dual ? { w: 18.33, gap: 0, el: x => <g key="sig" fill={c}>
      {[4, 5, 6, 6.67].map((h, i) => <rect key={i} x={x + i * 5.33} y={9.7 - h} width="3.33" height={h} rx="0.9" fillOpacity={i < sb.sig ? 1 : DIM2} />)}
      {[0, 1, 2, 3].map(i => <rect key={'b' + i} x={x + i * 5.33} y={11.37} width="3.33" height="3.67" rx="0.9" fillOpacity={i < sb.sig2 ? 1 : DIM2} />)}</g> }
    : { w: 19, gap: 0, el: x => <g key="sig" fill={c}>{[4.3, 3.3, 1.6, 0].map((t, i) => <rect key={i} x={x + i * 5.33} y={t + 1.4} width="3.33" height={13 - t} rx="1" fillOpacity={i < sb.sig ? 1 : DIM} />)}</g> })
  if (sb.net === 'wifi') items.push({ w: 16, gap: sbAct(sb) ? 6 : 8, el: x => <g key="wifi" transform={`translate(${x} 2)`} fill={c}>
      <path fillOpacity={sb.wifi >= 3 ? 1 : DIM} d="M8 0C11.1 0 13.9 1.2 16 3.2L14.6 4.6C12.9 2.9 10.6 2 8 2S3.1 2.9 1.4 4.6L0 3.2C2.1 1.2 4.9 0 8 0z" />
      <path fillOpacity={sb.wifi >= 2 ? 1 : DIM} d="M8 4.1c2 0 3.8.8 5.1 2L11.7 7.5C10.7 6.6 9.4 6 8 6S5.3 6.6 4.3 7.5L2.9 6.1C4.2 4.9 6 4.1 8 4.1z" />
      <path fillOpacity={sb.wifi >= 1 ? 1 : DIM} d="M8 8.2c1 0 1.9.4 2.6 1L8 12 5.4 9.2C6.1 8.6 7 8.2 8 8.2z" /></g> })
  if (sb.net === 'lte' || sb.net === '5g') { const t = sb.net === 'lte' ? 'LTE' : '5G', w = sb.net === 'lte' ? 18.7 : 13.5
    items.push({ w, gap: sbAct(sb) ? 6 : 9.67, el: x => <text key="net" x={x + w / 2} y={13.7} textAnchor="middle" textLength={w} lengthAdjust="spacingAndGlyphs" fill={c} style={{ font: `600 13.7px ${SB_FONT}` }}>{t}</text> }) }
  items.push({ w: 27.0, gap: sbAct(sb) ? 6 : 8, el: x => <g key="bat">
      <defs><mask id="sb-pct" maskUnits="userSpaceOnUse"><rect x={x} y="0" width="28" height="16" fill="#fff" />
        {sb.pct && <text x={x + 12.35} y="11.9" textAnchor="middle" fill="#000" style={{ font: `700 11px ${SB_FONT}`, letterSpacing: -0.2 }}>{sb.level}</text>}</mask>
        <clipPath id="sb-lvl"><rect x={x} y="0" width={24.7 * lvl} height="16" /></clipPath></defs>
      {sb.pct ? <g mask="url(#sb-pct)">
        <rect x={x} y="1.35" width="24.7" height="13.3" rx="4.2" fill={c} fillOpacity="0.4" />
        <rect x={x} y="1.35" width="24.7" height="13.3" rx="4.2" fill={c} clipPath="url(#sb-lvl)" /></g>
      : <g><rect x={x + 0.5} y="1.85" width="23.7" height="12.3" rx="3.8" fill="none" stroke={c} strokeOpacity="0.35" />
        <rect x={x + 2} y="3.35" width={20.7 * lvl} height="9.3" rx="2.4" fill={c} /></g>}
      <path d={`M${x + 26} 6.35v3.3c.6-.2 1-.9 1-1.65s-.4-1.45-1-1.65z`} fill={c} fillOpacity="0.4" /></g> })
  items[0].gap = 0
  const W = items.reduce((s, it) => s + it.gap + it.w, 0)
  const rightEdge = L.bubble ? L.bubble.l + L.bubble.d : L.r
  const rcx = sbAct(sb) ? (rightEdge + 386.7 + 2 * L.dx) / 2 : CSS_W - (402 - 327.3)
  let x = 0
  const els = items.map(it => { x += it.gap; const e = it.el(x); x += it.w; return e })
  return (
    <div style={{ position: 'absolute', left: 0, top: 0, width: CSS_W, height: STATUS_H, pointerEvents: 'none', color: c }}>
      <div style={{ position: 'absolute', left: timeL, top: SB_CY - 11 + (sb.carrier ? 0.3 : 0.8), height: 22, display: 'flex', alignItems: 'center', gap: GAP, whiteSpace: 'nowrap',
        font: sb.carrier ? `400 15px/22px ${SB_FONT}` : `600 17px/22px ${SB_FONT}`, letterSpacing: sb.carrier ? 0.2 : sbAct(sb) ? -0.8 : -0.3 }}>
        <span>{sb.carrier ?? time}</span>
        {!sb.carrier && sbGlyph(sb) === 'moon' && <Moon c={c} />}{!sb.carrier && sbGlyph(sb) === 'arrow' && <Arrow c={c} />}
      </div>
      <svg width={W} height="16" viewBox={`0 0 ${W} 16`} aria-hidden style={{ position: 'absolute', left: rcx - W / 2, top: SB_CY - 8, overflow: 'visible' }}>{els}</svg>
    </div>
  )
}

