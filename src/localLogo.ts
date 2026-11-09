import * as THREE from 'three'
import markUrl from './brand-mark.png'
import type { LogoArt } from './types'

export type { LogoArt }

/** White = artwork. Alpha is the silhouette when the file has one; otherwise dark ink on a light ground. */
function maskFromImage(img: HTMLImageElement): LogoArt {
  const iw = img.naturalWidth || 512, ih = img.naturalHeight || 512
  const k = 1024 / Math.max(iw, ih), w = Math.round(iw * k), h = Math.round(ih * k)
  const c = document.createElement('canvas'); c.width = w; c.height = h
  const ctx = c.getContext('2d')!; ctx.drawImage(img, 0, 0, w, h)
  const d = ctx.getImageData(0, 0, w, h)
  let opaque = 0
  for (let i = 3; i < d.data.length; i += 4) if (d.data[i] > 250) opaque++
  const hasAlpha = opaque < (w * h) * 0.98
  for (let i = 0; i < d.data.length; i += 4) {
    const lum = (d.data[i] * 0.3 + d.data[i + 1] * 0.59 + d.data[i + 2] * 0.11)
    const v = hasAlpha ? d.data[i + 3] : 255 - lum   // no alpha: dark art on light background
    d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255
  }
  ctx.putImageData(d, 0, 0)
  const t = new THREE.CanvasTexture(c); t.anisotropy = 8
  return { mask: t, aspect: w / h }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('logo'))
    img.src = src
  })
}

/** Turn an uploaded SVG or PNG into a greyscale mask (white = artwork) for the embossed logo. */
export function loadLogo(file: File): Promise<LogoArt> {
  const url = URL.createObjectURL(file)
  return loadImage(url).then(img => { URL.revokeObjectURL(url); return maskFromImage(img) }, err => { URL.revokeObjectURL(url); throw err })
}

/** The bundled mark. Its alpha is the silhouette, so each device paints it in that surface's own finish. */
let bundled: Promise<LogoArt | null> | null = null
export function builtinLogo(): Promise<LogoArt | null> {
  if (!bundled) bundled = loadImage(markUrl).then(maskFromImage).catch(() => null)
  return bundled
}

/** Optional local logo: public/local/logo.svg or logo.png (git-ignored, never bundled). Resolves null when absent. */
export async function loadLocalLogo(): Promise<{ mask: THREE.Texture; aspect: number } | null> {
  for (const name of ['logo.svg', 'logo.png']) {
    try {
      const r = await fetch(`/local/${name}`)
      const type = r.headers.get('content-type') ?? ''
      if (!r.ok || !type.startsWith('image/')) continue // Vite serves index.html for missing files
      const url = URL.createObjectURL(await r.blob())
      try { return maskFromImage(await loadImage(url)) } finally { URL.revokeObjectURL(url) }
    } catch { /* try the next one */ }
  }
  return null
}
