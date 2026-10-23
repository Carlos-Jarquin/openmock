// CPU skinning for the grip solver and the Spectral line pass. Three's applyBoneTransform rebuilds a
// bone matrix for every influence of every vertex. These helpers bake one matrix per bone after the
// skeleton moves, and keep the bind-pose positions and weights in flat arrays so a scan does not walk
// buffer attributes.
import * as THREE from 'three'

const _m = new THREE.Matrix4()

export interface SkinCache {
  count: number
  pos: Float32Array
  idx: Uint16Array
  w: Float32Array
  /** mesh-local skin matrix per bone, column-major, refreshed by bakeSkin */
  bone: Float32Array
  bones: number
}

export function skinCache(mesh: THREE.SkinnedMesh): SkinCache {
  const geo = mesh.geometry
  const pa = geo.getAttribute('position'), si = geo.getAttribute('skinIndex'), sw = geo.getAttribute('skinWeight')
  const n = pa.count, pos = new Float32Array(n * 3), idx = new Uint16Array(n * 4), w = new Float32Array(n * 4)
  for (let i = 0; i < n; i++) {
    pos[i * 3] = pa.getX(i); pos[i * 3 + 1] = pa.getY(i); pos[i * 3 + 2] = pa.getZ(i)
    const o = i * 4
    for (let k = 0; k < 4; k++) { idx[o + k] = si.getComponent(i, k); w[o + k] = sw.getComponent(i, k) }
  }
  return { count: n, pos, idx, w, bone: new Float32Array(mesh.skeleton.bones.length * 16), bones: mesh.skeleton.bones.length }
}

/** Mesh-local skin matrices. Call after the skeleton's world matrices are current. Matches applyBoneTransform. */
export function bakeSkin(mesh: THREE.SkinnedMesh, cache: SkinCache) {
  const bones = mesh.skeleton.bones, inv = mesh.skeleton.boneInverses, bind = mesh.bindMatrix, bindI = mesh.bindMatrixInverse
  const out = cache.bone
  for (let i = 0; i < bones.length; i++) {
    _m.multiplyMatrices(bones[i].matrixWorld, inv[i]).premultiply(bindI).multiply(bind)
    out.set(_m.elements, i * 16)
  }
}

/** Skinned position in the mesh's local frame, written to out. */
export function skinAt(cache: SkinCache, index: number, out: THREE.Vector3) {
  const p = cache.pos, o = index * 3, x = p[o], y = p[o + 1], z = p[o + 2]
  const idx = cache.idx, w = cache.w, b = cache.bone, iw = index * 4
  let ox = 0, oy = 0, oz = 0
  for (let k = 0; k < 4; k++) {
    const wt = w[iw + k]; if (wt === 0) continue
    const e = idx[iw + k] * 16
    ox += wt * (b[e] * x + b[e + 4] * y + b[e + 8] * z + b[e + 12])
    oy += wt * (b[e + 1] * x + b[e + 5] * y + b[e + 9] * z + b[e + 13])
    oz += wt * (b[e + 2] * x + b[e + 6] * y + b[e + 10] * z + b[e + 14])
  }
  return out.set(ox, oy, oz)
}

/** Every vertex, mesh-local, packed xyz. Used by the Spectral lines. */
export function skinAll(mesh: THREE.SkinnedMesh, cache: SkinCache, into: Float32Array) {
  bakeSkin(mesh, cache)
  const n = cache.count, p = cache.pos, idx = cache.idx, w = cache.w, b = cache.bone
  for (let i = 0; i < n; i++) {
    const o = i * 3, x = p[o], y = p[o + 1], z = p[o + 2], iw = i * 4
    let ox = 0, oy = 0, oz = 0
    for (let k = 0; k < 4; k++) {
      const wt = w[iw + k]; if (wt === 0) continue
      const e = idx[iw + k] * 16
      ox += wt * (b[e] * x + b[e + 4] * y + b[e + 8] * z + b[e + 12])
      oy += wt * (b[e + 1] * x + b[e + 5] * y + b[e + 9] * z + b[e + 13])
      oz += wt * (b[e + 2] * x + b[e + 6] * y + b[e + 10] * z + b[e + 14])
    }
    into[o] = ox; into[o + 1] = oy; into[o + 2] = oz
  }
}
