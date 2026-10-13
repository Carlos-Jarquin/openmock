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
export function retryEnvironment() { hdr = null }

if (import.meta.hot) import.meta.hot.dispose(() => { hdr?.then(t => t.dispose()).catch(() => {}); hdr = null })

/** Studio HDRI (Poly Haven, CC0) for reflections only; falls back to a built-in room if the file can't load. */
export function Env({ intensity }: { intensity: number }) {
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
    if (!tex) return
    scene.environment = tex; scene.environmentIntensity = intensity
    return () => { if (scene.environment === tex) scene.environment = null }
  }, [scene, tex, intensity])
  return null
}
