// Spectral hands: a near-invisible tinted body with Sketch-style outlines (opaque outer silhouette from a skinned inverted
// hull, thin inner lines for knuckle creases and fingertip fingerprint arcs), plus optional Glimmer (fresnel rim glow),
// Stars (small four-point sparkles) and Shimmer (an iridescent sweep, animated live). Everything is on the Sketch line
// layer and inside the hands' noBounds group, so it stays out of the contact shadow and the framing.
import * as THREE from 'three'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { LINE_LAYER } from '../sketch/Sketch'

export interface SpectralOptions { tint: string; transparency: number; glimmer: boolean; stars: boolean; shimmer: boolean }
export const SPECTRAL_DEFAULTS: SpectralOptions = { tint: '#206DD0', transparency: 0.98, glimmer: false, stars: false, shimmer: false }
export const SPECTRAL_OUTER = 2.4, SPECTRAL_INNER = 1.0 // CSS px, like Sketch's outer and inner lines

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
varying vec3 vN; varying vec3 vV; varying vec3 vW;
void main() {
${SKIN_BODY}
  vN = normalize(normalMatrix * objectNormal); vV = -mvPosition.xyz; vW = (modelMatrix * vec4(transformed, 1.0)).xyz;
}`
const bodyFrag = /* glsl */`
uniform vec3 uTint; uniform float uAlpha, uGlimmer, uShimmer, uTime;
varying vec3 vN; varying vec3 vV; varying vec3 vW;
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
const starVert = /* glsl */`uniform float uSize; attribute float aScale; void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = uSize * aScale; }`
const starFrag = /* glsl */`uniform vec3 uTint;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0; vec2 q = abs(p);
  // four-point star: two thin tapered rays plus a small core
  float ray = max(1.0 - smoothstep(0.0, 0.09 * (1.0 - q.x), q.y), 1.0 - smoothstep(0.0, 0.09 * (1.0 - q.y), q.x));
  ray *= 1.0 - smoothstep(0.6, 1.0, max(q.x, q.y));
  float core = 1.0 - smoothstep(0.0, 0.22, length(p));
  float a = max(ray, core);
  if (a < 0.01) discard;
  gl_FragColor = vec4(mix(uTint, vec3(1.0), 0.55 * core + 0.25), a * 0.9);
  #include <colorspace_fragment>
}`

export function spectralMaterials(o: SpectralOptions) {
  const tint = new THREE.Color(o.tint), res = new THREE.Vector2(1, 1)
  const body = new THREE.ShaderMaterial({ vertexShader: bodyVert, fragmentShader: bodyFrag, transparent: true, depthWrite: true,
    uniforms: { uTint: { value: tint }, uAlpha: { value: 1 - o.transparency }, uGlimmer: { value: o.glimmer ? 1 : 0 }, uShimmer: { value: o.shimmer ? 1 : 0 }, uTime: { value: 0 } } })
  const hull = new THREE.ShaderMaterial({ vertexShader: hullVert, fragmentShader: hullFrag, side: THREE.BackSide, transparent: true, depthWrite: false,
    uniforms: { uTint: { value: tint }, uWidth: { value: SPECTRAL_OUTER }, uRes: { value: res } } })
  const line = new LineMaterial({ color: o.tint, linewidth: SPECTRAL_INNER, worldUnits: false, transparent: true, opacity: 0.85, depthWrite: false })
  const star = new THREE.ShaderMaterial({ vertexShader: starVert, fragmentShader: starFrag, transparent: true, depthWrite: false, depthTest: false,
    uniforms: { uTint: { value: tint }, uSize: { value: 18 } } })
  return { body, hull, line, star, res, tint,
    /** per frame: pixel ratio and canvas size for the screen-space widths, and the shimmer clock (frozen when still) */
    frame(w: number, h: number, dpr: number, t: number) {
      res.set(w * dpr, h * dpr); line.resolution.set(w * dpr, h * dpr); line.linewidth = SPECTRAL_INNER * dpr
      hull.uniforms.uWidth.value = SPECTRAL_OUTER * dpr; star.uniforms.uSize.value = 18 * dpr; body.uniforms.uTime.value = t
    },
    dispose() { body.dispose(); hull.dispose(); line.dispose(); star.dispose() } }
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

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3()
/** Rebuilds the inner lines and stars for the current pose (the hands only move when re-solved). */
export function buildSpectral(mesh: THREE.SkinnedMesh, owner: string[], m: SpectralMats, stars: boolean) {
  for (const c of [...mesh.children]) if (c.userData.spectral && !c.userData.spectralHull) { mesh.remove(c); (c as THREE.Mesh).geometry?.dispose() }
  const prep = prepare(mesh, owner)
  let top: THREE.Object3D = mesh; while (top.parent) top = top.parent
  top.updateMatrixWorld(true); mesh.skeleton.update()
  const sk = new Map<number, THREE.Vector3>()
  const P = (i: number) => { let v = sk.get(i); if (!v) { v = mesh.getVertexPosition(i, new THREE.Vector3()); sk.set(i, v) } return v }
  // centre of the skinned hand, to push the lines a hair outward so they win the depth test against the body
  const box = new THREE.Box3(); for (const s of prep.segs) box.expandByPoint(P(s[0]))
  const out: number[] = []
  const pt = (i: number, j: number, t: number, nb: THREE.Vector3) => { _a.copy(P(i)).lerp(P(j), t); return _a }
  for (const s of prep.segs) {
    const A = pt(s[0], s[1], s[2], _c).clone(), Bp = pt(s[3], s[4], s[5], _c).clone()
    // outward offset: along the averaged normal estimate from the two edges' skinned positions relative to the segment's local centre
    const mid = A.clone().add(Bp).multiplyScalar(0.5)
    const n = mesh.geometry.getAttribute('normal')
    _b.fromBufferAttribute(n, s[0]).add(_c.fromBufferAttribute(n, s[3])).normalize()
    // bind-space normal turned by the dominant bone of the first vertex
    const bi = mesh.geometry.getAttribute('skinIndex').getX(s[0]), bone = mesh.skeleton.bones[bi]
    const rot = new THREE.Matrix3().setFromMatrix4(bone.matrixWorld.clone().multiply(mesh.skeleton.boneInverses[bi]))
    const nw = _b.applyMatrix3(rot).normalize().transformDirection(mesh.matrixWorld.clone().invert())
    const off = nw.multiplyScalar(0.004); void mid
    out.push(A.x + off.x, A.y + off.y, A.z + off.z, Bp.x + off.x, Bp.y + off.y, Bp.z + off.z)
  }
  const g = new LineSegmentsGeometry(); g.setPositions(out)
  const lines = new LineSegments2(g, m.line); lines.renderOrder = 12
  lines.userData = { spectral: true, noBounds: true }; lines.layers.set(LINE_LAYER); lines.frustumCulled = false; mesh.add(lines)
  if (stars) {
    const sp: number[] = [], sc: number[] = [], ks = [1, 0.7, 0.85, 0.6, 0.9, 0.75, 0.55, 0.65]
    prep.starV.forEach((v, k) => { const p = P(v); const o = [0.012, -0.008, 0.01][k % 3]; sp.push(p.x + o, p.y + o * 0.7, p.z + 0.01); sc.push(ks[k % ks.length]) })
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3)); sg.setAttribute('aScale', new THREE.Float32BufferAttribute(sc, 1))
    const pts = new THREE.Points(sg, m.star); pts.renderOrder = 14; pts.frustumCulled = false
    pts.userData = { spectral: true, noBounds: true }; pts.layers.set(LINE_LAYER); mesh.add(pts)
  }
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
