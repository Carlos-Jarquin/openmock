// Status bar settings shared by /live and the studio. Each field maps to a URL param on /live (see LivePhone.tsx).

export type SbCfg = {
  mode: 'auto' | 'dark' | 'light' | 'off'
  time: string | null // null: live clock
  carrier: string | null // null: show the time
  dnd: boolean; loc: boolean
  net: 'wifi' | 'lte' | '5g' | 'none'; wifi: number
  sig: number // -1: none
  dual: boolean; sig2: number
  level: number; pct: boolean
  island: 'compact' | 'activity'; act: string; ring: number
  bubble: boolean
  islandIcon: SbIcon; bubbleIcon: SbIcon // leading icon of the expanded island / the bubble ('lock' only for the island)
  batteryLine: boolean // lock-screen line under the battery
  homeBar: boolean // home indicator at the bottom of the screen
}
export type SbIcon = 'ring' | 'arrow' | 'lock' | 'none'
const ICONS = ['ring', 'arrow', 'lock', 'none'] as const
const icon = (v: string | null, d: SbIcon): SbIcon => (ICONS as readonly string[]).includes(v ?? '') ? v as SbIcon : d

const clampN = (v: string | null, d: number, lo: number, hi: number) => { const n = Number(v ?? d); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d }
const MODES = ['auto', 'dark', 'light', 'off'] as const, NETS = ['wifi', 'lte', '5g', 'none'] as const

export function parseSb(p: URLSearchParams): SbCfg {
  const q = (k: string) => p.get(k)
  return {
    mode: (MODES as readonly string[]).includes(q('statusbar') ?? '') ? q('statusbar') as SbCfg['mode'] : 'auto',
    time: q('time'), carrier: q('carrier'),
    dnd: q('focus') === 'dnd', loc: q('location') === 'on',
    net: (NETS as readonly string[]).includes(q('network') ?? '') ? q('network') as SbCfg['net'] : 'wifi',
    wifi: Math.round(clampN(q('wifi'), 3, 0, 3)),
    sig: q('signal') === 'none' ? -1 : Math.round(clampN(q('signal'), 4, 0, 4)),
    dual: q('sim') === 'dual', sig2: Math.round(clampN(q('signal2'), 3, 0, 4)),
    level: Math.round(clampN(q('level'), 77, 0, 100)), pct: q('battery') !== 'plain',
    island: q('island') === 'activity' ? 'activity' : 'compact', act: q('activity') ?? '23m', ring: clampN(q('ring'), 0.9, 0, 1),
    bubble: q('bubble') === 'on',
    islandIcon: icon(q('islandIcon'), 'ring'), bubbleIcon: ((b: SbIcon) => b === 'lock' ? 'arrow' : b)(icon(q('bubbleIcon'), 'arrow')),
    batteryLine: q('batteryLine') === 'on',
    homeBar: q('homebar') !== 'off', // on by default
  }
}
export const SB_DEFAULT = parseSb(new URLSearchParams())
/** The moon wins over the arrow, as on iOS (both in one slot). */
export const sbGlyph = (c: SbCfg): 'moon' | 'arrow' | null => c.dnd ? 'moon' : c.loc ? 'arrow' : null
/** Lock screen: carrier name, padlock in the island and the line under the battery (iOS 18 lock screen, 16 Pro). */
export const sbLockScreen = (c: SbCfg) => c.carrier !== null && c.islandIcon === 'lock' && c.batteryLine
export const SB_LOCK: Partial<SbCfg> = { carrier: 'ROGERS', islandIcon: 'lock', batteryLine: true }
export const SB_UNLOCK: Partial<SbCfg> = { carrier: null, islandIcon: 'ring', batteryLine: false }
export const sbAct = (c: SbCfg) => c.island === 'activity' || c.bubble

/** Write only non-default values; other params (device, src, style...) are kept. */
export function writeSb(c: SbCfg) {
  const p = new URLSearchParams(location.search), d = SB_DEFAULT
  const set = (k: string, v: string | null) => { if (v === null) p.delete(k); else p.set(k, v) }
  set('statusbar', c.mode !== d.mode ? c.mode : null)
  set('time', c.time); set('carrier', c.carrier)
  set('focus', c.dnd ? 'dnd' : null); set('location', c.loc ? 'on' : null)
  set('network', c.net !== d.net ? c.net : null); set('wifi', c.wifi !== d.wifi ? String(c.wifi) : null)
  set('signal', c.sig < 0 ? 'none' : c.sig !== d.sig ? String(c.sig) : null)
  set('sim', c.dual ? 'dual' : null); set('signal2', c.dual && c.sig2 !== d.sig2 ? String(c.sig2) : null)
  set('level', c.level !== d.level ? String(c.level) : null); set('battery', c.pct ? null : 'plain')
  set('island', c.island === 'activity' ? 'activity' : null)
  set('activity', c.act !== d.act ? c.act : null); set('ring', c.ring !== d.ring ? String(c.ring) : null)
  set('bubble', c.bubble ? 'on' : null)
  set('islandIcon', c.islandIcon !== d.islandIcon ? c.islandIcon : null); set('bubbleIcon', c.bubbleIcon !== d.bubbleIcon ? c.bubbleIcon : null)
  set('batteryLine', c.batteryLine ? 'on' : null)
  set('homebar', c.homeBar ? null : 'off')
  const qs = p.toString()
  history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash)
}

