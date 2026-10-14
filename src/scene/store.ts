// Scene store: every device in the scene keeps its own settings, hand and screens; camera, lighting, background,
// effects, style and export are global and sit alongside. Stage 1 has one device; the shape is ready for several.
import { useMemo, useRef, useState, type SetStateAction } from 'react'
import type * as THREE from 'three'
import type { DeviceId, DeviceOptions } from '../types'
import type { HandPose } from '../hands/Hands'
import { SPECTRAL_DEFAULTS, type SpectralOptions } from '../hands/spectral'
import { GESTURE_DEFAULT, HAND_ROT0, type Gesture, type HandRot } from '../hands/gestures'
import type { IdleLevel } from '../hands/motion'
import { SB_DEFAULT, type SbCfg } from '../statusbar/config'
import { SKETCH_DEFAULTS } from '../sketch/Sketch'

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
})
const GLOBAL0: GlobalState = { pose: POSE, light: LIGHT, fx: FX, style: 'photo', sk: SKETCH_DEFAULTS, bgMode: 'gradient', bg1: '#dfe7ff', bg2: '#f7d9e8', angle: 135, transparent: false, scale: 2 }
const init = (): SceneState => { const d = newDevice(); return { devices: [d], selected: d.uid, global: GLOBAL0 } }

type Setter<T> = (v: SetStateAction<T>) => void
const resolve = <T,>(v: SetStateAction<T>, old: T) => typeof v === 'function' ? (v as (o: T) => T)(old) : v

/** The scene plus stable, useState-style setters for each field of the selected device and of the global settings.
 *  A setter that leaves the value unchanged leaves the whole scene unchanged, so it costs no re-render. */
export function useScene() {
  const [scene, setScene] = useState<SceneState>(init)
  const ref = useRef(scene); ref.current = scene
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
    const devKeys = ['model', 'opts', 'media', 'mediaOuter', 'mediaTo', 'sbOn', 'sb', 'sbReset', 'foldFollow', 'foldSpeed', 'foldDark', 'hands', 'spectral', 'gesture', 'handRot', 'idle'] as const
    const gloKeys = ['pose', 'light', 'fx', 'style', 'sk', 'bgMode', 'bg1', 'bg2', 'angle', 'transparent', 'scale'] as const
    return {
      dev: Object.fromEntries(devKeys.map(k => [k, dev(k)])) as { [K in typeof devKeys[number]]: Setter<DeviceState[K]> },
      glo: Object.fromEntries(gloKeys.map(k => [k, glo(k)])) as { [K in typeof gloKeys[number]]: Setter<GlobalState[K]> },
      select: (uid: string) => setScene(s => s.devices.some(d => d.uid === uid) ? { ...s, selected: uid } : s),
      get: () => ref.current,
    }
  }, [])
  const selected = scene.devices.find(d => d.uid === scene.selected) ?? scene.devices[0]
  return { scene, selected, ...api }
}
