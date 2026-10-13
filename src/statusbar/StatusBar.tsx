// iOS status bar and Dynamic Island, drawn in iPhone points. Used live as DOM on /live and rasterised onto the screen texture in the studio.
import { useEffect, useState } from 'react'
import { type SbCfg, sbAct, sbGlyph } from './config'

// iOS 18+ on 402x874 and 440x956 (16 Pro class onward): status bar 54 pt.
// The software Dynamic Island is drawn larger than the glass cut-out: 126 x 37 pt, 14 pt from the top (Apple UI Kit / simulator).
export const STATUS_H = 54
// Home indicator, measured from a 3x iPhone 16 Pro screenshot (dark keyboard): 432 x 15 px, bottom edge 24 px above the
// screen edge, fully rounded, pure white on dark. In pt on 402 wide: 144 x 5, 8 from the bottom, radius 2.5, centred.
// Pro Max: width scaled by 440/402 (157.6 pt, inferred), height and offset unchanged.
export const HOME = { w: 144, h: 5, bottom: 8 }
export const homeBarBox = (W: number, H: number) => { const w = HOME.w * W / 402; return { x: (W - w) / 2, y: H - HOME.bottom - HOME.h, w, h: HOME.h, r: HOME.h / 2 } }
/** Light bar on dark content, dark bar on light content (tone as for the status bar: 'light' means white ink). */
export const homeBarColour = (tone: 'dark' | 'light') => tone === 'light' ? '#ffffff' : '#000000'
export function HomeBar({ tone, w, h }: { tone: 'dark' | 'light'; w: number; h: number }) {
  const b = homeBarBox(w, h)
  return <div style={{ position: 'absolute', left: b.x, top: b.y, width: b.w, height: b.h, borderRadius: b.r, background: homeBarColour(tone), pointerEvents: 'none' }} />
}
// Front camera seen through the island (non-Sketch looks): the hardware lens sits in the right-hand cap of the 15.68 mm glass
// cut-out, 4.8 mm right of centre (x 230.0 pt on the Pro, centre +29), visible radius 1.45 mm = 8.8 pt at 6.04 pt/mm.
// Drawn black on black with a slightly lighter lens disc and a faint inner ring, so it reads without standing out.
export const FRONT_LENS = { dx: 29.0, r: 8.8 }
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
// Time: SF Pro fitted to the 3x screenshots in Chromium on macOS (iOS semibold renders lighter than Chrome's 600), with the
// colon raised to the digit centre as iOS does. The expanded-island time is set smaller, not just tighter.
export const TIME_CMP = `500 16.85px ${'-apple-system, system-ui, "SF Pro Text", "Helvetica Neue", sans-serif'}`, TIME_LS_CMP = 0.26, TIME_LS_EXP = 0.11
export const COLON_DY = -1.8, TIME_BASE = 6.4, CARRIER_BASE = 6.35
// With an expanded island iOS draws the whole leading group and the right cluster ~5% smaller (time 35 vs 37 px tall, battery 71 vs 75 px wide).
export const EXP_K = 0.947, GLYPH_GAP = 3.7, GLYPH_GAP_EXP = 5.4, BAT_FONT = '520 11.75', BAT_LS = 0
/** Inferred minimum clear space either side of the right cluster beside an expanded island (pt). */
export const RC_MIN_PAD = 5
export const SB_CY = 32.3, DIM = 0.35, DIM2 = 0.22, DIM2_LIGHT = 0.195, ORANGE = '#ff9f0a'
export const SB_FONT = '-apple-system, system-ui, "SF Pro Text", "Helvetica Neue", sans-serif'
/** Expanded layouts: ink-centre corrections (pt) for the leading group, measured per layout against the screenshots,
 *  since iOS centres the ink rather than the text advance. */
const leadOff = (sb: SbCfg) => { const g = sbGlyph(sb)
  return sb.bubble ? (g === 'arrow' ? 0.35 : g === 'moon' ? -0.05 : 0) : sb.act ? -0.1 : -0.4 }
/** Island layout in pt, Pro width (Pro Max shifts by half the extra width). */
export function islandLayout(sb: SbCfg, CSS_W: number) {
  const dx = (CSS_W - 402) / 2
  // Right edge depends on what trails the island: bubble 263.74, timer text 305.0, nothing (arrow, no text) 285.07.
  const r = !sbAct(sb) ? 264 : sb.bubble ? 263.74 : sb.act ? 305.0 : 285.07
  // Left edge depends on the island's leading icon, not on the bubble (edge at the centre line, 3x screenshots):
  // arrow 109.93 (with or without bubble), lock 114.26, ring 107.33 (timer) / 108.27 (bubble).
  const l = !sbAct(sb) && sb.islandIcon !== 'lock' ? 138 : sb.islandIcon === 'lock' ? LOCK.islandL : sb.islandIcon === 'arrow' ? 109.93 : sb.bubble ? 108.27 : 107.33
  // the left ear used to centre the time keeps the previously fitted values (time placement already matches)
  const ear = !sbAct(sb) ? 138 : sb.bubble ? 108.3 : sb.act ? 107.3 : 109.7
  const rc = !sbAct(sb) ? 264 : sb.bubble ? 263.7 : sb.act ? 304.7 : 285.3 // right-cluster anchor, previously fitted
  return { l: l + dx, r: r + dx, ear: ear + dx, rc: rc + dx, top: ISL.top, h: ISL.h, bubble: sb.bubble ? { l: 271.7 + dx, d: 36.7 } : null, dx }
}

const RING_R = 9.2, RING_C = 2 * Math.PI * RING_R
/** Orange timer ring in a 22x22 box. */
const Ring = ({ p, c = ORANGE }: { p: number; c?: string }) => <>
  <circle cx="11" cy="11" r={RING_R} fill="none" stroke={c} strokeOpacity="0.3" strokeWidth="2.3" />
  <circle cx="11" cy="11" r={RING_R} fill="none" stroke={c} strokeWidth="2.3" strokeLinecap="round" strokeDasharray={`${RING_C * p} ${RING_C}`} transform="rotate(-90 11 11)" /></>
// Maps navigation arrow in the expanded island, traced from two 3x screenshots (Maps live activity): ink 12.78 x 13.94 pt,
// tip at y 24.57, base at 38.51, notch apex at 34.33, centred at x 128.84 (Pro); colour #5096f3. Island-independent position.
export const BUBBLE_ARROW_DX = 128.84 + 161 - 271.7 // arrow centre from the bubble's left edge
export const NAV = { cx: 128.84, cy: 31.54, w: 12.78, h: 13.94, notch: 34.33 - 24.57, color: '#5096f3' }
const NavArrow = ({ cx, cy }: { cx: number; cy: number }) => { const hw = NAV.w / 2, hh = NAV.h / 2, sw = 1.3, i = sw / 2
  // svg boxes snap to whole CSS px, so place via snapBox (fraction in the viewBox)
  return <svg {...snapBox(cx - hw - 2, cy - hh - 2, 1, -hw - 2, -hh - 2, NAV.w + 4, NAV.h + 4)}>
    <path d={`M0 ${-hh + i * 1.25}L${hw - i * 1.17} ${hh - i - 0.23}L0 ${-hh + NAV.notch - i * 1.34}L${-hw + i * 1.17} ${hh - i - 0.23}z`} fill={NAV.color} stroke={NAV.color} strokeWidth={sw} strokeLinejoin="round" /></svg> }

// Lock-screen padlock in the island, traced from the 3x ROGERS lock screen: ink 11.13 x 14.7 pt, body 126.77-137.90 x 31.2-39.5 (r 1.5),
// shackle stroke 1.35 on a 3.5 pt centre radius (outer top y 24.87, outer legs 128.17-136.53), centred x 132.33, flat grey #d5d5d5.
// Positioned from the island's left edge (body 12.52 pt in).
export const LOCK = { islandL: 114.26, dx: 12.52, bw: 11.13, by: 31.35, bh: 8.2, br: 1.5, sr: 3.5, sw: 1.35, top: 25.0, color: '#d5d5d5' }
const Padlock = ({ l, c = LOCK.color }: { l: number; c?: string }) => { const x0 = l + LOCK.dx, cx = LOCK.bw / 2, ay = LOCK.top + LOCK.sw / 2 + LOCK.sr
  return <svg {...snapBox(x0 - 1, LOCK.top - 1, 1, -1, LOCK.top - 1, LOCK.bw + 2, LOCK.by + LOCK.bh - LOCK.top + 2)}>
    <path d={`M${cx - LOCK.sr} ${LOCK.by + 0.5}V${ay}a${LOCK.sr} ${LOCK.sr} 0 0 1 ${2 * LOCK.sr} 0V${LOCK.by + 0.5}`} fill="none" stroke={c} strokeWidth={LOCK.sw} />
    <rect x="0" y={LOCK.by} width={LOCK.bw} height={LOCK.bh} rx={LOCK.br} fill={c} /></svg> }

/** Island look. Photo: black. Sketch: the 3D island's sketch tone with a thin sketch-line outline, so the status-bar island is
 *  the single island on screen (the 3D island mesh is hidden whenever this one is drawn). */
export type IslandLook = { fill: string; line: string; lw: number; accent: string; lock: string; lens?: boolean }
export const ISLAND_PHOTO: IslandLook = { fill: '#000', line: 'none', lw: 0, accent: ORANGE, lock: LOCK.color, lens: true }
/** Sketch: fill = Sketch's dark tone (#bdb5a6), outline in the sketch line colour; orange deepened and padlock in the line colour
 *  so they stay legible on the light pill. */
export const islandSketch = (line: string): IslandLook => ({ fill: '#000', line, lw: 0.6, accent: ORANGE, lock: LOCK.color }) // black like the screen (supersedes the beige pill); lens blended in, so no lens drawn

/** The Dynamic Island with an optional timer-style live activity and a minimal bubble. */
export function Island({ sb, w, look = ISLAND_PHOTO }: { sb: SbCfg; w: number; look?: IslandLook }) {
  const L = islandLayout(sb, w), i = look.lw / 2
  return <>
    {/* pill drawn as an SVG at a whole-point origin with the fractional offset inside, since a div's box snaps to whole points */}
    <svg width={Math.ceil(L.r) - Math.floor(L.l) + 1} height={L.h + 1} style={{ position: 'absolute', left: Math.floor(L.l), top: L.top, pointerEvents: 'none', overflow: 'visible' }}>
      <rect x={L.l - Math.floor(L.l) + i} y={i} width={L.r - L.l - 2 * i} height={L.h - 2 * i} rx={L.h / 2 - i} fill={look.fill} stroke={look.line} strokeWidth={look.lw} />
      {look.lens && (() => { const cx = w / 2 + FRONT_LENS.dx - Math.floor(L.l), cy = L.h / 2, r = FRONT_LENS.r
        return <g><circle cx={cx} cy={cy} r={r} fill="#060607" /><circle cx={cx} cy={cy} r={r * 0.72} fill="#141519" />
          <circle cx={cx} cy={cy} r={r * 0.45} fill="none" stroke="#25262c" strokeWidth={0.5} /><circle cx={cx} cy={cy} r={r * 0.2} fill="#08080a" /></g> })()}
    </svg>
    <div style={{ position: 'absolute', left: L.l, top: L.top, width: L.r - L.l, height: L.h, pointerEvents: 'none' }}>
      {sbAct(sb) && sb.islandIcon === 'ring' && <svg width="22" height="22" viewBox="0 0 22 22" style={{ position: 'absolute', left: 8.05, top: 7.2 }}><Ring p={sb.ring} c={look.accent} /></svg>}
      {sbAct(sb) && !sb.bubble && <div style={{ position: 'absolute', right: 9, top: 0, height: L.h, display: 'flex', alignItems: 'center', color: look.accent,
        font: `500 15.5px/1 ${SB_FONT}`, letterSpacing: -0.2, fontVariantNumeric: 'tabular-nums' }}>{sb.act}</div>}
    </div>
    {/* drawn in page coordinates, outside the island div, so its sub-pixel position is exact */}
    {sbAct(sb) && sb.islandIcon === 'arrow' && <NavArrow cx={NAV.cx + L.dx} cy={NAV.cy} />}
    {sb.islandIcon === 'lock' && <Padlock l={L.l} c={look.lock} />}
    {L.bubble && <div style={{ position: 'absolute', left: L.bubble.l, top: L.top, width: L.bubble.d, height: L.bubble.d, borderRadius: '50%', background: look.fill, boxSizing: 'border-box', border: look.lw ? `${look.lw}px solid ${look.line}` : undefined, pointerEvents: 'none' }}>
      {sb.bubbleIcon === 'ring' && <svg width="22" height="22" viewBox="0 0 22 22" style={{ position: 'absolute', left: (L.bubble.d - 22) / 2 - (look.lw || 0), top: (L.bubble.d - 22) / 2 - (look.lw || 0) }}><Ring p={sb.ring} c={look.accent} /></svg>}
    </div>}
    {/* bubble arrow: the 3x screenshots show the same Maps glyph as the island arrow (pixel-identical, same #5096f3 tint, upright),
        exactly 161.00 pt right of it (ink centroid 289.68, 32.30; bbox 283.67-296.00 x 24.67-38.33), i.e. 18.14 pt into the 36.7 pt bubble.
        Drawn in page coordinates via snapBox so its sub-pixel position is exact. */}
    {L.bubble && sb.bubbleIcon === 'arrow' && <NavArrow cx={L.bubble.l + BUBBLE_ARROW_DX} cy={NAV.cy} />}
  </>
}

// Glyphs fitted to the 3x screenshots (circle minus circle; rounded quad), in pt with y relative to the centre line SB_CY.
const MOON_W = 13.56, ARROW_W = 12.83
const Moon = ({ c, x }: { c: string; x: number }) => <path transform={`translate(${x} 0)`} fill={c} d="M5.591 -6.577A6.854 6.854 0 1 0 13.557 1.595A5.777 5.777 0 0 1 5.591 -6.577z" />
const Arrow = ({ c, x }: { c: string; x: number }) => <path transform={`translate(${x} 0) scale(1.1 1.032)`} fill={c} stroke={c} strokeWidth="1.404" strokeLinejoin="round" d="M0.701 -0.38L5.019 1.031L6.149 6.003L10.955 -5.013z" />

/** Props for an absolutely placed svg drawing user units (vx, vy, vw, vh) at CSS (left, top) with scale k. Chrome snaps the
 *  svg box to whole CSS px, so the box sits on integer px and the fraction moves into the viewBox (sub-pixel exact). */
function snapBox(left: number, top: number, k: number, vx: number, vy: number, vw: number, vh: number) {
  const l = Math.floor(left), t = Math.floor(top), w = Math.ceil(vw * k + left - l) + 1, h = Math.ceil(vh * k + top - t) + 1
  return { width: w, height: h, viewBox: `${vx - (left - l) / k} ${vy - (top - t) / k} ${w / k} ${h / k}`, overflow: 'visible' as const,
    style: { position: 'absolute' as const, left: l, top: t, overflow: 'visible' as const } }
}

// Lock-screen line under the battery, measured on the 3x ROGERS lock screen: x 315.67-370.5 (54.83 wide, rounded ends),
// y 47.0-49.26 (2.26 thick). It adds a flat +61/255 to every channel (bg 231,210,135 -> 255,255,196), i.e. white at 0.24 with plus-lighter.
export const BLINE = { l: 315.67, w: 54.83, y: 47.0, h: 2.26, a: 0.24 }

/** iOS status bar: time (or carrier) on the left, signal, network and battery on the right, on the island centre line. */
export function StatusBar({ tone, sb, w: CSS_W, time }: { tone: 'dark' | 'light'; sb: SbCfg; w: number; time: string }) {
  const c = tone === 'dark' ? '#000' : '#fff'
  // dimmed parts measured per tone: battery 0.3 on dark text, 0.5 on light; Wi-Fi 0.2 on dark text
  const BDIM = tone === 'dark' ? 0.3 : 0.5, WDIM = tone === 'dark' ? 0.205 : DIM
  const L = islandLayout(sb, CSS_W), lvl = sb.level / 100
  // left: compact -> time centred at 65 with the glyph hanging right; expanded -> time + glyph centred in [12, island left]
  const GW = sbGlyph(sb) === 'moon' ? MOON_W : sbGlyph(sb) === 'arrow' ? ARROW_W : 0, GAP = sbAct(sb) ? GLYPH_GAP_EXP - (sbGlyph(sb) === 'moon' ? 0.35 : 0) : GLYPH_GAP
  const K = sbAct(sb) ? EXP_K : 1, KL = sb.carrier ? 1 : K // the carrier name is not scaled
  const tf = sb.carrier ? `400 15px ${SB_FONT}` : TIME_CMP, tls = sb.carrier ? 0.13 : sbAct(sb) ? TIME_LS_EXP : TIME_LS_CMP
  const tw = textWidth(sb.carrier ?? time, tf, tls)
  const groupW = tw + (GW ? GAP + GW : 0)
  const timeL = sb.carrier ? 37.8 : !sbAct(sb) ? 64.9 - tw / 2 : (12 + L.ear) / 2 - groupW / 2 + leadOff(sb)
  // right cluster pieces (x in a local svg, y relative to top = SB_CY - 8)
  const items: { w: number; gap: number; net?: boolean; el: (x: number) => React.ReactNode }[] = []
  // Dual SIM. Compact: bars 3.36 wide on a 5.333 pitch. Expanded island: iOS redraws them narrower rather than just scaling by
  // EXP_K, measured on three 3x screenshots as exactly 3.00 pt wide (9 px) on a 5.00 pt pitch, top row 4.13/4.94/6.55/8.21 pt,
  // second row 35.30-39.11 pt, and 6.2 pt of clear space before LTE / 5G (vs 5.1 with the cluster gap). Units here are pre-K.
  let netDropped = false
  const dimS = tone === 'light' ? DIM2_LIGHT : DIM2
  if (sb.sig >= 0) items.push(sb.dual ? { w: 18.33, gap: 0, el: x => { const e = K !== 1, bw = e ? 3 / K : 3.36, pitch = e ? 5 / K : 5.333
      // ink-centre corrections measured per layout: LTE / 5G next (location + LTE), timer text in the island (time alone)
      const x0 = x + 0.4 + (e ? ((sb.net === 'lte' || sb.net === '5g') && !netDropped ? -1.07 : !sb.bubble && sb.act ? 0.3 : 0) / K : 0)
      const hs = e ? [3.925, 4.76, 6.526, 8.27] : [4.02, 5.06, 6.69, 8.29], y2 = e ? 11.765 : 11.68, h2 = e ? 3.605 : 3.69
      return <g key="sig" fill={c}>
      {hs.map((h, i) => <rect key={i} x={x0 + i * pitch} y={10.04 - h} width={bw} height={h} rx="1" fillOpacity={i < sb.sig ? 1 : dimS} />)}
      {[0, 1, 2, 3].map(i => <rect key={'b' + i} x={x0 + i * pitch} y={y2} width={bw} height={h2} rx="1" fillOpacity={i < sb.sig2 ? 1 : dimS} />)}</g> } }
    : { w: 19, gap: 0, el: x => <g key="sig" fill={c}>{[4.3, 3.3, 1.6, 0].map((t, i) => <rect key={i} x={x + i * 5.33} y={t + 1.4} width="3.33" height={13 - t} rx="1" fillOpacity={i < sb.sig ? 1 : DIM} />)}</g> })
  if (sb.net === 'wifi') items.push({ net: true, w: 16.85, gap: sbAct(sb) ? 2.22 : 8, el: x => <g key="wifi" transform={`translate(${x} 8.4)`} fill={c} stroke={c} strokeWidth="0.76" strokeLinejoin="round">
      <path fillOpacity={sb.wifi >= 3 ? 1 : WDIM} strokeOpacity={sb.wifi >= 3 ? 1 : WDIM} d="M0.54 -2.41L1.66 -1.23L3.16 -2.32L4.82 -3.12L6.59 -3.61L8.42 -3.78L10.25 -3.61L12.03 -3.12L13.68 -2.32L15.18 -1.23L16.31 -2.41L15.49 -3.07L14.52 -3.72L13.67 -4.18L12.6 -4.65L11.49 -5L10.55 -5.22L9.39 -5.37L8.42 -5.41L7.45 -5.37L6.3 -5.22L5.17 -4.95L4.24 -4.65L3.18 -4.18L2.32 -3.72L1.36 -3.07z" />
      <path fillOpacity={sb.wifi >= 2 ? 1 : WDIM} strokeOpacity={sb.wifi >= 2 ? 1 : WDIM} d="M3.4 0.61L4.59 1.86L5.43 1.27L6.41 0.82L7.45 0.55L8.42 0.47L9.4 0.55L10.44 0.82L11.42 1.27L12.26 1.86L13.44 0.61L12.38 -0.15L11.14 -0.75L9.8 -1.12L8.42 -1.25L7.04 -1.12L5.71 -0.75L4.46 -0.15z" />
      <path fillOpacity={sb.wifi >= 1 ? 1 : WDIM} strokeOpacity={sb.wifi >= 1 ? 1 : WDIM} d="M6.34 3.7L8.42 5.9L10.51 3.7L10.05 3.41L9.53 3.18L8.99 3.05L8.42 3L7.86 3.05L7.31 3.18L6.79 3.41z" /></g> })
  if (sb.net === 'lte' || sb.net === '5g') { const t = sb.net === 'lte' ? 'LTE' : '5G', w = sb.net === 'lte' ? 18.7 : 13.5
    items.push({ net: true, w, gap: sbAct(sb) ? 6 : 9.67, el: x => <text key="net" x={x + w / 2} y={14.02} textAnchor="middle" textLength={w * 1.09} lengthAdjust="spacingAndGlyphs" fill={c} style={{ font: `600 13.7px ${SB_FONT}` }}>{t}</text> }) }
  const BW = sbAct(sb) ? 25.12 : 24.28
  items.push({ w: 27.0 + BW - 24.28, gap: sbAct(sb) ? (sb.net === 'wifi' ? 5.23 : 6.77) : 8, el: x => <g key="bat">
      <defs><mask id="sb-pct" maskUnits="userSpaceOnUse"><rect x={x} y="0" width="30" height="17" fill="#fff" />
        {sb.pct && <text x={x + 0.42 + BW / 2 - (sbAct(sb) ? 0.3 : 0)} y={sbAct(sb) ? 12.45 : 12.8} textAnchor="middle" fill="#000" style={{ font: `${BAT_FONT}px ${SB_FONT}`, letterSpacing: BAT_LS }}>{sb.level}</text>}</mask>
        <clipPath id="sb-lvl"><rect x={x} y="0" width={0.23 + BW * lvl} height="17" /></clipPath></defs>
      {sb.pct ? <g mask="url(#sb-pct)">
        <rect x={x + 0.23} y="1.68" width={BW} height="13.63" rx="4.2" fill={c} fillOpacity={BDIM} />
        <rect x={x + 0.23} y="1.68" width={BW} height="13.63" rx="4.2" fill={c} clipPath="url(#sb-lvl)" /></g>
      : <g><rect x={x + 0.5} y="1.85" width="23.7" height="12.3" rx="3.8" fill="none" stroke={c} strokeOpacity="0.35" />
        <rect x={x + 2} y="3.35" width={20.7 * lvl} height="9.3" rx="2.4" fill={c} /></g>}
      <path d={`M${x + 2.02 + BW - (sbAct(sb) ? 0.7 : 0)} 6.33h0.3a1.03 2 0 0 1 0 4h-0.3z`} fill={c} fillOpacity={BDIM} /></g> })
  const rightEdge = L.bubble ? L.bubble.l + L.bubble.d : L.rc
  if (K !== 1) items.forEach(it => { it.gap /= K })
  // INFERRED (no screenshot shows it): with an expanded island the cluster is centred between the island's right edge and
  // x 384.4 (+dx). If it would leave less than RC_MIN_PAD pt either side, iOS-style, the network item (LTE / 5G / Wi-Fi) is
  // dropped first. Measured layouts all keep >= 6.0 pt (Wi-Fi + bubble), timer + signal + battery leaves 14.3; adding LTE
  // to the timer island would leave 2.4, which is what looked cramped.
  if (sbAct(sb)) { const span = 384.4 + 2 * L.dx - rightEdge, pad = () => (span - items.reduce((s, it, j) => s + (j ? it.gap : 0) + it.w, 0) * K) / 2
    while (pad() < RC_MIN_PAD && items.some(it => it.net)) { items.splice(items.findIndex(it => it.net), 1); netDropped = true } }
  items[0].gap = 0
  const W = items.reduce((s, it) => s + it.gap + it.w, 0)
  const rcx = sbAct(sb) ? (rightEdge + 384.4 + 2 * L.dx) / 2 + (L.bubble ? 0.45 : sb.act ? 0.4 : 1.1) : CSS_W - (402 - 326.85)
  let x = 0
  const els = items.map(it => { x += it.gap; const e = it.el(x); x += it.w; return e })
  return (
    <div style={{ position: 'absolute', left: 0, top: 0, width: CSS_W, height: STATUS_H, pointerEvents: 'none', color: c }}>
      {/* leading group as SVG text: DOM text snaps to whole CSS px, SVG text and paths place at sub-pixel precision */}
      <svg {...snapBox(timeL + groupW * (1 - KL) / 2, SB_CY - 11 * KL, KL, 0, -11, groupW, 22)} aria-hidden><g transform={sbAct(sb) || sb.carrier ? undefined : 'translate(0 0.07)'}>
        <text x="0" y={sb.carrier ? CARRIER_BASE : TIME_BASE} fill={c} style={{ font: tf, letterSpacing: tls, whiteSpace: 'pre' }}>
          {sb.carrier ?? time.split(':').map((p, i) => i ? [<tspan key={'c' + i} dy={COLON_DY}>:</tspan>, <tspan key={'d' + i} dy={-COLON_DY}>{p}</tspan>] : <tspan key="h">{p}</tspan>)}</text>
        {!sb.carrier && sbGlyph(sb) === 'moon' && <Moon c={c} x={tw + GAP} />}{!sb.carrier && sbGlyph(sb) === 'arrow' && <Arrow c={c} x={tw + GAP} />}</g>
      </svg>
      {sb.batteryLine && <svg {...snapBox(BLINE.l + L.dx, BLINE.y, 1, 0, 0, BLINE.w, BLINE.h)} style={{ ...snapBox(BLINE.l + L.dx, BLINE.y, 1, 0, 0, BLINE.w, BLINE.h).style, mixBlendMode: tone === 'light' ? 'plus-lighter' : 'normal' }}>
        <rect width={BLINE.w} height={BLINE.h} rx={BLINE.h / 2} fill={tone === 'light' ? '#fff' : '#000'} fillOpacity={BLINE.a} /></svg>}
      <svg {...snapBox(rcx - W * K / 2, SB_CY - 8 * K - 0.33, K, 0, 0, W, 16)} aria-hidden>{els}</svg>
    </div>
  )
}

