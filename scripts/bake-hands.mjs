// Bake view-independent skin maps for the WebXR generic hand (public/hands/right.glb).
// The mesh UVs already cover the whole hand, so one atlas serves every camera angle.
// Pose-dependent crease shadows are ray-traced ambient occlusion, packed into the RGBA
// channels of ao.webp (R rest, G grip, B point, A flat). Colour, pores, knuckle wrinkles,
// thickness, roughness and the wrist mask do not depend on the camera, so they stay valid
// while the user orbits. Re-run with `npm run bake-hands`. See README, "Realistic hands".
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import sharp from 'sharp'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, 'public/hands/realistic')
const previewDir = path.join('/tmp/hand-preview')
fs.mkdirSync(outDir, { recursive: true })
fs.mkdirSync(previewDir, { recursive: true })

const SIZE = 1024
const PORE = 256
const RAYS = 13
const AO_DIST = 0.04

const FINGERS = ['index-finger', 'middle-finger', 'ring-finger', 'pinky-finger']
const CHAIN = ['metacarpal', 'phalanx-proximal', 'phalanx-intermediate', 'phalanx-distal']

function loadGltf(file) {
  const buf = fs.readFileSync(file)
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  const loader = new GLTFLoader()
  return new Promise((resolve, reject) => loader.parse(ab, '', resolve, reject))
}

function findMesh(scene) {
  let mesh = null
  scene.traverse(o => { if (o.isSkinnedMesh) mesh = o })
  if (!mesh) throw new Error('no skinned mesh')
  return mesh
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
const lerp = (a, b, t) => a + (b - a) * t
const smooth = (v, a, b) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t) }
const dot3 = (ax, ay, az, bx, by, bz) => ax * bx + ay * by + az * bz

// --- value noise ----------------------------------------------------------
const perm = new Uint8Array(512)
{
  const p = new Uint8Array(256)
  for (let i = 0; i < 256; i++) p[i] = i
  let s = 7
  for (let i = 255; i > 0; i--) { s = (s * 16807) % 2147483647; const j = s % (i + 1); const t = p[i]; p[i] = p[j]; p[j] = t }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255]
}
const fade = t => t * t * t * (t * (t * 6 - 15) + 10)
function grad(h, x, y, z) {
  const hh = h & 15
  const u = hh < 8 ? x : y
  const v = hh < 4 ? y : (hh === 12 || hh === 14) ? x : z
  return ((hh & 1) ? -u : u) + ((hh & 2) ? -v : v)
}
function noise3(x, y, z) {
  const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255
  x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z)
  const u = fade(x), v = fade(y), w = fade(z)
  const A = perm[X] + Y, AA = perm[A] + Z, AB = perm[A + 1] + Z
  const B = perm[X + 1] + Y, BA = perm[B] + Z, BB = perm[B + 1] + Z
  const l = (a, b, t) => a + (b - a) * t
  return l(w,
    l(v, l(u, grad(perm[AA], x, y, z), grad(perm[BA], x - 1, y, z)), l(u, grad(perm[AB], x, y - 1, z), grad(perm[BB], x - 1, y - 1, z))),
    l(v, l(u, grad(perm[AA + 1], x, y, z - 1), grad(perm[BA + 1], x - 1, y, z - 1)), l(u, grad(perm[AB + 1], x, y - 1, z - 1), grad(perm[BB + 1], x - 1, y - 1, z - 1))))
}
function fbm(x, y, z, oct = 5) {
  let a = 0.5, f = 1, s = 0, n = 0
  for (let i = 0; i < oct; i++) { s += a * noise3(x * f, y * f, z * f); n += a; a *= 0.5; f *= 2.02 }
  return s / n
}

// --- skeleton -------------------------------------------------------------
function restOf(mesh) {
  const bones = {}, rest = {}
  mesh.skeleton.bones.forEach(b => { bones[b.name] = b; rest[b.name] = { p: b.position.clone(), q: b.quaternion.clone() } })
  return { bones, rest }
}
function commitBones(mesh) {
  for (const b of mesh.skeleton.bones) { b.matrixAutoUpdate = true; b.updateMatrix() }
  let root = mesh
  while (root.parent) root = root.parent
  root.updateMatrixWorld(true)
}
function resetBones(mesh, bones, rest) {
  for (const n in rest) { bones[n].position.copy(rest[n].p); bones[n].quaternion.copy(rest[n].q); bones[n].scale.set(1, 1, 1) }
  commitBones(mesh)
}
function skinPos(mesh, i, target) {
  target.fromBufferAttribute(mesh.geometry.getAttribute('position'), i)
  return mesh.applyBoneTransform(i, target)
}
function skinNrm(mesh, i, pos, nrm, target) {
  _p.fromBufferAttribute(pos, i)
  _q.fromBufferAttribute(pos, i)
  _n.fromBufferAttribute(nrm, i)
  _q.addScaledVector(_n, 0.01)
  mesh.applyBoneTransform(i, _p)
  mesh.applyBoneTransform(i, _q)
  return target.subVectors(_q, _p).normalize()
}
const _p = new THREE.Vector3(), _q = new THREE.Vector3(), _n = new THREE.Vector3()

// The WebXR hand is a flat armature: every bone is a child of the armature, so a finger curl is not a
// parent rotation. It is the same hinge the runtime solver uses (Hands.tsx): an absolute rotation about
// the joint, written into each bone's local transform. Positive sign closes the fingers toward the palm.
const _HM = new THREE.Matrix4(), _HT = new THREE.Matrix4(), _HR = new THREE.Matrix4(), _HS = new THREE.Vector3()
function hinge(M, pivot, axis, ang) {
  _HT.makeTranslation(pivot.x, pivot.y, pivot.z)
  _HR.makeRotationAxis(axis, ang)
  M.multiply(_HT).multiply(_HR).multiply(_HM.makeTranslation(-pivot.x, -pivot.y, -pivot.z))
}
function setBoneX(bones, rest, name, M) {
  const r = rest[name], b = bones[name]
  _HM.compose(r.p, r.q, _HS.set(1, 1, 1)).premultiply(M).decompose(b.position, b.quaternion, _HS)
}
function curlAxis(rest, a, b, N) {
  return rest[b].p.clone().sub(rest[a].p).normalize().cross(N).normalize()
}
function applyPose(mesh, bones, rest, palm, forward, pose, sign) {
  resetBones(mesh, bones, rest)
  const rad = THREE.MathUtils.degToRad
  const P = n => rest[n].p
  const chain = (names, angles) => {
    const M = new THREE.Matrix4()
    const axes = names.slice(0, -1).map((n, i) => curlAxis(rest, n, names[i + 1], palm))
    names.forEach((n, i) => {
      if (i < angles.length && bones[n]) hinge(M, P(n), axes[i], angles[i] * sign)
      if (bones[n]) setBoneX(bones, rest, n, M)
    })
  }
  for (const f of FINGERS) chain([...CHAIN.map(j => `${f}-${j}`), `${f}-tip`], (pose[f] ?? pose.fingers).map(rad))
  const t = pose.thumb.map(rad)
  const names = ['thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip']
  const M = new THREE.Matrix4()
  hinge(M, P(names[0]), forward, -t[0] * sign)
  hinge(M, P(names[0]), palm, t[0] * 0.35 * sign)
  const axes = names.slice(0, -1).map((n, i) => curlAxis(rest, n, names[i + 1], palm))
  names.forEach((n, i) => {
    if (i < 3) hinge(M, P(n), axes[i], [t[1], t[2], t[3]][i] * sign)
    setBoneX(bones, rest, n, M)
  })
  commitBones(mesh)
}

// curl degrees: metacarpal, proximal, intermediate, distal. Thumb: oppose, meta curl, proximal, distal.
const POSE = {
  rest: { fingers: [0, 10, 8, 5], thumb: [18, 8, 10, 8] },
  grip: { fingers: [6, 58, 74, 50], thumb: [46, 18, 28, 22] },
  point: {
    fingers: [4, 68, 86, 58],
    'index-finger': [0, 8, 6, 4],
    thumb: [22, 10, 14, 10],
  },
  flat: { fingers: [0, 3, 2, 2], thumb: [8, 2, 4, 3] },
}

// --- ray AO ---------------------------------------------------------------
function buildAccel(pos, index) {
  const n = index.count / 3
  const A = new Float32Array(n * 9)
  const CELL = 0.018
  const grid = new Map()
  const add = (ix, iy, iz, ti) => {
    const key = (ix + 128) + (iy + 128) * 512 + (iz + 128) * 262144
    let list = grid.get(key)
    if (!list) grid.set(key, list = [])
    list.push(ti)
  }
  for (let t = 0; t < n; t++) {
    const i0 = index.getX(t * 3), i1 = index.getX(t * 3 + 1), i2 = index.getX(t * 3 + 2)
    const o = t * 9
    for (let k = 0; k < 3; k++) { const i = [i0, i1, i2][k]; A[o + k * 3] = pos[i * 3]; A[o + k * 3 + 1] = pos[i * 3 + 1]; A[o + k * 3 + 2] = pos[i * 3 + 2] }
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity
    for (let k = 0; k < 9; k += 3) { x0 = Math.min(x0, A[o + k]); y0 = Math.min(y0, A[o + k + 1]); z0 = Math.min(z0, A[o + k + 2]); x1 = Math.max(x1, A[o + k]); y1 = Math.max(y1, A[o + k + 1]); z1 = Math.max(z1, A[o + k + 2]) }
    for (let ix = Math.floor(x0 / CELL); ix <= Math.floor(x1 / CELL); ix++)
      for (let iy = Math.floor(y0 / CELL); iy <= Math.floor(y1 / CELL); iy++)
        for (let iz = Math.floor(z0 / CELL); iz <= Math.floor(z1 / CELL); iz++) add(ix, iy, iz, t)
  }
  return { A, grid, CELL }
}
function triHit(A, ti, ox, oy, oz, dx, dy, dz) {
  const o = ti * 9
  const ax = A[o], ay = A[o + 1], az = A[o + 2]
  const e1x = A[o + 3] - ax, e1y = A[o + 4] - ay, e1z = A[o + 5] - az
  const e2x = A[o + 6] - ax, e2y = A[o + 7] - ay, e2z = A[o + 8] - az
  const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x
  const det = e1x * px + e1y * py + e1z * pz
  if (det > -1e-9 && det < 1e-9) return 0
  const inv = 1 / det
  const tx = ox - ax, ty = oy - ay, tz = oz - az
  const u = (tx * px + ty * py + tz * pz) * inv
  if (u < 0 || u > 1) return 0
  const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x
  const v = (dx * qx + dy * qy + dz * qz) * inv
  if (v < 0 || u + v > 1) return 0
  return (e2x * qx + e2y * qy + e2z * qz) * inv
}
function raycast(ox, oy, oz, dx, dy, dz, maxD, acc) {
  const { A, grid, CELL } = acc
  const invx = 1 / (Math.abs(dx) < 1e-12 ? 1e-12 : dx)
  const invy = 1 / (Math.abs(dy) < 1e-12 ? 1e-12 : dy)
  const invz = 1 / (Math.abs(dz) < 1e-12 ? 1e-12 : dz)
  let ix = Math.floor(ox / CELL), iy = Math.floor(oy / CELL), iz = Math.floor(oz / CELL)
  const sx = dx < 0 ? -1 : 1, sy = dy < 0 ? -1 : 1, sz = dz < 0 ? -1 : 1
  const tMax = (i, o, inv, s) => ((i + (s > 0 ? 1 : 0)) * CELL - o) * inv
  let tmaxX = tMax(ix, ox, invx, sx), tmaxY = tMax(iy, oy, invy, sy), tmaxZ = tMax(iz, oz, invz, sz)
  const tdx = Math.abs(CELL * invx), tdy = Math.abs(CELL * invy), tdz = Math.abs(CELL * invz)
  let best = 0
  for (let step = 0; step < 18; step++) {
    const list = grid.get((ix + 128) + (iy + 128) * 512 + (iz + 128) * 262144)
    if (list) for (let k = 0; k < list.length; k++) {
      const d = triHit(A, list[k], ox, oy, oz, dx, dy, dz)
      if (d > 0.0008 && (best === 0 || d < best)) best = d
    }
    if (Math.min(tmaxX, tmaxY, tmaxZ) > maxD) break
    if (tmaxX <= tmaxY && tmaxX <= tmaxZ) { ix += sx; tmaxX += tdx }
    else if (tmaxY <= tmaxZ) { iy += sy; tmaxY += tdy }
    else { iz += sz; tmaxZ += tdz }
  }
  return best > 0 && best < maxD ? best : 0
}
function hemiDir(i, n, nx, ny, nz) {
  const golden = Math.PI * (3 - Math.sqrt(5))
  const zz = (i + 0.5) / n
  const r = Math.sqrt(Math.max(0, 1 - zz * zz))
  const t = golden * i
  const x = Math.cos(t) * r, y = Math.sin(t) * r
  const ax = Math.abs(nx) < 0.9 ? 1 : 0, ay = Math.abs(nx) < 0.9 ? 0 : 1
  let tx = ay * nz, ty = -ax * nz, tz = ax * ny - ay * nx
  const tl = Math.hypot(tx, ty, tz) || 1
  tx /= tl; ty /= tl; tz /= tl
  const bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx
  const dx = tx * x + bx * y + nx * zz, dy = ty * x + by * y + ny * zz, dz = tz * x + bz * y + nz * zz
  const dl = Math.hypot(dx, dy, dz) || 1
  return [dx / dl, dy / dl, dz / dl]
}
function vertexAO(pos, nrm, index) {
  const n = pos.length / 3
  const acc = buildAccel(pos, index)
  const ao = new Float32Array(n)
  const nbr = Array.from({ length: n }, () => [])
  for (let t = 0; t < index.count; t += 3) {
    const a = index.getX(t), b = index.getX(t + 1), c = index.getX(t + 2)
    nbr[a].push(b, c); nbr[b].push(a, c); nbr[c].push(a, b)
  }
  for (let i = 0; i < n; i++) {
    const ox = pos[i * 3], oy = pos[i * 3 + 1], oz = pos[i * 3 + 2]
    const nx = nrm[i * 3], ny = nrm[i * 3 + 1], nz = nrm[i * 3 + 2]
    let occ = 0
    for (let s = 0; s < RAYS; s++) {
      const [dx, dy, dz] = hemiDir(s, RAYS, nx, ny, nz)
      const d = raycast(ox + nx * 0.0025, oy + ny * 0.0025, oz + nz * 0.0025, dx, dy, dz, AO_DIST, acc)
      if (d > 0) { const w = 1 - d / AO_DIST; occ += w * w }
    }
    let ray = 1 - Math.min(0.72, occ / RAYS * 1.35)
    let c = 0, cnt = 0
    for (const j of nbr[i]) {
      const dx = pos[j * 3] - ox, dy = pos[j * 3 + 1] - oy, dz = pos[j * 3 + 2] - oz
      const l = Math.hypot(dx, dy, dz)
      if (l < 1e-6) continue
      c += Math.max(0, (dx * nx + dy * ny + dz * nz) / l); cnt++
    }
    const curv = cnt ? c / cnt : 0
    const curvAO = 1 - Math.min(0.45, Math.max(0, curv) * 2.2)
    ao[i] = clamp(ray * lerp(1, curvAO, 0.85), 0.28, 1)
  }
  return ao
}

function klassOf(name) {
  if (!name || name === 'wrist') return 'wrist'
  if (name.startsWith('thumb')) return name.includes('distal') || name.includes('tip') ? 'tdistal' : 'thumb'
  if (name.includes('metacarpal')) return 'palm'
  if (name.includes('distal') || name.includes('tip')) return 'distal'
  if (name.includes('intermediate')) return 'mid'
  return 'prox'
}

// --- raster ---------------------------------------------------------------
function dilate(img, mask, w, h, passes) {
  const nbr = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]
  let m = mask
  for (let p = 0; p < passes; p++) {
    const next = m.slice()
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (m[i]) continue
      for (const [dx, dy] of nbr) {
        const nx = x + dx, ny = y + dy
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
        const j = ny * w + nx
        if (!m[j]) continue
        next[i] = 1
        img[i * 4] = img[j * 4]; img[i * 4 + 1] = img[j * 4 + 1]; img[i * 4 + 2] = img[j * 4 + 2]; img[i * 4 + 3] = img[j * 4 + 3]
        break
      }
    }
    m = next
  }
  return m
}

function shadeTexel(P, N, T, tw, palm, along, bone, u, vAlong) {
  const back = palm < 0 ? -palm : 0
  const front = palm > 0 ? palm : 0
  let r = 1, g = 0.985, b = 0.97
  // back of the hand: a little pinker and deeper. Palm: lighter, slightly yellow.
  if (back > 0) { const k = smooth(back, 0.02, 0.55); r = lerp(r, 0.98, k * 0.35); g = lerp(g, 0.80, k * 0.55); b = lerp(b, 0.76, k * 0.5) }
  if (front > 0) { const k = smooth(front, 0.05, 0.6); r = lerp(r, 1, k * 0.45); g = lerp(g, 0.90, k * 0.35); b = lerp(b, 0.80, k * 0.28) }
  const finger = bone === 'prox' || bone === 'mid' || bone === 'distal' || bone === 'thumb' || bone === 'tdistal'
  // knuckle blush on the back, just past each joint
  let knuckle = 0
  if (finger && bone !== 'thumb') {
    const band = Math.exp(-((along - 0.12) ** 2) / 0.0045) + 0.55 * Math.exp(-((along - 0.0) ** 2) / 0.003)
    knuckle = band * smooth(back, 0.05, 0.7)
    r = lerp(r, 0.99, knuckle * 0.28); g = lerp(g, 0.74, knuckle * 0.34); b = lerp(b, 0.68, knuckle * 0.3)
  }
  // fingertips flush
  if (bone === 'distal' || bone === 'tdistal') {
    const tip = smooth(along, 0.45, 0.95)
    r = lerp(r, 0.99, tip * 0.22); g = lerp(g, 0.72, tip * 0.28); b = lerp(b, 0.66, tip * 0.24)
  }
  if (bone === 'wrist') { r *= 0.93; g *= 0.94; b *= 0.97 }
  // mottling and faint freckles, stable in bind space so they don't swim
  const n1 = fbm(P.x * 42, P.y * 42, P.z * 42, 4)
  const n2 = fbm(P.x * 160, P.y * 160, P.z * 160, 3)
  r += n1 * 0.022 + n2 * 0.008; g += n1 * 0.016 + n2 * 0.006; b += n1 * 0.012
  const fr = fbm(P.x * 110 + 4, P.y * 110, P.z * 110, 4)
  if (fr > 0.55 && back > 0.2) { const k = smooth(fr, 0.55, 0.85) * 0.07; r -= k * 0.6; g -= k; b -= k * 0.85 }
  // veins on the back of the palm and wrist, very faint
  if ((bone === 'palm' || bone === 'wrist') && back > 0.15) {
    const vn = Math.sin(fbm(P.x * 28, P.y * 28, P.z * 28, 3) * 9)
    const vein = smooth(vn, 0.55, 0.9) * 0.10 * smooth(back, 0.15, 0.5)
    r -= vein * 0.55; g -= vein * 0.2; b += vein * 0.08
  }
  // palm creases painted in the palm plane (u across, v toward the fingers)
  let crease = 0
  if (front > 0.15 && (bone === 'palm' || bone === 'prox' || bone === 'thumb')) {
    const d1 = Math.abs(vAlong - (0.055 + 0.012 * Math.sin(u * 40)))
    const d2 = Math.abs(vAlong - (0.078 + 0.25 * u))
    const d3 = Math.abs(vAlong - (0.038 - 0.18 * u))
    crease = Math.min(1, Math.exp(-(d1 * d1) / 0.000012) + 0.8 * Math.exp(-(d2 * d2) / 0.00001) + 0.7 * Math.exp(-(d3 * d3) / 0.00001))
    crease *= smooth(front, 0.15, 0.55)
    r -= crease * 0.08; g -= crease * 0.09; b -= crease * 0.07
  }
  // flexor crease colour on the palm side of each joint
  let flex = 0
  if (finger && front > 0.05) {
    flex = Math.exp(-((along - 0.08) ** 2) / 0.003) * smooth(front, 0.05, 0.5)
    r -= flex * 0.07; g -= flex * 0.08; b -= flex * 0.06
  }
  // pores in the albedo, just a luminance tickle
  const pore = fbm(P.x * 900, P.y * 900, P.z * 900, 2)
  const lum = pore * 0.018
  r += lum; g += lum; b += lum

  // thickness: palm and wrist thick, fingertips and creases thin (they scatter more)
  let thick = 0.62
  if (bone === 'palm' || bone === 'wrist') thick = 0.88
  if (bone === 'prox') thick = 0.5
  if (bone === 'mid') thick = 0.4
  if (bone === 'distal' || bone === 'tdistal') thick = lerp(0.42, 0.2, smooth(along, 0.2, 0.95))
  if (bone === 'thumb') thick = 0.5
  thick = clamp(thick - crease * 0.15 - flex * 0.12, 0.12, 1)

  // roughness: oily pads, drier knuckles
  let rough = 0.58 + pore * 0.05
  if (front > 0.3 && (bone === 'distal' || bone === 'tdistal' || bone === 'palm')) rough = lerp(rough, 0.40, front)
  if (knuckle > 0.2) rough = lerp(rough, 0.84, knuckle)
  rough = clamp(rough, 0.32, 0.92)

  // wrist mask: 1 on the hand, falling off over the open rim past the wrist joint
  const behind = -vAlong
  const mask = bone === 'wrist' ? 1 - smooth(behind, 0.004, 0.02) : 1

  // tangent-space normal: pores + knuckle wrinkles + crease grooves
  const B = new THREE.Vector3().crossVectors(N, T).multiplyScalar(tw || 1)
  if (B.lengthSq() < 1e-8) B.set(0, 1, 0)
  B.normalize()
  const eps = 0.00035
  const h = (x, y, z) => fbm(x * 1400, y * 1400, z * 1400, 3) * 0.55 + fbm(x * 420, y * 420, z * 420, 2) * 0.45
  const h0 = h(P.x, P.y, P.z)
  const hx = h(P.x + T.x * eps, P.y + T.y * eps, P.z + T.z * eps)
  const hy = h(P.x + B.x * eps, P.y + B.y * eps, P.z + B.z * eps)
  let nx = (hx - h0) * 1.15
  let ny = (hy - h0) * 1.15
  // wrinkles run across the finger, so their slope follows the bone axis
  if (crease > 0.1 || flex > 0.1) {
    const g = (crease + flex) * 0.85
    nx += g * 0.35
    ny += g * 0.15
  }
  const nl = Math.hypot(nx, ny, 1)
  return {
    r: clamp(r, 0, 1), g: clamp(g, 0, 1), b: clamp(b, 0, 1),
    nx: nx / nl, ny: ny / nl, nz: 1 / nl,
    thick, rough, mask, crease: clamp(crease + flex * 0.8, 0, 1),
  }
}

function flattenBorder(normal, mask, W, H, radius) {
  const edge = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x
    if (!mask[i]) continue
    let border = false
    for (let dy = -radius; dy <= radius && !border; dy++) for (let dx = -radius; dx <= radius; dx++) {
      const xx = x + dx, yy = y + dy
      if (xx < 0 || yy < 0 || xx >= W || yy >= H || !mask[yy * W + xx]) border = true
    }
    if (border) edge[i] = 1
  }
  for (let i = 0; i < W * H; i++) if (edge[i]) {
    const o = i * 4
    normal[o] = 128; normal[o + 1] = 128; normal[o + 2] = 255
  }
}

function raster(mesh, fields) {
  const geo = mesh.geometry
  const uv = geo.getAttribute('uv')
  const index = geo.getIndex()
  const W = SIZE, H = SIZE
  const albedo = new Uint8ClampedArray(W * H * 4)
  const normal = new Uint8ClampedArray(W * H * 4)
  const surface = new Uint8ClampedArray(W * H * 4)
  const ao = new Uint8ClampedArray(W * H * 4)
  const mask = new Uint8Array(W * H)
  const pos = fields.pos, nrm = fields.nrm, tan = fields.tan, palm = fields.palm, along = fields.along
  const across = fields.across, bone = fields.bone, aoV = fields.ao
  const boneDir = fields.boneDir
  const P = new THREE.Vector3(), N = new THREE.Vector3(), T = new THREE.Vector3(), BD = new THREE.Vector3()
  let covered = 0
  for (let t = 0; t < index.count; t += 3) {
    const id = [index.getX(t), index.getX(t + 1), index.getX(t + 2)]
    const sx = id.map(i => uv.getX(i) * (W - 1))
    const sy = id.map(i => (1 - uv.getY(i)) * (H - 1))
    const area = (sx[1] - sx[0]) * (sy[2] - sy[0]) - (sx[2] - sx[0]) * (sy[1] - sy[0])
    if (Math.abs(area) < 0.01) continue
    const minx = clamp(Math.floor(Math.min(...sx)), 0, W - 1), maxx = clamp(Math.ceil(Math.max(...sx)), 0, W - 1)
    const miny = clamp(Math.floor(Math.min(...sy)), 0, H - 1), maxy = clamp(Math.ceil(Math.max(...sy)), 0, H - 1)
    for (let y = miny; y <= maxy; y++) for (let x = minx; x <= maxx; x++) {
      const px = x + 0.5, py = y + 0.5
      const w0 = ((sx[1] - px) * (sy[2] - py) - (sx[2] - px) * (sy[1] - py)) / area
      const w1 = ((sx[2] - px) * (sy[0] - py) - (sx[0] - px) * (sy[2] - py)) / area
      const w2 = 1 - w0 - w1
      if (w0 < -0.002 || w1 < -0.002 || w2 < -0.002) continue
      const w = [w0, w1, w2]
      const at = (arr, stride, c) => w[0] * arr[id[0] * stride + c] + w[1] * arr[id[1] * stride + c] + w[2] * arr[id[2] * stride + c]
      P.set(at(pos, 3, 0), at(pos, 3, 1), at(pos, 3, 2))
      N.set(at(nrm, 3, 0), at(nrm, 3, 1), at(nrm, 3, 2)).normalize()
      T.set(at(tan, 4, 0), at(tan, 4, 1), at(tan, 4, 2))
      const tw = at(tan, 4, 3) >= 0 ? 1 : -1
      if (T.lengthSq() > 1e-8) T.normalize(); else T.set(1, 0, 0)
      const pm = at(palm, 1, 0)
      const al = at(along, 1, 0)
      const ac = at(across, 1, 0)
      const dom = w0 >= w1 && w0 >= w2 ? 0 : w1 >= w2 ? 1 : 2
      const boneK = bone[id[dom]]
      BD.set(at(boneDir, 3, 0), at(boneDir, 3, 1), at(boneDir, 3, 2))
      const s = shadeTexel(P, N, T, tw, pm, al, boneK, ac, al)
      // wrinkle slope along the bone, in tangent space, now that we know the bone direction
      if (BD.lengthSq() > 1e-6) {
        BD.normalize()
        const B = new THREE.Vector3().crossVectors(N, T).multiplyScalar(tw)
        const bdT = BD.dot(T), bdB = BD.dot(B)
        const knuckle = Math.exp(-((al - 0.12) ** 2) / 0.0045) * (pm < 0 ? smooth(-pm, 0, 0.45) : 0)
        const dh = Math.cos((al - 0.12) * 48) * knuckle * 0.32
        s.nx += -dh * bdT
        s.ny += -dh * bdB
        const nl = Math.hypot(s.nx, s.ny, s.nz)
        s.nx /= nl; s.ny /= nl; s.nz /= nl
      }
      const i = (y * W + x) * 4
      const b8 = v => Math.max(0, Math.min(255, Math.round(v * 255)))
      albedo[i] = b8(s.r); albedo[i + 1] = b8(s.g); albedo[i + 2] = b8(s.b); albedo[i + 3] = 255
      normal[i] = b8(s.nx * 0.5 + 0.5); normal[i + 1] = b8(s.ny * 0.5 + 0.5); normal[i + 2] = b8(s.nz * 0.5 + 0.5); normal[i + 3] = 255
      surface[i] = b8(s.thick); surface[i + 1] = b8(s.rough); surface[i + 2] = b8(s.mask); surface[i + 3] = 255
      for (let k = 0; k < 4; k++) {
        const a = clamp(at(aoV[k], 1, 0) * (1 - s.crease * 0.28), 0.2, 1)
        ao[i + k] = b8(a)
      }
      if (!mask[y * W + x]) { mask[y * W + x] = 1; covered++ }
    }
  }
  // Island edges have unstable derivatives; a flat border dilates outward instead of a rainbow fringe.
  flattenBorder(normal, mask, W, H, 2)
  dilate(albedo, mask.slice(), W, H, 8)
  dilate(normal, mask.slice(), W, H, 8)
  dilate(surface, mask.slice(), W, H, 8)
  dilate(ao, mask.slice(), W, H, 8)
  console.log(`raster covered ${covered} px (${(covered / (W * H) * 100).toFixed(1)}%)`)
  return { albedo, normal, surface, ao, W, H }
}

function poreTile() {
  const n = PORE, img = new Uint8ClampedArray(n * n * 4)
  const h = (x, y) => {
    const fx = Math.cos(x * Math.PI * 2), fy = Math.sin(x * Math.PI * 2)
    const gx = Math.cos(y * Math.PI * 2), gy = Math.sin(y * Math.PI * 2)
    return noise3(fx * 3.2, fy * 3.2, gx * 3.2) * 0.65 + noise3(gy * 7, fx * 7, fy * 7) * 0.35
  }
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const u = x / n, v = y / n
    const e = 1 / n
    const h0 = h(u, v), hx = h(u + e, v), hy = h(u, v + e)
    let nx = (hx - h0) * n * 0.55, ny = (hy - h0) * n * 0.55
    const nl = Math.hypot(nx, ny, 1)
    const i = (y * n + x) * 4
    img[i] = (nx / nl * 0.5 + 0.5) * 255
    img[i + 1] = (ny / nl * 0.5 + 0.5) * 255
    img[i + 2] = (1 / nl * 0.5 + 0.5) * 255
    img[i + 3] = 255
  }
  return img
}

async function writeWebp(file, data, w, h, lossless) {
  const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength)
  const img = sharp(buf, { raw: { width: w, height: h, channels: 4 } })
  if (lossless) await img.webp({ lossless: true, effort: 6 }).toFile(file)
  else await img.webp({ quality: 90, alphaQuality: 100, effort: 5 }).toFile(file)
  const kb = (fs.statSync(file).size / 1024).toFixed(0)
  console.log(`${path.basename(file)} ${kb} KB`)
}

// software preview so the bake can be judged without the app
function renderPreview(mesh, images, fields, poseIndex, name, eye, target, up) {
  const W = 900, H = 700
  const color = new Float32Array(W * H * 3)
  const zb = new Float32Array(W * H).fill(1e9)
  const { albedo, normal, ao } = images
  const geo = mesh.geometry, index = geo.getIndex(), uv = geo.getAttribute('uv')
  const pos = fields.posed[poseIndex], nrm = fields.posedN[poseIndex]
  const fwd = target.clone().sub(eye).normalize()
  const right = new THREE.Vector3().crossVectors(fwd, up).normalize()
  const camUp = new THREE.Vector3().crossVectors(right, fwd).normalize()
  const focal = (H * 0.5) / Math.tan(THREE.MathUtils.degToRad(16))
  const tone = [0.875, 0.663, 0.541] // fair skin #dfa98a
  const L = new THREE.Vector3(-0.35, 0.75, 0.45).normalize()
  const sample = (img, u, v) => {
    const x = clamp(u, 0, 1) * (SIZE - 1), y = (1 - clamp(v, 0, 1)) * (SIZE - 1)
    const x0 = Math.floor(x), y0 = Math.floor(y)
    const i = (y0 * SIZE + x0) * 4
    return [img[i] / 255, img[i + 1] / 255, img[i + 2] / 255, img[i + 3] / 255]
  }
  const proj = p => {
    const rx = (p[0] - eye.x) * right.x + (p[1] - eye.y) * right.y + (p[2] - eye.z) * right.z
    const ry = (p[0] - eye.x) * camUp.x + (p[1] - eye.y) * camUp.y + (p[2] - eye.z) * camUp.z
    const rz = (p[0] - eye.x) * fwd.x + (p[1] - eye.y) * fwd.y + (p[2] - eye.z) * fwd.z
    return [W / 2 + rx / rz * focal, H / 2 - ry / rz * focal, rz]
  }
  for (let t = 0; t < index.count; t += 3) {
    const id = [index.getX(t), index.getX(t + 1), index.getX(t + 2)]
    const P = id.map(i => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]])
    const S = P.map(proj)
    if (S.some(s => s[2] < 0.02)) continue
    const area = (S[1][0] - S[0][0]) * (S[2][1] - S[0][1]) - (S[2][0] - S[0][0]) * (S[1][1] - S[0][1])
    if (Math.abs(area) < 0.2) continue
    const minx = clamp(Math.floor(Math.min(S[0][0], S[1][0], S[2][0])), 0, W - 1)
    const maxx = clamp(Math.ceil(Math.max(S[0][0], S[1][0], S[2][0])), 0, W - 1)
    const miny = clamp(Math.floor(Math.min(S[0][1], S[1][1], S[2][1])), 0, H - 1)
    const maxy = clamp(Math.ceil(Math.max(S[0][1], S[1][1], S[2][1])), 0, H - 1)
    for (let y = miny; y <= maxy; y++) for (let x = minx; x <= maxx; x++) {
      const px = x + 0.5, py = y + 0.5
      const w0 = ((S[1][0] - px) * (S[2][1] - py) - (S[2][0] - px) * (S[1][1] - py)) / area
      const w1 = ((S[2][0] - px) * (S[0][1] - py) - (S[0][0] - px) * (S[2][1] - py)) / area
      const w2 = 1 - w0 - w1
      if (w0 < 0 || w1 < 0 || w2 < 0) continue
      const z = w0 * S[0][2] + w1 * S[1][2] + w2 * S[2][2]
      const pi = y * W + x
      if (z >= zb[pi]) continue
      zb[pi] = z
      const u = w0 * uv.getX(id[0]) + w1 * uv.getX(id[1]) + w2 * uv.getX(id[2])
      const v = w0 * uv.getY(id[0]) + w1 * uv.getY(id[1]) + w2 * uv.getY(id[2])
      const alb = sample(albedo, u, v)
      const nr = sample(normal, u, v)
      const a = sample(ao, u, v)[poseIndex]
      let nx = w0 * nrm[id[0] * 3] + w1 * nrm[id[1] * 3] + w2 * nrm[id[2] * 3]
      let ny = w0 * nrm[id[0] * 3 + 1] + w1 * nrm[id[1] * 3 + 1] + w2 * nrm[id[2] * 3 + 1]
      let nz = w0 * nrm[id[0] * 3 + 2] + w1 * nrm[id[1] * 3 + 2] + w2 * nrm[id[2] * 3 + 2]
      const nl = Math.hypot(nx, ny, nz) || 1
      nx /= nl; ny /= nl; nz /= nl
      // bend the geometric normal a little toward the map so pores read in the preview
      const ndl = (nx * L.x + ny * L.y + nz * L.z)
      const diff = clamp((ndl + 0.32) / 1.32, 0, 1)
      const back = clamp(-ndl, 0, 1)
      const cav = 0.22 + 0.78 * a
      const poreShade = (nr[2] - 0.5) * 0.35 + (nr[0] - 0.5) * 0.15
      const c = [0, 1, 2].map(k => alb[k] * tone[k] * (0.34 + 0.85 * diff) * cav * (1 + poreShade) + back * back * 0.22 * [1, 0.4, 0.28][k])
      color[pi * 3] = c[0]; color[pi * 3 + 1] = c[1]; color[pi * 3 + 2] = c[2]
    }
  }
  const rgba = new Uint8ClampedArray(W * H * 4)
  for (let i = 0; i < W * H; i++) {
    const bg = zb[i] > 1e8
    rgba[i * 4] = bg ? 214 : clamp(Math.pow(color[i * 3], 1 / 2.2) * 255, 0, 255)
    rgba[i * 4 + 1] = bg ? 224 : clamp(Math.pow(color[i * 3 + 1], 1 / 2.2) * 255, 0, 255)
    rgba[i * 4 + 2] = bg ? 232 : clamp(Math.pow(color[i * 3 + 2], 1 / 2.2) * 255, 0, 255)
    rgba[i * 4 + 3] = 255
  }
  return sharp(Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength), { raw: { width: W, height: H, channels: 4 } }).png().toFile(path.join(previewDir, name))
}

async function main() {
  const gltf = await loadGltf(path.join(root, 'public/hands/right.glb'))
  const mesh = findMesh(gltf.scene)
  mesh.geometry.computeTangents()
  const { bones, rest } = restOf(mesh)
  resetBones(mesh, bones, rest)
  const wrist = bones.wrist.getWorldPosition(new THREE.Vector3())
  const mid = bones['middle-finger-phalanx-proximal'].getWorldPosition(new THREE.Vector3())
  const index = bones['index-finger-phalanx-proximal'].getWorldPosition(new THREE.Vector3())
  const pinky = bones['pinky-finger-phalanx-proximal'].getWorldPosition(new THREE.Vector3())
  const F = mid.clone().sub(wrist).normalize()
  const across = index.clone().sub(pinky).normalize()
  const palm = new THREE.Vector3().crossVectors(F, across).normalize()
  // flip so the thumb tip sits on the positive palm side (same test as Hands.tsx)
  const thumb = bones['thumb-tip'].getWorldPosition(new THREE.Vector3())
  if (thumb.clone().sub(wrist).dot(palm) < 0) palm.negate()
  console.log('palm', palm.toArray().map(n => +n.toFixed(3)), 'fwd', F.toArray().map(n => +n.toFixed(3)))

  const geo = mesh.geometry
  const n = geo.getAttribute('position').count
  const bindPos = new Float32Array(n * 3)
  const bindNrm = new Float32Array(n * 3)
  const tanA = geo.getAttribute('tangent')
  const tan = new Float32Array(n * 4)
  const palmA = new Float32Array(n), alongA = new Float32Array(n), acrossA = new Float32Array(n)
  const bone = new Array(n), boneDir = new Float32Array(n * 3)
  const si = geo.getAttribute('skinIndex'), sw = geo.getAttribute('skinWeight')
  let tipIndex = 0, tipBest = -Infinity
  resetBones(mesh, bones, rest)
  const bonePos = {}
  for (const name in bones) bonePos[name] = bones[name].getWorldPosition(new THREE.Vector3())
  const next = {}
  for (const f of [...FINGERS, 'thumb']) for (let i = 0; i < CHAIN.length; i++) {
    const a = `${f}-${CHAIN[i]}`
    const b = i + 1 < CHAIN.length ? `${f}-${CHAIN[i + 1]}` : `${f}-tip`
    if (bonePos[a] && bonePos[b]) next[a] = bonePos[b].clone().sub(bonePos[a])
  }
  next.wrist = F.clone()
  for (let i = 0; i < n; i++) {
    const p = skinPos(mesh, i, new THREE.Vector3())
    const nr = skinNrm(mesh, i, geo.getAttribute('position'), geo.getAttribute('normal'), new THREE.Vector3())
    bindPos[i * 3] = p.x; bindPos[i * 3 + 1] = p.y; bindPos[i * 3 + 2] = p.z
    bindNrm[i * 3] = nr.x; bindNrm[i * 3 + 1] = nr.y; bindNrm[i * 3 + 2] = nr.z
    tan[i * 4] = tanA.getX(i); tan[i * 4 + 1] = tanA.getY(i); tan[i * 4 + 2] = tanA.getZ(i); tan[i * 4 + 3] = tanA.getW(i)
    palmA[i] = nr.dot(palm)
    let bi = 0, bw = -1
    for (let k = 0; k < 4; k++) if (sw.getComponent(i, k) > bw) { bw = sw.getComponent(i, k); bi = si.getComponent(i, k) }
    const bn = mesh.skeleton.bones[bi].name
    bone[i] = klassOf(bn)
    const seg = next[bn] ?? F
    const dir = seg.clone().normalize()
    const origin = bonePos[bn] ?? wrist
    const len = Math.max(0.01, seg.length())
    alongA[i] = p.clone().sub(origin).dot(dir) / len
    acrossA[i] = p.clone().sub(wrist).dot(across)
    // vAlong for the wrist mask is the finger-direction coordinate (negative past the wrist)
    if (bone[i] === 'wrist') alongA[i] = p.clone().sub(wrist).dot(F)
    boneDir[i * 3] = dir.x; boneDir[i * 3 + 1] = dir.y; boneDir[i * 3 + 2] = dir.z
    if ((bn === 'middle-finger-phalanx-distal' || bn === 'middle-finger-tip') && p.dot(F) > tipBest) { tipBest = p.dot(F); tipIndex = i }
  }
  resetBones(mesh, bones, rest)
  const openTip = skinPos(mesh, tipIndex, new THREE.Vector3())
  applyPose(mesh, bones, rest, palm, F, POSE.grip, 1)
  const moved = skinPos(mesh, tipIndex, new THREE.Vector3()).sub(openTip).dot(palm)
  const sign = moved >= 0 ? 1 : -1
  console.log('grip curl toward palm (m):', moved.toFixed(4), 'sign', sign)
  resetBones(mesh, bones, rest)

  const posed = [], posedN = [], aoV = []
  const names = ['rest', 'grip', 'point', 'flat']
  for (const name of names) {
    applyPose(mesh, bones, rest, palm, F, POSE[name], sign)
    const ps = new Float32Array(n * 3), ns = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      const p = skinPos(mesh, i, new THREE.Vector3())
      const nr = skinNrm(mesh, i, geo.getAttribute('position'), geo.getAttribute('normal'), new THREE.Vector3())
      ps[i * 3] = p.x; ps[i * 3 + 1] = p.y; ps[i * 3 + 2] = p.z
      ns[i * 3] = nr.x; ns[i * 3 + 1] = nr.y; ns[i * 3 + 2] = nr.z
    }
    console.log('AO', name)
    const ao = vertexAO(ps, ns, geo.getIndex())
    let avg = 0; for (let i = 0; i < n; i++) avg += ao[i]; console.log('  mean', (avg / n).toFixed(3))
    posed.push(ps); posedN.push(ns); aoV.push(ao)
  }

  console.log('raster', SIZE)
  const images = raster(mesh, {
    pos: bindPos, nrm: bindNrm, tan, palm: palmA, along: alongA, across: acrossA, bone, boneDir, ao: aoV,
  })
  await writeWebp(path.join(outDir, 'albedo.webp'), images.albedo, SIZE, SIZE, false)
  await writeWebp(path.join(outDir, 'normal.webp'), images.normal, SIZE, SIZE, true)
  await writeWebp(path.join(outDir, 'surface.webp'), images.surface, SIZE, SIZE, true)
  await writeWebp(path.join(outDir, 'ao.webp'), images.ao, SIZE, SIZE, true)
  const pores = poreTile()
  await writeWebp(path.join(outDir, 'pores.webp'), pores, PORE, PORE, true)

  // left hand: same unwrap? compare a thumb-tip UV with the right
  const left = findMesh((await loadGltf(path.join(root, 'public/hands/left.glb'))).scene)
  const rUV = geo.getAttribute('uv'), lUV = left.geometry.getAttribute('uv')
  let uvDelta = 0, cnt = 0
  const step = Math.max(1, Math.floor(rUV.count / 200))
  for (let i = 0; i < Math.min(rUV.count, lUV.count); i += step) {
    uvDelta += Math.abs(rUV.getX(i) - lUV.getX(i)) + Math.abs(rUV.getY(i) - lUV.getY(i)); cnt++
  }
  console.log('left/right UV mean abs delta', (uvDelta / cnt).toFixed(4), '(0 = identical unwrap, textures are shared)')

  const center = new THREE.Vector3()
  for (let i = 0; i < n; i++) center.add(new THREE.Vector3(bindPos[i * 3], bindPos[i * 3 + 1], bindPos[i * 3 + 2]))
  center.multiplyScalar(1 / n)
  const dist = 0.34
  await renderPreview(mesh, images, { posed, posedN }, 1, 'shade-grip-back.png', center.clone().addScaledVector(palm, -dist), center, F)
  await renderPreview(mesh, images, { posed, posedN }, 1, 'shade-grip-palm.png', center.clone().addScaledVector(palm, dist), center, F)
  const side = new THREE.Vector3().crossVectors(F, palm).normalize()
  await renderPreview(mesh, images, { posed, posedN }, 2, 'shade-point-side.png', center.clone().addScaledVector(side, dist), center, F)
  await renderPreview(mesh, images, { posed, posedN }, 0, 'shade-rest-back.png', center.clone().addScaledVector(palm, -dist * 0.85), center, F)
  await sharp(Buffer.from(images.albedo.buffer, images.albedo.byteOffset, images.albedo.byteLength), { raw: { width: SIZE, height: SIZE, channels: 4 } }).resize(512).png().toFile(path.join(previewDir, 'albedo.png'))
  await sharp(Buffer.from(images.normal.buffer, images.normal.byteOffset, images.normal.byteLength), { raw: { width: SIZE, height: SIZE, channels: 4 } }).resize(512).png().toFile(path.join(previewDir, 'normal.png'))
  console.log('preview', previewDir)
}

main().catch(e => { console.error(e); process.exit(1) })
