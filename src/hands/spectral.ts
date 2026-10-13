// Spectral hands: a near-invisible tinted body with Sketch-style outlines (opaque outer silhouette from a skinned inverted
// hull, thin inner lines for silhouettes, knuckle creases and fingertip arcs), plus optional Glimmer (fresnel rim glow),
// Stars (tiny twinkling glints on the skin) and Shimmer (an iridescent sweep, animated live). Everything is on the Sketch line
// layer and inside the hands' noBounds group, so it stays out of the contact shadow and the framing.
import * as THREE from 'three'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { LINE_LAYER } from '../sketch/Sketch'

export interface SpectralOptions { tint: string; transparency: number; glimmer: boolean; stars: boolean; shimmer: boolean }
export const SPECTRAL_DEFAULTS: SpectralOptions = { tint: '#206DD0', transparency: 0.98, glimmer: false, stars: false, shimmer: false }
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
varying vec3 vN; varying vec3 vV; varying vec3 vW; varying vec3 vB;
void main() {
${SKIN_BODY}
  vN = normalize(normalMatrix * objectNormal); vV = -mvPosition.xyz; vW = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vB = position; // bind-pose position: glints stay put on the skin as the hand poses
}`
const bodyFrag = /* glsl */`
uniform vec3 uTint; uniform float uAlpha, uGlimmer, uShimmer, uStars, uTime, uPx;
varying vec3 vN; varying vec3 vV; varying vec3 vW; varying vec3 vB;
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
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
  #include <colorspace_fragment>
}`
const hullVert = `${SKIN_PARS}
uniform float uWidth; uniform vec2 uRes;
void main() {
${SKIN_BODY}
  vec4 nc = projectionMatrix * vec4(normalMatrix * objectNormal, 0.0);
  vec2 d = nc.xy; float l = length(d); d = l > 1e-6 ? d / l : vec2(0.0);
  gl_Position.xy += d * uWidth / uRes * 2.0 * gl_Position.w;
}`
const hullFrag = /* glsl */`uniform vec3 uTint; void main() { gl_FragColor = vec4(uTint, 1.0);
  #include <colorspace_fragment>
}`
export function spectralMaterials(o: SpectralOptions) {
  const tint = new THREE.Color(o.tint), res = new THREE.Vector2(1, 1)
  const body = new THREE.ShaderMaterial({ vertexShader: bodyVert, fragmentShader: bodyFrag, transparent: true, depthWrite: true,
    uniforms: { uTint: { value: tint }, uAlpha: { value: 1 - o.transparency }, uGlimmer: { value: o.glimmer ? 1 : 0 }, uShimmer: { value: o.shimmer ? 1 : 0 }, uStars: { value: o.stars ? 1 : 0 }, uTime: { value: 0 }, uPx: { value: 0.0005 } } })
  const hull = new THREE.ShaderMaterial({ vertexShader: hullVert, fragmentShader: hullFrag, side: THREE.BackSide, transparent: true, depthWrite: false,
    uniforms: { uTint: { value: tint }, uWidth: { value: SPECTRAL_OUTER }, uRes: { value: res } } })
  const line = new LineMaterial({ color: o.tint, linewidth: SPECTRAL_INNER, worldUnits: false, transparent: true, opacity: 0.85, depthWrite: false })
  return { body, hull, line, res, tint,
    /** per frame: pixel ratio and canvas size for the screen-space widths, and the shimmer clock (frozen when still) */
    frame(w: number, h: number, dpr: number, t: number) {
      res.set(w * dpr, h * dpr); line.resolution.set(w * dpr, h * dpr); line.linewidth = SPECTRAL_INNER * dpr
      hull.uniforms.uWidth.value = SPECTRAL_OUTER * dpr; body.uniforms.uTime.value = t
    },
    dispose() { body.dispose(); hull.dispose(); line.dispose() } }
}
export type SpectralMats = ReturnType<typeof spectralMaterials>

// ---------- authored inner lines on the skinned surface ----------
type Seg = [number, number, number, number, number, number] // two endpoints, each an edge (i, j, t)
interface Prepared { segs: Seg[]; starV: number[] }
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
  const segs: Seg[] = [], starV: number[] = [], f = new Float32Array(N)
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
    // Nail bed: a rounded outline on the back of the distal segment, from about 40% of its length to just short of the tip.
    for (let v = 0; v < N; v++) { const d = B[v].clone().sub(D); f[v] = Math.hypot((d.dot(ax) / len - 0.66) / 0.3, d.dot(side) / (hw * 0.68)) }
    const back = (v: number) => ownD(v) && B[v].clone().sub(D).dot(nrm) < -hw * 0.25
    contour(geo, f, back, 1, segs)
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
  const p = { segs, starV }; cache.set(geo, p); return p
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

interface LineState { skinned: Float32Array; creases: Float32Array; lines: LineSegments2; camKey: string }
/** Rebuilds the skinned positions and the crease and fingertip lines for the current pose (on each re-solve). */
export function buildSpectral(mesh: THREE.SkinnedMesh, owner: string[], m: SpectralMats) {
  for (const c of [...mesh.children]) if (c.userData.spectral && !c.userData.spectralHull) { mesh.remove(c); (c as THREE.Mesh).geometry?.dispose() }
  const prep = prepare(mesh, owner)
  let top: THREE.Object3D = mesh; while (top.parent) top = top.parent
  top.updateMatrixWorld(true); mesh.skeleton.update()
  const N = mesh.geometry.getAttribute('position').count, sk = new Float32Array(N * 3), v = new THREE.Vector3()
  for (let i = 0; i < N; i++) { mesh.getVertexPosition(i, v); sk[i * 3] = v.x; sk[i * 3 + 1] = v.y; sk[i * 3 + 2] = v.z }
  const P = (i: number, j: number, t: number, o: number[]) => { for (let k = 0; k < 3; k++) o.push(sk[i * 3 + k] + (sk[j * 3 + k] - sk[i * 3 + k]) * t) }
  const cr: number[] = []; for (const s of prep.segs) { P(s[0], s[1], s[2], cr); P(s[3], s[4], s[5], cr) }
  const lines = new LineSegments2(new LineSegmentsGeometry(), m.line); lines.renderOrder = 12
  lines.userData = { spectral: true, noBounds: true }; lines.layers.set(LINE_LAYER); lines.frustumCulled = false; mesh.add(lines)
  mesh.userData.spectralLines = { skinned: sk, creases: new Float32Array(cr), lines, camKey: '' } as LineState
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
  const nudge = (x: number, y: number, z: number) => { const dx = _cam.x - x, dy = _cam.y - y, dz = _cam.z - z, l = Math.hypot(dx, dy, dz) || 1, k = 0.0012 / l
    out.push(x + dx * k, y + dy * k, z + dz * k) }
  for (let e = 0; e < edges.length; e += 4) {
    const t1 = edges[e + 2], t2 = edges[e + 3]
    if (t2 === 0xffffffff || facing[t1] === facing[t2]) continue
    const a = edges[e] * 3, b = edges[e + 1] * 3
    nudge(sk[a], sk[a + 1], sk[a + 2]); nudge(sk[b], sk[b + 1], sk[b + 2])
  }
  const cr = st.creases; for (let i = 0; i < cr.length; i += 3) nudge(cr[i], cr[i + 1], cr[i + 2])
  st.lines.geometry.dispose(); const g = new LineSegmentsGeometry(); g.setPositions(out); st.lines.geometry = g
}

/** The opaque outer outline: an inverted hull sharing the hand's geometry and skeleton (or a plain mesh for the forearm). */
export function addHull(mesh: THREE.Mesh, m: SpectralMats) {
  for (const c of [...mesh.children]) if (c.userData.spectralHull) mesh.remove(c)
  let h: THREE.Mesh
  if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) { const s = mesh as THREE.SkinnedMesh; const sh = new THREE.SkinnedMesh(s.geometry, m.hull); sh.bind(s.skeleton, s.bindMatrix); sh.bindMode = s.bindMode; h = sh }
  else h = new THREE.Mesh(mesh.geometry, m.hull)
  h.renderOrder = 11; h.frustumCulled = false; h.userData = { spectral: true, spectralHull: true, noBounds: true }; h.layers.set(LINE_LAYER); h.castShadow = false
  mesh.add(h)
}
export function removeHull(mesh: THREE.Mesh) { for (const c of [...mesh.children]) if (c.userData.spectral) mesh.remove(c) }
