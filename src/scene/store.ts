// Scene store: every device in the scene keeps its own settings, hand and screens; camera, lighting, background,
// effects, style and export are global and sit alongside. Stage 1 has one device; the shape is ready for several.
import { useEffect, useMemo, useRef, useState, type SetStateAction } from 'react'
import type * as THREE from 'three'
import type { DeviceId, DeviceOptions } from '../types'
import type { HandPose } from '../hands/Hands'
import { SPECTRAL_DEFAULTS, type SpectralOptions } from '../hands/spectral'
import { GESTURE_DEFAULT, HAND_ROT0, type Gesture, type HandRot } from '../hands/gestures'
import type { IdleLevel } from '../hands/motion'
import { SB_DEFAULT, type SbCfg } from '../statusbar/config'
import { SKETCH_DEFAULTS } from '../sketch/Sketch'
import { XF0, type Xf } from '../timeline/tlCore'

export type Media = { texture: THREE.Texture; aspect: number; kind: 'image' | 'video'; name: string; video?: HTMLVideoElement; svg?: string; live?: boolean }
export const POSE = { tiltX: -10, tiltY: -30, rotZ: 0, zoom: 1, panX: 0, panY: 0, fov: 30 }
export type Pose = typeof POSE
export type LightPreset = 'soft' | 'apple' | 'violet'
export type BgMode = 'solid' | 'gradient' | 'streaks'
export const LIGHT = { preset: 'soft' as LightPreset, intensity: 1.6, azimuth: 35, elevation: 45, shadow: 0.45, env: 0.6, shadowOn: true, floor: 1.5 }
export const FX = { dof: false, focus: 0, blur: 2, bloom: false, grain: false }

/** Everything that belongs to one device: its model and options, both screens, status bar, Duo fold playback and its hand. */
export interface DeviceState {
  uid: string
  model: DeviceId
  opts: DeviceOptions
  media: Media | null
  mediaOuter: Media | null
  mediaTo: 'inner' | 'outer'
  sbOn: boolean
  sb: SbCfg
  sbReset: number
  foldFollow: boolean
  foldSpeed: number
  foldDark: number
  hands: { pose: HandPose; tone: string }
  spectral: SpectralOptions
  gesture: Gesture
  handRot: HandRot
  idle: IdleLevel
  /** shown name ('' = the model's name, numbered when there are several) */
  name: string
  hidden: boolean
  /** placement inside the view: position in scene units and rotation in degrees (all 0 for the first device) */
  xf: Xf
}
export interface GlobalState {
  pose: Pose
  light: typeof LIGHT
  fx: typeof FX
  style: 'photo' | 'sketch'
  sk: typeof SKETCH_DEFAULTS
  bgMode: BgMode
  bg1: string
  bg2: string
  angle: number
  transparent: boolean
  scale: number
}
export interface SceneState { devices: DeviceState[]; selected: string; global: GlobalState }

let n = 0
export const newDevice = (model: DeviceId = 'ip18'): DeviceState => ({
  uid: `dev-${++n}`, model,
  opts: { fold: 130, screen: 'inner', finish: 'silver', logo: null, logoSize: 0.16, logoTint: '#8a8f99', simTray: true },
  media: null, mediaOuter: null, mediaTo: 'inner',
  sbOn: true, // on by default (Carlos, Oct 13)
  sb: SB_DEFAULT, sbReset: 0,
  foldFollow: true, foldSpeed: 1, foldDark: 0,
  hands: { pose: 'off', tone: 'fair' }, spectral: SPECTRAL_DEFAULTS, gesture: GESTURE_DEFAULT, handRot: HAND_ROT0, idle: 'low',
  name: '', hidden: false, xf: XF0,
})
const GLOBAL0: GlobalState = { pose: POSE, light: LIGHT, fx: FX, style: 'photo', sk: SKETCH_DEFAULTS, bgMode: 'gradient', bg1: '#dfe7ff', bg2: '#f7d9e8', angle: 135, transparent: false, scale: 2 }
/** The device list and each device's settings persist (not screen media or the logo, which do not fit in storage). Device ids
 *  are kept, so per-device keyframes and screen clips still match after a reload. */
const SKEY = 'om-scene-v1'
const SAVE_SKIP = ['media', 'mediaOuter'] as const
function loadDevices(): { devices: DeviceState[]; selected: string } | null {
  try {
    const v = JSON.parse(localStorage.getItem(SKEY) || 'null'); if (!v || !Array.isArray(v.devices) || !v.devices.length) return null
    const devices: DeviceState[] = v.devices.filter((d: Partial<DeviceState>) => d && typeof d.uid === 'string' && typeof d.model === 'string').map((d: DeviceState) => {
      const base = newDevice(d.model)
      return { ...base, ...d, media: null, mediaOuter: null, opts: { ...base.opts, ...d.opts, logo: null, trans: null }, xf: { ...base.xf, ...d.xf } } })
    if (!devices.length) return null
    // carry on numbering after the highest saved id
    n = Math.max(n, ...devices.map(d => +(d.uid.match(/(\d+)$/)?.[1] ?? 0)))
    return { devices, selected: devices.some(d => d.uid === v.selected) ? v.selected : devices[0].uid }
  } catch { return null }
}
function saveDevices(s: SceneState) {
  try { localStorage.setItem(SKEY, JSON.stringify({ selected: s.selected, devices: s.devices.map(d => { const o: Record<string, unknown> = { ...d }; for (const k of SAVE_SKIP) delete o[k]; o.opts = { ...d.opts, logo: null, trans: null }; return o }) })) } catch { /* storage full: this session only */ }
}
const init = (): SceneState => { const l = loadDevices(); if (l) return { ...l, global: GLOBAL0 }; const d = newDevice(); return { devices: [d], selected: d.uid, global: GLOBAL0 } }

type Setter<T> = (v: SetStateAction<T>) => void
const resolve = <T,>(v: SetStateAction<T>, old: T) => typeof v === 'function' ? (v as (o: T) => T)(old) : v

/** The scene plus stable, useState-style setters for each field of the selected device and of the global settings.
 *  A setter that leaves the value unchanged leaves the whole scene unchanged, so it costs no re-render. */
export function useScene() {
  const [scene, setScene] = useState<SceneState>(init)
  const ref = useRef(scene); ref.current = scene
  // save the devices a moment after they change (not every frame of a drag)
  useEffect(() => { const t = setTimeout(() => saveDevices(scene), 300); return () => clearTimeout(t) }, [scene.devices, scene.selected])
  const api = useMemo(() => {
    const dev = <K extends keyof DeviceState>(k: K): Setter<DeviceState[K]> => v => setScene(s => {
      const i = s.devices.findIndex(d => d.uid === s.selected); if (i < 0) return s
      const d = s.devices[i], nv = resolve(v, d[k]); if (Object.is(nv, d[k])) return s
      const devices = s.devices.slice(); devices[i] = { ...d, [k]: nv }; return { ...s, devices }
    })
    const glo = <K extends keyof GlobalState>(k: K): Setter<GlobalState[K]> => v => setScene(s => {
      const nv = resolve(v, s.global[k]); if (Object.is(nv, s.global[k])) return s
      return { ...s, global: { ...s.global, [k]: nv } }
    })
    /** a setter for one field of any device, by uid */
    const devAt = <K extends keyof DeviceState>(uid: string, k: K, v: SetStateAction<DeviceState[K]>) => setScene(s => {
      const i = s.devices.findIndex(d => d.uid === uid); if (i < 0) return s
      const d = s.devices[i], nv = resolve(v, d[k]); if (Object.is(nv, d[k])) return s
      const devices = s.devices.slice(); devices[i] = { ...d, [k]: nv }; return { ...s, devices }
    })
    const devKeys = ['model', 'opts', 'media', 'mediaOuter', 'mediaTo', 'sbOn', 'sb', 'sbReset', 'foldFollow', 'foldSpeed', 'foldDark', 'hands', 'spectral', 'gesture', 'handRot', 'idle', 'name', 'hidden', 'xf'] as const
    const gloKeys = ['pose', 'light', 'fx', 'style', 'sk', 'bgMode', 'bg1', 'bg2', 'angle', 'transparent', 'scale'] as const
    return {
      dev: Object.fromEntries(devKeys.map(k => [k, dev(k)])) as { [K in typeof devKeys[number]]: Setter<DeviceState[K]> },
      glo: Object.fromEntries(gloKeys.map(k => [k, glo(k)])) as { [K in typeof gloKeys[number]]: Setter<GlobalState[K]> },
      select: (uid: string) => setScene(s => s.devices.some(d => d.uid === uid) ? { ...s, selected: uid } : s),
      get: () => ref.current,
      devAt,
      /** add a device (placed by the caller), select it and return its uid */
      add: (model: DeviceId, xf: Xf, from?: DeviceState) => { const d = from ? { ...from, uid: newDevice().uid, name: from.name ? `${from.name} copy` : '', hidden: false, xf } : { ...newDevice(model), xf }
        setScene(s => ({ ...s, devices: [...s.devices, d], selected: d.uid })); return d.uid },
      remove: (uid: string) => setScene(s => { if (s.devices.length < 2) return s
        const i = s.devices.findIndex(d => d.uid === uid); if (i < 0) return s
        const devices = s.devices.filter(d => d.uid !== uid)
        return { ...s, devices, selected: s.selected === uid ? devices[Math.max(0, i - 1)].uid : s.selected } }),
      /** move a device up or down the list */
      reorder: (uid: string, by: number) => setScene(s => { const i = s.devices.findIndex(d => d.uid === uid), j = i + by
        if (i < 0 || j < 0 || j >= s.devices.length) return s; const devices = s.devices.slice(); [devices[i], devices[j]] = [devices[j], devices[i]]; return { ...s, devices } }),
    }
  }, [])
  const selected = scene.devices.find(d => d.uid === scene.selected) ?? scene.devices[0]
  return { scene, selected, ...api }
}
