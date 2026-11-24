// Build a self-contained HTML file of the Live iPhone: the face-on device (no shadow, no padding)
// with the current prototype playing on the screen, so it can be dropped into a website.
import { renderToStaticMarkup } from 'react-dom/server'
import * as THREE from 'three'
import type { RootState } from '@react-three/fiber'
import type { IPhoneSpec } from '../devices/iphoneSpecs'
import { type SbCfg } from '../statusbar/config'
import { Island, StatusBar, HomeBar, type IslandLook } from '../statusbar/StatusBar'

const mm = (v: number) => v / 100
const OVERLAY_PX = 3
const SHELL_H = 2400
// Extra room around the body so side buttons are never clipped before the alpha crop.
const FRAME_PAD = 1.14

export type ShellShot = {
  png: string
  width: number
  height: number
  screen: { x: number; y: number; w: number; h: number; r: number }
}

/** Paths the inlined page refers to that will not resolve once it lives in srcdoc. */
export function relativeAssetPaths(html: string): string[] {
  const found = new Set<string>()
  const take = (raw: string | undefined) => {
    const u = raw?.trim()
    if (!u) return
    if (u.startsWith('data:') || u.startsWith('blob:') || u.startsWith('#') || u.startsWith('javascript:')) return
    if (/^[a-z][a-z0-9+.-]*:/i.test(u) || u.startsWith('//')) return
    found.add(u)
  }
  const re = /(?:\b(?:src|href)\s*=\s*["']([^"']+)["']|url\(\s*["']?([^"')]+)["']?\s*\)|@import\s+["']([^"']+)["'])/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) take(m[1] ?? m[2] ?? m[3])
  return [...found]
}

export async function loadPrototypeHtml(uploaded: string | null, src: string): Promise<{ html: string; warnings: string[] }> {
  if (uploaded != null) return { html: uploaded, warnings: relativeAssetPaths(uploaded) }
  const res = await fetch(src)
  if (!res.ok) throw new Error(`Could not read the page (${res.status}).`)
  const html = await res.text()
  return { html, warnings: relativeAssetPaths(html) }
}

export async function chromeOverlay(
  sb: SbCfg,
  tone: 'dark' | 'light',
  homeTone: 'dark' | 'light',
  W: number,
  H: number,
  time: string,
  look?: IslandLook,
): Promise<string> {
  const html = renderToStaticMarkup(
    <div {...({ xmlns: 'http://www.w3.org/1999/xhtml' } as object)} style={{ position: 'relative', width: W, height: H, overflow: 'hidden' }}>
      <Island sb={sb} w={W} look={look} />
      {sb.mode !== 'off' && <StatusBar tone={tone} sb={sb} w={W} time={time} />}
      {sb.homeBar && <HomeBar tone={homeTone} w={W} h={H} />}
    </div>,
  ).replace(/<svg /g, '<svg xmlns="http://www.w3.org/2000/svg" ')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W * OVERLAY_PX}" height="${H * OVERLAY_PX}" viewBox="0 0 ${W} ${H}"><foreignObject x="0" y="0" width="${W}" height="${H}">${html}</foreignObject></svg>`
  const img = await new Promise<HTMLImageElement>((ok, no) => {
    const i = new Image()
    i.onload = () => ok(i)
    i.onerror = () => no(new Error('Could not draw the status bar.'))
    i.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
  })
  const c = document.createElement('canvas')
  c.width = W * OVERLAY_PX
  c.height = H * OVERLAY_PX
  c.getContext('2d')!.drawImage(img, 0, 0)
  return c.toDataURL('image/png')
}

function alphaBounds(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const data = ctx.getImageData(0, 0, w, h).data
  let minX = w, minY = h, maxX = -1, maxY = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 0) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) throw new Error('The device did not render.')
  return {
    x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1,
    clipped: minX === 0 || minY === 0 || maxX === w - 1 || maxY === h - 1,
  }
}

function project(camera: THREE.Camera, x: number, y: number, z: number, w: number, h: number) {
  const v = new THREE.Vector3(x, y, z).project(camera)
  return { x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h }
}

/** Face-on WebGL shot of the phone, transparent, cropped to the silhouette, with the screen punched out. */
export function capturePhoneShell(three: RootState, spec: IPhoneSpec): ShellShot {
  const { gl, scene, camera } = three
  const persp = camera as THREE.PerspectiveCamera
  const rig = scene.getObjectByName('live-rig')
  const prevRot = rig ? rig.rotation.clone() : null
  const prevCamPos = persp.position.clone()
  const prevCamQuat = persp.quaternion.clone()
  const prevAspect = persp.aspect
  const prevNear = persp.near
  const prevFar = persp.far
  const prevClear = new THREE.Color()
  gl.getClearColor(prevClear)
  const prevAlpha = gl.getClearAlpha()
  const prevBg = scene.background
  const prevTarget = gl.getRenderTarget()
  const prevSize = gl.getSize(new THREE.Vector2())
  const prevDpr = gl.getPixelRatio()
  const canvas = gl.domElement
  const prevVis = canvas.style.visibility

  try {
    if (rig) rig.rotation.set(0, 0, 0)
    scene.background = null
    scene.updateMatrixWorld(true)

    const fov = (persp.fov * Math.PI) / 180
    const halfH = (mm(spec.body.h) / 2) * FRAME_PAD
    const halfW = (mm(spec.body.w) / 2 + mm(spec.btn.protrude) + mm(0.6)) * FRAME_PAD
    const aspect = halfW / halfH
    const height = SHELL_H
    const width = Math.round(height * aspect)
    const z = Math.max(halfH, halfW / aspect) / Math.tan(fov / 2)

    persp.aspect = width / height
    persp.near = 0.1
    persp.far = Math.max(20, z * 2)
    persp.position.set(0, 0, z)
    persp.lookAt(0, 0, 0)
    persp.updateProjectionMatrix()

    canvas.style.visibility = 'hidden'
    gl.setPixelRatio(1)
    gl.setSize(width, height, false)
    gl.setRenderTarget(null)
    gl.setClearColor(0x000000, 0)
    gl.clear()
    gl.render(scene, persp)

    const shot = document.createElement('canvas')
    shot.width = width
    shot.height = height
    const sctx = shot.getContext('2d')!
    sctx.drawImage(canvas, 0, 0)
    const bounds = alphaBounds(sctx, width, height)
    if (bounds.clipped) throw new Error('The device was clipped in the render.')

    const zScreen = mm(spec.body.t) / 2 + 0.0003 * 2
    const hw = mm(spec.active.w) / 2
    const hh = mm(spec.active.h) / 2
    const tl = project(persp, -hw, hh, zScreen, width, height)
    const br = project(persp, hw, -hh, zScreen, width, height)
    const rWorld = mm(spec.body.cornerR - spec.active.inset)
    const sx = tl.x, sy = tl.y, sw = br.x - tl.x, sh = br.y - tl.y
    const rPx = rWorld * (sw / mm(spec.active.w))

    const out = document.createElement('canvas')
    out.width = bounds.w
    out.height = bounds.h
    const ctx = out.getContext('2d')!
    ctx.drawImage(shot, bounds.x, bounds.y, bounds.w, bounds.h, 0, 0, bounds.w, bounds.h)
    const screen = { x: sx - bounds.x, y: sy - bounds.y, w: sw, h: sh, r: rPx }
    ctx.save()
    ctx.globalCompositeOperation = 'destination-out'
    ctx.beginPath()
    ctx.roundRect(screen.x, screen.y, screen.w, screen.h, Math.min(screen.r, screen.w / 2, screen.h / 2))
    ctx.fill()
    ctx.restore()

    return { png: out.toDataURL('image/png'), width: out.width, height: out.height, screen }
  } finally {
    if (rig && prevRot) rig.rotation.copy(prevRot)
    persp.position.copy(prevCamPos)
    persp.quaternion.copy(prevCamQuat)
    persp.aspect = prevAspect
    persp.near = prevNear
    persp.far = prevFar
    persp.updateProjectionMatrix()
    scene.background = prevBg
    gl.setClearColor(prevClear, prevAlpha)
    gl.setRenderTarget(prevTarget)
    gl.setPixelRatio(prevDpr)
    gl.setSize(prevSize.x, prevSize.y, false)
    canvas.style.visibility = prevVis
  }
}

function escAttr(s: string) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}

export function exportFileName(spec: IPhoneSpec) {
  return spec.id === 'ip18max' ? 'openmock-iphone-18-pro-max.html' : 'openmock-iphone-18-pro.html'
}

export function buildExportDocument(opts: {
  spec: IPhoneSpec
  shell: ShellShot
  chrome: string
  css: { w: number; h: number }
  proto: string
  warnings: string[]
}): string {
  const { spec, shell, chrome, css, proto, warnings } = opts
  const { width: dw, height: dh, screen: s } = shell
  const note = warnings.length
    ? `<!-- Relative paths in the page will not load in this file: ${warnings.join(', ')} -->\n`
    : ''
  return `<!doctype html>
<html lang="en-CA">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escAttr(spec.name)}</title>
<style>
  html, body { margin: 0; padding: 0; background: transparent; }
  .om-device {
    position: relative;
    width: 100%;
    height: auto;
    aspect-ratio: var(--dw) / var(--dh);
    display: block;
    line-height: 0;
  }
  .om-screen {
    position: absolute;
    left: calc(var(--sx) / var(--dw) * 100%);
    top: calc(var(--sy) / var(--dh) * 100%);
    width: calc(var(--sw) / var(--dw) * 100%);
    height: calc(var(--sh) / var(--dh) * 100%);
    overflow: hidden;
    border-radius: calc(var(--sr) / var(--sw) * 100%) / calc(var(--sr) / var(--sh) * 100%);
    background: #000;
  }
  .om-screen iframe {
    position: absolute;
    top: 0; left: 0;
    width: var(--css-w);
    height: var(--css-h);
    border: 0;
    display: block;
    background: #000;
    transform-origin: 0 0;
  }
  .om-shell, .om-shine, .om-chrome { pointer-events: none; }
  .om-shell { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
  .om-shine { position: absolute; inset: 0; background: linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0) 40%); }
  .om-chrome { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
</style>
</head>
<body>
${note}<div class="om-device" style="--dw:${dw};--dh:${dh};--sx:${s.x};--sy:${s.y};--sw:${s.w};--sh:${s.h};--sr:${s.r};--css-w:${css.w}px;--css-h:${css.h}px">
  <div class="om-screen">
    <iframe title="App" srcdoc="${escAttr(proto)}"></iframe>
    <div class="om-shine"></div>
    <img class="om-chrome" alt="" src="${chrome}">
  </div>
  <img class="om-shell" alt="${escAttr(spec.name)}" src="${shell.png}">
</div>
<script>
(function () {
  var screen = document.querySelector('.om-screen');
  var frame = screen && screen.querySelector('iframe');
  if (!screen || !frame) return;
  var w = ${css.w}, h = ${css.h};
  function fit() {
    var s = Math.max(screen.clientWidth / w, screen.clientHeight / h);
    frame.style.transform = 'scale(' + s + ')';
  }
  if (typeof ResizeObserver === 'function') new ResizeObserver(fit).observe(screen);
  else window.addEventListener('resize', fit);
  fit();
})();
</script>
</body>
</html>
`
}

export function downloadHtml(name: string, html: string) {
  const a = document.createElement('a')
  a.download = name
  a.href = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }))
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 4000)
}
