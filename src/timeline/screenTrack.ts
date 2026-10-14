// Screen track: clips that say "from time T, show this media on the screen", independent of the motion keyframes.
// Each target screen (inner, and the Duo's outer) has a mixer canvas that draws the clip at the playhead, cutting or
// crossfading from the clip before it. The canvas is the screen texture while the track is in use.
import * as THREE from 'three'

export type ScreenTarget = 'inner' | 'outer' | 'both'
export interface ScreenClip { id: string; at: number; target: ScreenTarget; name: string; kind: 'image' | 'video'; fade: number; src?: string; thumb?: string; /** device uid; missing means the first device (old timelines) */ dev?: string }
export interface Source { el: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement; w: number; h: number; kind: 'image' | 'video' }

/** In-memory media for each clip (videos only live here; images also persist as data URLs). */
export const sources = new Map<string, Source>()
const KEY = 'om-screen-v1'
export const FADES: [number, string][] = [[0, 'Cut'], [0.25, 'Fade 0.25 s'], [0.5, 'Fade 0.5 s'], [1, 'Fade 1 s']]

export const screenLive = {
  clips: [] as ScreenClip[],
  /** bumped whenever a mixer starts or stops covering its screen, or changes shape, so App re-reads the override */
  onShape: null as null | (() => void),
  /** device uids in scene order, set by App */
  devs: [] as string[],
}
export function loadClips(): ScreenClip[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]'); if (!Array.isArray(v)) return []
    for (const c of v as ScreenClip[]) if (c.src && !sources.has(c.id)) { const im = new Image(); im.onload = () => { sources.set(c.id, { el: im, w: im.naturalWidth, h: im.naturalHeight, kind: 'image' }); for (const m of allMixers()) m.key = '' }; im.src = c.src }
    return v
  } catch { return [] }
}
export function saveClips(c: ScreenClip[]) { try { localStorage.setItem(KEY, JSON.stringify(c)) } catch { /* too big for storage: kept for this session */ } }
export const sortClips = (c: ScreenClip[]) => [...c].sort((a, b) => a.at - b.at)

/** Data URL of an image source, at most `maxW` wide (thumbnails and saved images). */
export function toDataUrl(s: Source, maxW: number, type = 'image/jpeg') {
  const k = Math.min(1, maxW / s.w), c = document.createElement('canvas'); c.width = Math.max(1, Math.round(s.w * k)); c.height = Math.max(1, Math.round(s.h * k))
  const g = c.getContext('2d')!; g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height); g.drawImage(s.el, 0, 0, c.width, c.height); return c.toDataURL(type, 0.85)
}
/** Source from a screen texture (image, rasterised SVG canvas or video). */
export function sourceOf(tex: THREE.Texture, kind: 'image' | 'video'): Source | null {
  const el = tex.image as Source['el'] | undefined; if (!el) return null
  const w = (el as HTMLVideoElement).videoWidth || (el as HTMLImageElement).naturalWidth || el.width, h = (el as HTMLVideoElement).videoHeight || (el as HTMLImageElement).naturalHeight || el.height
  return w && h ? { el, w, h, kind } : null
}

const covers = (c: ScreenClip, t: 'inner' | 'outer') => c.target === 'both' || c.target === t
/** The clip showing on a screen at time t, the one before it (for a fade), and how far the fade has got (0 to 1). */
export function clipAt(clips: ScreenClip[], screen: 'inner' | 'outer', t: number) {
  let cur: ScreenClip | null = null, prev: ScreenClip | null = null
  for (const c of clips) { if (!covers(c, screen)) continue; if (c.at <= t + 1e-6) { prev = cur; cur = c } else break }
  const k = cur && prev && cur.fade > 0 ? Math.min(1, (t - cur.at) / cur.fade) : 1
  return { cur, prev: k < 1 ? prev : null, k }
}

class Mixer {
  canvas = document.createElement('canvas')
  tex: THREE.CanvasTexture
  aspect = 0
  key = ''
  on = false
  constructor() { this.canvas.width = 2; this.canvas.height = 2; this.tex = this.make() }
  private make() { const t = new THREE.CanvasTexture(this.canvas); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t }
  update(screen: 'inner' | 'outer', clips: ScreenClip[], t: number, playing: boolean) {
    const { cur, prev, k } = clipAt(clips, screen, t)
    const src = cur && sources.get(cur.id), on = !!src
    if (on !== this.on) { this.on = on; screenLive.onShape?.() }
    if (!src || !cur) { this.key = ''; return }
    // videos follow the playhead: play along while the timeline plays, else hold the frame at that time
    for (const c of [cur, prev]) { const s = c && sources.get(c.id); if (!s || s.kind !== 'video') continue
      const v = s.el as HTMLVideoElement, want = Math.max(0, t - c!.at) % (v.duration || 1e9)
      if (playing) { if (v.paused) v.play().catch(() => {}); if (Math.abs(v.currentTime - want) > 0.25) v.currentTime = want }
      else { if (!v.paused) v.pause(); if (Math.abs(v.currentTime - want) > 0.04) v.currentTime = want } }
    const video = src.kind === 'video' || (!!prev && sources.get(prev.id)?.kind === 'video')
    const key = `${cur.id}|${prev?.id ?? ''}|${k.toFixed(3)}`
    if (key === this.key && !video) return
    this.key = key
    // size the canvas to the clip (at most 1320 px wide), remaking the texture when the shape changes
    const W = Math.min(1320, src.w), H = Math.round(W * src.h / src.w)
    if (this.canvas.width !== W || this.canvas.height !== H) { this.canvas.width = W; this.canvas.height = H; this.tex.dispose(); this.tex = this.make(); this.aspect = W / H; screenLive.onShape?.() }
    const g = this.canvas.getContext('2d')!
    g.globalAlpha = 1; g.fillStyle = '#000'; g.fillRect(0, 0, W, H)
    const ps = prev && sources.get(prev.id)
    if (ps) { const s = Math.max(W / ps.w, H / ps.h), w = ps.w * s, h = ps.h * s; g.drawImage(ps.el, (W - w) / 2, (H - h) / 2, w, h); g.globalAlpha = k }
    g.drawImage(src.el, 0, 0, W, H); g.globalAlpha = 1
    this.tex.needsUpdate = true
  }
}
type Pair = { inner: Mixer; outer: Mixer }
const byDev = new Map<string, Pair>()
/** The mixer pair of one device (made on first use). */
export function mixersFor(uid: string): Pair { let p = byDev.get(uid); if (!p) { p = { inner: new Mixer(), outer: new Mixer() }; byDev.set(uid, p) } return p }
function allMixers() { const a: Mixer[] = []; for (const p of byDev.values()) a.push(p.inner, p.outer); return a }
/** Is this clip on device `uid`? Clips without a device belong to the first one. */
export const clipOn = (c: ScreenClip, uid: string, first: string) => (c.dev ?? first) === uid || (!!c.dev && !screenLive.devs.includes(c.dev) && uid === first)
/** Per frame (from the timeline driver): bring every device's mixers to the playhead. */
export function updateScreens(t: number, playing: boolean) {
  const all = screenLive.clips, first = screenLive.devs[0] ?? ''
  for (const uid of screenLive.devs) {
    const m = mixersFor(uid), c = all.filter(x => clipOn(x, uid, first))
    if (!c.length) { for (const x of [m.inner, m.outer]) if (x.on) { x.on = false; x.key = ''; screenLive.onShape?.() } continue }
    m.inner.update('inner', c, t, playing); m.outer.update('outer', c, t, playing)
  }
}
