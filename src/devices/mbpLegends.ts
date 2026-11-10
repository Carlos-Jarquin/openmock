// Key legends for the 16" MacBook Pro, shared by the studio and /live.
// Letters and words are SF Pro (the system face on a Mac; Inter stands in where SF Pro is not installed).
// The icons are drawn, at the weight of SF Symbols Regular, because that font is not a text face we can ship.
// Sizes are in millimetres on a 15.8 mm key face. SF Pro's cap-height is about 0.70 of the em.
import * as THREE from 'three'
import { MBP, MBP_KEY_ROWS } from './MacBookPro'

const PPM = 16 // canvas pixels per millimetre
const INK = '#e6e6eb'
const SANS = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro", Inter, "Helvetica Neue", system-ui, sans-serif'

// Measured against the 16" key photo: a letter's cap is about 30% of the 15.8 mm face,
// the shifted glyph sits just above the base character, and modifier words sit in the corner.
const LETTER = 6.4 // em; cap about 4.5 mm
const PAIR = 3.7
const WORD = 1.95
const ICON = 5.4
const ARROW = 3.35
const SYMBOL = 2.7
const GLOBE = 3.6

type Icon = 'sunMin' | 'sunMax' | 'mission' | 'search' | 'mic' | 'moon' | 'rew' | 'play' | 'ff' | 'mute' | 'volDown' | 'volUp'
type Sym = 'ctrl' | 'opt' | 'cmd' | 'globe'
type Mark =
  | { t: 'ch'; s: string }
  | { t: 'pair'; a: string; b: string }
  | { t: 'word'; s: string; side: 'l' | 'r'; dot?: boolean }
  | { t: 'stack'; sym: Sym; word: string }
  | { t: 'icon'; n: Icon }
  | { t: 'id' }
  | { t: 'arrow'; d: 'l' | 'r' | 'u' | 'd' }
  | { t: 'blank' }

const ch = (s: string): Mark => ({ t: 'ch', s })
const pair = (a: string, b: string): Mark => ({ t: 'pair', a, b })
// Rows run from the space row up, matching MBP_KEY_ROWS. Shifted glyphs sit above the base character.
const MARKS: Mark[][] = [
  [
    { t: 'stack', sym: 'globe', word: 'fn' },
    { t: 'stack', sym: 'ctrl', word: 'control' },
    { t: 'stack', sym: 'opt', word: 'option' },
    { t: 'stack', sym: 'cmd', word: 'command' },
    { t: 'blank' },
    { t: 'stack', sym: 'cmd', word: 'command' },
    { t: 'stack', sym: 'opt', word: 'option' },
    { t: 'arrow', d: 'l' },
    { t: 'blank' },
    { t: 'arrow', d: 'r' },
  ],
  [
    { t: 'word', s: 'shift', side: 'l' },
    ch('Z'), ch('X'), ch('C'), ch('V'), ch('B'), ch('N'), ch('M'),
    pair('<', ','), pair('>', '.'), pair('?', '/'),
    { t: 'word', s: 'shift', side: 'r' },
  ],
  [
    { t: 'word', s: 'caps lock', side: 'l', dot: true },
    ...'ASDFGHJKL'.split('').map(ch),
    pair(':', ';'), pair('"', "'"),
    { t: 'word', s: 'return', side: 'r' },
  ],
  [
    { t: 'word', s: 'tab', side: 'l' },
    ...'QWERTYUIOP'.split('').map(ch),
    pair('{', '['), pair('}', ']'), pair('|', '\\'),
  ],
  [
    pair('~', '`'), pair('!', '1'), pair('@', '2'), pair('#', '3'), pair('$', '4'), pair('%', '5'),
    pair('^', '6'), pair('&', '7'), pair('*', '8'), pair('(', '9'), pair(')', '0'),
    pair('_', '-'), pair('+', '='),
    { t: 'word', s: 'delete', side: 'r' },
  ],
  [
    { t: 'word', s: 'esc', side: 'l' },
    { t: 'icon', n: 'sunMin' }, { t: 'icon', n: 'sunMax' }, { t: 'icon', n: 'mission' }, { t: 'icon', n: 'search' },
    { t: 'icon', n: 'mic' }, { t: 'icon', n: 'moon' }, { t: 'icon', n: 'rew' }, { t: 'icon', n: 'play' },
    { t: 'icon', n: 'ff' }, { t: 'icon', n: 'mute' }, { t: 'icon', n: 'volDown' }, { t: 'icon', n: 'volUp' },
    { t: 'id' },
  ],
]

const font = (weight: number, emMm: number) => `${weight} ${Math.round(emMm * PPM)}px ${SANS}`

function icon(ctx: CanvasRenderingContext2D, name: Icon, cx: number, cy: number) {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.scale(ICON * PPM / 24, ICON * PPM / 24)
  ctx.lineWidth = 1.45
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = INK
  ctx.fillStyle = INK
  const sun = (r: number, inner: number, outer: number) => {
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke()
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4
      ctx.beginPath()
      ctx.moveTo(Math.cos(a) * inner, Math.sin(a) * inner)
      ctx.lineTo(Math.cos(a) * outer, Math.sin(a) * outer)
      ctx.stroke()
    }
  }
  // dir 1 points right. Rewind is two left-pointing triangles, fast-forward two right-pointing ones.
  const tri = (dir: 1 | -1, x: number) => {
    ctx.beginPath()
    ctx.moveTo(x + dir * 3.5, 0)
    ctx.lineTo(x - dir * 3.5, -5.15)
    ctx.lineTo(x - dir * 3.5, 5.15)
    ctx.closePath(); ctx.fill()
  }
  const speaker = (waves: number, slash: boolean) => {
    ctx.beginPath(); ctx.roundRect(-8.2, -2.05, 2.7, 4.1, 0.4); ctx.fill()
    ctx.beginPath()
    ctx.moveTo(-5.5, -2.05); ctx.lineTo(-0.6, -5.7); ctx.lineTo(-0.6, 5.7); ctx.lineTo(-5.5, 2.05)
    ctx.closePath(); ctx.fill()
    const rs = waves === 3 ? [3.2, 5.5, 7.8] : waves === 1 ? [4.4] : []
    for (const r of rs) { ctx.beginPath(); ctx.arc(-0.2, 0, r, -0.8, 0.8); ctx.stroke() }
    if (slash) { ctx.beginPath(); ctx.moveTo(-6.8, 6.6); ctx.lineTo(6.2, -6.6); ctx.stroke() }
  }
  if (name === 'sunMin') sun(3.15, 4.5, 6.3)
  else if (name === 'sunMax') sun(4.15, 5.7, 8.5)
  else if (name === 'mission') {
    ctx.beginPath(); ctx.roundRect(-7.4, -7.6, 10.4, 10.2, 1.7); ctx.stroke()
    ctx.beginPath(); ctx.roundRect(-3.0, -2.6, 10.4, 10.2, 1.7); ctx.stroke()
  } else if (name === 'search') {
    ctx.beginPath(); ctx.arc(-1.8, -1.8, 4.7, 0, Math.PI * 2); ctx.stroke()
    const a = Math.PI / 4
    ctx.beginPath()
    ctx.moveTo(-1.8 + Math.cos(a) * 5.5, -1.8 + Math.sin(a) * 5.5)
    ctx.lineTo(7.4, 7.4); ctx.stroke()
  } else if (name === 'mic') {
    ctx.beginPath(); ctx.roundRect(-2.35, -8.4, 4.7, 8.6, 2.35); ctx.stroke()
    ctx.beginPath(); ctx.arc(0, -2.0, 4.7, 0.18 * Math.PI, 0.82 * Math.PI); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(0, 2.5); ctx.lineTo(0, 5.8); ctx.moveTo(-3.3, 5.8); ctx.lineTo(3.3, 5.8); ctx.stroke()
  } else if (name === 'moon') {
    ctx.beginPath(); ctx.arc(-0.7, 0.2, 6.5, 0, Math.PI * 2); ctx.arc(2.5, -0.9, 5.3, 0, Math.PI * 2); ctx.fill('evenodd')
  } else if (name === 'rew') { tri(-1, -4.5); tri(-1, 3.3) }
  else if (name === 'ff') { tri(1, -3.3); tri(1, 4.5) }
  else if (name === 'play') {
    ctx.beginPath(); ctx.moveTo(-6.6, -5.3); ctx.lineTo(-6.6, 5.3); ctx.lineTo(0.6, 0); ctx.closePath(); ctx.fill()
    ctx.beginPath(); ctx.roundRect(2.8, -5.1, 2.15, 10.2, 0.6); ctx.fill()
    ctx.beginPath(); ctx.roundRect(6.2, -5.1, 2.15, 10.2, 0.6); ctx.fill()
  } else if (name === 'mute') speaker(0, true)
  else if (name === 'volDown') speaker(1, false)
  else speaker(3, false)
  ctx.restore()
}

function symbol(ctx: CanvasRenderingContext2D, sym: Sym, cx: number, cy: number, s: number) {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.strokeStyle = INK
  ctx.fillStyle = INK
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  if (sym === 'ctrl') {
    ctx.lineWidth = s * 0.13
    ctx.beginPath(); ctx.moveTo(-s * 0.46, s * 0.16); ctx.lineTo(0, -s * 0.34); ctx.lineTo(s * 0.46, s * 0.16); ctx.stroke()
  } else if (sym === 'opt') {
    ctx.lineWidth = s * 0.12
    ctx.beginPath()
    ctx.moveTo(-s * 0.34, s * 0.42); ctx.lineTo(-s * 0.34, -s * 0.42); ctx.lineTo(s * 0.46, -s * 0.42)
    ctx.moveTo(-s * 0.34, -s * 0.02); ctx.lineTo(s * 0.32, s * 0.44)
    ctx.stroke()
  } else if (sym === 'cmd') {
    const a = s * 0.32, r = s * 0.185
    ctx.lineWidth = s * 0.125
    for (const [x, y] of [[-a, -a], [a, -a], [a, a], [-a, a]] as const) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke() }
    ctx.beginPath()
    ctx.moveTo(-a, -a + r); ctx.lineTo(-a, a - r)
    ctx.moveTo(a, -a + r); ctx.lineTo(a, a - r)
    ctx.moveTo(-a + r, -a); ctx.lineTo(a - r, -a)
    ctx.moveTo(-a + r, a); ctx.lineTo(a - r, a)
    ctx.stroke()
  } else {
    ctx.lineWidth = s * 0.075
    ctx.beginPath(); ctx.arc(0, 0, s * 0.48, 0, Math.PI * 2); ctx.stroke()
    ctx.beginPath(); ctx.ellipse(0, 0, s * 0.48, s * 0.16, 0, 0, Math.PI * 2); ctx.stroke()
    ctx.beginPath(); ctx.ellipse(0, 0, s * 0.18, s * 0.48, 0, 0, Math.PI * 2); ctx.stroke()
  }
  ctx.restore()
}

function arrow(ctx: CanvasRenderingContext2D, cx: number, cy: number, d: 'l' | 'r' | 'u' | 'd') {
  const s = ARROW * PPM
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(d === 'u' ? 0 : d === 'r' ? Math.PI / 2 : d === 'd' ? Math.PI : -Math.PI / 2)
  ctx.fillStyle = INK
  ctx.beginPath()
  ctx.moveTo(0, -s * 0.52)
  ctx.lineTo(s * 0.34, -s * 0.02)
  ctx.lineTo(s * 0.13, -s * 0.02)
  ctx.lineTo(s * 0.13, s * 0.50)
  ctx.lineTo(-s * 0.13, s * 0.50)
  ctx.lineTo(-s * 0.13, -s * 0.02)
  ctx.lineTo(-s * 0.34, -s * 0.02)
  ctx.closePath(); ctx.fill()
  ctx.restore()
}

export interface MbpLegends { map: THREE.CanvasTexture; w: number; h: number; cy: number }

let cached: MbpLegends | null = null

/** One transparent legend sheet, in the base frame: x right, y toward the hinge, just above the key tops. */
export function mbpLegends(): MbpLegends {
  if (cached) return cached
  const pitch = MBP.kb.pitch, gap = MBP.kb.gap
  const x0 = -7.5 * pitch
  const y0 = -MBP.d / 2 + MBP.kb.bottom
  const wMm = 15 * pitch, hMm = MBP.kb.rows * pitch
  const y1 = y0 + hMm
  const cW = Math.round(wMm * PPM), cH = Math.round(hMm * PPM)
  const canvas = document.createElement('canvas')
  canvas.width = cW; canvas.height = cH
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, cW, cH)
  ctx.fillStyle = INK
  const toX = (xmm: number) => (xmm - x0) * PPM
  const toY = (ymm: number) => (y1 - ymm) * PPM

  const place = (mark: Mark, xmm: number, ymm: number, units: number, half: boolean) => {
    const fw = (units * pitch - gap) * PPM
    const fh = ((half ? pitch / 2 : pitch) - gap) * PPM
    const cx = Math.round(toX(xmm)), cy = Math.round(toY(ymm))
    const left = cx - fw / 2, top = cy - fh / 2
    if (mark.t === 'blank') return
    if (mark.t === 'ch') {
      ctx.font = font(400, LETTER); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText(mark.s, cx, cy - 0.2 * PPM)
    } else if (mark.t === 'pair') {
      ctx.font = font(400, PAIR); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      // Glyphs that sit on the baseline, or hang high in the em, get a nudge so the pair stays balanced.
      const nudge = (g: string) => (g === '_' || g === ',' || g === '.' || g === '`' ? -PAIR * 0.22 : g === '^' || g === '*' || g === '"' || g === "'" || g === '~' ? PAIR * 0.1 : 0)
      ctx.fillText(mark.a, cx, cy - 1.85 * PPM + nudge(mark.a) * PPM)
      ctx.fillText(mark.b, cx, cy + 1.95 * PPM + nudge(mark.b) * PPM)
    } else if (mark.t === 'word') {
      ctx.font = font(500, WORD); ctx.textAlign = mark.side === 'l' ? 'left' : 'right'; ctx.textBaseline = 'alphabetic'
      const pad = 1.45 * PPM
      ctx.fillText(mark.s, mark.side === 'l' ? left + pad : left + fw - pad, top + fh - 1.15 * PPM)
      if (mark.dot) {
        ctx.beginPath(); ctx.arc(left + 2.35 * PPM, top + 3.3 * PPM, 0.62 * PPM, 0, Math.PI * 2); ctx.fill()
      }
    } else if (mark.t === 'stack') {
      const sym = mark.sym === 'globe' ? GLOBE : SYMBOL
      symbol(ctx, mark.sym, cx, cy - (mark.sym === 'globe' ? 1.35 : 1.05) * PPM, sym * PPM)
      ctx.font = font(500, WORD); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = INK
      ctx.fillText(mark.word, cx, cy + 1.55 * PPM)
    } else if (mark.t === 'icon') icon(ctx, mark.n, cx, cy)
    else if (mark.t === 'arrow') arrow(ctx, cx, cy, mark.d)
    else {
      ctx.beginPath(); ctx.arc(cx, cy, 6.5 * PPM, 0, Math.PI * 2)
      ctx.fillStyle = '#101012'; ctx.fill()
      ctx.lineWidth = 0.7 * PPM; ctx.strokeStyle = '#6a6a70'; ctx.stroke()
      ctx.fillStyle = INK
    }
  }

  MBP_KEY_ROWS.forEach((ws, row) => {
    const marks = MARKS[row]
    if (!marks || marks.length !== ws.length) throw new Error(`legend row ${row} does not match the key row`)
    let x = x0
    ws.forEach((units, col) => {
      const xmm = x + units * pitch / 2
      const ymm = y0 + (row + 0.5) * pitch
      if (row === 0 && col === 8) {
        arrow(ctx, Math.round(toX(xmm)), Math.round(toY(ymm + pitch / 4)), 'u')
        arrow(ctx, Math.round(toX(xmm)), Math.round(toY(ymm - pitch / 4)), 'd')
      } else {
        const half = row === 0 && col >= 7
        place(marks[col], xmm, half ? ymm - pitch / 4 : ymm, units, half)
      }
      x += units * pitch
    })
  })

  const map = new THREE.CanvasTexture(canvas)
  map.colorSpace = THREE.SRGBColorSpace
  map.anisotropy = 16
  map.needsUpdate = true
  cached = { map, w: wMm / 100, h: hMm / 100, cy: (y0 + hMm / 2) / 100 }
  return cached
}
