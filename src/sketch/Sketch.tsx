// Sketch style: turns any device into a flat product illustration.
// Cream toon fill with two soft grey shade bands, thick grey silhouette lines (screen-space inverted hull)
// and thin grey crease lines (EdgesGeometry above a crease angle, plus hand-made lines a device can supply).
// Reflections, glass sheens and the environment are dropped. Works by swapping materials on the live meshes
// every frame (cheap), so it follows button presses, the SIM tray and hot reloads, and restores everything when off.
import { useEffect, useRef, type ReactNode } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'

export interface SketchOptions {
  /** body fill */ fill: string
  /** first and second shade bands */ shade1: string; shade2: string
  /** line colour */ line: string
  /** outer silhouette width and inner line width, in CSS pixels */ outer: number; inner: number
  /** crease angle in degrees for the inner lines */ crease: number
}
export const SKETCH_DEFAULTS: SketchOptions = { fill: '#f4ecdc', shade1: '#e3dac8', shade2: '#cfc5b2', line: '#77726a', outer: 2.6, inner: 1.1, crease: 32 }
/** Warm off-white paper for the background in sketch mode. */
export const SKETCH_PAPER = '#f7f3ea'

// ---------- materials ----------
const toonVert = /* glsl */`
varying vec3 vN;
#include <common>
#include <clipping_planes_pars_vertex>
void main() {
  vN = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  #include <clipping_planes_vertex>
}`
const toonFrag = /* glsl */`
uniform vec3 uFill; uniform vec3 uS1; uniform vec3 uS2; uniform vec3 uL;
uniform float uOpacity;
varying vec3 vN;
void main() {
  vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n;
  float d = dot(n, normalize(uL));
  // two soft-edged bands: lit, half shade, deep shade
  float a = smoothstep(0.18, 0.30, d), b = smoothstep(-0.32, -0.18, d);
  vec3 c = mix(uS2, mix(uS1, uFill, a), b);
  gl_FragColor = vec4(c, uOpacity);
  #include <colorspace_fragment>
}`
// Key light fixed in view space (upper left, slightly towards the viewer), so shading reads the same from any angle.
const LIGHT_DIR = new THREE.Vector3(-0.55, 0.7, 0.75)
function toonMaterial(fill: THREE.Color, s1: THREE.Color, s2: THREE.Color) {
  return new THREE.ShaderMaterial({
    uniforms: { uFill: { value: fill }, uS1: { value: s1 }, uS2: { value: s2 }, uL: { value: LIGHT_DIR }, uOpacity: { value: 1 } },
    vertexShader: toonVert, fragmentShader: toonFrag, toneMapped: false,
  })
}
const hullVert = /* glsl */`
uniform float uWidth; uniform vec2 uRes;
void main() {
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  vec3 vn = normalize(normalMatrix * normal);
  vec2 n = (projectionMatrix * vec4(vn, 0.0)).xy;
  float l = length(n);
  if (l > 1e-5) clip.xy += n / l * uWidth / uRes * 2.0 * clip.w;
  clip.z += 1e-4 * clip.w; // never in front of the fill it outlines
  gl_Position = clip;
}`
const hullFrag = /* glsl */`
uniform vec3 uColor;
void main() { gl_FragColor = vec4(uColor, 1.0);
  #include <colorspace_fragment>
}`

type Orig = { material: THREE.Material | THREE.Material[]; visible: boolean }
const ORIG = '__sketchOrig', ADDED = '__sketchAdded'
const edgeCache = new WeakMap<THREE.BufferGeometry, Map<number, LineSegmentsGeometry | null>>()
function edgesFor(g: THREE.BufferGeometry, crease: number) {
  let m = edgeCache.get(g); if (!m) edgeCache.set(g, m = new Map())
  if (m.has(crease)) return m.get(crease)!
  let out: LineSegmentsGeometry | null = null
  if (g.attributes.position && g.attributes.position.count < 400000) {
    const e = new THREE.EdgesGeometry(g, crease)
    if (e.attributes.position.count) { out = new LineSegmentsGeometry().setPositions(e.attributes.position.array as Float32Array) }
    e.dispose()
  }
  m.set(crease, out); return out
}
/** Segments where the plane y = c cuts the faces whose normal is mostly sideways (|nz| < maxNz), in local space. */
export function sliceY(g: THREE.BufferGeometry, ys: number[], maxNz = 0.93): Float32Array {
  const p = g.attributes.position, idx = g.index, out: number[] = []
  const tri = idx ? idx.count / 3 : p.count / 3
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), u = new THREE.Vector3()
  for (let t = 0; t < tri; t++) {
    const i0 = idx ? idx.getX(t * 3) : t * 3, i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2
    a.fromBufferAttribute(p, i0); b.fromBufferAttribute(p, i1); c.fromBufferAttribute(p, i2)
    n.copy(c).sub(b).cross(u.copy(a).sub(b)); if (n.lengthSq() === 0) continue
    if (Math.abs(n.normalize().z) > maxNz) continue
    for (const y of ys) {
      const pts: THREE.Vector3[] = []
      for (const [q, r] of [[a, b], [b, c], [c, a]]) {
        const dq = q.y - y, dr = r.y - y
        if ((dq < 0) !== (dr < 0) && dq !== dr) pts.push(q.clone().lerp(r, dq / (dq - dr)))
      }
      if (pts.length === 2) out.push(pts[0].x, pts[0].y, pts[0].z, pts[1].x, pts[1].y, pts[1].z)
    }
  }
  return new Float32Array(out)
}
const handCache = new WeakMap<Float32Array, LineSegmentsGeometry>()
const handLines = (a: Float32Array) => { let g = handCache.get(a); if (!g) handCache.set(a, g = new LineSegmentsGeometry().setPositions(a)); return g }

const lum = (c: THREE.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
const matColour = (m: THREE.Material) => (m as THREE.MeshBasicMaterial).color as THREE.Color | undefined

/**
 * Wrap a device with this. Mesh userData hints a device can set:
 *  sketchHull: true      thick silhouette outline around this mesh
 *  sketchEdges: false    no automatic crease lines (open surfaces whose border is not a real edge)
 *  sketchLines: Float32Array  extra thin line segments in local space
 *  sketchHide: true      hidden in sketch mode
 *  sketchTone: 'dark' | 'screen' | 'fill'   force a tone
 * Group userData.sketchNoEdges stops automatic crease lines for everything inside (lens internals).
 */
export function SketchStyle({ on, o = SKETCH_DEFAULTS, children }: { on: boolean; o?: SketchOptions; children: ReactNode }) {
  const root = useRef<THREE.Group>(null)
  const { gl, size } = useThree()
  const mats = useRef<ReturnType<typeof makeMats> | null>(null)
  useEffect(() => {
    if (!on) return
    const m = makeMats(o); mats.current = m
    return () => { mats.current = null; restore(root.current); m.dispose() }
  }, [on, o])
  useFrame(() => {
    const g = root.current, m = mats.current; if (!on || !g || !m) return
    const dpr = gl.getPixelRatio()
    m.res.set(size.width * dpr, size.height * dpr)
    m.thin.linewidth = o.inner * dpr; m.thick.uniforms.uWidth.value = o.outer * dpr
    const meshes: { mesh: THREE.Mesh; noEdges: boolean }[] = []
    const walk = (obj: THREE.Object3D, noEdges: boolean) => {
      if (obj.userData[ADDED]) return
      const ne = noEdges || !!obj.userData.sketchNoEdges
      if ((obj as THREE.Mesh).isMesh) meshes.push({ mesh: obj as THREE.Mesh, noEdges: ne })
      for (const c of obj.children) walk(c, ne)
    }
    walk(g, false)
    for (const { mesh, noEdges } of meshes) apply(mesh, noEdges, m, o)
  })
  return <group ref={root}>{children}</group>
}

function makeMats(o: SketchOptions) {
  const col = (s: string) => new THREE.Color(s)
  const fill = col(o.fill), s1 = col(o.shade1), s2 = col(o.shade2)
  const res = new THREE.Vector2(1, 1)
  const thick = new THREE.ShaderMaterial({ uniforms: { uColor: { value: col(o.line) }, uWidth: { value: o.outer }, uRes: { value: res } },
    vertexShader: hullVert, fragmentShader: hullFrag, side: THREE.BackSide, toneMapped: false })
  const thin = new LineMaterial({ color: o.line, linewidth: o.inner, worldUnits: false, toneMapped: false })
  // Dark parts (island, lens internals, ports) become a soft warm grey; the black bezel a deeper grey.
  const dark = toonMaterial(col('#bdb5a6'), col('#b0a898'), col('#a39b8b'))
  const bezel = toonMaterial(col('#6f6a62'), col('#67625a'), col('#5f5a53'))
  const idle = new THREE.MeshBasicMaterial({ color: '#e7e1d5', toneMapped: false })
  const logo = new THREE.MeshBasicMaterial({ color: o.line, transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false })
  const cache = new Map<string, THREE.Material>()
  /** One clone per (base, polygonOffset) pair, offset pushed back so the lines win the depth test. */
  const variant = (base: THREE.Material, src: THREE.Material) => {
    const f = (src.polygonOffset ? src.polygonOffsetFactor : 0) + 1.5, u = (src.polygonOffset ? src.polygonOffsetUnits : 0) + 1.5
    const k = `${base.uuid}|${f}|${u}|${src.side}`
    let v = cache.get(k)
    if (!v) { v = base.clone(); if ((base as THREE.ShaderMaterial).uniforms) (v as THREE.ShaderMaterial).uniforms = (base as THREE.ShaderMaterial).uniforms
      v.polygonOffset = true; v.polygonOffsetFactor = f; v.polygonOffsetUnits = u; v.side = src.side; cache.set(k, v) }
    return v
  }
  const fillMat = toonMaterial(fill, s1, s2)
  return { fill: fillMat, dark, bezel, idle, logo, thick, thin, res, variant, logoCache: new Map<THREE.Texture, THREE.Material>(),
    dispose() { [fillMat, dark, bezel, idle, logo, thick, thin, ...cache.values()].forEach(x => x.dispose()) } }
}
type Mats = ReturnType<typeof makeMats>

function pick(src: THREE.Material, mesh: THREE.Mesh, m: Mats): THREE.Material | null {
  const tone = mesh.userData.sketchTone as string | undefined
  if (src.blending === THREE.AdditiveBlending) return null // glass sheens and reflections
  const mb = src as THREE.MeshBasicMaterial
  if (mesh.name === 'screen' || tone === 'screen') {
    if (mb.map) return src // keep the user's screen content as is
    return m.variant(m.idle, src)
  }
  if (mb.alphaMap) { // logo: a quiet grey print of the artwork
    let v = m.logoCache.get(mb.alphaMap)
    if (!v) { v = m.logo.clone(); (v as THREE.MeshBasicMaterial).alphaMap = mb.alphaMap; v.polygonOffset = true; v.polygonOffsetFactor = -2; v.polygonOffsetUnits = -2; v.needsUpdate = true; m.logoCache.set(mb.alphaMap, v) }
    return v
  }
  if (tone === 'fill') return m.variant(m.fill, src)
  if (mesh.name === 'ip18-cover') return m.variant(m.bezel, src)
  const c = matColour(src)
  if (tone === 'dark' || (c && lum(c) < 0.02)) return m.variant(m.dark, src)
  if (src.transparent && src.opacity < 0.6) return null // thin AR films inside the lenses
  return m.variant(m.fill, src)
}

function apply(mesh: THREE.Mesh, noEdges: boolean, m: Mats, o: SketchOptions) {
  const ud = mesh.userData
  let orig = ud[ORIG] as Orig | undefined
  const cur = mesh.material as THREE.Material
  // A fresh material from React (re-render, hot reload) replaces our swap: remember it as the new original.
  if (!orig || (cur !== orig.material && !(cur as THREE.Material).userData?.sketch)) {
    orig = { material: mesh.material, visible: orig?.visible ?? mesh.visible }; ud[ORIG] = orig
    const src = Array.isArray(orig.material) ? orig.material[0] : orig.material
    const nm = ud.sketchHide ? null : pick(src, mesh, m)
    if (nm) { nm.userData.sketch = true; mesh.material = nm } else mesh.visible = false
    addLines(mesh, src, noEdges, m, o)
  }
}

function addLines(mesh: THREE.Mesh, src: THREE.Material, noEdges: boolean, m: Mats, o: SketchOptions) {
  for (const c of [...mesh.children]) if (c.userData[ADDED]) { mesh.remove(c) }
  if (!mesh.visible && !mesh.userData.sketchLines) return
  const add = (obj: THREE.Object3D) => { obj.userData[ADDED] = true; obj.raycast = () => {}; mesh.add(obj) }
  if (mesh.userData.sketchHull) {
    const h = new THREE.Mesh(mesh.geometry, m.thick); h.renderOrder = -1; add(h)
  }
  const lines = mesh.userData.sketchLines as Float32Array | undefined
  if (lines && lines.length) add(new LineSegments2(handLines(lines), m.thin))
  const tone = src && mesh.name !== 'screen' && !(src as THREE.MeshBasicMaterial).alphaMap
  if (tone && !noEdges && mesh.userData.sketchEdges !== false && mesh.visible) {
    const e = edgesFor(mesh.geometry, o.crease); if (e) add(new LineSegments2(e, m.thin))
  }
}

function restore(g: THREE.Object3D | null) {
  g?.traverse(obj => {
    const ud = obj.userData, orig = ud[ORIG] as Orig | undefined
    if (orig) { (obj as THREE.Mesh).material = orig.material; obj.visible = orig.visible; delete ud[ORIG] }
    for (const c of [...obj.children]) if (c.userData[ADDED]) obj.remove(c)
  })
}
