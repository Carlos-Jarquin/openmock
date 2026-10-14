import type { ComponentType } from 'react'
import type * as THREE from 'three'
export type DeviceId = 'ip18' | 'ip18max' | 'duo' | 'ipmini' | 'ippro13' | 'ippro11' | 'mbp16' | 'imacg4' | 'phone' | 'browser'
export type Finish = string
export interface LogoArt { mask: THREE.Texture; aspect: number }
export interface DeviceOptions { fold: number; screen: 'inner' | 'outer'; finish: Finish; logo: LogoArt | null; logoSize: number; logoTint: string; simTray: boolean; /** hide the 3D Dynamic Island (and front lens) when the status bar draws the island */ hideIsland?: boolean
  /** Duo fold transition: progress 0 to 1 towards screen `to`; the outgoing screen blurs and fades, the incoming one sharpens. blur is the strength 0 to 1. */
  trans?: { p: number; to: 'inner' | 'outer' } | null; foldBlur?: number
  /** Duo: dissolve the screens by hinge angle on stills and while scrubbing too (default on). */
  foldDissolve?: boolean
  /** Duo: how each screen's media fits (fill crops to cover, the default; fit letterboxes). */
  fitInner?: 'fill' | 'fit'; fitOuter?: 'fill' | 'fit'
  /** MacBook Pro: lid angle in degrees (0 closed, 90 upright). iMac G4: display tilt in degrees (top back) and stand height 0 to 1. */
  lid?: number; tilt?: number; rise?: number }
export interface DeviceProps { texture: THREE.Texture | null; mediaAspect: number; opts: DeviceOptions
  /** Duo only: the outer screen's own media (the inner screen uses texture). */
  textureOuter?: THREE.Texture | null; mediaAspectOuter?: number
  /** the device's id in the scene, for per-device live state (Duo fold) */
  uid?: string }
export interface DeviceDef { id: DeviceId; label: string; screenAspect: number | ((o: DeviceOptions) => number); foldable?: boolean; finishes?: Record<string, { label: string }>; defaultFinish?: string; nativePx?: { w: number; h: number }; logoSpot?: boolean; Component: ComponentType<DeviceProps> }
