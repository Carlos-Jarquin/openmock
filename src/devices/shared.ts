import * as THREE from 'three'
export function roundedRectShape(w: number, h: number, r: number) {
  const s = new THREE.Shape(); const x = -w / 2, y = -h / 2
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r)
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r)
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y); return s
}
/** Flat rounded-rect screen geometry with 0..1 UVs. */
export function screenGeometry(w: number, h: number, r: number) {
  const g = new THREE.ShapeGeometry(roundedRectShape(w, h, r), 24)
  const pos = g.attributes.position, uv = g.attributes.uv
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / w + 0.5, pos.getY(i) / h + 0.5)
  uv.needsUpdate = true; return g
}
/** Cover-fit a texture into a screen of the given aspect (w/h). Top aligned for tall screenshots. */
export function fitTexture(tex: THREE.Texture | null, mediaAspect: number, screenAspect: number) {
  if (!tex) return
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping
  if (mediaAspect > screenAspect) { const k = screenAspect / mediaAspect; tex.repeat.set(k, 1); tex.offset.set((1 - k) / 2, 0) }
  else { const k = mediaAspect / screenAspect; tex.repeat.set(1, k); tex.offset.set(0, 1 - k) }
  tex.needsUpdate = true
}

/** Logo tint meaning "use the finish colour": the logo renders as a flush polished mark in the back-glass colour. */
export const DEFAULT_LOGO_TINT = '#8a8f99'

/** Set by a clickable part of a device on pointer down so the stage does not start an orbit drag. */
export const sceneHit = { current: false }
