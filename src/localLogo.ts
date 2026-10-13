import * as THREE from 'three'

/** Turn an uploaded SVG or PNG into a greyscale mask (white = artwork) for the embossed logo. */
export function loadLogo(file: File): Promise<{ mask: THREE.Texture; aspect: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
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
      resolve({ mask: t, aspect: w / h })
    }
    img.onerror = reject
    img.src = URL.createObjectURL(file)
  })
}

/** Optional local logo: public/local/logo.svg or logo.png (git-ignored, never bundled). Resolves null when absent. */
export async function loadLocalLogo(): Promise<{ mask: THREE.Texture; aspect: number } | null> {
  for (const name of ['logo.svg', 'logo.png']) {
    try {
      const r = await fetch(`/local/${name}`)
      const type = r.headers.get('content-type') ?? ''
      if (!r.ok || !type.startsWith('image/')) continue // Vite serves index.html for missing files
      return await loadLogo(new File([await r.blob()], name, { type }))
    } catch { /* try the next one */ }
  }
  return null
}
