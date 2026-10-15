import { cutHand } from './cutout'
// "Make hands photoreal": renders guide passes from the live 3D scene, sends them to a local ComfyUI that repaints
// only the hands (Z-Image Turbo with the Fun ControlNet Union, workflow in comfy/hands.json), then composites the
// returned hands over the untouched phone render. Every pixel outside the visible-hand mask stays the 3D render.
import * as THREE from 'three'
import workflowText from '../../comfy/hands.json?raw'
import { SKIN_TONES } from './Hands'

export interface Passes {
  w: number; h: number
  beauty: HTMLCanvasElement      // the live render, effects included
  clean: HTMLCanvasElement       // the same render with the 3D hands hidden (the phone behind them)
  mask: HTMLCanvasElement        // visible hand pixels, white on black
  alpha: HTMLCanvasElement       // the mask with a soft 1.5 px edge
  occlusion: HTMLCanvasElement   // hand pixels the phone covers
  phone: HTMLCanvasElement       // the phone's silhouette
  depth: HTMLCanvasElement       // phone and hands, near is white
  normal: HTMLCanvasElement      // view-space normals
  pose: HTMLCanvasElement        // OpenPose-style hand skeleton
  prompt: string
}
type Grab = { gl: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.Camera }

const TONE_WORDS: Record<string, string> = {
  light: 'very light, fair', fair: 'fair', medium: 'medium, lightly tanned', olive: 'olive', brown: 'brown', deep: 'deep dark brown',
}
export function handPrompt(tone: string) {
  // Silhouette: ask for a plain backlit hand with skin detail; composite() grades it to the dark violet look.
  if (tone === 'silhouette') return 'Photorealistic low-key studio photograph of an adult hand holding a smartphone upright, strongly backlit, ' +
    'soft rim light along the fingers and the edge of the hand, the front of the hand in shadow, natural skin texture, knuckles and creases, ' +
    'relaxed natural grip, sharp focus. No rings, no jewellery, no watch, no sleeve, no text.'
  const t = TONE_WORDS[tone === 'spectral' ? 'fair' : tone] ?? SKIN_TONES[tone]?.label.toLowerCase() ?? 'natural' // Spectral: painted as Fair skin
  return `Photorealistic studio product photograph of an adult's hand with ${t} skin holding a smartphone, like Apple's iPhone product shots. ` +
    'Natural skin with fine texture and pores, realistic knuckles, creases and clean short fingernails, relaxed natural grip, ' +
    'soft diffused studio softbox lighting, gentle shadows, sharp focus, high detail. No rings, no jewellery, no watch, no text.'
}

const canvas = (w: number, h: number) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c }

/** Reads a render target into a canvas (flipped to image orientation). */
function readTarget(gl: THREE.WebGLRenderer, rt: THREE.WebGLRenderTarget) {
  const { width: w, height: h } = rt, px = new Uint8Array(w * h * 4)
  gl.readRenderTargetPixels(rt, 0, 0, w, h, px)
  const c = canvas(w, h), ctx = c.getContext('2d')!, img = ctx.createImageData(w, h)
  for (let y = 0; y < h; y++) img.data.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4)
  ctx.putImageData(img, 0, 0); return c
}

/** Renders every guide pass at the canvas's own pixel size, so the masks line up with the live render exactly. */
const frames = (n: number) => new Promise<void>(r => { const f = () => (--n <= 0 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f) })
export async function renderPasses(g: Grab, tone: string): Promise<Passes> {
  // Gesture markers are for placing the touch point only, so leave them out of every pass.
  const gizmos: THREE.Object3D[] = []
  g.scene.traverse(o => { if ((o.userData.gizmo || o.userData.spectral) && o.visible) gizmos.push(o) }) // Spectral outlines and lines too
  for (const o of gizmos) o.visible = false
  try { return await passes(g, tone) } finally { for (const o of gizmos) o.visible = true }
}
async function passes(g: Grab, tone: string): Promise<Passes> {
  const { gl, scene, camera } = g
  const w = gl.domElement.width, h = gl.domElement.height
  // Clean plate: the live render (with effects) once with the hands hidden, then the normal beauty frame.
  const handMeshes: THREE.Object3D[] = []
  scene.traverse(o => { if (o.userData.hand) handMeshes.push(o) })
  const clean = canvas(w, h)
  for (const m of handMeshes) m.visible = false
  try { await frames(3); clean.getContext('2d')!.drawImage(gl.domElement, 0, 0) } finally { for (const m of handMeshes) m.visible = true }
  await frames(3)
  const beauty = canvas(w, h); beauty.getContext('2d')!.drawImage(gl.domElement, 0, 0)

  // Sort meshes: hands, the device they hold (inside the hand rig group), everything else (floor shadow and so on).
  const hands: THREE.Mesh[] = [], device: THREE.Mesh[] = [], other: THREE.Object3D[] = []
  const visit = (o: THREE.Object3D, inRig: boolean) => {
    const rig = inRig || !!o.userData.handRig
    if ((o as THREE.Mesh).isMesh && o.visible) (o.userData.hand ? hands : rig ? device : other).push(o as THREE.Mesh)
    else if (((o as THREE.Points).isPoints || (o as THREE.Line).isLine) && o.visible) other.push(o)
    for (const c of o.children) if (c.visible) visit(c, rig)
  }
  visit(scene, false)
  const saved = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>()
  for (const m of [...hands, ...device]) saved.set(m, m.material)
  const bg = scene.background, env = scene.environment, tm = gl.toneMapping, prevRT = gl.getRenderTarget()
  const clear = gl.getClearColor(new THREE.Color()), clearA = gl.getClearAlpha()
  scene.background = null; gl.toneMapping = THREE.NoToneMapping
  for (const o of other) o.visible = false
  const rt = new THREE.WebGLRenderTarget(w, h, { samples: 4 })
  const white = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false })
  const black = new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false })
  const normalMat = new THREE.MeshNormalMaterial()
  const depthMat = new THREE.MeshDepthMaterial()
  const pass = (pick: (m: THREE.Mesh, isHand: boolean) => THREE.Material | null, bgCol = 0x000000) => {
    for (const m of hands) { const mt = pick(m, true); m.visible = !!mt; if (mt) m.material = mt }
    for (const m of device) { const mt = pick(m, false); m.visible = !!mt; if (mt) m.material = mt }
    gl.setRenderTarget(rt); gl.setClearColor(bgCol, 1); gl.clear(); gl.render(scene, camera)
    return readTarget(gl, rt)
  }
  let mask: HTMLCanvasElement, full: HTMLCanvasElement, phone: HTMLCanvasElement, depth: HTMLCanvasElement, normal: HTMLCanvasElement
  const cam = camera as THREE.PerspectiveCamera, near = cam.near, far = cam.far
  try {
    mask = pass((_m, isHand) => isHand ? white : black)
    full = pass((_m, isHand) => isHand ? white : null)
    phone = pass((_m, isHand) => isHand ? null : white)
    normal = pass(() => normalMat, 0x8080ff)
    // Depth over just the phone and hands: fit near and far round them so the greys use the whole range.
    const box = new THREE.Box3()
    for (const m of [...hands, ...device]) box.expandByObject(m)
    const sphere = box.getBoundingSphere(new THREE.Sphere()), dist = sphere.center.clone().applyMatrix4(cam.matrixWorldInverse).length()
    cam.near = Math.max(0.01, dist - sphere.radius); cam.far = dist + sphere.radius; cam.updateProjectionMatrix()
    depth = pass(() => depthMat)
  } finally {
    cam.near = near; cam.far = far; cam.updateProjectionMatrix()
    for (const [m, mt] of saved) { m.material = mt; m.visible = true }
    for (const o of other) o.visible = true
    scene.background = bg; scene.environment = env; gl.toneMapping = tm
    gl.setRenderTarget(prevRT); gl.setClearColor(clear, clearA)
    rt.dispose(); white.dispose(); black.dispose(); normalMat.dispose(); depthMat.dispose()
  }
  // Occlusion: hand pixels with no visible hand on top, i.e. the phone is in front.
  const occlusion = canvas(w, h)
  { const a = full.getContext('2d')!.getImageData(0, 0, w, h), b = mask.getContext('2d')!.getImageData(0, 0, w, h)
    for (let i = 0; i < a.data.length; i += 4) { const v = Math.max(0, a.data[i] - b.data[i]); a.data[i] = a.data[i + 1] = a.data[i + 2] = v; a.data[i + 3] = 255 }
    occlusion.getContext('2d')!.putImageData(a, 0, 0) }
  const alpha = canvas(w, h); { const c = alpha.getContext('2d')!; c.filter = `blur(${Math.max(1, w / 1400).toFixed(2)}px)`; c.drawImage(mask, 0, 0) }
  return { w, h, beauty, clean, mask, alpha, occlusion, phone, depth, normal, pose: posePass(hands, camera, w, h), prompt: handPrompt(tone) }
}

// OpenPose hand: 21 keypoints (wrist, then four per digit from the base out), 20 limbs coloured round the hue wheel.
const DIGITS = [['thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip'],
  ...['index', 'middle', 'ring', 'pinky'].map(f => ['phalanx-proximal', 'phalanx-intermediate', 'phalanx-distal', 'tip'].map(j => `${f}-finger-${j}`))]
function posePass(hands: THREE.Mesh[], camera: THREE.Camera, w: number, h: number) {
  const c = canvas(w, h), ctx = c.getContext('2d')!
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h)
  const lw = Math.max(2, Math.round(w / 256)), v = new THREE.Vector3()
  for (const m of hands) {
    const sk = (m as THREE.SkinnedMesh).skeleton; if (!sk) continue
    const at = (name: string) => { const b = sk.bones.find(x => x.name === name); if (!b) return null
      b.getWorldPosition(v).project(camera); return [(v.x + 1) / 2 * w, (1 - v.y) / 2 * h] as [number, number] }
    const wrist = at('wrist'); if (!wrist) continue
    const pts = [wrist, ...DIGITS.flat().map(at)]
    let e = 0
    DIGITS.forEach((_, d) => { for (let k = 0; k < 4; k++) {
      const a = k === 0 ? pts[0] : pts[1 + d * 4 + k - 1], b = pts[1 + d * 4 + k]
      if (a && b) { ctx.strokeStyle = `hsl(${(e / 20) * 360},100%,50%)`; ctx.lineWidth = lw; ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke() }
      e++ } })
    ctx.fillStyle = '#0000ff'
    for (const p of pts) if (p) { ctx.beginPath(); ctx.arc(p[0], p[1], lw * 1.2, 0, Math.PI * 2); ctx.fill() }
  }
  return c
}

/** Downloads every pass and the prompt, for running the workflow by hand in ComfyUI. */
export async function downloadPasses(p: Passes) {
  const save = (name: string, href: string) => { const a = document.createElement('a'); a.download = name; a.href = href; a.click() }
  for (const k of ['beauty', 'clean', 'mask', 'alpha', 'occlusion', 'phone', 'depth', 'normal', 'pose'] as const) {
    save(`openmock-hands-${k}.png`, p[k].toDataURL('image/png')); await new Promise(r => setTimeout(r, 150))
  }
  save('openmock-hands-prompt.txt', URL.createObjectURL(new Blob([p.prompt], { type: 'text/plain' })))
}

// ---------- ComfyUI ----------
const API = '/comfyui-api'
/** Generation size: longest edge 1024, both sides multiples of 16, same aspect as the canvas. */
function genSize(w: number, h: number) { const k = 1024 / Math.max(w, h); return { gw: Math.round(w * k / 16) * 16, gh: Math.round(h * k / 16) * 16 } }
function scaled(src: HTMLCanvasElement, w: number, h: number) { const c = canvas(w, h), x = c.getContext('2d')!; x.imageSmoothingQuality = 'high'; x.drawImage(src, 0, 0, w, h); return c }
const blobOf = (c: HTMLCanvasElement) => new Promise<Blob>((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('Could not encode an image.')), 'image/png'))

async function upload(name: string, c: HTMLCanvasElement) {
  const fd = new FormData(); fd.append('image', await blobOf(c), name); fd.append('overwrite', 'true')
  const r = await fetch(`${API}/upload/image`, { method: 'POST', body: fd })
  if (!r.ok) throw new Error(`ComfyUI would not take the upload (${r.status}).`)
  return (await r.json()).name as string
}
export async function comfyReachable() {
  try { const r = await fetch(`${API}/system_stats`, { cache: 'no-store' }); return r.ok } catch { return false }
}

export type Guide = 'depth' | 'pose'
export interface AiResult { layer: HTMLImageElement; full: HTMLImageElement; saved?: string }
/** Sends the passes through comfy/hands.json and returns the hand layer and the full generation. */
export async function runComfy(p: Passes, opts: { guide: Guide; seed: number; onStatus: (s: string) => void; signal?: AbortSignal }): Promise<AiResult> {
  const { gw, gh } = genSize(p.w, p.h), id = Date.now().toString(36)
  opts.onStatus('Sending the render to ComfyUI…')
  const names = {
    beauty: await upload(`openmock_${id}_beauty.png`, scaled(p.clean, gw, gh)),   // the AI sees the phone without the CG hand
    control: await upload(`openmock_${id}_control.png`, scaled(opts.guide === 'pose' ? p.pose : p.depth, gw, gh)),
    mask: await upload(`openmock_${id}_mask.png`, scaled(p.mask, gw, gh)),
    alpha: await upload(`openmock_${id}_alpha.png`, scaled(p.alpha, gw, gh)),
  }
  const wf = JSON.parse(workflowText) as Record<string, { inputs: Record<string, unknown> }>
  wf['5'].inputs.image = names.beauty; wf['6'].inputs.image = names.control
  wf['7'].inputs.image = names.mask; wf['16'].inputs.image = names.alpha
  wf['11'].inputs.text = p.prompt; wf['13'].inputs.width = gw; wf['13'].inputs.height = gh; wf['14'].inputs.seed = opts.seed
  const r = await fetch(`${API}/prompt`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: wf, client_id: `openmock-${id}` }) })
  const body = await r.json().catch(() => ({}))
  if (!r.ok) {
    const missing: string[] = []
    for (const ne of Object.values((body?.node_errors ?? {}) as Record<string, { errors?: { type?: string; details?: string; extra_info?: { input_name?: string; received_value?: unknown } }[] }>))
      for (const e of ne.errors ?? []) if (e.type === 'value_not_in_list' && /name$/.test(e.extra_info?.input_name ?? '')) missing.push(String(e.extra_info?.received_value))
    if (missing.length) throw new Error(`Missing model${missing.length > 1 ? 's' : ''} in ComfyUI: ${missing.join(', ')}. Add ${missing.length > 1 ? 'them' : 'it'} to ComfyUI's models folder, then try again.`)
    throw new Error(`ComfyUI rejected the workflow: ${body?.error?.message ?? r.status}`)
  }
  const pid = body.prompt_id as string
  const t0 = Date.now()
  // Step progress from ComfyUI's websocket (through the dev proxy); the history poll below still decides when it's done.
  const prog = { value: 0, max: 0, node: '' }
  let ws: WebSocket | null = null
  try {
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${API}/ws?clientId=openmock-${id}`)
    ws.onmessage = e => { if (typeof e.data !== 'string') return; try { const m = JSON.parse(e.data)
      if (m.type === 'progress' && m.data?.prompt_id === pid) { prog.value = m.data.value; prog.max = m.data.max }
      if (m.type === 'executing' && m.data?.prompt_id === pid) prog.node = m.data.node ?? '' } catch { /* not JSON */ } }
  } catch { ws = null }
  const NODE_WORDS: Record<string, string> = { '1': 'loading the image model', '2': 'loading the text model', '3': 'loading the VAE', '4': 'loading the ControlNet', '11': 'reading the prompt', '14': 'painting', '15': 'decoding', '19': 'saving', '20': 'saving' }
  try {
  for (;;) {
    if (opts.signal?.aborted) throw new Error('Cancelled.')
    await new Promise(res => setTimeout(res, 1000))
    const secs = Math.round((Date.now() - t0) / 1000)
    let ahead = 0
    try { const q = await (await fetch(`${API}/queue`, { cache: 'no-store' })).json(); const all = [...(q.queue_running ?? []), ...(q.queue_pending ?? [])]
      const i = all.findIndex((x: unknown[]) => x[1] === pid); ahead = i > 0 ? i : 0 } catch { /* keep going */ }
    opts.onStatus(ahead ? `Waiting in the ComfyUI queue (${ahead} ahead)… ${secs} s`
      : prog.max && prog.node === '14' ? `Painting the hands: step ${prog.value} of ${prog.max} (${Math.round(prog.value / prog.max * 100)}%)… ${secs} s`
      : `Working in ComfyUI${NODE_WORDS[prog.node] ? `: ${NODE_WORDS[prog.node]}` : ''}… ${secs} s`)
    const hr = await fetch(`${API}/history/${pid}`, { cache: 'no-store' }); if (!hr.ok) continue
    const hist = (await hr.json())[pid]; if (!hist) continue
    if (hist.status?.status_str === 'error') throw new Error(explainError(hist.status?.messages))
    const out = hist.outputs ?? {}
    if (!out['19']?.images?.length || !out['20']?.images?.length) { if (hist.status?.completed) throw new Error('ComfyUI finished without images.'); continue }
    const load = (im: { filename: string; subfolder: string; type: string }) => new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Could not load the result from ComfyUI.'))
      i.src = `${API}/view?${new URLSearchParams({ filename: im.filename, subfolder: im.subfolder, type: im.type })}`
    })
    const saved = out['20'].images[0] as { filename: string; subfolder: string }
    return { layer: await load(out['19'].images[0]), full: await load(out['20'].images[0]), saved: `${saved.subfolder ? saved.subfolder + '/' : ''}${saved.filename}` }
  }
  } finally { ws?.close() }
}

/** Plain-English reading of ComfyUI's execution_error. */
function explainError(messages: unknown): string {
  const err = (Array.isArray(messages) ? messages : []).find((m: unknown[]) => m[0] === 'execution_error')?.[1] as { node_type?: string; exception_message?: string; exception_type?: string } | undefined
  const msg = (err?.exception_message ?? '').trim(), where = err?.node_type ? ` in ${err.node_type}` : ''
  if (/Broken pipe|Errno 32/i.test(msg)) return 'ComfyUI stopped while painting: its console output is closed (Broken pipe). Quit and reopen ComfyUI, then try again.'
  if (/out of memory|MPS backend out of memory|CUDA out of memory/i.test(msg)) return `ComfyUI ran out of memory${where}. Close other apps or lower the size, then try again.`
  if (/No such file|not found/i.test(msg)) return `ComfyUI couldn't find a file${where}: ${msg.slice(0, 160)}`
  return msg ? `ComfyUI hit an error${where}: ${msg.slice(0, 200)}` : 'ComfyUI hit an error while running the workflow. See the ComfyUI log.'
}

/** The final picture: the live render, then the AI hands cut by Openmock's own full-resolution soft mask, minus anywhere
 * the phone is in front. Optional contact shadows multiply in the AI's darkening just outside the hands. */
/** Silhouette grade: AI skin luminance mapped from a dark violet shadow up to a lavender rim. */
const GRADE = { lo: [30, 23, 52], hi: [196, 178, 255] }
function grade(d: Uint8ClampedArray) {
  for (let i = 0; i < d.length; i += 4) {
    const l = (0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2]) / 255, t = Math.pow(l, 2.4) * 0.75
    for (let k = 0; k < 3; k++) d[i + k] = GRADE.lo[k] * (0.7 + l * 0.6) + (GRADE.hi[k] - GRADE.lo[k]) * t
  }
}
export function composite(p: Passes, ai: AiResult, opts: { shadows: boolean; silhouette?: boolean }) {
  const { w, h } = p, out = canvas(w, h), o = out.getContext('2d')!
  o.drawImage(p.beauty, 0, 0)
  const gen = scaled(Object.assign(canvas(ai.full.naturalWidth, ai.full.naturalHeight)), w, h)
  { const g = gen.getContext('2d')!; g.clearRect(0, 0, w, h); g.imageSmoothingQuality = 'high'; g.drawImage(ai.full, 0, 0, w, h) }
  const G = gen.getContext('2d')!.getImageData(0, 0, w, h), B = o.getImageData(0, 0, w, h)
  const P = p.phone.getContext('2d')!.getImageData(0, 0, w, h).data, C = p.clean.getContext('2d')!.getImageData(0, 0, w, h).data, M = (() => { const c = canvas(w, h), x = c.getContext('2d')!; x.filter = `blur(${Math.max(1.5, w / 600).toFixed(1)}px)`; x.drawImage(p.mask, 0, 0); return x.getImageData(0, 0, w, h).data })()
  const A = p.alpha.getContext('2d')!.getImageData(0, 0, w, h).data, O = p.occlusion.getContext('2d')!.getImageData(0, 0, w, h).data
  let ring: Uint8ClampedArray | null = null
  if (opts.shadows) {
    const r = canvas(w, h), x = r.getContext('2d')!; x.filter = `blur(${Math.round(w / 90)}px)`; x.drawImage(p.mask, 0, 0)
    ring = x.getImageData(0, 0, w, h).data
  }
  // Inside the mask the AI hand can come out slimmer than the 3D one, and there it repaints the phone. Show the real
  // phone (the clean plate) wherever the AI pixel barely differs from it, so only actual new hand pixels come through.
  const keep = canvas(w, h), kx = keep.getContext('2d')!, K = kx.createImageData(w, h)
  for (let i = 0; i < K.data.length; i += 4) {
    const d = (Math.abs(G.data[i] - C[i]) + Math.abs(G.data[i + 1] - C[i + 1]) + Math.abs(G.data[i + 2] - C[i + 2])) / 3
    // Off the phone the AI hand is always used. Over the phone it is used only where it differs from the plate and the AI pixel reads as skin (YCbCr skin range, soft edges), so it can never redraw the screen.
    const r = G.data[i], g = G.data[i + 1], b = G.data[i + 2]
    const cb = 128 - 0.1687 * r - 0.3313 * g + 0.5 * b, cr = 128 + 0.5 * r - 0.4187 * g - 0.0813 * b
    const band = (v: number, lo: number, hi: number, soft: number) => Math.max(0, Math.min(1, (v - lo + soft) / soft, (hi + soft - v) / soft))
    const onPhone = P[i] / 255, skin = band(cr, 132, 185, 8) * band(cb, 70, 130, 8)
    K.data[i] = K.data[i + 1] = K.data[i + 2] = (1 - onPhone) * 255 + onPhone * Math.max(0, Math.min(255, (d - 12) * 8 * skin)); K.data[i + 3] = 255
  }
  kx.putImageData(K, 0, 0)
  // Blur the difference before thresholding so thin seams the AI draws along the mask edge drop out, and only
  // solid areas of new skin count. Then a light blur again for a soft edge.
  const wide = canvas(w, h), wx = wide.getContext('2d')!; wx.filter = `blur(${Math.max(2, w / 260).toFixed(1)}px)`; wx.drawImage(keep, 0, 0)
  const W2 = wx.getImageData(0, 0, w, h)
  for (let i = 0; i < W2.data.length; i += 4) W2.data[i] = W2.data[i + 1] = W2.data[i + 2] = Math.max(0, Math.min(255, (W2.data[i] - 110) * 3))
  wx.putImageData(W2, 0, 0)
  const soft = canvas(w, h), sx = soft.getContext('2d')!; sx.filter = `blur(${Math.max(1, w / 900).toFixed(1)}px)`; sx.drawImage(wide, 0, 0)
  const D = sx.getImageData(0, 0, w, h).data
  if (opts.silhouette) grade(G.data)   // after the skin test above, which needs the AI's natural colours
  for (let i = 0; i < B.data.length; i += 4) {
    // Under the 3D hand the base is the clean plate, so no CG skin survives anywhere.
    const m = Math.min(1, M[i] / 255 * 4)   // grown a couple of pixels, so no anti-aliased CG edge is left
    if (m > 0) for (let k = 0; k < 3; k++) B.data[i + k] = B.data[i + k] * (1 - m) + C[i + k] * m
    const a = (A[i] / 255) * (1 - O[i] / 255) * (D[i] / 255)
    if (a > 0) for (let k = 0; k < 3; k++) B.data[i + k] = B.data[i + k] * (1 - a) + G.data[i + k] * a
    else if (ring && ring[i] > 4) {
      // Outside the hand: only ever darken, by the ratio the AI image shows, faded out with distance.
      const lb = B.data[i] + B.data[i + 1] + B.data[i + 2], lg = G.data[i] + G.data[i + 1] + G.data[i + 2]
      const m = Math.min(1, Math.max(0.55, lg / Math.max(1, lb))), f = 1 - (1 - m) * (ring[i] / 255)
      for (let k = 0; k < 3; k++) B.data[i + k] *= f
    }
  }
  o.putImageData(B, 0, 0)
  return out
}

/** AI hand swap: only the generated hand, as a transparent layer the size of the canvas, to sit over the live render with
 *  the 3D hand hidden. The cut follows the generated hand's own outline (see cutout.ts); a finger over the screen stays in
 *  front, parts of the device in front of the hand cut it. Returns the layer and the mask used, for checking. */
export function handLayer(p: Passes, ai: AiResult, opts: { silhouette?: boolean } = {}) {
  const { w, h } = p
  const gen = canvas(w, h), g = gen.getContext('2d')!; g.imageSmoothingQuality = 'high'; g.drawImage(ai.full, 0, 0, w, h)
  const px = (c: HTMLCanvasElement) => c.getContext('2d')!.getImageData(0, 0, w, h).data
  const { rgba, alpha } = cutHand({ w, h, gen: g.getImageData(0, 0, w, h).data, plate: px(p.clean), mask: px(p.mask), occ: px(p.occlusion) })
  const out = canvas(w, h), ox = out.getContext('2d')!, L = new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>, w, h)
  if (opts.silhouette) grade(L.data)
  ox.putImageData(L, 0, 0)
  const mask = canvas(w, h), mx = mask.getContext('2d')!, MK = mx.createImageData(w, h)
  for (let i = 0; i < w * h; i++) { const v = Math.round(alpha[i] * 255); MK.data[i * 4] = MK.data[i * 4 + 1] = MK.data[i * 4 + 2] = v; MK.data[i * 4 + 3] = 255 }
  mx.putImageData(MK, 0, 0)
  return { layer: out, mask }
}
