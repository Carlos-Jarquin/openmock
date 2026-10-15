/** AI hand cutout: follows the generated hand's own outline instead of the 3D hand's shape. Pure pixel code (no DOM).
 *  1. Difference matte against the exact plate ComfyUI saw (the clean render flattened on black), only inside a band
 *     around Openmock's hand mask, sharpened by skin colour; over the device only skin that differs counts.
 *  2. Open (erode then grow) to cut thin lines, keep only blobs that touch the 3D hand, fill enclosed holes.
 *  3. Soft edge from the matte, pulled in 1 px, colours un-mixed from the plate (no dark fringe), feathered about 1.5 px. */
export interface CutIn {
  w: number; h: number
  gen: Uint8ClampedArray      // generated full image, RGBA
  plate: Uint8ClampedArray    // clean render, RGBA (alpha = device coverage, background transparent)
  mask: Uint8ClampedArray     // the 3D hand silhouette, RGBA (red channel)
  occ?: Uint8ClampedArray     // parts of the device in front of the hand, RGBA (red channel)
}
const clamp01 = (v: number) => v < 0 ? 0 : v > 1 ? 1 : v
const smooth = (v: number, a: number, b: number) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t) }

/** square max (grow) or min (shrink) filter, separable, radius r */
function morph(src: Uint8Array, w: number, h: number, r: number, grow: boolean): Uint8Array {
  if (r <= 0) return src.slice()
  const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h), pick = grow ? Math.max : Math.min
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let v = src[y * w + x]
    for (let k = Math.max(0, x - r), e = Math.min(w - 1, x + r); k <= e; k++) v = pick(v, src[y * w + k]); tmp[y * w + x] = v }
  for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) { let v = tmp[y * w + x]
    for (let k = Math.max(0, y - r), e = Math.min(h - 1, y + r); k <= e; k++) v = pick(v, tmp[k * w + x]); out[y * w + x] = v }
  return out
}
/** binary dilation by a large radius, done as repeated small steps (fast enough for 40 px bands) */
function growBin(src: Uint8Array, w: number, h: number, r: number) { let s = src; for (let left = r; left > 0; left -= 4) s = morph(s, w, h, Math.min(4, left), true); return s }
/** box blur on floats, separable, radius r, n passes (about gaussian) */
function blur(src: Float32Array, w: number, h: number, r: number, n = 2): Float32Array {
  let a = src.slice(), b = new Float32Array(w * h)
  for (let p = 0; p < n; p++) {
    for (let y = 0; y < h; y++) { let s = 0, c = 0; const o = y * w
      for (let x = -r; x < w + r; x++) { if (x + r < w && x + r >= 0) { s += a[o + x + r]; c++ } if (x - r - 1 >= 0 && x - r - 1 < w) { s -= a[o + x - r - 1]; c-- } if (x >= 0 && x < w) b[o + x] = s / c } }
    for (let x = 0; x < w; x++) { let s = 0, c = 0
      for (let y = -r; y < h + r; y++) { if (y + r < h && y + r >= 0) { s += b[(y + r) * w + x]; c++ } if (y - r - 1 >= 0 && y - r - 1 < h) { s -= b[(y - r - 1) * w + x]; c-- } if (y >= 0 && y < h) a[y * w + x] = s / c } }
  }
  return a
}
/** 4-connected labels of a binary image; returns label per pixel and blob sizes */
function label(bin: Uint8Array, w: number, h: number) {
  const lab = new Int32Array(w * h), sizes: number[] = [0], st = new Int32Array(w * h)
  for (let i = 0; i < w * h; i++) { if (!bin[i] || lab[i]) continue
    const id = sizes.length; let n = 0, top = 0; st[top++] = i; lab[i] = id
    while (top) { const p = st[--top]; n++; const x = p % w
      if (x > 0 && bin[p - 1] && !lab[p - 1]) { lab[p - 1] = id; st[top++] = p - 1 }
      if (x < w - 1 && bin[p + 1] && !lab[p + 1]) { lab[p + 1] = id; st[top++] = p + 1 }
      if (p >= w && bin[p - w] && !lab[p - w]) { lab[p - w] = id; st[top++] = p - w }
      if (p < w * (h - 1) && bin[p + w] && !lab[p + w]) { lab[p + w] = id; st[top++] = p + w } }
    sizes.push(n) }
  return { lab, sizes }
}

export function cutHand(I: CutIn): { rgba: Uint8ClampedArray; alpha: Float32Array } {
  const { w, h, gen: G, plate: C, mask: Mk } = I, N = w * h, u = w / 1024
  const hand = new Uint8Array(N), onDev = new Float32Array(N)
  for (let i = 0; i < N; i++) { hand[i] = Mk[i * 4] > 127 ? 1 : 0; onDev[i] = C[i * 4 + 3] / 255 }
  // 1. band around the 3D hand, where the AI hand may have drawn
  const band = growBin(hand, w, h, Math.round(40 * u)), near = growBin(hand, w, h, Math.round(12 * u))
  // the background the AI actually painted: usually the flat black it was given, but it sometimes repaints it (a soft
  // gradient). Estimate it from generated pixels outside the band and off the device, filled inward by wide
  // normalised blurs (smallest scale that has samples wins).
  const known = new Float32Array(N), ch = [0, 1, 2].map(() => new Float32Array(N))
  for (let i = 0; i < N; i++) if (!band[i] && onDev[i] < 0.02) { known[i] = 1; for (let c = 0; c < 3; c++) ch[c][i] = G[i * 4 + c] }
  const bgc = [0, 1, 2].map(() => new Float32Array(N)), got = new Float32Array(N)
  for (const rad of [Math.round(24 * u), Math.round(72 * u), Math.round(200 * u)]) {
    const kw = blur(known, w, h, rad, 2), cs = ch.map(c => blur(c, w, h, rad, 2))
    for (let i = 0; i < N; i++) if (!got[i] && kw[i] > 0.04) { got[i] = 1; for (let c = 0; c < 3; c++) bgc[c][i] = cs[c][i] / kw[i] }
  }
  const inside = morph(hand, w, h, Math.round(6 * u), false)
  const raw = new Float32Array(N)
  for (let i = 0; i < N; i++) { if (!band[i]) continue
    const j = i * 4, r = G[j], g = G[j + 1], b = G[j + 2], ca = C[j + 3] / 255
    // the plate as ComfyUI saw it: transparency flattened on black
    const pr = C[j] * ca + bgc[0][i] * (1 - ca), pg = C[j + 1] * ca + bgc[1][i] * (1 - ca), pb = C[j + 2] * ca + bgc[2][i] * (1 - ca)
    const d = Math.max(Math.abs(r - pr), Math.abs(g - pg), Math.abs(b - pb))
    const cb = 128 - 0.1687 * r - 0.3313 * g + 0.5 * b, cr = 128 + 0.5 * r - 0.4187 * g - 0.0813 * b, Y = 0.299 * r + 0.587 * g + 0.114 * b
    const skin = smooth(cr, 128, 140) * (1 - smooth(cr, 180, 192)) * smooth(cb, 66, 76) * (1 - smooth(cb, 122, 132)) * smooth(Y, 20, 45)
    // deep inside the 3D hand the AI hand is almost always there too, so dark shaded skin needs less evidence
    const diff = inside[i] ? smooth(d, 6, 26) : smooth(d, 14, 52)
    // off the device: any clear difference (skin helps in the far band); on the device: only differing skin
    const off = diff * (inside[i] ? Math.max(0.85, skin) : near[i] ? Math.max(0.3, skin) : skin)
    raw[i] = (1 - onDev[i]) * off + onDev[i] * diff * skin
  }
  // 2. clean the shape: open to drop thin lines and specks, keep blobs touching the 3D hand, fill holes
  let bin: Uint8Array = new Uint8Array(N); for (let i = 0; i < N; i++) bin[i] = raw[i] > 0.5 ? 1 : 0
  const ro = Math.max(1, Math.round(2 * u)); bin = morph(morph(bin, w, h, ro, false), w, h, ro, true)
  const rc = Math.max(2, Math.round(5 * u)); bin = morph(growBin(bin, w, h, rc), w, h, 0, false)
  { let t: Uint8Array = bin; for (let left = rc; left > 0; left -= 4) t = morph(t, w, h, Math.min(4, left), false); bin = t }
  { const { lab, sizes } = label(bin, w, h), touch = new Uint8Array(sizes.length), min = N * 0.0015
    for (let i = 0; i < N; i++) if (lab[i] && hand[i]) touch[lab[i]] = 1
    for (let i = 0; i < N; i++) if (lab[i] && (!touch[lab[i]] || sizes[lab[i]] < min)) bin[i] = 0 }
  { const inv = new Uint8Array(N); for (let i = 0; i < N; i++) inv[i] = bin[i] ? 0 : 1
    const { lab, sizes } = label(inv, w, h), edge = new Uint8Array(sizes.length)
    for (let x = 0; x < w; x++) { edge[lab[x]] = 1; edge[lab[(h - 1) * w + x]] = 1 }
    for (let y = 0; y < h; y++) { edge[lab[y * w]] = 1; edge[lab[y * w + w - 1]] = 1 }
    for (let i = 0; i < N; i++) if (inv[i] && !edge[lab[i]] && sizes[lab[i]] < N * 0.02) bin[i] = 1 }
  // 3. edge: solid inside, the soft matte in a 2 px rim, pulled in 1 px, feathered
  const inner = morph(bin, w, h, 1, false), rim = morph(bin, w, h, 2, true)
  let a: Float32Array = new Float32Array(N)
  for (let i = 0; i < N; i++) a[i] = inner[i] ? 1 : rim[i] ? Math.min(raw[i], bin[i] ? 1 : 0.5) : 0
  a = blur(a, w, h, 1, 2)
  for (let i = 0; i < N; i++) a[i] = smooth(a[i], 0.12, 0.95)
  const occ = I.occ, out = new Uint8ClampedArray(N * 4)
  for (let i = 0; i < N; i++) { const j = i * 4; let al = a[i]; if (occ) al *= 1 - occ[j] / 255
    if (al <= 0.003) continue
    // un-mix the plate from edge pixels: fg = (gen - (1 - a) * plate) / a, so the black the AI blended in does not show
    const ca = C[j + 3] / 255, k = Math.max(al, 0.35)
    for (let c = 0; c < 3; c++) { const bg = C[j + c] * ca + bgc[c][i] * (1 - ca); out[j + c] = al > 0.97 ? G[j + c] : (G[j + c] - (1 - k) * bg) / k }
    out[j + 3] = Math.round(al * 255); a[i] = al }
  return { rgba: out, alpha: a }
}
