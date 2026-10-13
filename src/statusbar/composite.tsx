// Studio: composites the iOS status bar onto the screen media, so it shows in renders and PNG exports.
// The canvas is the screen at 3x points (Pro 1206x2622, Pro Max 1320x2868), and the media is fitted the same way
// fitTexture does (cover, top aligned when taller, centred when wider), so the bar sits at the right pt-to-screen scale.
import { useEffect, useMemo, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as THREE from 'three'
import { type SbCfg } from './config'
import { Island, StatusBar, STATUS_H, clockText } from './StatusBar'

const PX = 3

/** The island and bar as an SVG image, W pt wide and STATUS_H pt tall, rendered at 3x. */
function barImage(sb: SbCfg, tone: 'dark' | 'light', W: number, time: string): Promise<HTMLImageElement> {
  const html = renderToStaticMarkup(<div {...({ xmlns: "http://www.w3.org/1999/xhtml" } as object)} style={{ position: 'relative', width: W, height: STATUS_H, overflow: 'hidden' }}>
    <Island sb={sb} w={W} />{sb.mode !== 'off' && <StatusBar tone={tone} sb={sb} w={W} time={time} />}</div>)
    .replace(/<svg /g, '<svg xmlns="http://www.w3.org/2000/svg" ') // inline SVG needs its namespace inside XHTML
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W * PX}" height="${STATUS_H * PX}" viewBox="0 0 ${W} ${STATUS_H}"><foreignObject x="0" y="0" width="${W}" height="${STATUS_H}">${html}</foreignObject></svg>`
  return new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg) })
}

/** Average luminance (0-255) of the top 54 pt of the canvas, from a small downsample. */
function topLuma(src: HTMLCanvasElement, probe: HTMLCanvasElement) {
  const ctx = probe.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(src, 0, 0, src.width, STATUS_H * PX, 0, 0, probe.width, probe.height)
  const d = ctx.getImageData(0, 0, probe.width, probe.height).data
  let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11
  return s / (d.length / 4)
}

type Src = { texture: THREE.Texture; aspect: number; kind: 'image' | 'video'; video?: HTMLVideoElement } | null

/** Returns a texture with the status bar on top when on, otherwise the media texture unchanged. size: screen in pt. */
export function useStatusComposite(media: Src, on: boolean, sb: SbCfg, size: { w: number; h: number } | null) {
  const active = on && !!size
  const W = size?.w ?? 402, H = size?.h ?? 874
  const [minute, setMinute] = useState(() => clockText(new Date()))
  useEffect(() => { if (!active || sb.time) return; const i = setInterval(() => setMinute(clockText(new Date())), 5000); return () => clearInterval(i) }, [active, sb.time])
  const time = sb.time ?? minute
  const [bars, setBars] = useState<{ dark: HTMLImageElement; light: HTMLImageElement } | null>(null)
  useEffect(() => {
    if (!active) { setBars(null); return }
    let live = true
    Promise.all([barImage(sb, 'dark', W, time), barImage(sb, 'light', W, time)]).then(([dark, light]) => { if (live) setBars({ dark, light }) })
    return () => { live = false }
  }, [active, sb, W, time])
  // A new canvas and texture per screen size: three allocates GPU storage once, so a resized canvas would not upload.
  const canvas = useMemo(() => Object.assign(document.createElement('canvas'), { width: W * PX, height: H * PX }), [W, H])
  const probe = useMemo(() => Object.assign(document.createElement('canvas'), { width: 32, height: 4 }), [])
  const tex = useMemo(() => { const t = new THREE.CanvasTexture(canvas); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t }, [canvas])
  useEffect(() => () => tex.dispose(), [tex])
  useEffect(() => {
    if (!active || !bars) return
    const ctx = canvas.getContext('2d')!
    const img = media?.kind === 'video' ? media.video : media?.texture.image as CanvasImageSource | undefined
    const draw = () => {
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height)
      if (img && media) {
        const iw = media.kind === 'video' ? media.video!.videoWidth : (img as HTMLImageElement).width, ih = media.kind === 'video' ? media.video!.videoHeight : (img as HTMLImageElement).height
        const k = Math.max(canvas.width / iw, canvas.height / ih), dw = iw * k, dh = ih * k
        ctx.drawImage(img, media.aspect > W / H ? (canvas.width - dw) / 2 : 0, 0, dw, dh)
      }
      const tone = sb.mode === 'light' ? 'light' : sb.mode === 'dark' ? 'dark' : topLuma(canvas, probe) > 140 ? 'dark' : 'light'
      ctx.drawImage(tone === 'dark' ? bars.dark : bars.light, 0, 0, W * PX, STATUS_H * PX)
      canvas.dataset.tone = tone
      tex.needsUpdate = true
      if (import.meta.env.DEV) (window as unknown as { __omSb: unknown }).__omSb = { canvas, tone, time, sb, W }
    }
    draw()
    if (media?.kind !== 'video') return
    let raf = 0; const loop = () => { draw(); raf = requestAnimationFrame(loop) }; raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [active, bars, media, sb.mode, W, H, canvas, probe, tex])
  if (!active || !bars) return { texture: media?.texture ?? null, aspect: media?.aspect ?? null, tone: null as string | null }
  return { texture: tex as THREE.Texture, aspect: W / H, tone: canvas.dataset.tone ?? null }
}
