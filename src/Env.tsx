import { useEffect, useState } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

export const HDRI_URL = '/hdri/studio_small_08_1k.hdr'

// One HDRI load per page, shared by every mount. A failed load is forgotten so Try again re-fetches it.
let hdr: Promise<THREE.Texture> | null = null
function loadHdr() {
  return (hdr ??= new HDRLoader().loadAsync(HDRI_URL).then(t => { t.mapping = THREE.EquirectangularReflectionMapping; return t })
    .catch(e => { hdr = null; throw e }))
}
// Fallback studio lighting built in code, cached per renderer.
const rooms = new WeakMap<THREE.WebGLRenderer, THREE.Texture>()
function roomEnv(gl: THREE.WebGLRenderer) {
  let t = rooms.get(gl)
  if (!t) {
    const pm = new THREE.PMREMGenerator(gl), room = new RoomEnvironment()
    t = pm.fromScene(room, 0.04).texture; pm.dispose(); room.dispose(); rooms.set(gl, t)
  }
  return t
}
// "Apple studio": a black room lit only by a few bright strip softboxes, so dark finishes stay near-black
// and every edge picks up a crisp highlight. Built in code, cached per renderer.
const strips = new WeakMap<THREE.WebGLRenderer, THREE.Texture>()
function stripEnv(gl: THREE.WebGLRenderer) {
  let t = strips.get(gl)
  if (!t) {
    const sc = new THREE.Scene(); sc.background = new THREE.Color(0x020203)
    const box = (w: number, h: number, pos: [number, number, number], k: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(k, k, k), side: THREE.DoubleSide }))
      m.position.set(...pos); m.lookAt(0, 0, 0); sc.add(m)
    }
    box(1.2, 9, [-5, 0, 1.5], 6)    // tall strip, left
    box(1.2, 9, [5, 0, 1.5], 6)     // tall strip, right
    box(1.0, 9, [-4, 0, -4], 4)     // rear rims
    box(1.0, 9, [4, 0, -4], 4)
    box(7, 1.4, [0, 5, 0], 1.5)      // thin top strip
    box(3, 2, [0, 1, 6], 0.15)       // faint front fill so faces are not pure black
    const pm = new THREE.PMREMGenerator(gl)
    t = pm.fromScene(sc, 0.02).texture; pm.dispose()
    sc.traverse(o => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose() } })
    strips.set(gl, t)
  }
  return t
}
export function retryEnvironment() { hdr = null }

if (import.meta.hot) import.meta.hot.dispose(() => { hdr?.then(t => t.dispose()).catch(() => {}); hdr = null })

/** Studio HDRI (Poly Haven, CC0) for reflections only; falls back to a built-in room if the file can't load. */
export function Env({ intensity, mode = 'soft' }: { intensity: number; mode?: 'soft' | 'apple' }) {
  const { gl, scene } = useThree()
  const [tex, setTex] = useState<THREE.Texture | null>(null)
  useEffect(() => {
    let live = true
    loadHdr().then(t => { if (live) setTex(t) }, e => {
      console.warn('[Openmock] HDRI failed, using the built-in studio light instead:', e)
      if (live) setTex(roomEnv(gl))
    })
    return () => { live = false }
  }, [gl])
  useEffect(() => {
    const env = mode === 'apple' ? stripEnv(gl) : tex
    if (!env) return
    scene.environment = env; scene.environmentIntensity = intensity
    return () => { if (scene.environment === env) scene.environment = null }
  }, [scene, gl, tex, intensity, mode])
  return null
}
