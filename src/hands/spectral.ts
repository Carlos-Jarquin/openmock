// Spectral hands: a near-invisible tinted body with Sketch-style outlines (opaque outer silhouette from a skinned inverted
// hull, thin inner lines for silhouettes, knuckle creases and fingertip arcs), plus optional Glimmer (fresnel rim glow),
// Stars (tiny twinkling glints on the skin) and Shimmer (an iridescent sweep, animated live). Everything is on the Sketch line
// layer and inside the hands' noBounds group, so it stays out of the contact shadow and the framing.
import * as THREE from 'three'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { LINE_LAYER } from '../sketch/Sketch'

/** mass: 0 to 1, darker and denser where the hand has more volume. glow: a soft inner light where it is thin (fingertips,
 *  webbing). rim: a crisp white edge light. contours: faint level lines across the skin. Older saves lack the new keys. */
export interface SpectralOptions { tint: string; line: string; transparency: number; glimmer: boolean; stars: boolean; shimmer: boolean; seeBlur: number; mass?: number; glow?: boolean; rim?: boolean; contours?: boolean }
export const SPECTRAL_DEFAULTS: SpectralOptions = { tint: '#206DD0', line: '#206DD0', transparency: 0.98, seeBlur: 0.85, glimmer: false, stars: false, shimmer: false, mass: 0, glow: false, rim: false, contours: false }
export const SPECTRAL_OUTER = 2.4, SPECTRAL_INNER = 0.75 // CSS px, like Sketch's outer and inner lines

const SKIN_PARS = /* glsl */`
#include <common>
#include <skinning_pars_vertex>
`
const SKIN_BODY = /* glsl */`
#include <beginnormal_vertex>
#include <skinbase_vertex>
#include <skinnormal_vertex>
#include <begin_vertex>
#include <skinning_vertex>
#include <project_vertex>
`
const bodyVert = `${SKIN_PARS}
attribute vec3 smoothNormal; attribute float aMass; attribute float aArm;
varying vec3 vN; varying vec3 vV; varying vec3 vW; varying vec3 vB; varying float vMass; varying float vArm;
void main() {
  vMass = aMass; vArm = aArm;
${SKIN_BODY.replace('#include <beginnormal_vertex>', 'vec3 objectNormal = smoothNormal;')}
  vN = normalize(normalMatrix * objectNormal); vV = -mvPosition.xyz; vW = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vB = position; // bind-pose position: glints stay put on the skin as the hand poses
}`
const bodyFrag = /* glsl */`
uniform vec3 uTint; uniform float uAlpha, uGlimmer, uShimmer, uStars, uTime, uPx, uMass, uGlow, uRim, uContours, uArmFade;
varying vec3 vN; varying vec3 vV; varying vec3 vW; varying vec3 vB; varying float vMass; varying float vArm;
vec3 hash3(vec3 p) { p = fract(p * vec3(443.897, 441.423, 437.195)); p += dot(p, p.yxz + 19.19); return fract((p.xxy + p.yxx) * p.zyx); }
/** Stars: sparse glints on a 3D cell grid in bind space (cell ~2.5 mm), each a tiny four-point glint that twinkles on its own clock. */
float glints(vec3 b) {
  float cell = 0.003, best = 0.0;
  vec3 g = floor(b / cell);
  for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) for (int k = -1; k <= 1; k++) {
    vec3 c = g + vec3(i, j, k), h = hash3(c);
    if (h.x > 0.42) continue; // keep about 4 in 10 cells
    vec3 h2 = hash3(c + 17.3);
    vec3 pc = (c + h) * cell;
    // glint radius about 0.5 mm on the skin (bind space is in metres)
    float d = length(b - pc) / max(uPx, 1e-6);
    float tw = pow(0.5 + 0.5 * sin(uTime * (1.5 + 2.5 * h2.x) + 6.2831 * h2.y), 3.0);
    float core = exp(-d * d * 0.9);
    best = max(best, core * tw * (0.6 + 0.4 * h2.z));
  }
  return best;
}
vec3 hue(vec3 c, float a) { const vec3 k = vec3(0.57735); float ca = cos(a); return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca); }
void main() {
  vec3 n = normalize(vN), v = normalize(vV);
  float f = 1.0 - abs(dot(n, v));
  float rim = pow(f, 3.4);
  vec3 col = uTint; float a = uAlpha;
  // Glimmer: a soft rim glow in a lighter tint
  col = mix(col, mix(uTint, vec3(1.0), 0.45), uGlimmer * rim); a += uGlimmer * rim * 0.32;
  // Shimmer: a diagonal band that drifts across the hand, shifting the hue a little either side of the tint
  float s = sin(dot(vW, vec3(9.0, 6.0, 4.0)) - uTime * 1.3);
  float band = smoothstep(0.55, 1.0, s);
  col = mix(col, hue(mix(uTint, vec3(1.0), 0.3), 0.6 * sin(dot(vW, vec3(3.0, -2.0, 1.0)) + uTime * 0.4)), uShimmer * (0.35 + 0.65 * band));
  a += uShimmer * (0.05 + 0.18 * band * (0.4 + 0.6 * f));
  float st = uStars > 0.0 ? glints(vB) : 0.0;
  col = mix(col, mix(uTint, vec3(1.0), 0.35), min(1.0, st * 1.6)); a = max(a, min(1.0, st * 1.6));
  // Mass: deeper tint and a little more body where the hand is thick (palm, base of the thumb, forearm)
  col = mix(col, col * 0.42, uMass * vMass); a += uMass * vMass * 0.22;
  // Inner glow: thin parts let light through, so they glow a pale tint, most towards the edges
  float thin = 1.0 - vMass;
  col = mix(col, mix(uTint, vec3(1.0), 0.65), uGlow * thin * thin * (0.45 + 0.55 * f)); a += uGlow * thin * thin * 0.16;
  // Rim light: a crisp white edge, narrower and brighter than Glimmer
  float rl = pow(f, 7.0); col = mix(col, vec3(1.0), uRim * rl * 0.85); a += uRim * rl * 0.55;
  // Contours: faint level lines every 4 mm on the skin (bind space, so they ride with it), one pixel wide
  float ch = vB.y + 0.35 * vB.x, cg = abs(fract(ch / 0.004) - 0.5) * 0.004, cw = fwidth(ch) * 0.8;
  float cl = 1.0 - smoothstep(0.0, max(cw, 1e-6), cg); col = mix(col, mix(uTint, vec3(1.0), 0.2), uContours * cl * 0.7); a += uContours * cl * 0.25;
  // Arm off: the forearm fades out from 3 to 30 mm past the wrist (vArm is in model units, 100 mm)
  a *= 1.0 - uArmFade * smoothstep(0.03, 0.3, vArm);
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
  #include <colorspace_fragment>
}`
const hullVert = `${SKIN_PARS}
uniform float uWidth; uniform vec2 uRes; attribute float aArm; attribute float aCut; varying float vArm; varying float vCut;
void main() {
  vArm = aArm; vCut = aCut;
${SKIN_BODY}
  vec4 nc = projectionMatrix * vec4(normalMatrix * objectNormal, 0.0);
  vec2 d = nc.xy; float l = length(d); d = l > 1e-6 ? d / l : vec2(0.0);
  gl_Position.xy += d * uWidth / uRes * 2.0 * gl_Position.w;
}`
// vCut: the hand mesh's open wrist rim, whose hull read as a ring where the forearm joins, so hand and arm draw as one
// outline. With the arm off, the forearm's outline fades with its body.
const hullFrag = /* glsl */`uniform vec3 uTint; uniform float uArmFade; varying float vArm; varying float vCut;
void main() { if (vCut > 0.5) discard; float k = 1.0 - uArmFade * smoothstep(0.03, 0.3, vArm); if (k < 0.02) discard; gl_FragColor = vec4(uTint, k);
  #include <colorspace_fragment>
}`
export function spectralMaterials(o: SpectralOptions) {
  const tint = new THREE.Color(o.tint), lineCol = new THREE.Color(o.line ?? o.tint), res = new THREE.Vector2(1, 1)
  const body = new THREE.ShaderMaterial({ vertexShader: bodyVert, fragmentShader: bodyFrag, transparent: true, depthWrite: true,
    uniforms: { uTint: { value: tint }, uAlpha: { value: 1 - o.transparency }, uGlimmer: { value: o.glimmer ? 1 : 0 }, uShimmer: { value: o.shimmer ? 1 : 0 }, uStars: { value: o.stars ? 1 : 0 }, uTime: { value: 0 }, uPx: { value: 0.0005 }, uMass: { value: o.mass ?? 0 }, uGlow: { value: o.glow ? 1 : 0 }, uRim: { value: o.rim ? 1 : 0 }, uContours: { value: o.contours ? 1 : 0 }, uArmFade: { value: 0 } } })
  const hull = new THREE.ShaderMaterial({ vertexShader: hullVert, fragmentShader: hullFrag, side: THREE.BackSide, transparent: true, depthWrite: false,
    uniforms: { uTint: { value: lineCol }, uWidth: { value: SPECTRAL_OUTER }, uRes: { value: res }, uArmFade: { value: 0 } } })
  const line = new LineMaterial({ color: o.line ?? o.tint, linewidth: SPECTRAL_INNER, worldUnits: false, transparent: true, opacity: 0.85, depthWrite: false })
  // See-through layers: the same lines where they sit behind the nearest skin (depth test inverted against the body's depth
  // prepass), drawn as three stacked strokes, wider and fainter as the blur rises, which reads as a soft, out-of-focus line.
  const ghosts = [0, 1, 2].map(() => new LineMaterial({ color: o.line ?? o.tint, linewidth: SPECTRAL_INNER, worldUnits: false, transparent: true, opacity: 0, depthWrite: false }))
  let blur = o.seeBlur ?? 0.85
  return { body, hull, line, ghosts, res, tint, lineCol,
    setLine(c: string) { lineCol.set(c); line.color.set(c); for (const g of ghosts) g.color.set(c) },
    setBlur(b: number) { blur = b },
    /** per frame: pixel ratio and canvas size for the screen-space widths, and the shimmer clock (frozen when still) */
    frame(w: number, h: number, dpr: number, t: number) {
      res.set(w * dpr, h * dpr); line.resolution.set(w * dpr, h * dpr); line.linewidth = SPECTRAL_INNER * dpr
      const spread = [2, 6, 12], op = [0.8 * (1 - blur) ** 2 + 0.006 * blur, 0.004 * blur, 0.0025 * blur]
      ghosts.forEach((g, i) => { g.resolution.set(w * dpr, h * dpr); g.linewidth = SPECTRAL_INNER * dpr * (1 + blur * spread[i]); g.opacity = op[i]; g.visible = op[i] > 0.003 })
      hull.uniforms.uWidth.value = SPECTRAL_OUTER * dpr; body.uniforms.uTime.value = t
    },
    dispose() { body.dispose(); hull.dispose(); line.dispose(); for (const g of ghosts) g.dispose() } }
}
export type SpectralMats = ReturnType<typeof spectralMaterials>

// ---------- authored inner lines on the skinned surface ----------
type Seg = [number, number, number, number, number, number] // two endpoints, each an edge (i, j, t)
type Bary = [number, number, number, number, number] // triangle a, b, c and weights for b and c
interface Prepared { segs: Seg[]; starV: number[]; bary: Bary[]; rings: Bary[][] }
function rayTri(o: THREE.Vector3, d: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): [number, number, number] | null {
  const e1 = b.clone().sub(a), e2 = c.clone().sub(a), p = d.clone().cross(e2), det = e1.dot(p); if (Math.abs(det) < 1e-12) return null
  const s = o.clone().sub(a), u = s.dot(p) / det; if (u < 0 || u > 1) return null
  const q = s.clone().cross(e1), v = d.dot(q) / det; if (v < 0 || u + v > 1) return null
  const t = e2.dot(q) / det; return t > 0 ? [t, u, v] : null }
const cache = new WeakMap<THREE.BufferGeometry, Prepared>()
const FINGERS = ['index-finger', 'middle-finger', 'ring-finger', 'pinky-finger']

/** Level-set segments of f over triangles whose vertices all pass keep(). */
function contour(geo: THREE.BufferGeometry, f: Float32Array, keep: (v: number) => boolean, level: number, out: Seg[]) {
  const idx = geo.index!, n = idx.count
  for (let k = 0; k < n; k += 3) {
    const t = [idx.getX(k), idx.getX(k + 1), idx.getX(k + 2)]
    if (!keep(t[0]) || !keep(t[1]) || !keep(t[2])) continue
    const pts: [number, number, number][] = []
    for (let e = 0; e < 3; e++) { const a = t[e], b = t[(e + 1) % 3], fa = f[a] - level, fb = f[b] - level
      if ((fa < 0) !== (fb < 0)) pts.push([a, b, fa / (fa - fb)]) }
    if (pts.length === 2) out.push([...pts[0], ...pts[1]] as Seg)
  }
}

function prepare(mesh: THREE.SkinnedMesh, owner: string[]): Prepared {
  const geo = mesh.geometry
  const hit = cache.get(geo); if (hit) return hit
  const pos = geo.getAttribute('position'), N = pos.count
  // Bind-pose world space: vertices via bindMatrix, joints from the inverse bind matrices.
  const bind = (i: number) => new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.bindMatrix)
  const B: THREE.Vector3[] = []; for (let i = 0; i < N; i++) B.push(bind(i))
  const bones = mesh.skeleton.bones
  const J = (name: string) => { const k = bones.findIndex(b => b.name === name); return new THREE.Vector3().setFromMatrixPosition(mesh.skeleton.boneInverses[k].clone().invert()) }
  const W = J('wrist'), I = J('index-finger-metacarpal'), P = J('pinky-finger-metacarpal'), M = J('middle-finger-phalanx-proximal')
  // Palm normal (palm side positive). The sign flips with handedness on its own, since the left model is mirrored.
  let pn = new THREE.Vector3().crossVectors(I.clone().sub(W), P.clone().sub(W)).normalize()
  // Make it point to the palm: the fingertips curl toward the palm in the rest pose of these assets only slightly, so use
  // the thumb, which sits on the palm side of the index-pinky plane.
  if (J('thumb-tip').sub(W).dot(pn) < 0) pn.negate()
  void M
  const segs: Seg[] = [], starV: number[] = [], bary: Bary[] = [], f = new Float32Array(N)
  const finger = (base: string, distal: string, tip: string, creaseJoints: string[], owned: string[]) => {
    const D = J(distal), T = J(tip), ax = T.clone().sub(D), len = ax.length(); ax.normalize()
    const side = new THREE.Vector3().crossVectors(ax, pn).normalize(), nrm = new THREE.Vector3().crossVectors(side, ax).normalize()
    const mine = new Set(owned), ownD = (v: number) => owner[v] === distal
    let hw = 0; for (let v = 0; v < N; v++) if (ownD(v)) hw = Math.max(hw, Math.abs(B[v].clone().sub(D).dot(side)))
    hw = Math.max(hw, 1e-4)
    // Fingerprint arcs: concentric ellipses on the pad (palm side), opening toward the tip.
    const s0 = 0.5
    for (let v = 0; v < N; v++) { const d = B[v].clone().sub(D); f[v] = Math.hypot((d.dot(ax) / len - s0) / 0.42, d.dot(side) / (hw * 0.85)) }
    const pad = (v: number) => { if (!ownD(v)) return false; const d = B[v].clone().sub(D); return d.dot(nrm) > hw * 0.35 && d.dot(ax) / len < s0 + 0.12 }
    for (const L of [0.3, 0.55, 0.8]) contour(geo, f, pad, L, segs)
    // Nails are authored curves, not level sets: the distal segment has too few triangles for a clean contour. Each curve
    // point is cast from the bone axis out through the back of the finger onto the bind-pose surface and stored as a
    // barycentric point on the hit triangle, so it follows the skin as the hand poses.
    // Nail plate: squoval covering the last ~45% of the distal segment (s 0.5 to 0.95 of D to tip) and ~75% of the finger
    // width (a chord at +-48.6 deg round it); squarer at the free edge (superellipse power 4), rounder at the cuticle (2.6).
    // Measured from the real fingertip (the furthest skin past the tip joint, not the joint), the plate spans the distal
    // 10% to 55% of the last phalanx, so its free edge ends a millimetre or two short of the tip.
    let Lmax = len; for (let v = 0; v < N; v++) if (ownD(v)) Lmax = Math.max(Lmax, B[v].clone().sub(D).dot(ax))
    const n0 = (Lmax * 0.45) / len, n1 = (Lmax * 0.9) / len, nc = (n0 + n1) / 2, nh = (n1 - n0) / 2, A = Math.asin(0.75)
    // Orientation and centre per finger: the bone sits nearer the back than the fleshy pad, so the cross-section centroid
    // (over the nail's span) points from the axis toward the pad. Its opposite is the nail's facing; the palm-plane normal
    // alone tilted the thumb's nails and any finger rolled about its axis. The centroid's sideways offset recentres it.
    const cen = new THREE.Vector3(); let cn = 0
    for (let v = 0; v < N; v++) if (ownD(v)) { const d = B[v].clone().sub(D), a = d.dot(ax) / len; if (a > n0 && a < n1) { cen.add(d.addScaledVector(ax, -d.dot(ax))); cn++ } }
    let nb = nrm.clone(), off = new THREE.Vector3()
    if (cn > 4) { cen.divideScalar(cn); const pd = cen.clone().normalize(); void pd // tried: facing from the centroid; it rolled the nails sideways on these meshes, so keep the palm-plane facing
      off = side.clone().multiplyScalar(cen.dot(side) * 0.5) } // half the sideways offset: recentre without overshooting
    const sb = new THREE.Vector3().crossVectors(ax, nb).normalize().multiplyScalar(Math.sign(new THREE.Vector3().crossVectors(ax, nb).dot(side)) || 1)
    const tris: number[] = []; { const idx = geo.index!; for (let t = 0; t < idx.count; t += 3) { const a = idx.getX(t), b = idx.getX(t + 1), c = idx.getX(t + 2); if (ownD(a) || ownD(b) || ownD(c)) tris.push(a, b, c) } }
    const cast = (u: number, w: number): Bary | null => {
      const O = D.clone().add(off).addScaledVector(ax, (nc + u * nh) * len), ang = w * A
      const dir = nb.clone().multiplyScalar(-Math.cos(ang)).addScaledVector(sb, Math.sin(ang))
      let best: Bary | null = null, bt = Infinity
      for (let t = 0; t < tris.length; t += 3) { const h = rayTri(O, dir, B[tris[t]], B[tris[t + 1]], B[tris[t + 2]]); if (h && h[0] < bt) { bt = h[0]; best = [tris[t], tris[t + 1], tris[t + 2], h[1], h[2]] } }
      return best }
    const curve = (pts: [number, number][], closed: boolean) => { const c = pts.map(([u, w]) => cast(u, w))
      for (let i = 0; i < c.length - (closed ? 0 : 1); i++) { const a = c[i], b = c[(i + 1) % c.length]; if (a && b) bary.push(a, b) } }
    const sq = (th: number, k: number) => { const c = Math.cos(th), s2 = Math.sin(th); return [Math.sign(c) * Math.pow(Math.abs(c), 2 / k), Math.sign(s2) * Math.pow(Math.abs(s2), 2 / k)] as [number, number] }
    const plate: [number, number][] = []; for (let i = 0; i < 40; i++) { const th = (i / 40) * Math.PI * 2; plate.push(sq(th, Math.cos(th) > 0 ? 4 : 2.6)) }
    curve(plate, true)
    // Eponychium (cuticle fold): the rounded base curve again, a little behind the plate, on the cuticle side only.
    const epo: [number, number][] = []; for (let i = 0; i <= 16; i++) { const th = Math.PI * (0.62 + 0.76 * i / 16), [u, w] = sq(th, 2.6); epo.push([u - 0.14, w * 1.03]) }
    curve(epo, false)
    // Lunula: the pale half-moon at the nail base, an arc bulging toward the free edge about a fifth of the way in.
    const lun: [number, number][] = []; for (let i = 0; i <= 14; i++) { const th = -Math.PI / 2 + Math.PI * i / 14; lun.push([-0.96 + 0.4 * Math.cos(th), 0.55 * Math.sin(th)]) }
    curve(lun, false)
    // Knuckle creases: a short line across each joint, on both the palm and the back, kept to the middle of the finger.
    for (const jn of creaseJoints) {
      const C = J(jn), nxt = J(jn.replace(/phalanx-(proximal|intermediate|distal)$/, (m) => ({ 'phalanx-proximal': 'phalanx-intermediate', 'phalanx-intermediate': 'phalanx-distal', 'phalanx-distal': 'tip' } as Record<string, string>)[m]))
      const a2 = nxt.sub(C).normalize()
      for (let v = 0; v < N; v++) f[v] = B[v].clone().sub(C).dot(a2)
      const near = (v: number) => mine.has(owner[v]) && Math.abs(B[v].clone().sub(C).dot(side)) < hw * 0.55 && B[v].distanceTo(C) < hw * 2.2
      contour(geo, f, near, 0, segs)
    }
    // a star candidate near the tip, on the outer edge
    let best = -1, bd = -1; for (let v = 0; v < N; v++) if (ownD(v)) { const d = B[v].clone().sub(D).dot(ax); if (d > bd) { bd = d; best = v } }
    if (best >= 0) starV.push(best)
    void base
  }
  for (const fg of FINGERS) finger(fg, `${fg}-phalanx-distal`, `${fg}-tip`, [`${fg}-phalanx-intermediate`, `${fg}-phalanx-distal`],
    [`${fg}-phalanx-proximal`, `${fg}-phalanx-intermediate`, `${fg}-phalanx-distal`])
  finger('thumb', 'thumb-phalanx-distal', 'thumb-tip', ['thumb-phalanx-distal'], ['thumb-phalanx-proximal', 'thumb-phalanx-distal'])
  // two more stars by the knuckles of the index and ring fingers
  for (const b of ['index-finger-phalanx-proximal', 'ring-finger-phalanx-intermediate', 'wrist']) { const v = owner.indexOf(b); if (v >= 0) starV.push(v) }
  // Thumb outline: on these meshes the thumb is fused into the palm, so there is no depth step or facing switch where it
  // lies over the hand and the geometric silhouette finds nothing (checked with the phone hidden). Instead the thumb is
  // treated as a bent tube: rings of skin points round its metacarpal (from where it leaves the palm), proximal and distal
  // segments, each point cast from the bone axis and stored on the skin. Per frame, each ring's two contour points (where
  // the skin turns away from the camera) are joined ring to ring into the thumb's two side edges.
  const rings: Bary[][] = []
  { const chain = ['thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip'], spans = [[0.45, 1], [0, 1], [0, 0.8]]
    const thumbish = new Set([...chain, 'wrist', 'index-finger-metacarpal']), idx = geo.index!, tt: number[] = []
    for (let t = 0; t < idx.count; t += 3) { const a = idx.getX(t), b = idx.getX(t + 1), c = idx.getX(t + 2); if (thumbish.has(owner[a]) || thumbish.has(owner[b]) || thumbish.has(owner[c])) tt.push(a, b, c) }
    for (let k = 0; k < 3; k++) { const A = J(chain[k]), Bj = J(chain[k + 1]), ax2 = Bj.clone().sub(A), L = ax2.length(); ax2.normalize()
      const u = new THREE.Vector3(1, 0, 0); if (Math.abs(u.dot(ax2)) > 0.9) u.set(0, 1, 0); u.addScaledVector(ax2, -u.dot(ax2)).normalize()
      const w = new THREE.Vector3().crossVectors(ax2, u), steps = k === 0 ? 4 : 6
      for (let i = 0; i < steps; i++) { if (k > 0 && i === 0) continue
        const f = spans[k][0] + (spans[k][1] - spans[k][0]) * i / (steps - 1), O = A.clone().addScaledVector(ax2, f * L), ring: Bary[] = []
        for (let j = 0; j < 24; j++) { const an = j / 24 * Math.PI * 2, dir = u.clone().multiplyScalar(Math.cos(an)).addScaledVector(w, Math.sin(an))
          let best: Bary | null = null, bt = Infinity
          for (let t = 0; t < tt.length; t += 3) { const h = rayTri(O, dir, B[tt[t]], B[tt[t + 1]], B[tt[t + 2]]); if (h && h[0] < bt && h[0] < 0.03) { bt = h[0]; best = [tt[t], tt[t + 1], tt[t + 2], h[1], h[2]] } }
          if (best) ring.push(best) }
        if (ring.length >= 16) rings.push(ring) } } }
  const p = { segs, starV, bary, rings }; cache.set(geo, p); return p
}

// ---------- per-frame inner silhouettes ----------
// Finger separations, overlaps and inner contours are the hand's own silhouette edges seen from the camera: mesh edges
// between a front- and a back-facing triangle. They are found every frame (the camera or the hand may turn), and every
// line point is pulled 1.2 mm toward the camera so it wins the depth test against the clear body it lies on. A normal
// offset alone lost grazing silhouettes to the body's depth, which is what made them drop out.
interface Edges { tris: Uint32Array; edges: Uint32Array /* a, b, t1, t2 */ }
const edgeCache = new WeakMap<THREE.BufferGeometry, Edges>()
function edgesOf(geo: THREE.BufferGeometry): Edges {
  const hit = edgeCache.get(geo); if (hit) return hit
  const pos = geo.getAttribute('position'), idx = geo.index!
  // weld split vertices (UV seams) so neighbouring triangles share edges
  const key = new Map<string, number>(), weld = new Uint32Array(pos.count)
  for (let i = 0; i < pos.count; i++) { const k = `${pos.getX(i).toFixed(5)},${pos.getY(i).toFixed(5)},${pos.getZ(i).toFixed(5)}`
    let w = key.get(k); if (w === undefined) { w = i; key.set(k, i) } weld[i] = w }
  const tris = new Uint32Array(idx.count); for (let i = 0; i < idx.count; i++) tris[i] = idx.getX(i)
  const map = new Map<string, number[]>()
  for (let t = 0; t < idx.count / 3; t++) for (let e = 0; e < 3; e++) {
    const a = weld[tris[t * 3 + e]], b = weld[tris[t * 3 + (e + 1) % 3]], k = a < b ? `${a}_${b}` : `${b}_${a}`
    const l = map.get(k); if (l) l.push(t); else map.set(k, [a < b ? a : b, a < b ? b : a, t]) }
  const out: number[] = []
  for (const l of map.values()) out.push(l[0], l[1], l[2], l.length > 3 ? l[3] : 0xffffffff)
  const r = { tris, edges: new Uint32Array(out) }; edgeCache.set(geo, r); return r
}

interface LineState { prep: Prepared; skinned: Float32Array; creases: Float32Array; rings: Float32Array[]; lines: LineSegments2; thumb: LineSegments2; ghosts: LineSegments2[]; camKey: string }
/** Rebuilds the skinned positions and the crease and fingertip lines for the current pose (on each re-solve). */
/** noNails: the hand wears procedural nail meshes (nails.ts), so the authored nail curves are left out and only the
 *  nail meshes' own outline shows. */
export function buildSpectral(mesh: THREE.SkinnedMesh, owner: string[], m: SpectralMats, noNails = false) {
  for (const c of [...mesh.children]) if (c.userData.spectral && !c.userData.spectralHull) { mesh.remove(c); (c as THREE.Mesh).geometry?.dispose() }
  const prep0 = prepare(mesh, owner), prep = noNails ? { ...prep0, bary: [] } : prep0
  let top: THREE.Object3D = mesh; while (top.parent) top = top.parent
  top.updateMatrixWorld(true); mesh.skeleton.update()
  const N = mesh.geometry.getAttribute('position').count, sk = new Float32Array(N * 3), v = new THREE.Vector3()
  for (let i = 0; i < N; i++) { mesh.getVertexPosition(i, v); sk[i * 3] = v.x; sk[i * 3 + 1] = v.y; sk[i * 3 + 2] = v.z }
  const P = (i: number, j: number, t: number, o: number[]) => { for (let k = 0; k < 3; k++) o.push(sk[i * 3 + k] + (sk[j * 3 + k] - sk[i * 3 + k]) * t) }
  const cr: number[] = []; for (const s of prep.segs) { P(s[0], s[1], s[2], cr); P(s[3], s[4], s[5], cr) }
  for (const [a, b, c, u, w] of prep.bary) for (let k = 0; k < 3; k++) cr.push(sk[a * 3 + k] * (1 - u - w) + sk[b * 3 + k] * u + sk[c * 3 + k] * w)
  const lines = new LineSegments2(new LineSegmentsGeometry(), m.line); lines.renderOrder = 12
  lines.userData = { spectral: true, noBounds: true }; lines.layers.set(LINE_LAYER); lines.frustumCulled = false; mesh.add(lines)
  const ghosts = m.ghosts.map((gm, i) => { const g = new LineSegments2(lines.geometry, gm);
    g.userData = { spectral: true, noBounds: true, ghost: true }; g.layers.set(LINE_LAYER); g.frustumCulled = false; mesh.add(g); return g })
  for (const g of ghosts) g.renderOrder = 8 // before the hand's depth prepass (9): they test only against the phone's depth,
  // so nothing behind the phone ever shows; the clear skin (10) then lies over them and the crisp lines (12) win where visible
  const rings = prep.rings.map(r => { const a = new Float32Array(r.length * 3); r.forEach(([x, y, z, u, w], i) => { for (let k = 0; k < 3; k++) a[i * 3 + k] = sk[x * 3 + k] * (1 - u - w) + sk[y * 3 + k] * u + sk[z * 3 + k] * w }); return a })
  // The thumb outline is drawn before the hand's depth prepass, so only the phone (not the hand's own skin, e.g. the
  // thenar bulge it runs past) can hide it; with its 7 mm pull it also clears the frame it rests on.
  const thumb = new LineSegments2(new LineSegmentsGeometry(), m.line); thumb.renderOrder = 8
  thumb.userData = { spectral: true, noBounds: true }; thumb.layers.set(LINE_LAYER); thumb.frustumCulled = false; mesh.add(thumb)
  mesh.userData.spectralLines = { prep, skinned: sk, creases: new Float32Array(cr), rings, lines, thumb, ghosts, camKey: '' } as LineState
}

/** Re-skins the lines in place for the pose the bones hold now. The hand's motion layer springs the bones after each
 *  solve, so lines baked only at the solve were left at an old pose: stacked, stale thumb outlines over the moving skin. */
export function reskinSpectral(mesh: THREE.SkinnedMesh) {
  const st = mesh.userData.spectralLines as LineState | undefined; if (!st || !st.lines.parent) return
  let top: THREE.Object3D = mesh; while (top.parent) top = top.parent
  top.updateMatrixWorld(true); mesh.skeleton.update()
  const sk = st.skinned, N = sk.length / 3, v = new THREE.Vector3()
  for (let i = 0; i < N; i++) { mesh.getVertexPosition(i, v); sk[i * 3] = v.x; sk[i * 3 + 1] = v.y; sk[i * 3 + 2] = v.z }
  const cr = st.creases; let o = 0
  const P = (i: number, j: number, t: number) => { for (let k = 0; k < 3; k++) cr[o++] = sk[i * 3 + k] + (sk[j * 3 + k] - sk[i * 3 + k]) * t }
  for (const g of st.prep.segs) { P(g[0], g[1], g[2]); P(g[3], g[4], g[5]) }
  for (const [a, b, c, u, w] of st.prep.bary) for (let k = 0; k < 3; k++) cr[o++] = sk[a * 3 + k] * (1 - u - w) + sk[b * 3 + k] * u + sk[c * 3 + k] * w
  st.prep.rings.forEach((r, ri) => { const a = st.rings[ri]; r.forEach(([x, y, z, u, w], i) => { for (let k = 0; k < 3; k++) a[i * 3 + k] = sk[x * 3 + k] * (1 - u - w) + sk[y * 3 + k] * u + sk[z * 3 + k] * w }) })
  st.camKey = ''   // the silhouette is redrawn on the next updateSpectral
}

const _cam = new THREE.Vector3(), _inv = new THREE.Matrix4()
/** Per frame: silhouette edges from the camera's point of view, plus the creases, all nudged toward the camera. */
export function updateSpectral(mesh: THREE.SkinnedMesh, camera: THREE.Camera) {
  const st = mesh.userData.spectralLines as LineState | undefined; if (!st || !st.lines.parent) return
  _inv.copy(mesh.matrixWorld).invert(); _cam.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(_inv)
  const key = `${_cam.x.toFixed(4)},${_cam.y.toFixed(4)},${_cam.z.toFixed(4)}`; if (key === st.camKey) return
  st.camKey = key
  const { tris, edges } = edgesOf(mesh.geometry), sk = st.skinned, T = tris.length / 3
  const facing = new Int8Array(T)
  for (let t = 0; t < T; t++) {
    const a = tris[t * 3] * 3, b = tris[t * 3 + 1] * 3, c = tris[t * 3 + 2] * 3
    const ux = sk[b] - sk[a], uy = sk[b + 1] - sk[a + 1], uz = sk[b + 2] - sk[a + 2], vx = sk[c] - sk[a], vy = sk[c + 1] - sk[a + 1], vz = sk[c + 2] - sk[a + 2]
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    facing[t] = nx * (_cam.x - sk[a]) + ny * (_cam.y - sk[a + 1]) + nz * (_cam.z - sk[a + 2]) > 0 ? 1 : -1
  }
  const out: number[] = []
  // the toward-camera nudge, in mesh-local units (the hand mesh is in metres): 1.2 mm
  // Silhouette edges get a larger pull (5 mm): on this low-poly mesh the front/back switch often falls on an edge that
  // sits a few millimetres behind the part's own visible rim (the thumb over the palm was the worst), so a 1.2 mm pull
  // left the contour failing the depth test and only its faint see-through copy showed. Moving toward the camera does
  // not shift a line on screen, so the larger pull only changes what it may draw over, by 5 mm.
  let pull = 0.005
  const tout: number[] = []; let tgt = out
  const nudge = (x: number, y: number, z: number) => { const dx = _cam.x - x, dy = _cam.y - y, dz = _cam.z - z, l = Math.hypot(dx, dy, dz) || 1, k = pull / l
    tgt.push(x + dx * k, y + dy * k, z + dz * k) }
  for (let e = 0; e < edges.length; e += 4) {
    const t1 = edges[e + 2], t2 = edges[e + 3]
    if (t2 === 0xffffffff || facing[t1] === facing[t2]) continue
    const a = edges[e] * 3, b = edges[e + 1] * 3
    nudge(sk[a], sk[a + 1], sk[a + 2]); nudge(sk[b], sk[b + 1], sk[b + 2])
  }
  // thumb side edges: per ring, the two points where the skin turns from facing the camera to facing away
  let thumbHits = 0
  // The thumb outline is drawn before the hand's depth (so only the phone hides it), which means the hand's own skin must
  // be checked here: a point counts as buried when the ray to the camera meets the hand more than 10 mm in front of it
  // (the palm, when the thumb is on the far side). Nearer skin, like the thenar bulge the edge runs past, doesn't count.
  const ray = new THREE.Ray(), va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3(), hitP = new THREE.Vector3()
  const buried = (p: number[]) => { ray.origin.set(p[0], p[1], p[2]); ray.direction.set(_cam.x - p[0], _cam.y - p[1], _cam.z - p[2]).normalize()
    ray.origin.addScaledVector(ray.direction, 0.01)
    for (let t = 0; t < T; t++) { const a = tris[t * 3] * 3, b = tris[t * 3 + 1] * 3, c = tris[t * 3 + 2] * 3
      va.set(sk[a], sk[a + 1], sk[a + 2]); vb.set(sk[b], sk[b + 1], sk[b + 2]); vc.set(sk[c], sk[c + 1], sk[c + 2])
      if (ray.intersectTriangle(va, vb, vc, false, hitP)) return true }
    return false }
  // The thumb hugs the phone's side and front edge, so its inner edge lies on (or a hair inside) the frame and failed the
  // depth test there. Its points get a 7 mm pull: enough to clear the frame it rests on, still less than the phone's
  // 8.25 mm thickness, so a thumb truly behind the phone (seen from the back) stays hidden.
  pull = 0.007; tgt = tout
  { let prev: number[][] | null = null
    for (const r of st.rings) { const n = r.length / 3; let cx = 0, cy = 0, cz = 0; for (let i = 0; i < n; i++) { cx += r[i * 3]; cy += r[i * 3 + 1]; cz += r[i * 3 + 2] } cx /= n; cy /= n; cz /= n
      const f = (i: number) => { const x = r[i * 3], y = r[i * 3 + 1], z = r[i * 3 + 2]; return (x - cx) * (_cam.x - x) + (y - cy) * (_cam.y - y) + (z - cz) * (_cam.z - z) }
      const hits: number[][] = []
      for (let i = 0; i < n; i++) { const j = (i + 1) % n, a = f(i), b = f(j); if ((a > 0) !== (b > 0)) { const t = a / (a - b); hits.push([0, 1, 2].map(k => r[i * 3 + k] + (r[j * 3 + k] - r[i * 3 + k]) * t)) } }
      // a ring with a gap or a bump can report more than two crossings: keep the two furthest apart
      if (hits.length > 2) { let bi = 0, bj = 1, bd = -1
        for (let i = 0; i < hits.length; i++) for (let j = i + 1; j < hits.length; j++) { const dd = Math.hypot(hits[i][0] - hits[j][0], hits[i][1] - hits[j][1], hits[i][2] - hits[j][2]); if (dd > bd) { bd = dd; bi = i; bj = j } }
        hits.splice(0, hits.length, hits[bi], hits[bj]) }
      thumbHits += hits.length
      if (hits.length === 2 && prev) {
        // pair each edge with the nearer point of the previous ring so the two sides don't cross
        const d = (p: number[], q: number[]) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])
        const sw: boolean = d(prev[0], hits[0]) + d(prev[1], hits[1]) > d(prev[0], hits[1]) + d(prev[1], hits[0])
        const h: number[][] = sw ? [hits[1], hits[0]] : hits
        for (let s2 = 0; s2 < 2; s2++) if (!buried(prev[s2]) && !buried(h[s2])) { nudge(prev[s2][0], prev[s2][1], prev[s2][2]); nudge(h[s2][0], h[s2][1], h[s2][2]) }
        prev = h
      } else if (hits.length === 2) {
        // first good ring: start the two side edges here (no line across the base; it read as a stray mark)
        prev = hits }
      // a ring with no clean crossing (a gap in the cast points) is skipped and the edges bridge over it
    }
  }
  if (import.meta.env.DEV) (globalThis as { __thumbHits?: number }).__thumbHits = thumbHits
  tgt = out
  pull = 0.0012
  const cr = st.creases; for (let i = 0; i < cr.length; i += 3) nudge(cr[i], cr[i + 1], cr[i + 2])
  st.lines.geometry.dispose(); const g = new LineSegmentsGeometry(); g.setPositions(out); st.lines.geometry = g; for (const gh of st.ghosts) gh.geometry = g
  st.thumb.geometry.dispose(); const tg = new LineSegmentsGeometry(); tg.setPositions(tout.length ? tout : [0, 0, 0, 0, 0, 0]); st.thumb.geometry = tg
}

/** The opaque outer outline: an inverted hull sharing the hand's geometry and skeleton (or a plain mesh for the forearm). */
/** The hand meshes have hard (split) normals at UV seams and low-poly creases, so a Fresnel rim from them shows flat facets
 *  and shards. Average the normals of every vertex sharing a position (0.05 mm grid) into 'smoothNormal' for the body shader. */
function ensureSmooth(g: THREE.BufferGeometry) {
  if (g.getAttribute('smoothNormal')) return
  if (!g.getAttribute('normal')) g.computeVertexNormals()
  const pos = g.getAttribute('position'), nor = g.getAttribute('normal'), n = pos.count
  const key = (i: number) => `${Math.round(pos.getX(i) / 5e-5)},${Math.round(pos.getY(i) / 5e-5)},${Math.round(pos.getZ(i) / 5e-5)}`
  const sum = new Map<string, THREE.Vector3>(), keys: string[] = []
  for (let i = 0; i < n; i++) { const k = key(i); keys.push(k); const v = sum.get(k) ?? new THREE.Vector3(); v.x += nor.getX(i); v.y += nor.getY(i); v.z += nor.getZ(i); sum.set(k, v) }
  const out = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) { const v = sum.get(keys[i])!.clone().normalize(); out[i * 3] = v.x; out[i * 3 + 1] = v.y; out[i * 3 + 2] = v.z }
  g.setAttribute('smoothNormal', new THREE.BufferAttribute(out, 3))
}
export function addHull(mesh: THREE.Mesh, m: SpectralMats) {
  ensureSmooth(mesh.geometry)
  for (const c of [...mesh.children]) if (c.userData.spectralHull) mesh.remove(c)
  let h: THREE.Mesh
  if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) { const s = mesh as THREE.SkinnedMesh; const sh = new THREE.SkinnedMesh(s.geometry, m.hull); sh.bind(s.skeleton, s.bindMatrix); sh.bindMode = s.bindMode; h = sh }
  else h = new THREE.Mesh(mesh.geometry, m.hull)
  h.renderOrder = 11; h.frustumCulled = false; h.userData = { spectral: true, spectralHull: true, noBounds: true }; h.layers.set(LINE_LAYER); h.castShadow = false
  mesh.add(h)
  // Depth prepass: the body is see-through, so without it the palm, the thumb behind it and fingers wrapping the phone
  // each add their own Glimmer rim and Shimmer, which shows as shards and flat facets. Writing depth first means only the
  // nearest skin surface is shaded (the phone still shows through, since it is drawn before at renderOrder 0).
  // transparent (though it draws no colour) so it sorts by renderOrder with the clear body and the lines; as an opaque
  // material it ran in the opaque pass before every line, which silently hid the see-through and thumb lines too.
  const pm = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true, transparent: true })
  let d: THREE.Mesh
  if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) { const s = mesh as THREE.SkinnedMesh; const sd = new THREE.SkinnedMesh(s.geometry, pm); sd.bind(s.skeleton, s.bindMatrix); sd.bindMode = s.bindMode; d = sd }
  else d = new THREE.Mesh(mesh.geometry, pm)
  d.renderOrder = 9; d.frustumCulled = false; d.userData = { spectral: true, spectralHull: true, noBounds: true }; d.layers.set(LINE_LAYER); d.castShadow = false
  mesh.add(d)
}
export function removeHull(mesh: THREE.Mesh) { for (const c of [...mesh.children]) if (c.userData.spectral) mesh.remove(c) }
